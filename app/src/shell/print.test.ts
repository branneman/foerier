import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **§6's print row, pinned** — nav hidden, single column, ink on white,
 * truncation expanded.
 *
 * Two of the four shipped and two did not, and the gap had one symptom: a
 * long Depot printed **one viewport**. Nothing unpinned `.shell__main`'s
 * inner scroller, so the page got whatever was on screen and clipped the
 * rest.
 *
 * Read as stylesheet text, for `drawnSizes.test.ts`'s reason — no `css`
 * option is set, so CSS modules are not processed and jsdom computes no
 * layout — and doubly so here, because jsdom has no print medium at all: a
 * `@media print` rule is invisible to every other technique in the repo.
 * Comments are stripped first, since these fences match across a whole rule
 * and the prose explaining a declaration would otherwise satisfy it.
 */
function sheet(name: string): string {
  const here = dirname(expect.getState().testPath ?? '')
  return readFileSync(
    join(here, '..', '..', '..', 'ui', 'styles', name),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The body of the `@media print` block in `name`, or `undefined`. */
function printBlock(name: string): string | undefined {
  const css = sheet(name)
  const start = css.indexOf('@media print')
  if (start === -1) return undefined

  // Brace-matched rather than `[^}]*`: this block holds whole rules.
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
    }
  }
  return undefined
}

describe('print', () => {
  it('hides the nav, which is an affordance nobody can tap on paper', () => {
    expect(printBlock('layout.css')).toMatch(
      /\.shell__nav\s*\{[^}]*display:\s*none/,
    )
  })

  it('unpins the shell, so the document pages instead of clipping', () => {
    const block = printBlock('layout.css')

    // The three pins, each undone: the fixed viewport height, the inner
    // scroller, and the capped centred column.
    expect(block).toMatch(/\.shell\s*\{[^}]*height:\s*auto/)
    expect(block).toMatch(/\.shell__main\s*\{[^}]*overflow:\s*visible/)
    expect(block).toMatch(/\.shell__main\s*\{[^}]*max-width:\s*none/)
  })

  it('is a single column, which the grid is not once the nav is hidden', () => {
    // From Split up `.shell` is a two-column grid; hiding the nav leaves an
    // empty 216px column rather than a wider one.
    expect(printBlock('layout.css')).toMatch(
      /\.shell\s*\{[^}]*display:\s*block/,
    )
  })

  it('prints ink on white', () => {
    const block = printBlock('base.css')

    expect(block).toMatch(/body\s*\{[^}]*background:\s*#fff/)
    expect(block).toMatch(/body\s*\{[^}]*color:\s*#000/)
  })

  it('expands every truncated line, including the module-level copies', () => {
    // Truncation is spelled in a dozen CSS modules whose class names are
    // hashed at build time, so the global override is the only rule that can
    // reach them.
    const block = printBlock('base.css')

    expect(block).toMatch(/white-space:\s*normal\s*!important/)
    expect(block).toMatch(/text-overflow:\s*clip\s*!important/)
    expect(block).toMatch(/-webkit-line-clamp:\s*none\s*!important/)
  })

  it('excludes .visually-hidden from that expansion', () => {
    // Without the exclusion, printing a page prints every screen-reader-only
    // string in it: `.visually-hidden` hides its content in a 1px box.
    expect(printBlock('base.css')).toMatch(/\*:not\(\.visually-hidden\)/)
  })

  it('leaves overflow alone globally, unpinning the shell by name instead', () => {
    // `overflow: visible` on every element would undo `.visually-hidden`'s
    // own clip and every deliberate clip in the app. The one scroller that
    // has to go is named in `layout.css`, where the element is known.
    expect(printBlock('base.css')).not.toMatch(/overflow:\s*visible/)
  })

  it('expands the two utilities in their own sheet', () => {
    const block = printBlock('utilities.css')

    expect(block).toMatch(/\.truncate\s*\{[^}]*white-space:\s*normal/)
    expect(block).toMatch(/\.clamp-2\s*\{[^}]*-webkit-line-clamp:\s*none/)
  })
})
