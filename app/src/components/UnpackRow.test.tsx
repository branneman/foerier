import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { UnpackRow } from './UnpackRow'

/**
 * **F5's row** (`docs/design/README.md` §7, ruling F6) — the four pills, the
 * trip-only slot's "no button at all", and the glued-spelling trap
 * `patterns.md` §6.6 names for a name-plus-badge pair.
 */

const ENTRY = 'nnnnnnnn-0000-7000-8000-00000000000a'

describe('UnpackRow — the pill (F6: the meta is where it goes, the pill is what happened)', () => {
  it.each([
    ['back', '●', 'BACK', 'packed'],
    [null, '○', 'OPEN', 'not-packed'],
    ['consumed', '', 'CONSUMED', 'dashed'],
    ['lost', '▲', 'LOST', 'attention'],
  ] as const)('draws %s as %s %s, toned %s', (outcome, glyph, label, tone) => {
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Sleeping bag, winter"
        meta="→ SHELF L-TOP ▸ CRATE B · ×2"
        outcome={outcome}
        onOutcome={vi.fn()}
        onReHome={vi.fn()}
      />,
    )

    const pill = screen.getByRole('button', {
      name: `${glyph} ${label}`.trim(),
    })
    expect(pill).toHaveAttribute('data-tone', tone)
  })

  it('one ▲ per row, on LOST alone', () => {
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Headlamp"
        meta="→ BAK 3"
        outcome="back"
        onOutcome={vi.fn()}
        onReHome={vi.fn()}
      />,
    )

    expect(screen.queryByText('▲', { exact: false })).not.toBeInTheDocument()
  })

  it('opens the outcome sheet on a pill tap', async () => {
    const user = userEvent.setup()
    const onOutcome = vi.fn()
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Cook set"
        meta="→ BAK 3"
        outcome={null}
        onOutcome={onOutcome}
        onReHome={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '○ OPEN' }))

    expect(onOutcome).toHaveBeenCalledOnce()
  })
})

describe('UnpackRow — the row body (tap row = re-home)', () => {
  it('draws the name and the meta', () => {
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Duffel 90 L"
        meta="→ SHELF L-TOP · 12 INSIDE"
        outcome="back"
        onOutcome={vi.fn()}
        onReHome={vi.fn()}
      />,
    )

    expect(screen.getByTestId('unpack-row-name')).toHaveTextContent(
      'Duffel 90 L',
    )
    expect(screen.getByTestId('unpack-row-meta')).toHaveTextContent(
      '→ SHELF L-TOP · 12 INSIDE',
    )
  })

  it('draws no meta line at all when meta is empty', () => {
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Trekking poles"
        meta=""
        outcome={null}
        onOutcome={vi.fn()}
        onReHome={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('unpack-row-meta')).not.toBeInTheDocument()
  })

  it('opens the Home picker on a body tap', async () => {
    const user = userEvent.setup()
    const onReHome = vi.fn()
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Tarp 3×4"
        meta="→ CRATE A"
        outcome="back"
        onOutcome={vi.fn()}
        onReHome={onReHome}
      />,
    )

    await user.click(screen.getByTestId('unpack-row-body'))

    expect(onReHome).toHaveBeenCalledOnce()
  })
})

describe('UnpackRow — a trip-only row (no button at all)', () => {
  it('draws no button anywhere in the row', () => {
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Passports, all"
        meta="NOT IN DEPOT"
        outcome={null}
        onOutcome={vi.fn()}
        onReHome={vi.fn()}
        tripOnly
      />,
    )

    const row = screen.getByTestId(`unpack-row-${ENTRY}`)
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it('draws the right slot as faint mono CLEARS AT CLOSE, not a pill', () => {
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Passports, all"
        meta="NOT IN DEPOT"
        outcome={null}
        onOutcome={vi.fn()}
        onReHome={vi.fn()}
        tripOnly
      />,
    )

    expect(screen.getByTestId('unpack-row-clears')).toHaveTextContent(
      'CLEARS AT CLOSE',
    )
  })

  it('draws NOT IN DEPOT as the meta', () => {
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Passports, all"
        meta="NOT IN DEPOT"
        outcome={null}
        onOutcome={vi.fn()}
        onReHome={vi.fn()}
        tripOnly
      />,
    )

    expect(screen.getByTestId('unpack-row-meta')).toHaveTextContent(
      'NOT IN DEPOT',
    )
  })

  /**
   * `patterns.md` §6.6: a flex `gap` separates the name and the badge on
   * screen but is not a character in the DOM's text — `getByText` on the
   * badge alone cannot see a missing space, so this reads the row's own
   * **parent** text content, which is exactly what an enclosing accessible
   * name would glue.
   */
  it('keeps a real space between the name and the TRIP-ONLY badge', () => {
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Passports, all"
        meta="NOT IN DEPOT"
        outcome={null}
        onOutcome={vi.fn()}
        onReHome={vi.fn()}
        tripOnly
      />,
    )

    const badge = screen.getByTestId('unpack-row-badge')
    expect(badge.parentElement).toHaveTextContent('Passports, all TRIP-ONLY')
  })
})

/**
 * **Task 13's 34px cluster** (`docs/design/README.md` §7, ruling F7) — one
 * control replacing the pill for a per-person, non-container Entry. The
 * cluster and its resolved-over-Pieces count are **one control with one
 * accessible name** (`patterns.md` §5.4), never a per-circle target.
 */
describe('UnpackRow — the cluster (F7)', () => {
  const CLUSTER = {
    people: [
      { key: 'mark', label: 'M', tone: 'filled' as const },
      { key: 'els', label: 'E', tone: 'filled' as const },
      { key: 'kees', label: 'K', tone: 'attention' as const },
    ],
    resolved: 2,
    total: 3,
  }

  it('draws the cluster instead of the pill, with the resolved-over-Pieces count in its one accessible name', () => {
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Headlamp"
        meta="→ LADE 2 · PER-PERSON · 2/3"
        outcome={null}
        onOutcome={vi.fn()}
        onReHome={vi.fn()}
        cluster={CLUSTER}
      />,
    )

    expect(
      screen.getByRole('button', {
        name: 'Outcome — Headlamp, 2 of 3 resolved',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('status-pill')).not.toBeInTheDocument()
    // Circles are never individual targets — one button, not three.
    expect(screen.queryAllByRole('button')).toHaveLength(2) // body + cluster
  })

  it('opens the sheet on a cluster tap, the pill’s own target', async () => {
    const user = userEvent.setup()
    const onOutcome = vi.fn()
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Headlamp"
        meta="→ LADE 2 · PER-PERSON · 2/3"
        outcome={null}
        onOutcome={onOutcome}
        onReHome={vi.fn()}
        cluster={CLUSTER}
      />,
    )

    await user.click(
      screen.getByRole('button', {
        name: 'Outcome — Headlamp, 2 of 3 resolved',
      }),
    )

    expect(onOutcome).toHaveBeenCalledOnce()
  })

  it('paints each circle the tone it was handed, filled and attention alike', () => {
    render(
      <UnpackRow
        entryId={ENTRY}
        name="Headlamp"
        meta="→ LADE 2 · PER-PERSON · 2/3"
        outcome={null}
        onOutcome={vi.fn()}
        onReHome={vi.fn()}
        cluster={CLUSTER}
      />,
    )

    const circles = screen.getAllByTestId('person-circle')
    expect(circles.map((circle) => circle.getAttribute('data-tone'))).toEqual([
      'filled',
      'filled',
      'attention',
    ])
  })
})
