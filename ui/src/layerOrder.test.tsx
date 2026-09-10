import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * **The cascade's layer order is decided by the bundle, not by this package's
 * stylesheet — and that is the whole of this file.**
 *
 * `ui/styles/index.css` opens with
 * `@layer reset, tokens, base, layout, components, utilities, overrides;`, and
 * `frontend-design.md` §4.1 leans on it: *a utility can never lose a
 * specificity fight to a component*. But CSS layers take their order from
 * **first mention**, so the order the browser actually applies is whichever
 * `@layer` the bundler emits first — and every `*.module.css` in this package
 * opens `@layer components { … }`.
 *
 * It shipped inverted for three months. `app/src/main.tsx` imported
 * `ErrorBoundary` from this barrel *above* its own
 * `import '@foerier/ui/styles.css'`, so module evaluation reached a dozen
 * component modules first: `components` was created before `reset` existed and
 * the declared order appended every other layer **after** it. `reset`, `base`,
 * `layout` and `utilities` then beat every component here. What it looked
 * like: `reset`'s `button { color: inherit }` winning, so the journey rail's
 * current chip painted its background and inherited its text colour (white on
 * white) and the sign-in CTA drew dark on dark; both FABs losing
 * `position: fixed` and standing in the content flow; the Depot's title row
 * and the sidebar's foot losing their layout.
 *
 * **Nothing else in the repo can see this.** Vitest processes no CSS modules
 * and jsdom computes no styles, so no rendering test can catch it; the
 * symptom is proved end to end by `test/e2e/shell.spec.ts` (a control whose
 * text is its own background), and the mechanism is proved here — text, which
 * is the only technique available at this tier.
 */

const REPO = join(dirname(new URL(import.meta.url).pathname), '..', '..')

function read(...segments: readonly string[]): string {
  return readFileSync(join(REPO, ...segments), 'utf8')
}

/** With comments stripped, so a `@layer` named in prose is never a match. */
function bare(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').trim()
}

const LAYERS = [
  'reset',
  'tokens',
  'base',
  'layout',
  'components',
  'utilities',
  'overrides',
] as const

describe('the cascade layer order', () => {
  it('is declared before anything in the stylesheet can create a layer', () => {
    const css = bare(read('ui', 'styles', 'index.css'))

    expect(css.startsWith(`@layer ${LAYERS.join(', ')};`)).toBe(true)
  })

  /**
   * The barrel is what every consumer touches, so the statement travelling
   * with it makes the order a property of **this package** rather than of one
   * consumer's import order — which is what was wrong.
   */
  it('travels with the barrel, ahead of every component it re-exports', () => {
    const source = bare(read('ui', 'src', 'index.ts'))
    const imports = [...source.matchAll(/^\s*(?:import|export)\b[^\n]*$/gm)]

    expect(imports[0]?.[0]).toContain("import '../styles/index.css'")
  })

  /**
   * A module with no layer of its own is unlayered, and **unlayered styles
   * beat every layer** — the inversion again, one file at a time and much
   * harder to see, since it would look like one component ignoring a utility.
   */
  it('is claimed by every stylesheet in the package', () => {
    const dir = join(REPO, 'ui', 'src')
    const unlayered = readdirSync(dir)
      .filter((name) => name.endsWith('.module.css'))
      .filter((name) => !bare(read('ui', 'src', name)).startsWith('@layer '))

    expect(unlayered).toEqual([])
  })
})
