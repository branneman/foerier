import { createHash, randomBytes } from 'node:crypto'

/**
 * Secrets, and how they are stored.
 *
 * Both the Device token and the Invite secret are 32 bytes of uniform
 * randomness, stored hashed with plain SHA-256. A slow KDF would be the right
 * answer for a password and is the wrong one here: there is nothing to
 * brute-force in 256 random bits, and nothing a work factor would protect
 * (`auth-design.md` §6.1).
 */

/** Makes the string recognisable to secret scanners and to a human reading a log. */
export const TOKEN_PREFIX = 'foe_'

const SECRET_BYTES = 32

function randomSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url')
}

/** Returns a Buffer: node-postgres serialises those to `bytea` directly. */
export function hashSecret(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

export interface IssuedToken {
  /** Shown to the client exactly once. Never stored. */
  token: string
  /** What goes in `device.token_hash`. */
  tokenHash: Buffer
}

/**
 * Opaque, not a JWT: there is one server and one database, so a self-contained
 * token would buy nothing and cost instant revocability.
 */
export function issueDeviceToken(): IssuedToken {
  const token = `${TOKEN_PREFIX}${randomSecret()}`
  return { token, tokenHash: hashSecret(token) }
}

export interface IssuedSecret {
  /** Goes in the URL fragment, and nowhere else. */
  secret: string
  secretHash: Buffer
}

export function generateInviteSecret(): IssuedSecret {
  const secret = randomSecret()
  return { secret, secretHash: hashSecret(secret) }
}

/**
 * Pulls the bearer token out of an `Authorization` header.
 *
 * Returns null rather than throwing: an absent or malformed header is an
 * anonymous request, which is a normal thing to be, not an error.
 */
export function bearerFrom(header: string | undefined | null): string | null {
  if (typeof header !== 'string') return null
  const match = /^Bearer (.+)$/.exec(header.trim())
  return match?.[1] ?? null
}
