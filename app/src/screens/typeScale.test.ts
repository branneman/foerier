import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **The small end of the type scale, and the one thing a test can hold about
 * it** (`docs/design/README.md` §5n K28).
 *
 * The mono-caps label was the codebase's most-copied rule: seventy-six
 * uppercase-label rules across twenty-nine modules, and ~170 `font-size`
 * declarations setting a raw `rem` because the boards draw mono down to 8.5
 * and the scale stopped at 11. K28 gives the small end four steps and turns
 * the recipe into a utility class.
 *
 * **A class is assertable and 170 raw `rem`s never were.** That is the whole
 * argument for the class over four bare tokens, and this file is where it
 * pays: a label that drifts off the scale is one grep, where half a pixel in
 * one module was invisible to every tier. jsdom computes no layout and
 * `app/vitest.config.ts` sets no `css` option, so — as in
 * `drawnSizes.test.ts` and `print.test.ts` — the stylesheet text is the only
 * thing there is to read.
 *
 * What it cannot hold is the **paint**. An explicit line-height where one was
 * inherited is exactly the change no tier here can see, and the browser pass
 * for it is recorded in `KEYBOARD-PASS.md`.
 */

const REPO = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..')

function tokens(): string {
  return readFileSync(join(REPO, 'ui', 'styles', 'tokens.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
}

function utilities(): string {
  return readFileSync(
    join(REPO, 'ui', 'styles', 'utilities.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every `*.module.css` under `app/src` and `ui/src`. */
function moduleStylesheets(): readonly { name: string; css: string }[] {
  const found: { name: string; css: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.module.css')) {
        found.push({
          name: entry.name,
          css: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
        })
      }
    }
  }
  walk(join(REPO, 'app', 'src'))
  walk(join(REPO, 'ui', 'src'))
  return found
}

/** The four steps, and the two sizes K28b folded into `control`. */
const STEPS = [
  ['--text-label', '0.6875rem/0.875rem', '11/14'],
  ['--text-label-control', '0.625rem/0.8125rem', '10/13'],
  ['--text-label-chrome', '0.5625rem/0.75rem', '9/12'],
  ['--text-label-head', '0.53125rem/0.71875rem', '8.5/11.5'],
] as const

describe('the small type scale', () => {
  it.each(STEPS)('declares %s at %s (%s)', (token, pair) => {
    expect(tokens()).toMatch(
      new RegExp(`${token}:\\s*${pair.replace(/[./]/g, '\\$&')};`),
    )
  })

  it('derives every line-height as size + 3, which is what the drawn pair states', () => {
    // The derivation is the reason four steps could be added to a scale whose
    // own rule is that a per-screen override is the drift tokens prevent:
    // nothing here is a new opinion about type.
    const css = tokens()
    for (const [token] of STEPS) {
      const pair = new RegExp(`${token}:\\s*([0-9.]+)rem/([0-9.]+)rem;`).exec(
        css,
      )
      expect(pair, token).not.toBeNull()
      const size = Number(pair?.[1]) * 16
      const leading = Number(pair?.[2]) * 16
      expect(leading - size, token).toBeCloseTo(3, 5)
    }
  })

  it('raises tracking as size falls, one value per step', () => {
    const css = utilities()
    expect(css).toMatch(
      /\.label\s*\{[^}]*letter-spacing:\s*var\(--tracking-label\)/,
    )
    expect(css).toMatch(/\.label--control\s*\{[^}]*letter-spacing:\s*0\.1em/)
    expect(css).toMatch(/\.label--chrome\s*\{[^}]*letter-spacing:\s*0\.12em/)
    expect(css).toMatch(/\.label--head\s*\{[^}]*letter-spacing:\s*0\.14em/)
    expect(tokens()).toMatch(/--tracking-label:\s*0\.08em;/)
  })

  it('carries weight and the transform on the class, never on a step', () => {
    // A step is a size. A caller wanting 10px mono in sentence case should
    // not have to unset a transform it never asked for — `ui/Chip`'s tag,
    // which is lowercase by rule, is that caller.
    const base = /\.label\s*\{([^}]*)\}/.exec(utilities())?.[1] ?? ''
    expect(base).toMatch(/font-weight:\s*600/)
    expect(base).toMatch(/text-transform:\s*uppercase/)

    for (const [token] of STEPS) {
      expect(tokens()).not.toMatch(new RegExp(`${token}:[^;]*uppercase`))
    }
  })

  /**
   * The migration, asserted by absence — the only shape that scales past a
   * hundred call sites.
   *
   * **Scoped to rules that are actually on this scale**, which is a rule
   * about the mono label and not about small type: a rule qualifies when it
   * names `--font-mono`, on its own or through the shorthand. `PersonCircle`
   * is why the distinction is drawn rather than assumed — its initials sit at
   * 11, 10 and 9 in the **body** face, and an initial is a letter, not a
   * label. Handing it a step would give a single glyph a caps run's tracking
   * and a line-height derived for one.
   */
  it('leaves no mono label spelling a step, or a retired size, as a raw rem', () => {
    const retired = ['0.59375rem', '0.65625rem'] // K28b: 9.5 and 10.5
    const banned = [...STEPS.map(([, pair]) => pair.split('/')[0]), ...retired]

    const offenders: string[] = []
    for (const { name, css } of moduleStylesheets()) {
      for (const match of css.matchAll(/\{([^{}]*)\}/g)) {
        const body = match[1] ?? ''
        if (!body.includes('--font-mono')) continue
        for (const size of banned) {
          if (body.includes(`font-size: ${size};`)) {
            offenders.push(`${name} — font-size: ${size}`)
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
