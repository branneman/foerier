import {
  authorOp,
  createHlcClock,
  placeRecorded,
  type Clock,
  type IdSource,
  type OpEnvelope,
} from '@foerier/shared'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { StoreApi } from 'zustand/vanilla'

import { App } from '../App'
import { createAuthApi } from '../auth/api'
import { inMemoryPendingStore } from '../auth/pendingFirstPerson'
import { inMemorySessionStore, type Session } from '../auth/sessionStore'
import { inMemoryOpLog, type OpLog } from '../depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
} from '../depot/store'
import { createSyncEngine, type SyncEngine } from '../depot/syncEngine'
import {
  createFakeServer,
  fakeTransport,
  type PullBody,
  type Transport,
  type TransportResult,
} from '../depot/transport'
import { createSessionDepot, type DepotFactory } from '../depot/wiring'
import { Join } from '../screens/Join'
import { FirstSync } from './FirstSync'

/**
 * Every test drives a **real** first sync: the real `createSyncEngine` paging
 * a real `createFakeServer` through a real `inMemoryOpLog`, folded by the real
 * `createDepotStore`. Nothing here hand-shapes a `BootstrapProgress` — the
 * numbers on the screen are the numbers the engine actually reported, which
 * is the only way this file can prove that `RETRY NOW` resumes rather than
 * restarts.
 *
 * **What jsdom cannot answer.** CSS Modules are not wired to computed style
 * here, so `docs/design/README.md` §9's colour rules — the paused frame's
 * offline dot being the only amber, the muted CTA, the 6px bar — rest on
 * review, not on these tests. The *absence of a `▲`* is content rather than
 * colour, so that one is asserted.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const THIS_DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const OTHER_DEVICE = 'aaaaaaaa-0000-7000-8000-000000000002'

let nextId = 0

/** A fresh, canonical-shaped id, distinct per call. */
function anId(): string {
  const suffix = (nextId++).toString(16).padStart(12, '0')
  return `eeeeeeee-0000-7000-8000-${suffix}`
}

const ids: IdSource = { next: anId }

function fixedClock(): Clock {
  return { now: () => 1_700_000_000_000 }
}

/**
 * Ops another Device already put in the household's log — the history this
 * Device has to fold before it can show anything (`sync-protocol.md` §7).
 */
function householdHistory(count: number): OpEnvelope[] {
  const author = {
    household_id: HOUSEHOLD,
    device_id: OTHER_DEVICE,
    ids,
    hlc: createHlcClock(fixedClock()),
  }
  return Array.from({ length: count }, (_, index) =>
    authorOp(author, placeRecorded(anId(), `Place ${index + 1}`)),
  )
}

/**
 * The `/sync` transport, wrapped so a test can hold one page open the way a
 * slow line does and drop one the way a lost connection does — and can read
 * back the `since` every page was asked for, which is the whole evidence that
 * a resume is not a restart. A real fake over the real in-memory server.
 */
/** A lost connection by default; a test that needs a specific server refusal
 * (a 400, say) passes it explicitly. */
const NETWORK_DROP = { status: 0, code: 'network' } as const

interface Wire {
  transport: Transport
  /** The `since` of every page asked for, in order. */
  pulls: number[]
  /** Hold the nth pull open until {@link release}. */
  hold(nth: number): void
  release(): void
  /** Fail the nth pull the way a lost connection does, unless `failure` names
   * a different refusal. */
  drop(nth: number, failure?: { status: number; code: string }): void
}

function controllable(inner: Transport): Wire {
  const pulls: number[] = []
  let holdAt: number | null = null
  let dropAt: number | null = null
  let dropWith: { status: number; code: string } = NETWORK_DROP
  let held: (() => void) | null = null

  return {
    pulls,
    hold(nth) {
      holdAt = nth
    },
    drop(nth, failure = NETWORK_DROP) {
      dropAt = nth
      dropWith = failure
    },
    release() {
      held?.()
      held = null
    },
    transport: {
      push: (ops) => inner.push(ops),
      async pull(since, limit) {
        pulls.push(since)
        const nth = pulls.length
        if (nth === dropAt) {
          const dropped: TransportResult<PullBody> = {
            ok: false,
            ...dropWith,
          }
          return dropped
        }
        if (nth === holdAt) {
          await new Promise<void>((resolve) => {
            held = resolve
          })
        }
        return inner.pull(since, limit)
      },
    },
  }
}

interface Harness {
  store: StoreApi<DepotStoreState>
  engine: SyncEngine
  wire: Wire
  log: OpLog
}

const built: StoreApi<DepotStoreState>[] = []

afterEach(() => {
  for (const store of built.splice(0)) store.getState().stopSync()
})

function harness(
  options: { history?: number; pageSize?: number } = {},
): Harness {
  const server = createFakeServer()
  server.push(householdHistory(options.history ?? 0))

  const wire = controllable(fakeTransport(server))
  const log = inMemoryOpLog()
  const hlc = createHlcClock(fixedClock())
  let engine: SyncEngine | null = null

  const store = createDepotStore({
    log,
    author: { household_id: HOUSEHOLD, device_id: THIS_DEVICE, ids, hlc },
    engine: (hooks) => {
      const made = createSyncEngine({
        log,
        transport: wire.transport,
        clock: fixedClock(),
        hlc,
        onOps: hooks.onOps,
        onStatus: hooks.onStatus,
        onBootstrap: hooks.onBootstrap,
        pageSize: options.pageSize ?? 2,
        // Full jitter at zero, so a dropped page's backoff window is over the
        // moment it opens and `RETRY NOW` is never blocked by it.
        random: () => 0,
        // Captured and never run: nothing may resume behind the test's back,
        // so every resume in this file is one the screen asked for.
        schedule: () => () => undefined,
      })
      engine = made
      return made
    },
  })

  built.push(store)
  if (engine === null) throw new Error('the store built no engine')
  return { store, engine, wire, log }
}

function renderFirstSync(store: StoreApi<DepotStoreState>): void {
  render(
    <DepotProvider value={store}>
      <FirstSync />
    </DepotProvider>,
  )
}

/** The join screen's success frame, which composes the same card. */
function renderJoinSuccess(store: StoreApi<DepotStoreState>): string[] {
  const opened: string[] = []
  render(
    <DepotProvider value={store}>
      <Join
        preview={null}
        deadEnd={null}
        signedIn
        onConfirm={() => Promise.resolve()}
        onOpenSignIn={() => undefined}
        onOpenDepot={() => opened.push('depot')}
      />
    </DepotProvider>,
  )
  return opened
}

describe('the first-sync fold', () => {
  it('gates the CTA until the fold completes', async () => {
    const h = harness({ history: 5 })
    h.wire.hold(2)
    renderJoinSuccess(h.store)

    const pulling = h.engine.pull()

    const gated = await screen.findByRole('button', {
      name: 'Open the depot — folding 40%',
    })
    expect(gated).toBeDisabled()

    h.wire.release()
    await pulling

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Open the depot' }),
      ).toBeEnabled()
    })
  })

  it('shows the ops folded and the total', async () => {
    // Four figures on both sides of the OF, because the mono line is grouped
    // — `OP 4,215 OF 11,562 FOLDED` is the §9 frame, not `OP 4215 OF 11562`.
    const h = harness({ history: 1234, pageSize: 1000 })
    h.wire.hold(2)
    renderFirstSync(h.store)

    const pulling = h.engine.pull()

    expect(await screen.findByText('OP 1,000 OF 1,234 FOLDED')).toBeVisible()
    expect(screen.getByText('81%')).toBeVisible()
    // The "one-time" honesty §7.6 asks for — the only §9 requirement that had
    // no coverage anywhere in this file.
    expect(
      screen.getByText(
        "This device folds the household's history once. After this it " +
          'starts instantly and works offline.',
      ),
    ).toBeVisible()

    h.wire.release()
    await pulling
  })

  it('shows a dash for the total before the first page arrives', async () => {
    // `household_seq` comes back *in* the pull response (§6.4), so the
    // denominator is genuinely unknown for exactly one round trip. The card
    // says so rather than guessing, and rather than not appearing at all and
    // leaving a CTA to enable and then disable under the user's finger.
    const h = harness({ history: 5 })
    h.wire.hold(1)
    renderFirstSync(h.store)

    const pulling = h.engine.pull()

    expect(await screen.findByText('OP 0 OF — FOLDED')).toBeVisible()

    h.wire.release()
    await pulling
  })

  it('shows the percentage in the CTA label while folding', async () => {
    const h = harness({ history: 5 })
    h.wire.hold(2)
    renderJoinSuccess(h.store)

    const pulling = h.engine.pull()

    // The same number in both places: the CTA states the fold's progress
    // rather than a second, drifting one.
    expect(await screen.findByText('40%')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Open the depot — folding 40%' }),
    ).toBeVisible()

    h.wire.release()
    await pulling
  })

  it('enables the CTA once the first page confirms there is nothing to fold', async () => {
    // Awaits the pull before asserting, so this pins the *settled* state only
    // — it does not say whether the card showed for one round trip on the way
    // there. R50 settled that a brand-new household does show the card for
    // that one round trip; test 3 above ('shows a dash for the total before
    // the first page arrives') owns that frame.
    const h = harness({ history: 0 })
    renderJoinSuccess(h.store)

    await h.engine.pull()

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Open the depot' }),
      ).toBeEnabled()
    })
    expect(screen.queryByRole('region', { name: 'First sync' })).toBeNull()
  })

  it('shows PAUSED with the cursor kept when a page fails', async () => {
    const h = harness({ history: 5 })
    h.wire.drop(2)
    renderFirstSync(h.store)

    await h.engine.pull()

    expect(await screen.findByText('FIRST SYNC — PAUSED')).toBeVisible()
    expect(screen.getByText('OP 2 OF 5 · CURSOR KEPT')).toBeVisible()
    expect(
      screen.getByText(
        'Connection dropped. It continues from op 2 when the line returns — nothing restarts.',
      ),
    ).toBeVisible()
    // The cursor is the kept fact behind the copy, not a phrase on a screen.
    expect(await h.log.readMeta<number>('cursor')).toBe(2)
  })

  it('renders no attention triangle in the paused state', async () => {
    // A paused first sync is not an error state (§9): nothing of the user's
    // is wrong, and `▲` is reserved for attention — missing, lost,
    // disagreement (README, Status Grammar).
    const h = harness({ history: 5 })
    h.wire.drop(2)
    renderFirstSync(h.store)

    await h.engine.pull()

    const card = await screen.findByRole('region', { name: 'First sync' })
    expect(card).toHaveTextContent('FIRST SYNC — PAUSED')
    expect(card.textContent).not.toContain('▲')
  })

  it('resumes from the kept cursor on RETRY NOW rather than restarting', async () => {
    // Driven through the join frame, because a paused fold still gates the
    // CTA there — and `RETRY NOW` is the only thing on the screen that can
    // end it: a pull refused with a 400 schedules no retry at all, so nothing
    // but the click resumes it. (A dropped connection would also pause, but
    // through `retryLater`, which *does* schedule — the schedule here is
    // just a capturing no-op, so that path would leave this constraint
    // unpinned.)
    const h = harness({ history: 5 })
    h.wire.drop(2, { status: 400, code: 'bad_request' })
    renderJoinSuccess(h.store)

    await h.engine.pull()
    expect(h.wire.pulls).toEqual([0, 2])
    expect(
      await screen.findByRole('button', {
        name: 'Open the depot — paused at 40%',
      }),
    ).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'RETRY NOW' }))

    // Page three is asked for from 2, never from 0: the two ops already
    // folded are not folded again, and the household is not re-sent.
    await waitFor(() => {
      expect(h.wire.pulls).toEqual([0, 2, 2, 4])
    })
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Open the depot' }),
      ).toBeEnabled()
    })
    expect(screen.queryByRole('region', { name: 'First sync' })).toBeNull()
  })

  it('renders full-screen when a signed-in device has an empty log', async () => {
    // The fold is a state of the sync engine, not a property of the join
    // screen: a freshly linked Device, or one signing in after a local wipe,
    // meets it ahead of the shell rather than inside it.
    const session: Session = {
      token: 'foe_test',
      loginId: '0f0000a1-0000-4000-8000-0000000000a1',
      personId: '0f0000a2-0000-4000-8000-0000000000a2',
      householdId: HOUSEHOLD,
      deviceId: THIS_DEVICE,
    }
    const noNetwork: typeof fetch = () => {
      throw new Error('the first sync must not reach auth')
    }

    const server = createFakeServer()
    server.push(householdHistory(5))
    const wire = controllable(fakeTransport(server))
    wire.hold(1)

    const log = inMemoryOpLog()
    // Registered onto `built` the moment it exists, same as every other
    // harness-built store in this file — otherwise `afterEach` never calls
    // `stopSync()` on it, and this engine's 30 s interval and DOM listeners
    // outlive the test.
    const createDepot: DepotFactory = async (forSession) => {
      const store = await createSessionDepot(forSession, {
        log,
        transport: wire.transport,
      })
      built.push(store)
      return store
    }

    const { hook } = memoryLocation({ path: '/' })
    render(
      <Router hook={hook}>
        <App
          api={createAuthApi(noNetwork)}
          sessionStore={inMemorySessionStore(session)}
          pendingStore={inMemoryPendingStore()}
          createDepot={createDepot}
        />
      </Router>,
    )

    expect(await screen.findByText('FIRST SYNC — ONE-TIME')).toBeVisible()
    // Ahead of the shell, not inside it: no tab bar to leave through.
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull()

    wire.release()

    expect(
      await screen.findByRole('navigation', { name: 'Sections' }),
    ).toBeVisible()
  })
})
