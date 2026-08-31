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

  it.each([
    ['Account.module.css', '.signOut'],
    ['Account.module.css', '.remove'],
    ['Devices.module.css', '.signOut'],
  ])('paints %s %s as attention text, never a button', (file, selector) => {
    const css = moduleCss(file)
    const rule = ruleBody(css, selector)

    expect(rule).toBeDefined()
    expect(rule).not.toMatch(FLOOR)
    // §11 draws these as text: no box of their own, and the hit area is what
    // makes them tappable.
    expect(rule).toMatch(/background:\s*none/)
    expect(rule).toMatch(/position:\s*relative/)
    expect(ruleBody(css, `${selector}::after`)).toBeDefined()
  })

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
})
