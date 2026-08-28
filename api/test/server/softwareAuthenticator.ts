import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers'
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto'

/**
 * A real, minimal WebAuthn authenticator in software.
 *
 * `docs/testing.md` is explicit that boundaries get real in-memory fakes
 * rather than mocking-framework mocks, and WebAuthn is the boundary where that
 * matters most: a mocked ceremony would assert that our code calls a library,
 * which is worth nothing. This thing actually generates a P-256 keypair,
 * actually builds authenticator data, and actually signs — so
 * `@simplewebauthn/server` verifies it the same way it verifies a real phone,
 * and a mistake in our challenge, origin, or RP ID handling shows up as a
 * failed signature rather than a passing mock.
 *
 * It implements only what foerier uses: ES256, `none` attestation, and
 * discoverable credentials.
 */

const AAGUID = new Uint8Array(16) // all-zero, as `none` attestation reports

const FLAG_UP = 0x01 // user present
const FLAG_UV = 0x04 // user verified
const FLAG_AT = 0x40 // attested credential data included

function sha256(data: Uint8Array | string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(data).digest())
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function uint32(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, false)
  return out
}

function uint16(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value, false)
  return out
}

/**
 * One credential, in the two encodings a replay needs.
 *
 * Deliberately the encodings the *consumers* want rather than the ones this
 * file finds convenient: the private key is base64 of PKCS#8 DER, which is
 * exactly what Chrome's CDP `WebAuthn.addCredential` takes, so a single pair
 * of CI secrets serves both the browser (Tier 5) and this class (Tier 4).
 * See `docs/specs/2026-08-28-tier-4-and-5-against-production.md` §6.4.
 */
export interface ExportedCredential {
  /** base64, standard alphabet — PKCS#8 DER. */
  privateKey: string
  /** base64url, as WebAuthn ids are everywhere else. */
  credentialId: string
}

export interface SoftwareAuthenticatorOptions {
  origin: string
  rpId: string
  /**
   * Whether the authenticator claims to have verified the user. A device that
   * cannot do UV still reports user *presence*, which is the case the
   * "preferred" policy exists to keep working.
   */
  userVerified?: boolean
  /**
   * The count reported by the *first* assertion; `get()` advances it from
   * there, as a real authenticator does. 0 is the default because that is
   * what a synced passkey reports, and the configuration most real
   * credentials will have.
   */
  signCount?: number
  /**
   * A credential from {@link SoftwareAuthenticator.export}, replayed instead
   * of generating a fresh one. This is how Tier 4 signs in against the
   * deployed box with no browser and no ceremony state — only two secrets.
   */
  credential?: ExportedCredential
}

export class SoftwareAuthenticator {
  private readonly privateKey: KeyObject
  private readonly coseKey: Uint8Array<ArrayBuffer>
  private readonly credentialId: Uint8Array<ArrayBuffer>
  private readonly origin: string
  private readonly rpId: string
  private readonly userVerified: boolean

  signCount: number

  constructor({
    origin,
    rpId,
    userVerified = true,
    signCount = 0,
    credential,
  }: SoftwareAuthenticatorOptions) {
    this.origin = origin
    this.rpId = rpId
    this.userVerified = userVerified
    this.signCount = signCount

    if (credential === undefined) {
      const generated = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      this.privateKey = createPrivateKey(
        generated.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      )
      // Must be random, not derived: two authenticators in one test would
      // otherwise collide on the `credential_id` unique index, and a real
      // authenticator never reuses one either.
      this.credentialId = new Uint8Array(randomBytes(32))
    } else {
      this.privateKey = createPrivateKey({
        key: Buffer.from(credential.privateKey, 'base64'),
        format: 'der',
        type: 'pkcs8',
      })
      this.credentialId = new Uint8Array(
        isoBase64URL.toBuffer(credential.credentialId),
      )
    }

    // Derived from the private key rather than carried alongside it, so the
    // replayed and the generated case cannot disagree about which public key
    // belongs to the signature.
    const jwk = createPublicKey(this.privateKey).export({ format: 'jwk' }) as {
      x: string
      y: string
    }

    // COSE_Key for ES256 (RFC 8152): kty=EC2(2), alg=ES256(-7),
    // crv=P-256(1), plus the raw x and y coordinates.
    this.coseKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x)],
        [-3, isoBase64URL.toBuffer(jwk.y)],
      ]) as never,
    )
  }

  get credentialIdB64(): string {
    return isoBase64URL.fromBuffer(this.credentialId)
  }

  /**
   * The credential, in a form another authenticator — or Chrome's virtual one
   * — can be seeded with. The sign count is deliberately not part of it: it is
   * per-run state (spec §5.2), not part of the credential.
   */
  export(): ExportedCredential {
    return {
      privateKey: this.privateKey
        .export({ format: 'der', type: 'pkcs8' })
        .toString('base64'),
      credentialId: this.credentialIdB64,
    }
  }

  private clientData(type: string, challenge: string): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(
      JSON.stringify({
        type,
        challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    )
  }

  private flags(includeAttestedData: boolean): number {
    let flags = FLAG_UP
    if (this.userVerified) flags |= FLAG_UV
    if (includeAttestedData) flags |= FLAG_AT
    return flags
  }

  /** The `navigator.credentials.create()` half. */
  create(
    options: PublicKeyCredentialCreationOptionsJSON,
  ): RegistrationResponseJSON {
    const clientDataJSON = this.clientData('webauthn.create', options.challenge)

    const authData = concat(
      sha256(this.rpId),
      new Uint8Array([this.flags(true)]),
      uint32(this.signCount),
      AAGUID,
      uint16(this.credentialId.length),
      this.credentialId,
      this.coseKey,
    )

    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]) as never,
    )

    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ['internal'],
      },
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }

  /** The `navigator.credentials.get()` half. */
  get(
    options: PublicKeyCredentialRequestOptionsJSON,
  ): AuthenticationResponseJSON {
    const clientDataJSON = this.clientData('webauthn.get', options.challenge)

    const authenticatorData = concat(
      sha256(this.rpId),
      new Uint8Array([this.flags(false)]),
      uint32(this.signCount),
    )

    // A real authenticator advances its counter per assertion, and the server
    // requires it to (`isSignCountAcceptable`). Without this a second sign-in
    // from one instance would replay the same count and be rejected — the
    // case Tier 4 hits whenever a job signs in twice.
    this.signCount += 1

    // WebAuthn signs authenticatorData || SHA-256(clientDataJSON). Node emits
    // DER-encoded ECDSA, which is exactly what ES256 expects here.
    const signature = new Uint8Array(
      sign(
        'sha256',
        concat(authenticatorData, sha256(clientDataJSON)),
        this.privateKey,
      ),
    )

    return {
      id: this.credentialIdB64,
      rawId: this.credentialIdB64,
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
        signature: isoBase64URL.fromBuffer(signature),
      },
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }
}
