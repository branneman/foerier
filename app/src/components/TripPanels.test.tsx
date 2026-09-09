import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TripPanels } from './TripPanels'

afterEach(cleanup)

/**
 * **The shell S12 and S13 share** — design `README.md` §5l I1, I2, I7, and
 * `docs/specs/2026-09-08-trip-notes.md` §1.
 *
 * Two properties are worth a test, and they are the two that would let the
 * parallel build go wrong silently. **I2** — a missing panel draws nothing,
 * no band and no gap — is what makes either landing order correct, and until
 * a panel exists this component's whole behaviour *is* I2. **I7's container**
 * is the second: `Trip`'s `.screen` declares none, so a row that queried its
 * caller's would be laying itself out against the viewport-sized shell pane,
 * and the symptom is two panels going 2-up on a phone.
 *
 * The layout half is asserted against the stylesheet text rather than the
 * DOM, for `drawnSizes.test.ts`'s reason: `app/vitest.config.ts` sets no
 * `css` option, so CSS modules are not processed, `toHaveStyle` passes
 * unconditionally, and jsdom computes no layout to measure. Reading the file
 * is the one technique that sees a CSS regression here.
 */
function moduleCss(name: string): string {
  const here = dirname(expect.getState().testPath ?? '')
  return readFileSync(join(here, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('TripPanels — ruling I2, a missing panel draws nothing', () => {
  it('renders nothing at all with no children', () => {
    const { container } = render(<TripPanels />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when every child is withheld', () => {
    // The call site's ordinary shape once a panel exists: `{show && <Panel/>}`.
    // `Children.toArray` drops `false`, so the row collapses rather than
    // drawing an empty bordered card — I2, and the reason the guard counts
    // children instead of asking whether `children` is `undefined`.
    const show = false

    const { container } = render(
      <TripPanels>
        {show && <p>TASKS</p>}
        {show && <p>NOTES</p>}
      </TripPanels>,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('draws one panel in the same slot the pair would take', () => {
    render(
      <TripPanels>
        <p>NOTES</p>
      </TripPanels>,
    )

    expect(screen.getByText('NOTES')).toBeInTheDocument()
  })

  it('keeps TASKS before NOTES in the document', () => {
    // I1's order is the caller's to pass and this component's to preserve —
    // it never sorts. The assertion is document order, which is also the tab
    // order and what a screen reader announces.
    render(
      <TripPanels>
        <p>TASKS</p>
        <p>NOTES</p>
      </TripPanels>,
    )

    const [first, second] = screen.getAllByText(/TASKS|NOTES/)

    expect(first).toHaveTextContent('TASKS')
    expect(second).toHaveTextContent('NOTES')
  })
})

describe('TripPanels — ruling I7, the row carries its own container', () => {
  const css = moduleCss('TripPanels.module.css')

  it('declares the query container on the wrapper, not on the row', () => {
    // An element is never its own container: a `@container` rule matching
    // `.row` from inside `.row` would resolve against whatever ancestor does
    // declare one — at Split and Desktop, the full-width shell pane.
    expect(/\.panels\s*\{[^}]*container-type:\s*inline-size/.test(css)).toBe(
      true,
    )
    expect(/\.row\s*\{[^}]*container-type/.test(css)).toBe(false)
  })

  it('takes one column as the base and two only inside the query', () => {
    // Fail-open (`frontend-design.md` §3.2): with no container-query support
    // both panels render full width, which is the phone drawing.
    expect(/\.row\s*\{[^}]*grid-template-columns:\s*1fr;/.test(css)).toBe(true)
    expect(css).toMatch(/@container \(min-width: 40rem\)/)
    expect(css.indexOf('1fr 1fr')).toBeGreaterThan(
      css.indexOf('@container (min-width: 40rem)'),
    )
  })

  it('caps a lone panel rather than stretching it', () => {
    expect(css).toMatch(/\.row:has\(> :only-child\)/)
    expect(css).toMatch(/minmax\(0, 35rem\)/)
  })

  it('states the card treatment once, on the row', () => {
    // S12 and S13 would otherwise each spell the same border, and drift.
    expect(/\.row > \*\s*\{[^}]*border:/.test(css)).toBe(true)
  })
})

/**
 * The panel boundary — the innermost of the app's three
 * (`frontend-design.md` §5). A panel is this component's own unit, so this
 * is where the app says what an *independent* panel is: `NOTES` crashing
 * leaves `TASKS`, and the trip screen around them, standing.
 */
describe('a crashed panel', () => {
  function Boom(): React.ReactNode {
    throw new Error('note.text was undefined')
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('leaves its sibling and the row standing', () => {
    render(
      <TripPanels>
        <p>tasks</p>
        <Boom />
      </TripPanels>,
    )

    expect(screen.getByText('tasks')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it("opts the fallback out of the row's own card, rather than doubling it", () => {
    // The fallback arrives already bordered (`ui/ErrorBoundary`), and the
    // row's `> *` gives every child a card at Roomy and up. Two borders
    // 16px apart is a treatment no board draws, and jsdom computes no
    // layout — so this reads the stylesheet, as the layout half above does.
    const css = moduleCss('TripPanels.module.css')

    expect(css).toMatch(/\.row > \[data-error-boundary\] \{[^}]*border: none/)
  })

  it('adds no element while nothing throws, so I7 and I2 are untouched', () => {
    const { container } = render(
      <TripPanels>
        <p>tasks</p>
        <p>notes</p>
      </TripPanels>,
    )

    // A boundary renders its children with no wrapper of its own, which is
    // what keeps `.row`'s `1fr 1fr` and its `:only-child` cap reading the
    // panels themselves.
    const row = container.firstElementChild?.firstElementChild
    const panels = Array.from(row?.children ?? [])
    expect(panels.map((panel) => panel.tagName)).toEqual(['P', 'P'])
  })
})
