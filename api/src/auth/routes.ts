import { Hono } from 'hono'

import type { RegistrationResponseJSON } from '@simplewebauthn/server'

import type { RateLimiter } from './rateLimiter.ts'
import { AuthError, InviteRequestError, type AuthService } from './service.ts'
import type { AuthVariables } from './middleware.ts'
import type { MiddlewareHandler } from 'hono'

export interface AuthRoutesDeps {
  service: AuthService
  requireAuth: MiddlewareHandler<{ Variables: AuthVariables }>
  limiter: RateLimiter
}

/** One indistinguishable failure for every way enrolment or sign-in can fail. */
const VAGUE_FAILURE = { error: 'auth_failed' } as const

/**
 * Reads a JSON body without trusting it.
 *
 * A malformed body is `{}` rather than a throw: every field is checked
 * individually below anyway, and an unparseable body deserves the same vague
 * failure as a wrong one.
 */
async function readJson<T extends object>(c: {
  req: { json: <U>() => Promise<U> }
}): Promise<Partial<T>> {
  try {
    return await c.req.json<Partial<T>>()
  } catch {
    return {}
  }
}

function clientKey(headers: Headers): string {
  // Caddy sets this; without it (a direct call, a test) fall back to a single
  // shared bucket, which is the conservative direction to fail in.
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `invite.id`, `device.id` and `passkey.id` are all `uuid` columns
 * (`api/migrations/0002_auth.ts`). Handing a non-UUID path param straight to
 * Kysely makes Postgres raise `invalid input syntax for type uuid` — not an
 * `AuthError`, so `failure()` below never sees it, and with no `app.onError`
 * (`app.ts`) Hono answers a plain-text 500 where every one of these routes
 * documents 204 whether or not a row matched. A malformed id trivially
 * matches no row, so it gets exactly that answer (`final-review.md`
 * finding 7).
 */
function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function createAuthRoutes({
  service,
  requireAuth,
  limiter,
}: AuthRoutesDeps) {
  const auth = new Hono<{ Variables: AuthVariables }>()

  // Coarse per-IP limiting on the *unauthenticated* endpoints only. Sized to
  // protect the box, not to substitute for 256-bit secrets
  // (auth-design.md §9.4).
  const rateLimited: MiddlewareHandler = async (c, next) => {
    if (!limiter.take(clientKey(c.req.raw.headers))) {
      return c.json({ error: 'slow_down' }, 429)
    }
    await next()
    return undefined
  }

  // Not in auth-design §9.1's original table: the join screen has to render
  // "Join Veldkamp?" before the user agrees to anything, and no other endpoint
  // can tell it the household's name. Consumes nothing.
  auth.post('/join/preview', rateLimited, async (c) => {
    const body = await readJson<{ secret: unknown }>(c)
    if (typeof body.secret !== 'string') return c.json(VAGUE_FAILURE, 400)

    try {
      const preview = await service.previewInvite({ secret: body.secret })
      return c.json({
        household_name: preview.householdName,
        purpose: preview.purpose,
        expires_at: preview.expiresAt.toISOString(),
        person_id: preview.personId,
        person_recorded: preview.personRecorded,
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.post('/register/options', rateLimited, async (c) => {
    const body = await readJson<{ secret: unknown }>(c)
    if (typeof body.secret !== 'string') return c.json(VAGUE_FAILURE, 400)

    try {
      return c.json(await service.beginRegistration({ secret: body.secret }))
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.post('/register/verify', rateLimited, async (c) => {
    const body = await readJson<{ secret: unknown; response: unknown }>(c)
    if (typeof body.secret !== 'string' || typeof body.response !== 'object') {
      return c.json(VAGUE_FAILURE, 400)
    }

    try {
      const result = await service.finishRegistration({
        secret: body.secret,
        // Shape is validated by @simplewebauthn during verification; a
        // malformed body fails there and returns the same vague error.
        response: body.response as never,
        userAgent: c.req.header('user-agent'),
      })

      return c.json({
        token: result.token,
        login_id: result.context.loginId,
        household_id: result.context.householdId,
        person_id: result.personId,
        device_id: result.context.deviceId,
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  // The compatibility floor (auth-design.md §5). Unauthenticated and rate
  // limited like the other redemption routes: the Invite secret is the whole
  // credential.
  auth.post('/device/claim', rateLimited, async (c) => {
    const body = await readJson<{ secret: unknown }>(c)
    if (typeof body.secret !== 'string') return c.json(VAGUE_FAILURE, 400)

    try {
      const { token, context } = await service.claimDevice({
        secret: body.secret,
        userAgent: c.req.header('user-agent'),
      })
      return c.json({
        token,
        login_id: context.loginId,
        person_id: context.personId,
        household_id: context.householdId,
        device_id: context.deviceId,
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.post('/login/options', rateLimited, async (c) => {
    // No body: an empty `allowCredentials` is what makes sign-in
    // username-less (auth-design.md §4).
    return c.json(await service.beginLogin())
  })

  auth.post('/login/verify', rateLimited, async (c) => {
    const body = await readJson<{ response: unknown }>(c)
    if (typeof body.response !== 'object') return c.json(VAGUE_FAILURE, 400)

    try {
      const result = await service.finishLogin({
        response: body.response as never,
        userAgent: c.req.header('user-agent'),
      })

      return c.json({
        token: result.token,
        login_id: result.context.loginId,
        household_id: result.context.householdId,
        person_id: result.personId,
        device_id: result.context.deviceId,
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.get('/me', requireAuth, async (c) => {
    const context = c.get('auth')
    try {
      const { householdName } = await service.me(context)
      return c.json({
        login_id: context.loginId,
        person_id: context.personId,
        household_id: context.householdId,
        household_name: householdName,
        device_id: context.deviceId,
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.post('/signout', requireAuth, async (c) => {
    try {
      await service.signOut(c.get('auth'))
      return c.body(null, 204)
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.post('/invites', requireAuth, async (c) => {
    const body = await readJson<{ purpose: unknown; person_id: unknown }>(c)
    const context = c.get('auth')
    const personId =
      typeof body.person_id === 'string' && isUuid(body.person_id)
        ? body.person_id
        : null

    // Precise 400s throughout: there is no secret to protect here and no
    // enumeration surface, so being vague would cost the caller and buy
    // nothing (`auth-design.md` §9.4 governs the unauthenticated routes).
    try {
      if (body.purpose === 'join') {
        if (personId === null) {
          return c.json({ error: 'person_id_required' }, 400)
        }
        const issued = await service.issueJoinInvite(context, personId)
        return c.json({
          id: issued.inviteId,
          secret: issued.secret,
          expires_at: issued.expiresAt.toISOString(),
        })
      }

      if (body.purpose === 'device') {
        const issued =
          personId === null || personId === context.personId
            ? await service.issueDeviceLink(context)
            : await service.issueDeviceLinkFor(context, personId)
        return c.json({
          id: issued.inviteId,
          secret: issued.secret,
          expires_at: issued.expiresAt.toISOString(),
        })
      }

      return c.json({ error: 'unsupported_purpose' }, 400)
    } catch (error) {
      if (error instanceof InviteRequestError) {
        return c.json({ error: error.code }, 400)
      }
      return failure(c, error)
    }
  })

  auth.get('/invites', requireAuth, async (c) => {
    try {
      const invites = await service.listInvites(c.get('auth'))
      return c.json({
        invites: invites.map((invite) => ({
          id: invite.id,
          purpose: invite.purpose,
          expires_at: invite.expiresAt.toISOString(),
        })),
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.delete('/invites/:id', requireAuth, async (c) => {
    const id = c.req.param('id')
    // 204 whether or not a row matched: "not yours", "does not exist" and
    // "not even a UUID" are all the same answer to the caller — see
    // `isUuid`'s own doc comment.
    if (!isUuid(id)) return c.body(null, 204)

    try {
      await service.revokeInvite(c.get('auth'), id)
      return c.body(null, 204)
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.get('/logins', requireAuth, async (c) => {
    try {
      const logins = await service.listLogins(c.get('auth'))
      return c.json({
        logins: logins.map((login) => ({
          id: login.id,
          person_id: login.personId,
          device_count: login.deviceCount,
          last_seen_at: login.lastSeenAt?.toISOString() ?? null,
        })),
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.delete('/logins/:id', requireAuth, async (c) => {
    const id = c.req.param('id')
    const context = c.get('auth')

    // Checked first, and precisely: the boards give the reason ("only your
    // own row lacks them — your exit is SIGN OUT"), and the consequence is
    // stronger than a screen rule. Since no Login can disable itself, a
    // Household never reaches zero active Logins by any single act.
    if (id === context.loginId) {
      return c.json({ error: 'cannot_revoke_self' }, 400)
    }

    // 204 whether or not a row matched — same convention as
    // `DELETE /invites/:id`.
    if (!isUuid(id)) return c.body(null, 204)

    try {
      await service.revokeLogin(context, id)
      return c.body(null, 204)
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.get('/devices', requireAuth, async (c) => {
    try {
      const devices = await service.listDevices(c.get('auth'))
      return c.json({
        devices: devices.map((device) => ({
          id: device.id,
          label: device.label,
          created_at: device.createdAt.toISOString(),
          last_seen_at: device.lastSeenAt.toISOString(),
          current: device.current,
          enrolled_passkey_here: device.enrolledPasskeyHere,
        })),
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.delete('/devices/:id', requireAuth, async (c) => {
    const id = c.req.param('id')
    // 204 whether or not a row matched: "not mine", "does not exist" and
    // "not even a UUID" are the same answer to the caller (`docs/testing.md`
    // cross-Login case; `isUuid`'s own doc comment).
    if (!isUuid(id)) return c.body(null, 204)

    try {
      await service.revokeDevice(c.get('auth'), id)
      return c.body(null, 204)
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.post('/passkeys/options', requireAuth, async (c) => {
    try {
      return c.json(await service.beginAddPasskey(c.get('auth')))
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.post('/passkeys/verify', requireAuth, async (c) => {
    const body = await readJson<{ response: unknown; label: unknown }>(c)
    if (typeof body.response !== 'object' || body.response === null) {
      return c.json(VAGUE_FAILURE, 400)
    }

    try {
      const { passkeyId } = await service.finishAddPasskey({
        context: c.get('auth'),
        response: body.response as RegistrationResponseJSON,
        label: typeof body.label === 'string' ? body.label : null,
        userAgent: c.req.header('user-agent'),
      })
      return c.json({ id: passkeyId })
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.get('/passkeys', requireAuth, async (c) => {
    try {
      const passkeys = await service.listPasskeys(c.get('auth'))
      return c.json({
        passkeys: passkeys.map((passkey) => ({
          id: passkey.id,
          label: passkey.label,
          created_at: passkey.createdAt.toISOString(),
          last_used_at: passkey.lastUsedAt?.toISOString() ?? null,
        })),
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  auth.delete('/passkeys/:id', requireAuth, async (c) => {
    const id = c.req.param('id')
    // Same 204-regardless discipline as the other two `DELETE …/:id` routes
    // above — see `isUuid`'s own doc comment.
    if (!isUuid(id)) return c.body(null, 204)

    try {
      await service.removePasskey(c.get('auth'), id)
      return c.body(null, 204)
    } catch (error) {
      return failure(c, error)
    }
  })

  return auth
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function failure(c: any, error: unknown) {
  if (error instanceof AuthError) {
    // Precise in the log, vague to the client.
    console.warn(`auth failed: ${error.reason}`)
    return c.json(VAGUE_FAILURE, 401)
  }
  throw error
}
