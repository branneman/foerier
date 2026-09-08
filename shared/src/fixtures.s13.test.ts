import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/s13-tasks.ops.json' with { type: 'json' }
import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'
import { taskCounts, taskTickedOf, tasksOf } from './selectors/task.ts'

/**
 * S13's half of the fixture rule
 * ([architecture §8.7](../../docs/architecture-design.md), `testing.md`'s
 * Backward-compatibility group): **capture an op fixture in the same commit
 * as the slice that introduces the op type**. S4's fixture landed a slice
 * late — `fixtures.s4.test.ts`'s own header says so — and the drift between
 * S4 and S6 is now baked into that snapshot as though it had always been the
 * format. This file exists so the same thing does not happen to
 * `trip.task_added` and `trip.task_ticked` (spec §1).
 *
 * It carries **only** S13's two op types plus the `trip.created` that gives
 * them something to address. There is no Gear and no Person in it, and that
 * absence is itself a fact about the slice: a Pre-trip task is *non-gear* by
 * definition (story 15), so nothing here references another aggregate and no
 * reader of a Task ever has to ask whether one has arrived.
 *
 * Four cases, each either captured or a forward-compatibility probe:
 *
 * 1. **`k-s13-charge`** — the ordinary line: added, then ticked. Its `ticked`
 *    register is present and `true`.
 * 2. **`k-s13-vignette`** — ticked by one Device and unticked by another,
 *    later. It pins **one op for both directions**: the second write is an
 *    ordinary LWW value on the same register, not a delete, so the register is
 *    present and `false` rather than gone.
 * 3. **`k-s13-vouchers`** — added and never ticked. Its `ticked` register is
 *    **absent**, which `taskTickedOf` reads as `false`. Absent and case 2's
 *    explicit `false` are different facts about the log that every reader
 *    treats alike, and this fixture holds both at once so the pair cannot
 *    quietly collapse into one.
 * 4. **`k-s13-orphan`** — a `trip.task_ticked` whose `trip.task_added` never
 *    arrives, standing for a peer whose add is still queued. Spec §1's *folds
 *    unconditionally*: the Task exists in the fold, holds a `ticked` register
 *    and no `text`, and is drawn nowhere — excluded from `tasksOf` and from
 *    both of `taskCounts`' numbers.
 */

const TRIP = 't-s13-1'
const CHARGE = 'k-s13-charge'
const VIGNETTE = 'k-s13-vignette'
const VOUCHERS = 'k-s13-vouchers'
/** Ticked by a peer whose add never arrived — the probe. */
const ORPHAN = 'k-s13-orphan'

function folded() {
  return fold(fixture as OpEnvelope[])
}

function taskOf(id: string) {
  return folded().trips[TRIP]?.tasks?.[id]
}

describe('the S13 fixture', () => {
  it('folds to exactly the state it folded to when captured', () => {
    expect(folded()).toMatchSnapshot()
  })

  it('never mutates the fixture it was given', () => {
    const before = JSON.stringify(fixture)
    folded()
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it('folds every op it carries', () => {
    expect(folded().unfolded.count).toBe(0)
  })

  it('ticks the ordinary line', () => {
    expect(taskOf(CHARGE)?.ticked?.value).toBe(true)
  })

  // One op for both directions: the untick is a value on the same register,
  // so what it leaves behind is a present `false` and never a dropped key.
  it('leaves a present false register when a second Device unticks', () => {
    const vignette = taskOf(VIGNETTE)
    expect(vignette?.ticked).toBeDefined()
    expect(vignette?.ticked?.value).toBe(false)
    expect(taskTickedOf(vignette!)).toBe(false)
  })

  // The other half of the pair, in the same fixture: absent is a different
  // fact from an explicit `false` and reads the same on the way out.
  it('leaves no ticked register at all on a task never ticked', () => {
    const vouchers = taskOf(VOUCHERS)
    expect(vouchers?.ticked).toBeUndefined()
    expect(taskTickedOf(vouchers!)).toBe(false)
  })

  it('folds a tick whose add never arrived, holding no text — a forward-compatibility probe', () => {
    const orphan = taskOf(ORPHAN)
    expect(orphan?.ticked?.value).toBe(true)
    expect(orphan?.text).toBeUndefined()
  })

  it('draws the three named lines and never the orphan', () => {
    const trip = folded().trips[TRIP]!
    expect(tasksOf(trip).map((t) => t.text)).toEqual([
      'Charge the devices',
      'Buy the vignette',
      'Print the hut vouchers',
    ])
    expect(taskCounts(trip)).toEqual({ total: 3, ticked: 1 })
  })
})
