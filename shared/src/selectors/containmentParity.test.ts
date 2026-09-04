import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  gearRecorded,
  gearRehomed,
  tripCreated,
  tripEntryAdded,
  tripEntryMoved,
} from '../authoring.ts'
import { createReplica, fakeClock } from '../../testUtils/index.ts'
import { containmentView } from './containment.ts'
import { tripContainmentView } from './tripContainment.ts'

/**
 * **The two containment views, held against each other.**
 *
 * `tripContainment.ts` restates `containment.ts`'s traversal, its sorted-id
 * determinism and [sync §3.6](../../../docs/sync-protocol.md)'s cycle break
 * over a different pointer type. `CLAUDE.md` records the duplication as
 * deliberate — the two worlds resolve against different things, Places and
 * Gear against Entries, and a shared implementation would take a strategy
 * object for every line — and names the half that would be **silent** if they
 * diverged: the cycle break, where a replica-dependent break shows up only as
 * two Devices drawing different trees.
 *
 * Each file's own suite pins the rule on its own side, so a divergence is not
 * *undetectable*. What neither can see is the two answering **differently**,
 * because neither knows the other exists. This file is the one place that
 * does. It is not a third implementation: it builds one random graph, plays it
 * into both worlds with the same ids in the same order, and asserts the two
 * views agree — so a rule changed on one side and not the other fails here
 * even when both sides' own tests still pass.
 *
 * What it deliberately does **not** assert is the two rules the trip tree does
 * not share, stated in `tripContainment.ts`'s own header: no restore for
 * `trip.entry_removed`, and no trip twin of the home tree's *retired* reason.
 * Those are differences by design, and the graph below reaches neither —
 * every node is a live container in both worlds.
 *
 * **And one it cannot reach rather than declines to.** `lowestEdgeOf`'s final
 * `id < best.id` tiebreak fires only on two *equal* stamps, which means the
 * same hlc and the same `device_id`; every edge here is authored through a
 * real replica, and one replica never mints the same hlc twice. So this file
 * covers the stamp comparison and not the tiebreak under it. Measured by
 * mutation rather than assumed: flipping the trip side's `compareStamps`
 * direction fails two of the three tests below, while flipping only its id
 * tiebreak fails none of them — and is caught instead by
 * `tripContainment.test.ts`'s own *uses the entry id as a canonical final
 * tiebreak on equal stamps*, which hand-builds the equal stamps that
 * authoring cannot produce. The two halves of the rule are covered in two
 * places, and this is the half that needed a second file.
 */

const HOUSEHOLD = 'cccccccc-0000-7000-8000-000000000003'
const DEVICE = 'aaaaaaaa-0000-7000-8000-000000000001'
const BASE_MS = 1_700_000_000_000
const TRIP = 't-parity'

/** Six is enough for two disjoint cycles plus a tail hanging off one. */
const NODES = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'] as const

/**
 * A **functional** graph over {@link NODES} — each node points at one other
 * node or at nothing, which is exactly the out-degree-≤-1 shape both files
 * argue their walk from. Self-references included: a one-node cycle is a case
 * both sides special-case identically and neither should.
 */
const arbEdges = (): fc.Arbitrary<Record<string, string | undefined>> =>
  fc
    .tuple(
      ...NODES.map(() =>
        fc.option(fc.constantFrom(...NODES), { nil: undefined }),
      ),
    )
    .map((parents) =>
      Object.fromEntries(NODES.map((id, i) => [id, parents[i]])),
    )

/** The order the edges are written in, which is what sets their stamps. */
const arbWriteOrder = (): fc.Arbitrary<readonly string[]> =>
  fc.shuffledSubarray([...NODES], { minLength: NODES.length })

function replica() {
  return createReplica({
    deviceId: DEVICE,
    householdId: HOUSEHOLD,
    clock: fakeClock(BASE_MS),
  })
}

/** The same graph as gear-in-gear: every node a container, so every edge
 * resolves rather than falling to reason 3. */
function homeView(
  edges: Record<string, string | undefined>,
  order: readonly string[],
) {
  const r = replica()
  for (const id of NODES) {
    r.emit(gearRecorded(id, { name: id, container: true, kind: 'single' }))
  }
  for (const id of order) {
    const parent = edges[id]
    if (parent !== undefined)
      r.emit(gearRehomed(id, { in: 'gear', id: parent }))
  }
  return containmentView(r.state())
}

/** The identical graph as entry-in-container-entry, written in the identical
 * order, so the two edge stamps rank the same way on both sides. */
function tripView(
  edges: Record<string, string | undefined>,
  order: readonly string[],
) {
  const r = replica()
  r.emit(tripCreated(TRIP, 'Parity'))
  for (const id of NODES) {
    r.emit(
      tripEntryAdded(TRIP, id, {
        from: 'trip_only',
        name: id,
        container: true,
      }),
    )
  }
  for (const id of order) {
    const parent = edges[id]
    if (parent !== undefined) {
      r.emit(tripEntryMoved(TRIP, id, { in: 'container', entryId: parent }))
    }
  }
  const state = r.state()
  const trip = state.trips[TRIP]
  expect(trip).toBeDefined()
  return tripContainmentView(trip!, state)
}

describe('the two containment views break the same edges', () => {
  it('agrees on the broken set over a random functional graph', () => {
    fc.assert(
      fc.property(arbEdges(), arbWriteOrder(), (edges, order) => {
        const home = homeView(edges, order)
        const trip = tripView(edges, order)

        expect([...trip.brokenEdges].sort()).toEqual(
          [...home.brokenEdges].sort(),
        )
      }),
      { numRuns: 500 },
    )
  })

  it('agrees on every bucket, not only on which edges were cut', () => {
    fc.assert(
      fc.property(arbEdges(), arbWriteOrder(), (edges, order) => {
        const home = homeView(edges, order)
        const trip = tripView(edges, order)

        // `childrenOf` is where a break becomes visible to a screen, and it is
        // the half `containment.ts`'s own doc calls replica-dependent when the
        // traversal is not sorted. Two views agreeing on `brokenEdges` and
        // disagreeing here would still draw two different trees.
        for (const id of NODES) {
          expect(trip.childrenOf({ kind: 'container', entryId: id })).toEqual(
            home.childrenOf({ kind: 'gear', id }),
          )
        }
        expect(trip.childrenOf({ kind: 'loose' })).toEqual(
          home.childrenOf({ kind: 'loose' }),
        )
      }),
      { numRuns: 500 },
    )
  })

  /**
   * The guard on the two tests above: a graph with no cycle in it would let
   * them pass against any cycle rule at all, including none. This asserts the
   * generator actually reaches the case they exist for.
   */
  it('generates cycles often enough for the agreement to mean anything', () => {
    const samples = fc.sample(fc.tuple(arbEdges(), arbWriteOrder()), {
      numRuns: 500,
      seed: 20260904,
    })
    const withACycle = samples.filter(
      ([edges, order]) => homeView(edges, order).brokenEdges.size > 0,
    ).length

    expect(withACycle).toBeGreaterThan(samples.length / 4)
  })
})
