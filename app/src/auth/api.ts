import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'

/**
 * The auth half of the API client.
 *
 * `fetch` is injected rather than reached for globally so component tests can
 * hand it a real in-memory implementation instead of patching a global
 * (`docs/testing.md`).
 */

export const API_BASE =
  import.meta.env['VITE_API_BASE'] ??
  (import.meta.env.DEV
    ? 'http://localhost:8080/api/v1'
    : 'https://api.foerier.app/api/v1')

export interface InvitePreview {
  household_name: string
  purpose: 'join' | 'device'
  expires_at: string
  person_id: string
  person_recorded: boolean
}

export interface SignedIn {
  token: string
  login_id: string
  person_id: string
  household_id: string
  device_id: string
}

/** Every way the server can say no, as one thing, because it is one thing. */
export class AuthRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`auth request failed (${status})`)
    this.name = 'AuthRequestError'
    this.status = status
  }
}

export type Fetch = typeof globalThis.fetch

export function createAuthApi(
  doFetch: Fetch = globalThis.fetch,
  base = API_BASE,
) {
  async function post<T>(
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    if (!res.ok) throw new AuthRequestError(res.status)
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  return {
    previewInvite: (secret: string) =>
      post<InvitePreview>('/auth/join/preview', { secret }),

    registerOptions: (secret: string) =>
      post<PublicKeyCredentialCreationOptionsJSON>('/auth/register/options', {
        secret,
      }),

    registerVerify: (secret: string, response: RegistrationResponseJSON) =>
      post<SignedIn>('/auth/register/verify', { secret, response }),

    loginOptions: () =>
      post<PublicKeyCredentialRequestOptionsJSON>('/auth/login/options'),

    loginVerify: (response: AuthenticationResponseJSON) =>
      post<SignedIn>('/auth/login/verify', { response }),

    signOut: (token: string) => post<void>('/auth/signout', undefined, token),
  }
}

export type AuthApi = ReturnType<typeof createAuthApi>
