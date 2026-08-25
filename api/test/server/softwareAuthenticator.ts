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
   * Synced passkeys legitimately report 0 forever. That is the default here on
   * purpose — it is the configuration most real credentials will have.
   */
  signCount?: number
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
  }: SoftwareAuthenticatorOptions) {
    this.origin = origin
    this.rpId = rpId
    this.userVerified = userVerified
    this.signCount = signCount

    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    })
    this.privateKey = createPrivateKey(
      privateKey.export({ format: 'pem', type: 'pkcs8' }),
    )

    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }

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

    // Must be random, not derived: two authenticators in one test would
    // otherwise collide on the `credential_id` unique index, and a real
    // authenticator never reuses one either.
    this.credentialId = new Uint8Array(randomBytes(32))
  }

  get credentialIdB64(): string {
    return isoBase64URL.fromBuffer(this.credentialId)
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
