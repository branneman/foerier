import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **Ruling O's drawn sizes, pinned.**
 *
 * The global `min-height: max(3rem, 48px)` floor in `ui/styles/base.css` was
 * retired because it floored the *paint* rather than the hit area, and
 * `min-height` beats `height` regardless of cascade layer — so every control
 * drawn smaller than 48px was painted at 48 while its own declaration looked
 * like it was working. Seventeen controls turned out to be sized only by that
 * floor. The round-2 closeout split them: those a board draws smaller get
 * their drawn size back plus a clamped, non-painting `::after`; the rest keep
 * an explicit 48.
 *
 * Nothing else in this repo can catch a regression here. `app/vitest.config.ts`
 * runs with `css: false`, so `toHaveStyle` passes unconditionally and jsdom
 * computes no layout at all. Reading the stylesheet text is the one technique
 * that survives that, and it is the same one `EntryRow.test.tsx` and
 * `OverClaimBand.test.tsx` already use.
 *
 * What this guards is narrow and deliberate: that these three did not quietly
 * go back to being painted at 48, and that each still carries the hit
 * extension that makes the small paint reachable. The exact pixel values are
 * the boards' business and are asserted only where the board states a number.
 */
function moduleCss(...segments: readonly string[]): string {
  const here = dirname(expect.getState().testPath ?? '')
  return readFileSync(join(here, ...segments), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
}

/** The `{ … }` body of the rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string | undefined {
  const escaped = selector.replace(/[.[\]:]/g, '\\$&')
  return new RegExp(`(?:^|[\\s{}])${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
}

const FLOOR = /min-height:\s*max\(3rem,\s*48px\)/

describe("ruling O's drawn sizes", () => {
  it('paints the phase chip as the ~24px pill the board draws', () => {
    const css = moduleCss('Trip.module.css')
    const chip = ruleBody(css, '.chip')

    expect(chip).toBeDefined()
    expect(chip).not.toMatch(FLOOR)
    expect(chip).toMatch(/min-height:\s*1\.5rem/)
    // Reachable despite the small paint, and relative so the extension has
    // something to position against.
    expect(chip).toMatch(/position:\s*relative/)
    expect(ruleBody(css, '.chip::after')).toBeDefined()
  })

  /**
   * The two `EDIT LIST ›` links are the same door drawn twice, and only one
   * of them may take the floor. In the `GEAR LIST` band `.editList` sits in
   * an `align-items: baseline` row beside `.gearListCount`, so a taller box
   * would push it off that baseline — it keeps its 11px paint and reaches 44
   * through a symmetric `::after`. In the empty region there is no such row,
   * so ruling O's standalone clause applies and the hit area is simply
   * drawn. Pinned together, because the failure this guards is the copy: a
   * second author giving the band's link the floor, or the region's link an
   * extension it has nothing to clamp against.
   */
  it('floors the empty region\u2019s EDIT LIST, and never the band\u2019s', () => {
    const css = moduleCss('Trip.module.css')
    const empty = ruleBody(css, '.editListEmpty')
    const inBand = ruleBody(css, '.editList')

    expect(empty).toBeDefined()
    expect(empty).toMatch(FLOOR)
    expect(empty).not.toMatch(/position:\s*relative/)
    expect(ruleBody(css, '.editListEmpty::after')).toBeUndefined()

    expect(inBand).toBeDefined()
    expect(inBand).not.toMatch(FLOOR)
    expect(inBand).toMatch(/position:\s*relative/)
    expect(ruleBody(css, '.editList::after')).toMatch(/inset:\s*-0\.6875rem/)
  })

  it('paints the Depot column head as its drawn band, not a 48px box', () => {
    const css = moduleCss('Depot.module.css')
    const head = ruleBody(css, '.columnHead')

    expect(head).toBeDefined()
    expect(head).not.toMatch(FLOOR)
    expect(head).toMatch(/position:\s*relative/)

    // The extension clamps at the band's own vertical padding rather than
    // growing into the gear rows immediately beneath it — `.list > li` sits
    // adjacent with no gap, so any further growth would land a header tap on
    // the first row of gear.
    const band = ruleBody(css, '.columnHeads')
    const after = ruleBody(css, '.columnHead::after')
    expect(band).toMatch(/padding:\s*var\(--space-8\)/)
    expect(after).toMatch(/inset:\s*-0\.5rem 0/)
  })

  /**
   * **Review F6's gap, a second time** — the `PackingRow .body` shape, three
   * screens over. The first version of this case asserted `background: none`,
   * `position: relative` and that a `::after` *existed*, and never what the
   * extension was measured from. All three are content-sized flex items in
   * an `align-items: center` row, so with no stated paint each grew from its
   * text's line-height: `--text-label` is 11/14 and `--text-data` 13/18, and
   * `inset: -0.625rem 0` adds 10 each side — 14 + 20 = 34 for `REMOVE` and
   * the Devices `SIGN OUT`, 18 + 20 = 38 for the Account footer's. Every one
   * short of the 44 minimum, under a comment that claimed ≥44.
   *
   * Now `.move`'s constant: a stated 24 (`min-height: 1.5rem`) and
   * `inset: -0.75rem 0`, (48 − 24) / 2 = 12 each side, so each reaches 48.
   * The clamp is measured against the owning row, pinned as the third and
   * fourth columns: Account's `.row` is `min-height: 2rem` + `padding-block:
   * 12` ≥ 56, its `.footer` `min-height: max(3.5rem, 56px)` with no
   * padding, Devices' `.row` `max(2.75rem, 44px)` + 24 ≥ 68 — every one ≥
   * 48, and since consecutive rows touch across a 1px rule with no gap, 48
   * is also the most an extension here may take. Vertical-only in every
   * case: the title group and the `BUILD` line sit beside these, and a
   * sideways grow gains nothing.
   */
  it.each([
    [
      'Account.module.css',
      '.signOut',
      '.footer',
      [/min-height:\s*max\(3\.5rem,\s*56px\)/],
    ],
    [
      'Account.module.css',
      '.remove',
      '.row',
      [/min-height:\s*2rem/, /padding-block:\s*var\(--space-12\)/],
    ],
    [
      'Devices.module.css',
      '.signOut',
      '.row',
      [
        /min-height:\s*max\(2\.75rem,\s*44px\)/,
        /padding-block:\s*var\(--space-12\)/,
      ],
    ],
  ] as const)(
    'paints %s %s as attention text, clamped at 48 inside %s',
    (file, selector, rowSelector, rowBounds) => {
      const css = moduleCss(file)
      const rule = ruleBody(css, selector)

      expect(rule).toBeDefined()
      expect(rule).not.toMatch(FLOOR)
      // §11 draws these as text: no box of their own, and the hit area is what
      // makes them tappable.
      expect(rule).toMatch(/background:\s*none/)
      expect(rule).toMatch(/position:\s*relative/)
      // The painted size, stated — an extension is only worth what it is
      // measured from, and a content-sized flex item measures from its
      // line-height unless the stylesheet says otherwise.
      expect(rule).toMatch(/min-height:\s*1\.5rem/)
      // 24 + 12 + 12 = 48, vertical-only.
      expect(ruleBody(css, `${selector}::after`)).toMatch(
        /inset:\s*-0\.75rem 0/,
      )

      // The bounds the clamp is measured against.
      const row = ruleBody(css, rowSelector)
      expect(row).toBeDefined()
      for (const bound of rowBounds) expect(row).toMatch(bound)
    },
  )

  /**
   * The other half of the ruling, and the reason this file does not simply
   * assert "no control anywhere declares the floor". Controls the boards draw
   * at 48 keep their explicit 48 — *stating* it was the fix, since the value
   * is now a decision the file makes rather than one a global rule imposes.
   */
  it('leaves an explicit 48 alone where no board draws smaller', () => {
    const css = moduleCss('..', 'components', 'OverClaimBand.module.css')

    expect(ruleBody(css, '.settle')).toMatch(FLOOR)
    expect(ruleBody(css, '.more')).toMatch(FLOOR)
  })

  /**
   * **S8 ruling A/B** (`docs/design/README.md` §5d), the fourth of these —
   * later than the round-2 closeout's original seventeen, but the identical
   * shape: a 24px circle stays 24px even in the read pane's TABLE-44 density
   * ("display needs no target's air"), and the cluster + `×N` control that
   * wraps it grows to the *row's* own 48, not the 44 every other dense
   * control here reaches for — this is `EntryRow`'s primary control for a
   * `per_person` row, not a secondary action beside it.
   */
  it("paints the piece cluster at 24px in both modes, and clamps the control at the row's 48", () => {
    const circleCss = moduleCss(
      '..',
      '..',
      '..',
      'ui',
      'src',
      'PersonCircle.module.css',
    )
    const size24 = ruleBody(circleCss, '.size24')

    expect(size24).toBeDefined()
    expect(size24).not.toMatch(FLOOR)
    expect(size24).toMatch(/width:\s*1\.5rem/)
    expect(size24).toMatch(/height:\s*1\.5rem/)

    const entryRowCss = moduleCss('..', 'components', 'EntryRow.module.css')
    const control = ruleBody(entryRowCss, '.pieceControl')

    expect(control).toBeDefined()
    expect(control).not.toMatch(FLOOR)
    expect(control).toMatch(/position:\s*relative/)

    // Vertical-only, unlike every other dense control's symmetric
    // `inset: -0.4375rem` — the row's own flex `gap` already separates this
    // control from `✕`, so there is nothing to clamp sideways; the row
    // above/below is the real risk (`.remove`'s own 13px-overlap
    // counter-example, restated at the row's 48 instead of the status-pill
    // minimum's 44).
    expect(ruleBody(entryRowCss, '.pieceControl::after')).toMatch(
      /inset:\s*-0\.75rem 0/,
    )

    // Ruling B's other half: above Split the cluster is a plain `<span>`,
    // not a control — no `position: relative` of its own and no `::after`,
    // so there is nothing here for ruling O to floor.
    const display = ruleBody(entryRowCss, '.pieceDisplay')
    expect(display).toBeDefined()
    expect(display).not.toMatch(/position:\s*relative/)
    expect(ruleBody(entryRowCss, '.pieceDisplay::after')).toBeUndefined()
  })

  /**
   * **S9 review F5.** The first draft declared no paint height on `.move`
   * at all, so an 11px mono glyph painted by the UA's own `line-height:
   * normal` reached only ~13px, and the existing `inset: -0.75rem 0`
   * clamp — `EntryRow.pieceControl`'s own constant — yielded ~37px, short of
   * the 44px floor. `EntryRow.pieceControl` only reaches 48 because it
   * states its own 24px paint (`min-height: 1.5rem`); `.move` now states the
   * identical 24, so the same clamp reaches the identical 48, still inside
   * the row it must not spill out of.
   */
  it("paints the Piece status sheet's MOVE at 24px, clamped to the row's 48", () => {
    const css = moduleCss('..', 'components', 'PieceStatusSheet.module.css')
    const move = ruleBody(css, '.move')

    expect(move).toBeDefined()
    expect(move).not.toMatch(FLOOR)
    expect(move).toMatch(/min-height:\s*1\.5rem/)
    expect(move).toMatch(/position:\s*relative/)

    // (48 - 24) / 2 = 12px = 0.75rem each side, vertical-only — the row's
    // own flex `gap` already separates this from the body button sideways.
    expect(ruleBody(css, '.move::after')).toMatch(/inset:\s*-0\.75rem 0/)
  })

  /**
   * **S9a task 10, moved forward from task 12 by review F2** — because F1 is
   * exactly the failure this file exists to catch, and it shipped: `.row` is
   * `align-items: center`, which sizes a flex item to its **content** on the
   * cross axis rather than stretching it, so the row body painted ~38px
   * inside a 64px row while a comment claimed it inherited the row's height.
   * Every earlier precedent here puts the floor on the element that *is* the
   * target; a content-sized button nested in a taller `<div>` was a shape the
   * repo had not had before.
   */
  it("clamps the packing row's body at the row's own 48, since a flex item is not stretched", () => {
    const css = moduleCss('..', 'components', 'PackingRow.module.css')
    const body = ruleBody(css, '.body')

    expect(body).toBeDefined()
    expect(body).not.toMatch(FLOOR)
    expect(body).toMatch(/position:\s*relative/)
    // **The painted size, pinned like every sibling here** (review F6). The
    // first version of this test asserted the extension and not the paint,
    // which is the one combination this file must never accept: an
    // extension is only worth what it is measured from, and `.body` is
    // content-sized, so without a stated 24 a meta-less row painted 22 and
    // reached 46. Exactly `.move`'s constant, one row along.
    expect(body).toMatch(/min-height:\s*1\.5rem/)
    // Vertical-only: the pill and the cluster sit immediately beside it, and
    // a horizontal extension would take taps meant for *how far along*.
    expect(ruleBody(css, '.body::after')).toMatch(/inset:\s*-0\.75rem 0/)
  })

  /**
   * **The other end of the same row moved to `ui/StatusPill`**, where
   * `ui/src/StatusPill.test.tsx` makes the same two claims for both callers:
   * `docs/design/README.md`'s touch rule carves the pill out at **44**
   * rather than 48, and the board draws it there, so it states its own paint
   * and grows no extension — which is also what keeps it from reaching back
   * across `.body`'s. Named here rather than silently deleted, because this
   * file is where a reader looks for that row's sizes.
   */

  /**
   * Ruling B at 34px (ruling A1): the circles paint the packing row's own
   * density and the **cluster** is the target, clamped at the row rather
   * than at the 44 a secondary action would take — this is one of the row's
   * two primary controls, `EntryRow.pieceControl`'s argument one size up.
   */
  it("paints the packing row's cluster at 34px and clamps the control at 48", () => {
    const circleCss = moduleCss(
      '..',
      '..',
      '..',
      'ui',
      'src',
      'PersonCircle.module.css',
    )
    const size34 = ruleBody(circleCss, '.size34')

    expect(size34).toBeDefined()
    expect(size34).not.toMatch(FLOOR)
    expect(size34).toMatch(/width:\s*2\.125rem/)
    expect(size34).toMatch(/height:\s*2\.125rem/)

    const css = moduleCss('..', 'components', 'PackingRow.module.css')
    const cluster = ruleBody(css, '.cluster')

    expect(cluster).toBeDefined()
    expect(cluster).not.toMatch(FLOOR)
    expect(cluster).toMatch(/position:\s*relative/)
    // 34 painted + 7 above and below = 48, and vertical-only for the body
    // button's sake.
    expect(ruleBody(css, '.cluster::after')).toMatch(/inset:\s*-0\.4375rem 0/)
  })

  /**
   * Ruling A15: the rail chip is painted at the phase chip's own drawn size
   * and reaches 48 through the same clamp — which is why the group header is
   * a 12px-gapped column, so the extension lands in those gaps rather than
   * on the header body's target above it or the first gear row below.
   *
   * **Vertical only**, and that is ruling B's arithmetic in the other axis:
   * the four chips sit 4px apart on one line, so a horizontal extension
   * would put a tap meant for `CAR` on `PACKED`.
   */
  it('paints the journey chip at the phase chip 24 and clamps it at the header row', () => {
    const css = moduleCss('..', 'components', 'JourneyRail.module.css')
    const chip = ruleBody(css, '.chip')

    expect(chip).toBeDefined()
    expect(chip).not.toMatch(FLOOR)
    expect(chip).toMatch(/min-height:\s*1\.5rem/)
    expect(chip).toMatch(/position:\s*relative/)
    expect(ruleBody(css, '.chip::after')).toMatch(/inset:\s*-0\.75rem 0/)

    // The gaps the clamp is measured against. A smaller gap here would let
    // a chip tap land on the header body's own target.
    const header = ruleBody(moduleCss('Packing.module.css'), '.groupHeader')
    expect(header).toMatch(/gap:\s*var\(--space-12\)/)
    expect(header).toMatch(/padding:\s*var\(--space-12\) var\(--space-16\)/)
  })

  /**
   * The container's *where* target, and the other half of ruling O: a
   * control **no board draws at all** has no drawn size to preserve, so it
   * takes the standalone rule — simply drawn ≥48 — rather than a clamp that
   * would have to share the 12px gap the rail chip's extension already
   * occupies.
   */
  it('draws the group header body at an explicit 48, with no extension to share', () => {
    const css = moduleCss('Packing.module.css')
    const header = ruleBody(css, '.headerBody')

    expect(header).toBeDefined()
    expect(header).toMatch(FLOOR)
    expect(ruleBody(css, '.headerBody::after')).toBeUndefined()
  })

  /**
   * **Ruling A10's controls row — half of it moved.** The mode segments now
   * come from `ui/SegmentedControl` and are asserted in `ui/src/SegmentedControl.test.tsx`,
   * where the same two claims are made once for all four callers: 40 painted,
   * a vertical-only clamp to 48, and **nothing clipping**, because a clipped
   * descendant is not hit-testable and a stylesheet-text test would otherwise
   * find the `::after` and pass over a hit area that does not exist. Named
   * here rather than silently deleted, since this file is where a reader
   * looks for that screen's sizes.
   *
   * The pill beside them is still this screen's own, and still shares the
   * argument: inset 0 horizontally, because the two controls sit on one row
   * edge to edge and a sideways grow would put a tap meant for one on the
   * other.
   */
  it('paints the ○ LEFT filter pill at 40px and clamps it at 48', () => {
    const css = moduleCss('Packing.module.css')
    const filter = ruleBody(css, '.filter')

    expect(filter).toBeDefined()
    expect(filter).not.toMatch(FLOOR)
    expect(filter).toMatch(/min-height:\s*max\(2\.5rem,\s*40px\)/)
    expect(filter).toMatch(/position:\s*relative/)
    expect(ruleBody(css, '.filter::after')).toMatch(/inset:\s*-0\.25rem 0/)
  })

  /**
   * **F1 (review round 2).** The Piece status sheet's own row states its size
   * explicitly rather than having been shrunk off the retired global floor —
   * the identical shape `OverClaimBand`'s `.settle`/`.more` test above pins,
   * so an explicit size is not a category this file excludes; it is one it
   * deliberately keeps pinned.
   *
   * Its `SET EVERYONE` chips are `ui/StatusPill`'s `action` size now, pinned
   * at 44 in that component's own suite alongside the row pill they share a
   * grammar with.
   */
  it("leaves the Piece status sheet's row explicit", () => {
    const css = moduleCss('..', 'components', 'PieceStatusSheet.module.css')

    expect(ruleBody(css, '.rowButton')).toMatch(FLOOR)
  })
})
