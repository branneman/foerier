import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { GearRow } from './GearRow'

/**
 * Components §03's variant map, which is the canonical one: **one component,
 * three renders**. `2-LINE` and `1-LINE` are the same DOM folding by
 * `@container`; `TABLE-44` is the desktop table's 8-column row.
 *
 * jsdom applies no container queries and computes no layout, so what is
 * testable here is the **content contract** — which facts appear in which
 * render, and how the row is announced. The folding itself is CSS, and CSS is
 * not what a component test proves.
 */

const BAG = {
  name: 'Sleeping bag, winter',
  href: '/gear/g-bag',
  whereabouts: '⌂ HOME',
} as const

describe('GearRow', () => {
  it('is announced by its name alone', () => {
    render(<GearRow {...BAG} path="ATTIC ▸ CRATE B" qty="×2" />)
    // The row *is* the gear; the path and whereabouts are content it
    // describes, reached through `aria-describedby` rather than folded into
    // a name nobody would say out loud.
    expect(
      screen.getByRole('link', { name: 'Sleeping bag, winter' }),
    ).toBeInTheDocument()
  })

  it('describes itself with the meta line and the whereabouts', () => {
    render(<GearRow {...BAG} path="ATTIC ▸ CRATE B" qty="×2" />)
    const link = screen.getByRole('link', { name: 'Sleeping bag, winter' })
    const described = (link.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)

    expect(described).toContain('ATTIC ▸ CRATE B · ×2')
    expect(described).toContain('⌂ HOME')
  })

  it('composes the meta line from owner, path and qty, skipping what is absent', () => {
    const { rerender } = render(
      <GearRow {...BAG} owner="PERSONAL E" path="SLAAPKAMER ▸ KAST" />,
    )
    expect(screen.getByTestId('gear-row-meta')).toHaveTextContent(
      'PERSONAL E · SLAAPKAMER ▸ KAST',
    )

    rerender(<GearRow {...BAG} qty="×2" />)
    expect(screen.getByTestId('gear-row-meta')).toHaveTextContent('×2')
  })

  it('renders no meta element at all when there is nothing to say', () => {
    render(<GearRow {...BAG} />)
    expect(screen.queryByTestId('gear-row-meta')).toBeNull()
  })

  /**
   * Containment shows as the name's `N INSIDE` suffix and a chevron — **never
   * as a fake Kind** (Components §03). `KIND` in UI always means the glossary
   * Kind; `ITEM`/`CONTAINER` are meta-line words only.
   */
  it('shows containment as a suffix on the name, not as a kind', () => {
    render(
      <GearRow
        name="Crate B"
        href="/gear/g"
        whereabouts="⌂ HOME"
        insideCount={5}
      />,
    )
    expect(screen.getByTestId('gear-row-inside')).toHaveTextContent('5 INSIDE')
    expect(screen.getByTestId('gear-row-chevron')).toBeInTheDocument()
  })

  it('shows no chevron on gear that holds nothing', () => {
    render(<GearRow {...BAG} />)
    expect(screen.queryByTestId('gear-row-chevron')).toBeNull()
  })

  /**
   * "Rows never show tags — a tag filter changes which rows appear, not the
   * rows" (`docs/design/README.md` §3). Tags live in the table's own column
   * and on gear detail, nowhere else.
   */
  it('never shows tags in the folding row, however many it is given', () => {
    render(<GearRow {...BAG} tags={['winter', 'sleep']} />)
    expect(screen.queryByTestId('gear-row-tags')).toBeNull()
    // `#sleep` and not `sleep`: the gear's own name carries "winter", so a
    // bare word would match the name and pass for the wrong reason.
    expect(screen.queryByText(/#sleep/)).toBeNull()
  })

  it('shows tags as plain text in the table row', () => {
    render(<GearRow {...BAG} layout="table" tags={['winter', 'sleep']} />)
    expect(screen.getByTestId('gear-row-tags')).toHaveTextContent(
      '#winter #sleep',
    )
  })

  it('gives the table row a cell per column', () => {
    render(
      <GearRow
        {...BAG}
        layout="table"
        kind="Counted"
        owner="SHARED"
        path="ATTIC ▸ CRATE B"
        tags={['winter']}
        qty="×2"
      />,
    )
    expect(screen.getByTestId('gear-row-kind')).toHaveTextContent('Counted')
    expect(screen.getByTestId('gear-row-owner')).toHaveTextContent('SHARED')
    expect(screen.getByTestId('gear-row-home')).toHaveTextContent(
      'ATTIC ▸ CRATE B',
    )
    expect(screen.getByTestId('gear-row-qty')).toHaveTextContent('×2')
    // The folding row has no separate KIND cell — it folds into the meta
    // line, or does not appear at all.
    expect(screen.queryByTestId('gear-row-meta')).toBeNull()
  })

  // `QTY = ×N for counted only — singles read —` (Components §03).
  it('reads a dash in the table QTY cell when there is no count', () => {
    render(<GearRow {...BAG} layout="table" />)
    expect(screen.getByTestId('gear-row-qty')).toHaveTextContent('—')
  })

  it('strikes through a retired name', () => {
    render(<GearRow {...BAG} retired whereabouts="RETIRED" />)
    expect(
      screen.getByTestId('gear-row-name').querySelector('s'),
    ).not.toBeNull()
  })

  /**
   * Find's plain match is the same row with the meta slot swapped to the `⌂`
   * path — "answer-first is a meta-slot choice, not a new component"
   * (Components §03). Proving it here is what keeps `Find` from growing a
   * second copy of this row, which is the duplication S3 exists to remove.
   */
  it('serves Find by taking the path in the meta slot', () => {
    render(<GearRow {...BAG} path="⌂ ATTIC ▸ CRATE B" />)
    expect(screen.getByTestId('gear-row-meta')).toHaveTextContent(
      '⌂ ATTIC ▸ CRATE B',
    )
  })

  it('forwards the click to whatever wraps it', async () => {
    const onClick = vi.fn((event: React.MouseEvent) => event.preventDefault())
    render(<GearRow {...BAG} onClick={onClick} />)

    await userEvent.click(screen.getByRole('link'))

    // `ui/` never imports a router; the app wraps this in wouter's `Link`,
    // which needs the anchor's own href and click to reach it.
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/gear/g-bag')
  })
})
