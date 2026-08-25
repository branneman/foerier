import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server'
import { randomBytes } from 'node:crypto'
import type { Kysely } from 'kysely'

import type { Clock, IdSource } from '@foerier/shared'

import type { Database, InvitePurpose } from '../db/schema.ts'
import { isRedeemable } from './invite.ts'
import type { RpConfig } from './rp.ts'
import {
  deviceLabelFrom,
  isSignCountAcceptable,
  nextExpiry,
} from './session.ts'
import { generateInviteSecret, hashSecret, issueDeviceToken } from './tokens.ts'

/** Challenges live 5 minutes and are consumed on use (`auth-design.md` §9.2). */
const CHALLENGE_TTL_MS = 5 * 60 * 1000

/**
 * Deliberately one error for every way enrolment or sign-in can fail.
 *
 * An Invite that is unknown, expired, used, or revoked is indistinguishable to
 * the client, and so is a failed assertion. There are no usernames, so there is
 * no enumeration surface to protect — but there is also nothing to gain from
 * being specific, and plenty to lose (`auth-design.md` §9.4).
 */
export class AuthError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super('auth failed')
    this.name = 'AuthError'
    // Precise in the log, vague to the client.
    this.reason = reason
  }
}

export interface AuthContext {
  deviceId: string
  loginId: string
  householdId: string
  /**
   * Opaque to the server, echoed back so the client can resolve "you are Ada"
   * against its own folded state (`auth-design.md` §2.1).
   */
  personId: string
}

export interface AuthServiceDeps {
  db: Kysely<Database>
  clock: Clock
  ids: IdSource
  rp: RpConfig
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/** Returns a Buffer: node-postgres serialises those to `bytea` directly. */
function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

/**
 * Reads the challenge back out of the signed client data.
 *
 * This value is attacker-supplied and proves nothing on its own. It is only a
 * lookup key: what makes it trustworthy is {@link createAuthService}'s
 * `consumeChallenge`, which succeeds only for a challenge this server issued
 * and has not already spent — and the signature, which covers this very
 * clientDataJSON.
 */
function challengeFromClientData(clientDataJSON: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString())
  } catch {
    throw new AuthError('client data not JSON')
  }

  const challenge = (parsed as { challenge?: unknown }).challenge
  if (typeof challenge !== 'string')
    throw new AuthError('client data has no challenge')
  return challenge
}

export function createAuthService({ db, clock, ids, rp }: AuthServiceDeps) {
  async function storeChallenge(
    challenge: string,
    purpose: 'register' | 'login' | 'add-passkey',
    loginId: string | null,
  ): Promise<void> {
    // Expired rows are deleted lazily on write rather than by a cron job.
    await db
      .deleteFrom('webauthn_challenge')
      .where('expires_at', '<', new Date(clock.now()))
      .execute()

    await db
      .insertInto('webauthn_challenge')
      .values({
        id: ids.next(),
        challenge: fromBase64Url(challenge),
        purpose,
        login_id: loginId,
        expires_at: new Date(clock.now() + CHALLENGE_TTL_MS),
      })
      .execute()
  }

  /**
   * Consumes a challenge, or throws. Single-use is enforced by the update's
   * own `where consumed_at is null`, so two concurrent requests cannot both
   * win it.
   */
  async function consumeChallenge(
    challenge: string,
    purpose: 'register' | 'login' | 'add-passkey',
  ): Promise<void> {
    const consumed = await db
      .updateTable('webauthn_challenge')
      .set({ consumed_at: new Date(clock.now()) })
      .where('challenge', '=', fromBase64Url(challenge))
      .where('purpose', '=', purpose)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', new Date(clock.now()))
      .returning('id')
      .executeTakeFirst()

    if (consumed === undefined) throw new AuthError('challenge not valid')
  }

  async function findRedeemableInvite(secret: string) {
    const invite = await db
      .selectFrom('invite')
      .selectAll()
      .where('secret_hash', '=', hashSecret(secret))
      .executeTakeFirst()

    if (invite === undefined) throw new AuthError('invite unknown')
    if (!isRedeemable(invite, clock)) {
      throw new AuthError(`invite ${invite.purpose} not redeemable`)
    }
    return invite
  }

  return {
    /**
     * What the join screen needs to ask "Join Veldkamp?" before the user has
     * agreed to anything.
     *
     * Consumes nothing and stores nothing — not even a challenge — because
     * opening a link must change nothing at all (`auth-design.md` §3.3), and
     * because chat apps fetch links to build previews. Deliberately says
     * nothing about the Person beyond whether one is already recorded: names
     * live in the op log, which the server has no view of (§2.1).
     */
    async previewInvite({ secret }: { secret: string }): Promise<{
      householdName: string
      purpose: InvitePurpose
      expiresAt: Date
      personId: string
      /**
       * False for a brand-new Household's first Invite, which is what sends
       * the client down the "name yourself" path (`docs/design/README.md` §9).
       */
      personRecorded: boolean
    }> {
      const invite = await findRedeemableInvite(secret)

      const household = await db
        .selectFrom('household')
        .select('name')
        .where('id', '=', invite.household_id)
        .executeTakeFirst()

      if (household === undefined) throw new AuthError('household missing')

      // A Person exists only as the fold of an op log, so the server can never
      // answer "is this Person recorded" directly. What it can say is whether
      // this Household has any Login yet — and a Household with none is
      // necessarily one whose first Person is created as they join.
      const anyLogin = await db
        .selectFrom('login')
        .select('id')
        .where('household_id', '=', invite.household_id)
        .executeTakeFirst()

      return {
        householdName: household.name,
        purpose: invite.purpose,
        expiresAt: invite.expires_at,
        personId: invite.person_id,
        personRecorded: anyLogin !== undefined,
      }
    },

    /**
     * Step 1 of joining. Validates the Invite and returns creation options.
     *
     * Reading an Invite here consumes nothing: redemption happens only on the
     * explicit POST in {@link finishRegistration}, because chat apps and mail
     * scanners fetch links to build previews (`auth-design.md` §3.3).
     */
    async beginRegistration({
      secret,
    }: {
      secret: string
    }): Promise<PublicKeyCredentialCreationOptionsJSON> {
      // Validates the Invite and throws if it is not redeemable. Nothing is
      // consumed here — redemption is the explicit POST in
      // finishRegistration, because link previews fetch URLs (§3.3).
      await findRedeemableInvite(secret)

      const options = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpId,
        // Never the Person's name or any household data: user handles are
        // stored by the authenticator and may be displayed by password
        // managers (auth-design.md §3.5).
        userName: 'foerier',
        userID: new Uint8Array(randomBytes(32)),
        attestationType: 'none',
        authenticatorSelection: {
          // Discoverable, so sign-in needs no username.
          residentKey: 'required',
          // "preferred", not "required": required would hard-fail on setups
          // that cannot perform UV at all, turning a UV gap into a lockout on
          // exactly the devices the compatibility floor protects (§4).
          userVerification: 'preferred',
        },
      })

      await storeChallenge(options.challenge, 'register', null)
      return options
    },

    /**
     * Step 3 of joining: verify, then create the Login, store the credential,
     * consume the Invite, and issue this Device's token — **in one
     * transaction**, so a double-tap cannot yield two Logins.
     */
    async finishRegistration({
      secret,
      response,
      userAgent,
    }: {
      secret: string
      response: RegistrationResponseJSON
      userAgent: string | undefined
    }): Promise<{ token: string; context: AuthContext; personId: string }> {
      const invite = await findRedeemableInvite(secret)
      if (invite.purpose !== 'join') throw new AuthError('invite not a join')

      // Consume BEFORE verifying. A challenge is single-use whether or not the
      // assertion turns out to be valid, so a failed attempt cannot be replayed
      // against the same challenge. The update is atomic, so two simultaneous
      // redemptions cannot both spend it.
      const challenge = challengeFromClientData(
        response.response.clientDataJSON,
      )
      await consumeChallenge(challenge, 'register')

      let verification
      try {
        verification = await verifyRegistrationResponse({
          response,
          expectedChallenge: challenge,
          expectedOrigin: rp.allowedOrigins,
          expectedRPID: rp.rpId,
          // Matches `userVerification: "preferred"`. The flag we actually saw
          // is recorded per credential, so tightening the policy later is not
          // a migration (auth-design.md §4).
          requireUserVerification: false,
        })
      } catch (cause) {
        throw new AuthError(`registration did not verify: ${String(cause)}`)
      }

      if (!verification.verified) throw new AuthError('registration unverified')
      const { credential, aaguid, userVerified } = verification.registrationInfo

      const { token, tokenHash } = issueDeviceToken()
      const loginId = ids.next()
      const deviceId = ids.next()

      await db.transaction().execute(async (trx) => {
        // Re-check inside the transaction and claim the Invite with the same
        // statement. `where used_at is null` is what actually enforces
        // single-use: two simultaneous redemptions race here, and exactly one
        // updates a row.
        const claimed = await trx
          .updateTable('invite')
          .set({ used_at: new Date(clock.now()) })
          .where('id', '=', invite.id)
          .where('used_at', 'is', null)
          .where('revoked_at', 'is', null)
          .returning('id')
          .executeTakeFirst()

        if (claimed === undefined) throw new AuthError('invite already used')

        await trx
          .insertInto('login')
          .values({
            id: loginId,
            household_id: invite.household_id,
            person_id: invite.person_id,
          })
          .execute()

        await trx
          .insertInto('passkey')
          .values({
            id: ids.next(),
            login_id: loginId,
            credential_id: fromBase64Url(credential.id),
            public_key: credential.publicKey,
            sign_count: credential.counter,
            transports:
              credential.transports === undefined
                ? null
                : JSON.stringify(credential.transports),
            aaguid,
            uv_seen: userVerified,
            label: deviceLabelFrom(userAgent),
          })
          .execute()

        await trx
          .insertInto('device')
          .values({
            id: deviceId,
            login_id: loginId,
            household_id: invite.household_id,
            token_hash: tokenHash,
            label: deviceLabelFrom(userAgent),
            expires_at: nextExpiry(clock),
            // Explicit rather than left to the column's `now()` default: this
            // value is later compared against the injected clock by
            // `shouldRefreshLastSeen`, so a row stamped by Postgres instead
            // mixes two clocks in one comparison.
            last_seen_at: new Date(clock.now()),
          })
          .execute()
      })

      return {
        token,
        context: {
          deviceId,
          loginId,
          householdId: invite.household_id,
          personId: invite.person_id,
        },
        personId: invite.person_id,
      }
    },

    /**
     * Username-less by construction: an empty `allowCredentials` is what lets
     * the authenticator pick the credential it already holds for
     * `foerier.app`, so the sign-in screen is one button and no text field.
     */
    async beginLogin(): Promise<PublicKeyCredentialRequestOptionsJSON> {
      const options = await generateAuthenticationOptions({
        rpID: rp.rpId,
        allowCredentials: [],
        userVerification: 'preferred',
      })

      await storeChallenge(options.challenge, 'login', null)
      return options
    },

    async finishLogin({
      response,
      userAgent,
    }: {
      response: AuthenticationResponseJSON
      userAgent: string | undefined
    }): Promise<{ token: string; context: AuthContext; personId: string }> {
      const credentialId = fromBase64Url(response.id)

      const row = await db
        .selectFrom('passkey')
        .innerJoin('login', 'login.id', 'passkey.login_id')
        .select([
          'passkey.id as passkey_id',
          'passkey.credential_id',
          'passkey.public_key',
          'passkey.sign_count',
          'passkey.transports',
          'login.id as login_id',
          'login.household_id',
          'login.person_id',
          'login.disabled_at',
        ])
        .where('passkey.credential_id', '=', credentialId)
        .executeTakeFirst()

      if (row === undefined) throw new AuthError('credential unknown')
      if (row.disabled_at !== null) throw new AuthError('login disabled')

      const challenge = challengeFromClientData(
        response.response.clientDataJSON,
      )
      await consumeChallenge(challenge, 'login')

      let verification
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challenge,
          expectedOrigin: rp.allowedOrigins,
          expectedRPID: rp.rpId,
          credential: {
            id: response.id,
            publicKey: new Uint8Array(row.public_key),
            counter: row.sign_count,
            ...(row.transports === null
              ? {}
              : {
                  // Stored as jsonb; the enum is WebAuthn's, and an unknown
                  // transport is the browser's business, not ours.
                  transports: row.transports as NonNullable<
                    WebAuthnCredential['transports']
                  >,
                }),
          },
          requireUserVerification: false,
        })
      } catch (cause) {
        throw new AuthError(`assertion did not verify: ${String(cause)}`)
      }

      if (!verification.verified) throw new AuthError('assertion unverified')

      const { newCounter, userVerified } = verification.authenticationInfo
      if (
        !isSignCountAcceptable({ stored: row.sign_count, received: newCounter })
      ) {
        throw new AuthError('signature counter did not advance')
      }

      const { token, tokenHash } = issueDeviceToken()
      const deviceId = ids.next()

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('passkey')
          .set({
            sign_count: newCounter,
            last_used_at: new Date(clock.now()),
            uv_seen: userVerified,
          })
          .where('id', '=', row.passkey_id)
          .execute()

        await trx
          .insertInto('device')
          .values({
            id: deviceId,
            login_id: row.login_id,
            household_id: row.household_id,
            token_hash: tokenHash,
            label: deviceLabelFrom(userAgent),
            expires_at: nextExpiry(clock),
            // Explicit rather than left to the column's `now()` default: this
            // value is later compared against the injected clock by
            // `shouldRefreshLastSeen`, so a row stamped by Postgres instead
            // mixes two clocks in one comparison.
            last_seen_at: new Date(clock.now()),
          })
          .execute()
      })

      return {
        token,
        context: {
          deviceId,
          loginId: row.login_id,
          householdId: row.household_id,
          personId: row.person_id,
        },
        personId: row.person_id,
      }
    },

    async signOut(context: AuthContext): Promise<void> {
      await db
        .updateTable('device')
        .set({ revoked_at: new Date(clock.now()) })
        .where('id', '=', context.deviceId)
        .execute()
    },

    /**
     * Mints a Household and its first join Invite. Used only by the Maintainer
     * bootstrap script (`auth-design.md` §3.4).
     */
    async bootstrapHousehold({ name }: { name: string }): Promise<{
      householdId: string
      personId: string
      secret: string
      expiresAt: Date
    }> {
      const householdId = ids.next()
      // A brand-new Household has no ops, therefore no People, so nothing
      // exists to bind the Invite to. Minting the Person's id here and having
      // onboarding emit `person.recorded` with this exact id is what keeps
      // "a Login is always a Person" true from the very first second, without
      // the script knowing anything about the domain.
      const personId = ids.next()
      const { secret, secretHash } = generateInviteSecret()
      const expiresAt = new Date(clock.now() + 7 * 24 * 60 * 60 * 1000)

      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('household')
          .values({ id: householdId, name })
          .execute()

        await trx
          .insertInto('invite')
          .values({
            id: ids.next(),
            household_id: householdId,
            person_id: personId,
            purpose: 'join',
            secret_hash: secretHash,
            login_id: null,
            created_by_login: null,
            expires_at: expiresAt,
          })
          .execute()
      })

      return { householdId, personId, secret, expiresAt }
    },
  }
}

export type AuthService = ReturnType<typeof createAuthService>

export { toBase64Url, fromBase64Url }
