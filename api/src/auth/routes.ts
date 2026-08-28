import { Hono } from 'hono'

import type { RateLimiter } from './rateLimiter.ts'
import { AuthError, type AuthService } from './service.ts'
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

  auth.get('/me', requireAuth, (c) => {
    const context = c.get('auth')
    return c.json({
      login_id: context.loginId,
      person_id: context.personId,
      household_id: context.householdId,
      device_id: context.deviceId,
    })
  })

  auth.post('/signout', requireAuth, async (c) => {
    await service.signOut(c.get('auth'))
    return c.body(null, 204)
  })

  auth.post('/invites', requireAuth, async (c) => {
    const body = await readJson<{ purpose: unknown }>(c)

    // Only `device` until S5. A join Invite must name a Person, and there is
    // no way to pick one before S4 records People — accepting one here would
    // produce exactly the unnamed-Quartermaster defect 0004 exists to prevent.
    // A plain 400 rather than the vague failure: there is no secret to protect
    // and no enumeration surface, so being precise costs nothing.
    if (body.purpose !== 'device') {
      return c.json({ error: 'unsupported_purpose' }, 400)
    }

    const { inviteId, secret, expiresAt } = await service.issueDeviceLink(
      c.get('auth'),
    )
    return c.json({
      id: inviteId,
      secret,
      expires_at: expiresAt.toISOString(),
    })
  })

  auth.get('/invites', requireAuth, async (c) => {
    const invites = await service.listInvites(c.get('auth'))
    return c.json({
      invites: invites.map((invite) => ({
        id: invite.id,
        purpose: invite.purpose,
        expires_at: invite.expiresAt.toISOString(),
      })),
    })
  })

  auth.delete('/invites/:id', requireAuth, async (c) => {
    await service.revokeInvite(c.get('auth'), c.req.param('id'))
    // 204 whether or not a row matched: "not yours" and "does not exist" are
    // the same answer, and the caller's next GET is the source of truth.
    return c.body(null, 204)
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
