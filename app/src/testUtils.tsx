import {
  createHlcClock,
  type Clock,
  type IdSource,
  type OpAuthor,
  type OpSpec,
} from '@foerier/shared'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { StoreApi } from 'zustand/vanilla'

import { inMemoryOpLog } from './depot/opLog'
import {
  createDepotStore,
  DepotProvider,
  type DepotStoreState,
  type EngineFactory,
} from './depot/store'

/**
 * The Tier 3 scaffolding, in one place (`docs/testing.md` Tier 3).
 *
 * Every `app/` suite needs the same four things before it can assert
 * anything: an author, an engine that does not sync, a real store over a fake
 * log, and a provider around the component. Thirty suites carried a private
 * copy of all four — `noopEngine` byte-identical in every one of them — which
 * meant a change to how a suite is built had thirty edit sites and no failing
 * test to find them.
 *
 * **What stays local.** A suite's own `render<Thing>` helper is not
 * duplication: it names that component's props and its real-fake counters,
 * and belongs beside the tests that read them. A suite that genuinely needs a
 * second Device, a different id prefix or a clock that moves keeps its own
 * too — {@link anAuthor} takes each as an option rather than swallowing it.
 *
 * **Ids restart per file, exactly as the copies did.** Vitest isolates
 * modules per test file, so the counter below is per suite and not per run;
 * a failing assertion still names an id from a short, readable sequence.
 */

/** The household every suite seeds under, unless it says otherwise. */
export const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'

/** The Device every suite authors as, unless it says otherwise. */
export const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'

/**
 * The wall clock a seed is stamped at. Fixed, because `DAY N` and every
 * timestamp a screen renders is counted from it — and pinned to the same
 * millisecond `shared/testUtils` uses, so a fixture built in one tier reads
 * the same in the other.
 */
export const SEEDED_AT = 1_700_000_000_000

/**
 * An id source with its own counter, producing canonical-shaped ids
 * (`eeeeeeee-0000-7000-8000-00000000002a`). Ordered, so the nth id sorts
 * after the (n-1)th, and distinct per source, so two of them in one suite
 * never collide.
 */
export function countingIds(prefix = 'eeeeeeee'): IdSource {
  let n = 0
  return {
    next: () =>
      `${prefix}-0000-7000-8000-${(n++).toString(16).padStart(12, '0')}`,
  }
}

/** A clock frozen at {@link SEEDED_AT}, or wherever the caller says. */
export function fixedClock(at: number = SEEDED_AT): Clock {
  return { now: () => at }
}

/**
 * The suite's default id source — one per test file, as each copy was.
 *
 * A suite that hand-names entity ids under the same `eeeeeeee` prefix keeps
 * its **own** source under a different one, or the counter reaches the named
 * constant and two entities share an id (`PieceStatusSheet` names an Entry
 * `eeeeeeee-…-008`, which this source's ninth id would be). Those suites pass
 * their source to {@link anAuthor} rather than dropping it.
 */
export const ids = countingIds()

/** One id from {@link ids}, for a suite that names entities as it seeds. */
export function anId(): string {
  return ids.next()
}

export function anAuthor(
  overrides: {
    householdId?: string
    deviceId?: string
    ids?: IdSource
    /** The wall clock the HLC runs over. */
    at?: number
  } = {},
): OpAuthor {
  return {
    household_id: overrides.householdId ?? HOUSEHOLD,
    device_id: overrides.deviceId ?? DEVICE,
    ids: overrides.ids ?? ids,
    hlc: createHlcClock(fixedClock(overrides.at)),
  }
}

/**
 * An engine that never syncs: the device is alone with its log, which is what
 * a component test is about. `status: 'idle'` is what makes every screen's
 * own sync line read `SYNCED`.
 */
export const noopEngine: EngineFactory = () => ({
  start() {},
  stop() {},
  flush: () => Promise.resolve(),
  pull: () => Promise.resolve(),
  status: () => 'idle',
  bootstrap: () => null,
})

/**
 * A **real** store over a fake log, seeded by emitting real ops through the
 * same builders the screen uses — the reducer, the selectors and the queue
 * are all live, and only storage and transport are stubbed.
 *
 * It awaits `drained()`, which is the half a caller forgets: `emit` is
 * durable-first, so the fold arrives a queue-turn after the call and a store
 * handed back unawaited is empty.
 */
export async function seededStore(
  specs: readonly OpSpec[] = [],
  options: {
    engine?: EngineFactory
    author?: OpAuthor
    log?: ReturnType<typeof inMemoryOpLog>
  } = {},
): Promise<StoreApi<DepotStoreState>> {
  const store = createDepotStore({
    log: options.log ?? inMemoryOpLog(),
    engine: options.engine ?? noopEngine,
    author: options.author ?? anAuthor(),
  })
  for (const spec of specs) store.getState().emit(spec)
  await store.getState().drained()
  return store
}

/** The component under a store, for a screen that reads no route. */
export function renderWithStore(
  ui: ReactNode,
  store: StoreApi<DepotStoreState>,
) {
  return render(<DepotProvider value={store}>{ui}</DepotProvider>)
}
