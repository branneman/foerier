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
import { inviteExpiry, isRedeemable } from './invite.ts'
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

  /**
   * The one insert a device-link Invite ever needs, shared by the two ways
   * of asking for one: {@link mintDeviceLink} (Maintainer script, no signed-in
   * caller, `created_by_login` null) and `issueDeviceLink` (a signed-in
   * Device issuing one for itself, `created_by_login` its own Login).
   *
   * Everything about the row is identical between the two callers except
   * whose Login vouches for it — so they share this insert rather than each
   * repeating the six-field shape and risking one drifting from the other.
   */
  async function insertDeviceLinkInvite({
    householdId,
    personId,
    loginId,
    createdByLogin,
  }: {
    householdId: string
    personId: string
    loginId: string
    createdByLogin: string | null
  }): Promise<{ inviteId: string; secret: string; expiresAt: Date }> {
    const inviteId = ids.next()
    const { secret, secretHash } = generateInviteSecret()
    const expiresAt = inviteExpiry('device', clock)

    await db
      .insertInto('invite')
      .values({
        id: inviteId,
        household_id: householdId,
        person_id: personId,
        purpose: 'device',
        secret_hash: secretHash,
        login_id: loginId,
        created_by_login: createdByLogin,
        // A device link never creates a Person; the value is inert here and
        // stated only because the column has no default.
        person_recorded: true,
        expires_at: expiresAt,
      })
      .execute()

    return { inviteId, secret, expiresAt }
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
       * False when the joiner names themselves — the client then emits
       * `person.recorded` with this Invite's `person_id`
       * (`docs/design/README.md` §9, "Name yourself").
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

      return {
        householdName: household.name,
        purpose: invite.purpose,
        expiresAt: invite.expires_at,
        personId: invite.person_id,
        // Read, not derived. The issuer knew; the row remembers.
        personRecorded: invite.person_recorded,
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
      const passkeyId = ids.next()

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

        // Inserted before the passkey row: `passkey.created_on_device` is a
        // non-deferred FK against `device.id`, so the Device must already
        // exist in this transaction by the time the Passkey references it.
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

        await trx
          .insertInto('passkey')
          .values({
            id: passkeyId,
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
            created_on_device: deviceId,
          })
          .execute()

        // Recorded by an update rather than in the insert above, because the
        // Passkey does not exist yet when the Device row is written. The two
        // FKs end up pointing at each other, which is legal precisely because
        // both are nullable — and they are two different facts:
        // `created_on_device` is which Device enrolled this Passkey,
        // `passkey_id` is which Passkey signed this Device in
        // (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §3).
        await trx
          .updateTable('device')
          .set({ passkey_id: passkeyId })
          .where('id', '=', deviceId)
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
     * The compatibility floor (`auth-design.md` §5): a token for a Device that
     * holds no credential and may never be able to hold one.
     *
     * Serves **both** Invite kinds. A device Invite signs its Login in; a join
     * Invite creates the Login first, exactly as {@link finishRegistration}
     * does, minus the Passkey — so a Person's very first Device can be one
     * that cannot make a credential.
     */
    async claimDevice({
      secret,
      userAgent,
    }: {
      secret: string
      response?: never
      userAgent: string | undefined
    }): Promise<{ token: string; context: AuthContext; personId: string }> {
      const invite = await findRedeemableInvite(secret)

      // A device Invite names its Login; a join Invite creates one. Anything
      // else is a row we did not write.
      if (invite.purpose === 'device' && invite.login_id === null) {
        throw new AuthError('device invite has no login')
      }

      const { token, tokenHash } = issueDeviceToken()
      const loginId = invite.login_id ?? ids.next()
      const deviceId = ids.next()
      // For a join Invite this is the Person minted alongside the new Login
      // (`invite.person_id`, same as `finishRegistration`). For a device
      // Invite it is overwritten below with the *existing* Login's own
      // `person_id` — a device Invite's `person_id` column is not read as
      // authoritative, because the Person who owns the Login being signed
      // into is a fact of the Login row, not of the Invite that named it.
      let personId = invite.person_id

      await db.transaction().execute(async (trx) => {
        // Claim the Invite with the same statement that checks it. `where
        // used_at is null` is what enforces single-use: two simultaneous
        // redemptions race here and exactly one updates a row.
        const claimed = await trx
          .updateTable('invite')
          .set({ used_at: new Date(clock.now()) })
          .where('id', '=', invite.id)
          .where('used_at', 'is', null)
          .where('revoked_at', 'is', null)
          .returning('id')
          .executeTakeFirst()

        if (claimed === undefined) throw new AuthError('invite already used')

        if (invite.purpose === 'join') {
          await trx
            .insertInto('login')
            .values({
              id: loginId,
              household_id: invite.household_id,
              person_id: invite.person_id,
            })
            .execute()
        } else {
          // A Device for a Login that has since been disabled would 401 on its
          // very first request; refusing here is the same answer, earlier and
          // truthfully. Read inside the transaction so a concurrent disable
          // cannot slip past the check.
          //
          // The `household_id` filter is not load-bearing today — both
          // writers of a device Invite (`mintDeviceLink`, `issueDeviceLink`)
          // source `household_id` and `login_id` from the same row, so the
          // two can never disagree in practice. It is here so that stays
          // true structurally rather than by accident: `requireAuth` reads
          // `householdId` off `device` and `loginId`/`personId` off the
          // joined `login` (`middleware.ts`), so an Invite whose household
          // disagreed with its Login's would otherwise mint an auth context
          // split across two households — tenancy's worst failure mode
          // (`final-review.md` finding 9).
          const login = await trx
            .selectFrom('login')
            .select(['id', 'person_id', 'disabled_at', 'household_id'])
            .where('id', '=', loginId)
            .where('household_id', '=', invite.household_id)
            .executeTakeFirst()

          if (login === undefined) throw new AuthError('login unknown')
          if (login.disabled_at !== null) throw new AuthError('login disabled')
          personId = login.person_id
        }

        await trx
          .insertInto('device')
          .values({
            id: deviceId,
            login_id: loginId,
            household_id: invite.household_id,
            token_hash: tokenHash,
            label: deviceLabelFrom(userAgent),
            expires_at: nextExpiry(clock),
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
          personId,
        },
        personId,
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
            // Which Passkey signed this Device in. `/test/reset` spares it
            // when it wipes a disposable Household's credentials
            // (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §3).
            passkey_id: row.passkey_id,
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
     *
     * `disposable` marks the Household as one `/test/reset` may wipe. It is
     * the third of that route's three gates, and this is the only code path
     * that can set it — which is what stops a typo in an environment variable
     * from pointing the wipe at a real Household
     * (`docs/specs/2026-08-28-tier-4-and-5-against-production.md` §3.1).
     */
    async bootstrapHousehold({
      name,
      disposable = false,
    }: {
      name: string
      disposable?: boolean
    }): Promise<{
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
          .values({ id: householdId, name, disposable })
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
            // A brand-new Household has no ops, so its first Person is
            // created as they join.
            person_recorded: false,
            expires_at: expiresAt,
          })
          .execute()
      })

      return { householdId, personId, secret, expiresAt }
    },

    /**
     * A join Invite into a Household that already exists.
     *
     * `auth-design.md` §3.4 puts only a Household's *first* Login out of band,
     * and every later Invite is meant to be issued in-app against a Person the
     * inviter picked. Until S5 builds that picker there is no route at all for
     * a second Login, so this is the Maintainer's stand-in: it pre-binds a
     * fresh Person id exactly as the bootstrap does, and the joiner names
     * themselves.
     */
    async mintJoinInvite({ householdId }: { householdId: string }): Promise<{
      personId: string
      secret: string
      expiresAt: Date
    }> {
      const household = await db
        .selectFrom('household')
        .select('id')
        .where('id', '=', householdId)
        .executeTakeFirst()
      if (household === undefined) throw new AuthError('household unknown')

      const personId = ids.next()
      const { secret, secretHash } = generateInviteSecret()
      const expiresAt = inviteExpiry('join', clock)

      await db
        .insertInto('invite')
        .values({
          id: ids.next(),
          household_id: householdId,
          person_id: personId,
          purpose: 'join',
          secret_hash: secretHash,
          login_id: null,
          created_by_login: null,
          person_recorded: false,
          expires_at: expiresAt,
        })
        .execute()

      return { personId, secret, expiresAt }
    },

    /**
     * A device link for an existing Login, minted with server access.
     *
     * `auth-design.md` §5 names the case this exists for — a Household with one
     * Login and no passkey, signed in nowhere — as "the single case in this
     * design that leaves the product". Until now it had a sentence and no
     * mechanism.
     */
    async mintDeviceLink({ loginId }: { loginId: string }): Promise<{
      householdId: string
      secret: string
      expiresAt: Date
    }> {
      const login = await db
        .selectFrom('login')
        .select(['id', 'household_id', 'person_id', 'disabled_at'])
        .where('id', '=', loginId)
        .executeTakeFirst()

      if (login === undefined) throw new AuthError('login unknown')
      if (login.disabled_at !== null) throw new AuthError('login disabled')

      const { secret, expiresAt } = await insertDeviceLinkInvite({
        householdId: login.household_id,
        personId: login.person_id,
        loginId,
        createdByLogin: null,
      })

      return { householdId: login.household_id, secret, expiresAt }
    },

    /**
     * A device link for the *caller's own* Login, issued from a signed-in
     * Device — the in-app counterpart to {@link mintDeviceLink}'s Maintainer
     * script. Everything comes from the auth context, never a request body:
     * `household_id`, `person_id` and `login_id` are all attested by the
     * bearer token the middleware already verified, so there is no lookup
     * to repeat and no tenancy check to get wrong.
     */
    async issueDeviceLink(context: AuthContext): Promise<{
      inviteId: string
      secret: string
      expiresAt: Date
    }> {
      return insertDeviceLinkInvite({
        householdId: context.householdId,
        personId: context.personId,
        loginId: context.loginId,
        createdByLogin: context.loginId,
      })
    },

    /**
     * Invites this Login issued and has not spent. Never returns the secret:
     * it exists only in the link, and the row holds a hash (§3.1).
     */
    async listInvites(
      context: AuthContext,
    ): Promise<Array<{ id: string; purpose: InvitePurpose; expiresAt: Date }>> {
      const rows = await db
        .selectFrom('invite')
        .select(['id', 'purpose', 'expires_at'])
        .where('household_id', '=', context.householdId)
        .where('created_by_login', '=', context.loginId)
        .where('used_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', new Date(clock.now()))
        .orderBy('expires_at')
        .execute()

      return rows.map((row) => ({
        id: row.id,
        purpose: row.purpose,
        expiresAt: row.expires_at,
      }))
    },

    /** Kills the link, never any data. Scoped to the caller's own Household. */
    async revokeInvite(context: AuthContext, inviteId: string): Promise<void> {
      await db
        .updateTable('invite')
        .set({ revoked_at: new Date(clock.now()) })
        .where('id', '=', inviteId)
        .where('household_id', '=', context.householdId)
        .where('created_by_login', '=', context.loginId)
        .execute()
    },

    /**
     * Every Device signed in as this Login. Coarse labels only — no IPs, no
     * fingerprinting (`docs/design/README.md` §12).
     */
    async listDevices(context: AuthContext): Promise<
      Array<{
        id: string
        label: string | null
        createdAt: Date
        lastSeenAt: Date
        current: boolean
        enrolledPasskeyHere: boolean
      }>
    > {
      const rows = await db
        .selectFrom('device')
        .leftJoin('passkey', 'passkey.created_on_device', 'device.id')
        .select(({ fn }) => [
          'device.id as id',
          'device.label as label',
          'device.created_at as created_at',
          'device.last_seen_at as last_seen_at',
          fn.count<string>('passkey.id').as('passkeys'),
        ])
        .where('device.login_id', '=', context.loginId)
        .where('device.revoked_at', 'is', null)
        // The one-year sliding expiry (`session.ts`'s `nextExpiry`) is what
        // `requireAuth` enforces (`middleware.ts:68-70`) — a Device past it
        // is already 401'd there. Without this filter it would still be
        // rendered as signed in and counted here: safe only because nothing
        // in this database is a year old yet (`final-review.md` finding 8).
        .where('device.expires_at', '>', new Date(clock.now()))
        .groupBy([
          'device.id',
          'device.label',
          'device.created_at',
          'device.last_seen_at',
        ])
        .orderBy('device.last_seen_at', 'desc')
        .execute()

      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        current: row.id === context.deviceId,
        // Enrolment, not reachability: a credential synced through a password
        // manager works on Devices that never enrolled it, and the server
        // cannot see that. The board's line says what happened here.
        enrolledPasskeyHere: Number(row.passkeys) > 0,
      }))
    },

    /**
     * Cuts a Device off. Scoped to the caller's own Login: cross-Login
     * revocation is `DELETE /auth/logins/:id`, which is story 28's.
     */
    async revokeDevice(context: AuthContext, deviceId: string): Promise<void> {
      await db
        .updateTable('device')
        .set({ revoked_at: new Date(clock.now()) })
        .where('id', '=', deviceId)
        .where('login_id', '=', context.loginId)
        .execute()
    },

    /**
     * Creation options for an additional Passkey on an already-signed-in
     * Login. The same ceremony as joining (§3.5), authenticated, appending
     * rather than creating.
     */
    async beginAddPasskey(
      context: AuthContext,
    ): Promise<PublicKeyCredentialCreationOptionsJSON> {
      const existing = await db
        .selectFrom('passkey')
        .select('credential_id')
        .where('login_id', '=', context.loginId)
        .execute()

      const options = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpId,
        userID: randomBytes(32),
        // Never the Person's name or any household data: user handles are
        // stored by the authenticator and may be displayed by password
        // managers (auth-design.md §3.5).
        userName: context.loginId,
        attestationType: 'none',
        // Offering to make a second credential for one already present is a
        // confusing prompt, not a security hole — but the authenticator can
        // refuse cleanly if we say so.
        excludeCredentials: existing.map((row) => ({
          id: toBase64Url(row.credential_id),
        })),
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'preferred',
        },
      })

      await storeChallenge(options.challenge, 'add-passkey', context.loginId)
      return options
    },

    async finishAddPasskey({
      context,
      response,
      label,
      userAgent,
    }: {
      context: AuthContext
      response: RegistrationResponseJSON
      label: string | null
      userAgent: string | undefined
    }): Promise<{ passkeyId: string }> {
      const challenge = challengeFromClientData(
        response.response.clientDataJSON,
      )
      await consumeChallenge(challenge, 'add-passkey')

      let verification
      try {
        verification = await verifyRegistrationResponse({
          response,
          expectedChallenge: challenge,
          expectedOrigin: rp.allowedOrigins,
          expectedRPID: rp.rpId,
          requireUserVerification: false,
        })
      } catch (cause) {
        throw new AuthError(`add-passkey did not verify: ${String(cause)}`)
      }

      if (!verification.verified) throw new AuthError('add-passkey unverified')
      const { credential, aaguid, userVerified } = verification.registrationInfo

      const passkeyId = ids.next()
      const trimmed = label?.trim()

      await db
        .insertInto('passkey')
        .values({
          id: passkeyId,
          login_id: context.loginId,
          credential_id: fromBase64Url(credential.id),
          public_key: credential.publicKey,
          sign_count: credential.counter,
          transports:
            credential.transports === undefined
              ? null
              : JSON.stringify(credential.transports),
          aaguid,
          uv_seen: userVerified,
          // Named at the moment of adding, which is the only moment the person
          // reliably knows what the thing is (spec §6.5). An empty field still
          // produces a useful row. Renaming later is story 37, Later.
          label:
            trimmed === undefined || trimmed === ''
              ? deviceLabelFrom(userAgent)
              : trimmed.slice(0, 60),
          created_on_device: context.deviceId,
        })
        .execute()

      return { passkeyId }
    },

    async listPasskeys(context: AuthContext): Promise<
      Array<{
        id: string
        label: string | null
        createdAt: Date
        lastUsedAt: Date | null
      }>
    > {
      const rows = await db
        .selectFrom('passkey')
        .select(['id', 'label', 'created_at', 'last_used_at'])
        .where('login_id', '=', context.loginId)
        .orderBy('created_at')
        .execute()

      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      }))
    },

    /**
     * Removing the **last** one is allowed and warned about in the UI, not
     * blocked: it drops the Login to the device-link-only mode of §5 rather
     * than locking it out.
     */
    async removePasskey(
      context: AuthContext,
      passkeyId: string,
    ): Promise<void> {
      await db
        .deleteFrom('passkey')
        .where('id', '=', passkeyId)
        .where('login_id', '=', context.loginId)
        .execute()
    },

    /** The household's name, which unlike the Person's is a server fact. */
    async me(context: AuthContext): Promise<{ householdName: string }> {
      const household = await db
        .selectFrom('household')
        .select('name')
        .where('id', '=', context.householdId)
        .executeTakeFirst()

      if (household === undefined) throw new AuthError('household missing')
      return { householdName: household.name }
    },

    /** The Maintainer's only window onto who exists. Reads nothing secret. */
    async listHouseholds(): Promise<
      Array<{
        id: string
        name: string
        logins: Array<{
          id: string
          personId: string
          createdAt: Date
          devices: number
        }>
      }>
    > {
      const households = await db
        .selectFrom('household')
        .select(['id', 'name'])
        .orderBy('name')
        .execute()

      const logins = await db
        .selectFrom('login')
        .leftJoin('device', (join) =>
          join
            .onRef('device.login_id', '=', 'login.id')
            .on('device.revoked_at', 'is', null),
        )
        .select(({ fn }) => [
          'login.id as id',
          'login.household_id as household_id',
          'login.person_id as person_id',
          'login.created_at as created_at',
          fn.count<string>('device.id').as('devices'),
        ])
        .groupBy([
          'login.id',
          'login.household_id',
          'login.person_id',
          'login.created_at',
        ])
        .execute()

      return households.map((household) => ({
        id: household.id,
        name: household.name,
        logins: logins
          .filter((login) => login.household_id === household.id)
          .map((login) => ({
            id: login.id,
            personId: login.person_id,
            createdAt: login.created_at,
            // `count` reaches the driver as a string; see `db/index.ts`.
            devices: Number(login.devices),
          })),
      }))
    },
  }
}

export type AuthService = ReturnType<typeof createAuthService>

export { toBase64Url, fromBase64Url }
