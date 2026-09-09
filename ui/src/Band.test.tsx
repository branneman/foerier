import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Band } from './Band'

/**
 * The section band, extracted from its three copies — `Trip`'s `GEAR LIST`
 * (S7), `NotesPanel`'s and `TasksPanel`'s (S12 and S13, in parallel
 * worktrees). What is asserted here is the **anatomy**; what each band says
 * stays in its caller's own suite.
 */

function css(): string {
  return readFileSync(
    join(dirname(expect.getState().testPath ?? ''), 'Band.module.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]:]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css())?.[1] ?? ''
}

describe('Band', () => {
  it('draws the label as written', () => {
    render(<Band label="GEAR LIST" />)

    expect(screen.getByText('GEAR LIST')).toBeInTheDocument()
  })

  it('names the label only where a caller asks, for its own aria-labelledby', () => {
    const { rerender } = render(<Band label="TASKS" />)
    expect(screen.getByText('TASKS')).not.toHaveAttribute('id')

    rerender(<Band label="TASKS" labelId="tasks-band" />)
    expect(screen.getByText('TASKS')).toHaveAttribute('id', 'tasks-band')
  })

  it('draws no trailing slot at all when a band has nothing to put in it', () => {
    // `TasksPanel` at zero tasks is exactly this: ruling I3 withholds the
    // count, and an empty wrapper would leave the band's `space-between`
    // holding a box with no content.
    const { container } = render(<Band label="TASKS" />)

    expect(container.querySelector('div')?.children).toHaveLength(1)
  })

  it('puts the whole trailing group in one flex item', () => {
    // One item however many children, which is what `space-between` needs to
    // keep them glued to the trailing edge rather than spread apart.
    const { container } = render(
      <Band
        label="GEAR LIST"
        trailing={
          <>
            <span>12 ENTRIES</span>
            <a href="/x">PACKING ›</a>
          </>
        }
      />,
    )

    const band = container.querySelector('div')
    expect(band?.children).toHaveLength(2)
    expect(band?.children[1]?.children).toHaveLength(2)
  })

  /**
   * Review I1, now pinned once for three callers. The band is a non-wrapping
   * flex row of exactly two children, and neither the trailing slot's own
   * `flex-wrap` nor its `justify-content` stops a width deficit from
   * shrinking the **label** too — unless the label refuses to shrink at all.
   * Without these two declarations a narrow band wraps `GEAR LIST` into
   * `GEAR` / `LIST` before the trailing slot, which is built to absorb the
   * whole deficit, wraps at all. No board draws that, and jsdom computes no
   * layout, so it is pinned as stylesheet text.
   */
  it('pins the label so a width deficit lands on the trailing slot', () => {
    expect(rule('.label')).toMatch(/flex:\s*none/)
    expect(rule('.label')).toMatch(/white-space:\s*nowrap/)
  })

  it('reflows the trailing slot organically, right-aligned', () => {
    // Organic reflow rather than a breakpoint of its own: the box shrinks to
    // what is left after the label, and wraps when its children no longer
    // fit. `flex-end` is what makes the wrapped line read as the board's
    // "second, right-aligned line" instead of drifting left under the count.
    expect(rule('.trailing')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule('.trailing')).toMatch(/justify-content:\s*flex-end/)
    expect(rule('.trailing')).toMatch(/gap:\s*var\(--space-12\)/)
  })

  it('keeps the label and the trailing slot on one baseline, under one rule', () => {
    expect(rule('.band')).toMatch(/align-items:\s*baseline/)
    expect(rule('.band')).toMatch(/justify-content:\s*space-between/)
    expect(rule('.band')).toMatch(/border-bottom:/)
  })
})
