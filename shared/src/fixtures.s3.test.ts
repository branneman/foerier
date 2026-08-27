import { describe, expect, it } from 'vitest'

import type { OpEnvelope } from './ops.ts'
import { fold } from './reduce.ts'

import fixture from '../fixtures/s3-tags.ops.json' with { type: 'json' }

/**
 * S3's half of the fixture rule
 * ([architecture §8.7](../../docs/architecture-design.md), `testing.md`'s
 * Backward-compatibility group): **capture an op fixture in the same slice
 * that introduces the op type.** A fixture written later is captured from a
 * format that has already drifted.
 *
 * S3 introduces `gear.tag_applied` and `gear.tag_removed`, so this file pins
 * their wire format and their effect on folded state, replayed through the
 * current reducer on every push to `main`. The S2 fixture stays where it is;
 * a slice adds its own rather than editing a captured one, because editing a
 * capture is how a capture stops being one.
 *
 * **Most of this fixture is deliberately un-authorable by us.** `authoring.ts`
 * types both builders' `tag` as `TagString`, so no foerier client can emit
 * `WINTER`, `cook set`, `#winter` or a 200-character tag. Those five ops are
 * **forward-compatibility probes**, standing in for a client on a different
 * normalisation — the exact case `sync-protocol.md` §4.3 says outranks the
 * `TagString` rule ("an installed PWA running an older build may hold ops
 * queued offline against an earlier normalisation, and rejecting them would
 * discard a Quartermaster's work to enforce a cosmetic rule"). Do not read
 * them as evidence some old build emitted them.
 */

/** Tagged conformingly, then one tag removed — the ordinary path. */
const CONFORMING_GEAR = '44444444-0000-7000-8000-000000000001'
/** Carries the five tags no builder of ours can author. */
const FOREIGN_GEAR = '44444444-0000-7000-8000-000000000002'
/** Tagged, then removed by a *lower* clock that arrives later in the file. */
const LATE_LOSER_GEAR = '44444444-0000-7000-8000-000000000003'

describe('the S3 tag fixture', () => {
  // §5.4's frozen list is a test, not a convention, only because this
  // snapshot is committed and replayed. A future slice that changes what
  // `gear.tag_applied` does to folded state fails here first.
  it('folds the S3 fixture to exactly the state it folded to when captured', () => {
    expect(fold(fixture as OpEnvelope[])).toMatchSnapshot()
  })

  it('never mutates the fixture it was given', () => {
    const before = JSON.stringify(fixture)
    fold(fixture as OpEnvelope[])
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it('folds a conforming apply and remove into per-tag registers', () => {
    const tags = fold(fixture as OpEnvelope[]).gear[CONFORMING_GEAR]?.tags
    expect(tags?.['winter']?.value).toBe(true)
    expect(tags?.['sleep']?.value).toBe(true)
    // Removed, not deleted: the register survives holding `false`, carrying
    // the removal's own clock.
    expect(tags?.['bulky']?.value).toBe(false)
  })

  /**
   * The rule §4.3 states and §5 outranks it with: a non-conforming tag folds
   * **exactly as received**. The register key is the literal string that
   * arrived — never normalised, never rejected, never dropped.
   */
  it('folds every non-conforming tag exactly as received', () => {
    const tags = fold(fixture as OpEnvelope[]).gear[FOREIGN_GEAR]?.tags ?? {}
    expect(Object.keys(tags).sort()).toEqual(
      ['WINTER', 'cook set', '#winter', 'a'.repeat(200), 'ünter'].sort(),
    )
  })

  // Two spellings of one intent are two registers that both fold — which is
  // precisely why the defence is the picker at authoring time.
  it('keeps two spellings of one intent as two registers', () => {
    const state = fold(fixture as OpEnvelope[])
    expect(state.gear[FOREIGN_GEAR]?.tags?.['WINTER']?.value).toBe(true)
    expect(state.gear[CONFORMING_GEAR]?.tags?.['winter']?.value).toBe(true)
  })

  // Arrival order is not merge order (§8.2). The removal sits later in the
  // file and carries the lower clock, so it loses.
  it('lets a lower-clocked op that arrives later still lose', () => {
    const tags = fold(fixture as OpEnvelope[]).gear[LATE_LOSER_GEAR]?.tags
    expect(tags?.['food']?.value).toBe(true)
  })
})
