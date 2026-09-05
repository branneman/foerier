import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SegmentedControl } from './SegmentedControl'

/**
 * One control, two sizes — `Stepper`'s own shape, and for the same reason:
 * three screens had hand-rolled this box (`AddGear`, `GearDetail`,
 * `Packing`) and the three copies had already drifted in ways only one of
 * them was right about. The assertions below are written against the two
 * that mattered: `GearDetail`'s copy drew **no focus ring at all**, and its
 * `overflow: hidden` container meant it could never grow a hit extension —
 * a clipped descendant is not hit-testable.
 *
 * The paint is asserted from the **stylesheet text**, `Stepper.test.tsx`'s
 * and `drawnSizes.test.ts`'s technique, which is the only one that sees CSS
 * at all in a Vitest run.
 */

function css(): string {
  return readFileSync(
    join(
      dirname(expect.getState().testPath ?? ''),
      'SegmentedControl.module.css',
    ),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The `{ … }` body of the rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string | undefined {
  const escaped = selector.replace(/[.[\]:='+>~() -]/g, '\\$&')
  return new RegExp(`(?:^|[\\s{}])${escaped}\\s*\\{([^}]*)\\}`).exec(css())?.[1]
}

const MODES = [
  { value: 'container', label: 'CONTAINER' },
  { value: 'person', label: 'PERSON' },
  { value: 'all', label: 'ALL' },
] as const

describe('SegmentedControl', () => {
  it('renders one radio per option, with the current one checked', () => {
    render(
      <SegmentedControl
        name="packing-mode"
        options={MODES}
        value="person"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'PERSON' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'ALL' })).not.toBeChecked()
  })

  it("hands the caller the option's own value, not an index", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SegmentedControl
        name="packing-mode"
        options={MODES}
        value="container"
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('radio', { name: 'ALL' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('all')
  })

  it('groups its radios under one name, so two controls on a page stay apart', () => {
    render(
      <SegmentedControl
        name="packing-mode"
        options={MODES}
        value="all"
        onChange={vi.fn()}
      />,
    )

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('name', 'packing-mode')
    }
  })

  /**
   * **`undefined` means nothing is selected, and it is a real state.** Gear
   * detail's edit sheet draws no Kind at all for a Gear carrying no `kind`
   * register — the sheet may not assert a Kind nobody stated
   * (`docs/design/README.md` §4) — so the primitive has to be able to draw a
   * control with every segment unchecked rather than force a caller to
   * invent one.
   */
  it('checks nothing when the value matches no option', () => {
    render(
      <SegmentedControl
        name="kind"
        options={MODES}
        value={undefined}
        onChange={vi.fn()}
      />,
    )

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked()
    }
  })

  /**
   * The radio carries the state and stays in the accessibility tree; it is
   * simply not painted. A `display: none` here would take the control out of
   * the tab order and out of the tree with it.
   */
  it('hides the radio visually without removing it from the tree', () => {
    expect(ruleBody('.segment input')).toMatch(/opacity:\s*0/)
    expect(ruleBody('.segment input')).not.toMatch(/display:\s*none/)
    expect(ruleBody('.segment input')).not.toMatch(/visibility:\s*hidden/)
  })

  /**
   * **The defect this primitive closes.** `GearDetail`'s hand-rolled copy had
   * `:has(input:checked)` and no `:has(input:focus-visible)` — a keyboard
   * user moving through its Kind selector saw nothing at all. One ring, on
   * the one control, at both sizes.
   */
  it('draws a focus ring, which one of the three copies did not', () => {
    expect(ruleBody('.segment:has(input:focus-visible)')).toMatch(
      /box-shadow:\s*var\(--focus-ring\)/,
    )
  })

  /**
   * **A clipped descendant is not hit-testable**, so an `overflow: hidden`
   * container would make the dense size's extension dead on arrival — and
   * `drawnSizes`-style parsing would find the `::after` and pass over a hit
   * area that does not exist. Two of the three copies clipped. The end
   * segments round themselves instead.
   */
  it('clips nothing, and rounds its end segments instead', () => {
    expect(ruleBody('.segmented')).not.toMatch(/overflow:\s*hidden/)
    expect(ruleBody('.segment:first-child')).toMatch(
      /border-start-start-radius/,
    )
    expect(ruleBody('.segment:last-child')).toMatch(/border-end-end-radius/)
  })

  /** Ruling O: a standalone control is simply drawn ≥48, with no extension. */
  it('paints the default size at 48', () => {
    expect(ruleBody('.segment')).toMatch(/min-height:\s*max\(3rem,\s*48px\)/)
  })

  /**
   * Ruling O's other arm: 40 painted, 4 above and below, **inset 0
   * horizontally** — three segments share a row edge to edge, so a
   * horizontal grow would land a tap meant for one on its neighbour.
   */
  it('paints the dense size at 40 and clamps its extension vertically', () => {
    const dense = ruleBody(".segmented[data-size='dense'] .segment")
    expect(dense).toMatch(/min-height:\s*max\(2\.5rem,\s*40px\)/)
    expect(ruleBody('.segment::after')).toMatch(/inset:\s*-0\.25rem 0/)
    // Positioned against the segment itself, never the initial containing
    // block — which is also what keeps the 1px radio from escaping.
    expect(ruleBody('.segment')).toMatch(/position:\s*relative/)
  })
})
