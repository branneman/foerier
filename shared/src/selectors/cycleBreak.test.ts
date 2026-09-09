import { describe, expect, it } from 'vitest'

import { aGear, anOp, aTrip, hlcAt } from '../../testUtils/index.ts'
import {
  gearRehomed,
  tripEntryAdded,
  tripEntryMoved,
  type OpSpec,
} from '../authoring.ts'
import type { OpEnvelope } from '../ops.ts'
import { fold } from '../reduce.ts'
import { containmentView } from './containment.ts'
import { tripContainmentView } from './tripContainment.ts'

/**
 * **The cycle break, asserted once against both containment views.**
 *
 * `tripContainment.ts` restates `containment.ts`'s traversal over a different
 * pointer type, deliberately — the two worlds resolve against different
 * things, and a shared implementation would take a strategy object for every
 * line. Its header names the obligation that duplication creates, and names
 * the half that would fail **silently**: the cycle break. A replica-dependent
 * break has no symptom on any one Device; it shows up as two Devices drawing
 * different trees, which no tier compares — the convergence tier compares
 * folded state, and both views run downstream of the fold.
 *
 * `sync-protocol.md` §3.6 is one rule for both: within a cycle, the edge
 * whose `residence` register carries the **lowest `(hlc, device_id)`** reads
 * loose, with the id as the final canonical tiebreak. So the rule is spelled
 * once here, and each case is run through **both** worlds. A drift fails one
 * column and passes the other, which is exactly the shape of the failure
 * these files cannot otherwise be made to show.
 *
 * It deliberately does not assert the rest of either view. Their own suites
 * cover the four loose reasons, the sorted traversal and the two worlds'
 * intended differences; what has no home but this file is the claim that the
 * *same* input breaks the *same* edge in both.
 */

const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'
const DEV_B = 'bbbbbbbb-0000-7000-8000-000000000002'
const TRIP = 'trip-cycle'

/** One node of a three-node cycle: who it points at, and on whose clock. */
interface Edge {
  readonly id: string
  readonly holder: string
  readonly counter: number
  readonly deviceId: string
}

function op(spec: OpSpec, counter: number, deviceId: string): OpEnvelope {
  return anOp(spec, { hlc: hlcAt(counter), deviceId })
}

/**
 * The same cycle in the **home** world: three containers, each resided in the
 * next, the closing edge written on its own stamp.
 */
function brokenAtHome(edges: readonly Edge[]): ReadonlySet<string> {
  const ops: OpEnvelope[] = []
  for (const edge of edges) {
    ops.push(
      ...aGear({ id: edge.id, name: edge.id, container: true }).map((spec) =>
        anOp(spec, { hlc: hlcAt(1), deviceId: DEV_A }),
      ),
    )
  }
  for (const edge of edges) {
    ops.push(
      op(
        gearRehomed(edge.id, { in: 'gear', id: edge.holder }),
        edge.counter,
        edge.deviceId,
      ),
    )
  }
  return containmentView(fold(ops)).brokenEdges
}

/** The same cycle in the **trip** world: three container Entries. */
function brokenOnTrip(edges: readonly Edge[]): ReadonlySet<string> {
  const ops: OpEnvelope[] = aTrip({ id: TRIP, name: 'Alps' }).map((spec) =>
    anOp(spec, { hlc: hlcAt(1), deviceId: DEV_A }),
  )

  for (const edge of edges) {
    // Trip-only so the Entry is a container on its own say-so, with no Gear
    // aggregate in the picture — the cycle is what is under test, not how an
    // Entry learns it can hold something.
    ops.push(
      op(
        tripEntryAdded(TRIP, edge.id, {
          from: 'trip_only',
          name: edge.id,
          container: true,
        }),
        1,
        DEV_A,
      ),
    )
  }
  for (const edge of edges) {
    ops.push(
      op(
        tripEntryMoved(TRIP, edge.id, {
          in: 'container',
          entryId: edge.holder,
        }),
        edge.counter,
        edge.deviceId,
      ),
    )
  }

  const state = fold(ops)
  return tripContainmentView(state.trips[TRIP]!, state).brokenEdges
}

const worlds = [
  ['home', brokenAtHome],
  ['trip', brokenOnTrip],
] as const

describe('§3.6’s cycle break is one rule, and both worlds obey it', () => {
  it.each(worlds)(
    '%s: breaks the edge with the lowest hlc',
    (_world, broken) => {
      // `b` closes the cycle on the earliest clock, so `b`'s own edge is the
      // one reported loose — not the last one written, and not the first node
      // the traversal happens to meet.
      expect([
        ...broken([
          { id: 'a', holder: 'c', counter: 7, deviceId: DEV_A },
          { id: 'b', holder: 'a', counter: 3, deviceId: DEV_A },
          { id: 'c', holder: 'b', counter: 5, deviceId: DEV_A },
        ]),
      ]).toEqual(['b'])
    },
  )

  it.each(worlds)(
    '%s: breaks the tie on device_id, not on arrival',
    (_world, broken) => {
      // Equal stamps, so `compareStamps` falls to `device_id` — and `DEV_A`
      // sorts before `DEV_B`. The ops are written in an order that would give
      // the other answer if arrival decided it.
      expect([
        ...broken([
          { id: 'a', holder: 'c', counter: 4, deviceId: DEV_B },
          { id: 'b', holder: 'a', counter: 4, deviceId: DEV_B },
          { id: 'c', holder: 'b', counter: 4, deviceId: DEV_A },
        ]),
      ]).toEqual(['c'])
    },
  )

  it.each(worlds)(
    '%s: falls to the id when the whole stamp ties',
    (_world, broken) => {
      // Unreachable through one Device's clock and canonical by design: the
      // id is what makes the break total by inspection rather than by an
      // argument about who wrote when.
      expect([
        ...broken([
          { id: 'a', holder: 'c', counter: 9, deviceId: DEV_A },
          { id: 'b', holder: 'a', counter: 9, deviceId: DEV_A },
          { id: 'c', holder: 'b', counter: 9, deviceId: DEV_A },
        ]),
      ]).toEqual(['a'])
    },
  )

  it.each(worlds)(
    '%s: breaks exactly one edge, so the rest of the cycle stays hung together',
    (_world, broken) => {
      // The point of breaking one and not the cycle: everything else keeps
      // the holder it names, and restoring the broken pointer restores the
      // arrangement. Two broken edges would silently scatter a crate's
      // contents across the tree's root.
      expect(
        broken([
          { id: 'a', holder: 'c', counter: 7, deviceId: DEV_A },
          { id: 'b', holder: 'a', counter: 3, deviceId: DEV_A },
          { id: 'c', holder: 'b', counter: 5, deviceId: DEV_A },
        ]).size,
      ).toBe(1)
    },
  )
})
