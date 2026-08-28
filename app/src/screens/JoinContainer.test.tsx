import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { createAuthApi } from '../auth/api'
import {
  inMemoryPendingStore,
  type PendingStore,
} from '../auth/pendingFirstPerson'
import { JoinContainer } from './JoinContainer'

/**
 * `JoinContainer` reads its secret out of `window.location.hash` directly
 * (`takeSecretFromFragment`), so these tests drive that real browser API
 * rather than a route param.
 */
function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init })
}

const DEVICE_PREVIEW = {
  household_name: 'Veldkamp',
  purpose: 'device' as const,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  person_id: '0f0000aa-0000-4000-8000-0000000000aa',
  person_recorded: true,
}

const JOIN_PREVIEW = {
  household_name: 'Veldkamp',
  purpose: 'join' as const,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  person_id: '0f0000aa-0000-4000-8000-0000000000aa',
  person_recorded: false,
}

const CLAIMED = {
  token: 'foe_claimed',
  login_id: '0f0000b1-0000-4000-8000-0000000000b1',
  person_id: '0f0000aa-0000-4000-8000-0000000000aa',
  household_id: '0f0000b3-0000-4000-8000-0000000000b3',
  device_id: '0f0000b4-0000-4000-8000-0000000000b4',
}

/** A fetch stub keyed on path, standing in for the real HTTP transport. */
function fetchFrom(responses: Record<string, unknown>): typeof fetch {
  return (input: RequestInfo | URL) => {
    const url = String(input)
    for (const [path, body] of Object.entries(responses)) {
      if (url.endsWith(path)) return Promise.resolve(jsonResponse(body))
    }
    throw new Error(`unmocked request: ${url}`)
  }
}

function renderJoinContainer(options: {
  responses: Record<string, unknown>
  hash?: string
  pending?: PendingStore
  onSignedIn?: (session: unknown) => Promise<void>
}) {
  window.location.hash = options.hash ?? '#a-secret'
  const api = createAuthApi(fetchFrom(options.responses))
  const onSignedIn = options.onSignedIn ?? vi.fn().mockResolvedValue(undefined)
  const pending = options.pending ?? inMemoryPendingStore()
  const { hook } = memoryLocation({ path: '/join' })

  render(
    <Router hook={hook}>
      <JoinContainer api={api} pending={pending} onSignedIn={onSignedIn} />
    </Router>,
  )

  return { onSignedIn, pending }
}

afterEach(() => {
  window.location.hash = ''
})

describe('JoinContainer', () => {
  it('skips the confirm frame entirely for a device link', async () => {
    renderJoinContainer({
      responses: { '/auth/join/preview': DEVICE_PREVIEW },
    })

    expect(
      await screen.findByRole('heading', {
        name: 'Continue without a passkey',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Join / })).toBeNull()
  })

  it('claims the token with no ceremony and signs in', async () => {
    const onSignedIn = vi.fn().mockResolvedValue(undefined)
    renderJoinContainer({
      responses: {
        '/auth/join/preview': DEVICE_PREVIEW,
        '/auth/device/claim': CLAIMED,
      },
      onSignedIn,
    })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue' }),
    )

    expect(onSignedIn).toHaveBeenCalledWith({
      token: CLAIMED.token,
      loginId: CLAIMED.login_id,
      personId: CLAIMED.person_id,
      householdId: CLAIMED.household_id,
      deviceId: CLAIMED.device_id,
    })
  })

  it('falls through to the passkey-less path when no authenticator is available, keeping the typed name', async () => {
    // jsdom implements no WebAuthn, so `window.PublicKeyCredential` is
    // already absent here — exactly the condition `confirmOrFallThrough`
    // checks for. No credential-store stub is needed to exercise it.
    const user = userEvent.setup()
    renderJoinContainer({
      responses: { '/auth/join/preview': JOIN_PREVIEW },
    })

    await user.type(await screen.findByRole('textbox'), 'Bran')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // `pendingName` must have survived the swap from `Join` to `NoPasskey`.
    expect(
      await screen.findByRole('button', { name: 'Continue as Bran' }),
    ).toBeInTheDocument()
  })

  it('authors the pending name once the fallback claim completes', async () => {
    const user = userEvent.setup()
    const pending = inMemoryPendingStore()
    renderJoinContainer({
      responses: {
        '/auth/join/preview': JOIN_PREVIEW,
        '/auth/device/claim': CLAIMED,
      },
      pending,
    })

    await user.type(await screen.findByRole('textbox'), 'Bran')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(
      await screen.findByRole('button', { name: 'Continue as Bran' }),
    )

    expect(await pending.read()).toEqual({
      personId: CLAIMED.person_id,
      householdId: CLAIMED.household_id,
      name: 'Bran',
    })
  })
})
