import { describe, expect, it } from 'vitest'

import { anOp, hlcAt } from '../testUtils/index.ts'
import {
  tripContainerStageSet,
  tripEntryMoved,
  tripEntryStatusSet,
  tripPieceMoved,
  tripPieceStatusSet,
  type OpSpec,
} from './authoring.ts'
import { emptyState, fold } from './reduce.ts'
import type { HouseholdState } from './state.ts'

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'
const DEFAULT_MS = 1_700_000_000_000

const TRIP = '66666666-0000-7000-8000-000000000001'
const ENTRY = '77777777-0000-7000-8000-000000000001'
const CRATE = '77777777-0000-7000-8000-000000000002'
const MARK = '88888888-0000-7000-8000-000000000001'

function foldOf(...specs: readonly OpSpec[]): HouseholdState {
  return fold(
    specs.map((spec, i) =>
      anOp(spec, { hlc: hlcAt(i + 1, DEFAULT_MS), deviceId: DEV_A }),
    ),
    emptyState(),
  )
}

describe('the five packing ops', () => {
  it('sets an Entry status on the Entry, and nothing else', () => {
    const state = foldOf(tripEntryStatusSet(TRIP, ENTRY, 'packed'))
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.status?.value).toBe('packed')
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.residence).toBeUndefined()
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.stage).toBeUndefined()
  })

  it('sets a Piece status on the Piece, not on its Entry', () => {
    const state = foldOf(tripPieceStatusSet(TRIP, ENTRY, MARK, 'staged'))
    const entry = state.trips[TRIP]?.entries?.[ENTRY]
    expect(entry?.pieces?.[MARK]?.status?.value).toBe('staged')
    expect(entry?.status).toBeUndefined()
  })

  it('folds a trip residence, mapping entry_id to entryId', () => {
    const state = foldOf(
      tripEntryMoved(TRIP, ENTRY, { in: 'container', entryId: CRATE }),
    )
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.residence?.value).toEqual({
      in: 'container',
      entryId: CRATE,
    })
  })

  it('folds a loose trip residence', () => {
    const state = foldOf(tripEntryMoved(TRIP, ENTRY, { in: 'loose' }))
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.residence?.value).toEqual({
      in: 'loose',
    })
  })

  it('folds a Piece residence on the Piece', () => {
    const state = foldOf(
      tripPieceMoved(TRIP, ENTRY, MARK, { in: 'container', entryId: CRATE }),
    )
    expect(
      state.trips[TRIP]?.entries?.[ENTRY]?.pieces?.[MARK]?.residence?.value,
    ).toEqual({ in: 'container', entryId: CRATE })
  })

  it('folds a container stage', () => {
    const state = foldOf(tripContainerStageSet(TRIP, CRATE, 'car'))
    expect(state.trips[TRIP]?.entries?.[CRATE]?.stage?.value).toBe('car')
  })

  it('stores an unrecognised status verbatim and never coerces it', () => {
    const state = foldOf(tripEntryStatusSet(TRIP, ENTRY, 'in_the_shed'))
    expect(state.trips[TRIP]?.entries?.[ENTRY]?.status?.value).toBe(
      'in_the_shed',
    )
  })

  it('returns the identical object when a write loses LWW', () => {
    const seeded = fold([
      anOp(tripEntryStatusSet(TRIP, ENTRY, 'packed'), {
        hlc: hlcAt(5, DEFAULT_MS),
        deviceId: DEV_A,
      }),
    ])
    const stale = fold(
      [
        anOp(tripEntryStatusSet(TRIP, ENTRY, 'staged'), {
          hlc: hlcAt(1, DEFAULT_MS),
          deviceId: DEV_A,
        }),
      ],
      seeded,
    )
    // Not merely equal — the same object. `slice.ts`'s WeakMap memo is keyed
    // on the fold's own immutable identity and depends on this.
    expect(stale).toBe(seeded)
  })

  it('reads an unrecognised residence shape as absent, leaving the register alone', () => {
    const seeded = fold([
      anOp(tripEntryMoved(TRIP, ENTRY, { in: 'loose' }), {
        hlc: hlcAt(1, DEFAULT_MS),
        deviceId: DEV_A,
      }),
    ])
    const raw = {
      ...anOp(tripEntryMoved(TRIP, ENTRY, { in: 'loose' }), {
        hlc: hlcAt(2, DEFAULT_MS),
        deviceId: DEV_A,
      }),
      payload: {
        entry_id: ENTRY,
        residence: { in: 'elsewhere', entry_id: CRATE },
      },
    }
    const after = fold([raw], seeded)
    // Tolerant: the op folds, the Entry survives, the register is untouched.
    expect(after.trips[TRIP]?.entries?.[ENTRY]?.residence?.value).toEqual({
      in: 'loose',
    })
    expect(after.unfolded.count).toBe(0)
  })

  it('folds a status and a stage on the same Entry — the reducer never gates', () => {
    // Sync §3.7's `never both` is an authoring rule; a peer on another build
    // may write one, and the reader must not reject it (spec §1.3).
    const state = fold([
      anOp(tripEntryStatusSet(TRIP, CRATE, 'packed'), {
        hlc: hlcAt(1, DEFAULT_MS),
        deviceId: DEV_A,
      }),
      anOp(tripContainerStageSet(TRIP, CRATE, 'car'), {
        hlc: hlcAt(2, DEFAULT_MS),
        deviceId: DEV_A,
      }),
    ])
    expect(state.trips[TRIP]?.entries?.[CRATE]?.status?.value).toBe('packed')
    expect(state.trips[TRIP]?.entries?.[CRATE]?.stage?.value).toBe('car')
  })
})
