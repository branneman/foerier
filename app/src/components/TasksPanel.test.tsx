import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { TaskView } from '@foerier/shared'

import { TasksPanel } from './TasksPanel'

const THREE: readonly TaskView[] = [
  { id: 'k1', text: 'Charge the devices', ticked: true },
  { id: 'k2', text: 'Check tire pressure', ticked: false },
  { id: 'k3', text: 'Buy the vignette', ticked: false },
]

function panel(
  props: Partial<React.ComponentProps<typeof TasksPanel>> = {},
): React.ComponentProps<typeof TasksPanel> {
  return {
    tasks: THREE,
    counts: { total: 3, ticked: 1 },
    onAdd: vi.fn(),
    onToggle: vi.fn(),
    ...props,
  }
}

function moduleCss(): string {
  const here = dirname(expect.getState().testPath ?? '')
  return readFileSync(join(here, 'TasksPanel.module.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
}

function ruleBody(css: string, selector: string): string | undefined {
  const escaped = selector.replace(/[.[\]:]/g, '\\$&')
  return new RegExp(`(?:^|[\\s{}])${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
}

const COMPOSER = /^\+ TASK — NOT GEAR/

describe('the band', () => {
  it('reads the label and the fraction', () => {
    render(<TasksPanel {...panel()} />)
    expect(screen.getByText('TASKS')).toBeInTheDocument()
    expect(screen.getByText('1/3 TICKED')).toBeInTheDocument()
  })

  // I3: a fraction is not a zero segment, so ruling G3 does not reach it.
  it('draws 0/3 rather than dropping the segment', () => {
    render(<TasksPanel {...panel({ counts: { total: 3, ticked: 0 } })} />)
    expect(screen.getByText('0/3 TICKED')).toBeInTheDocument()
  })

  it('draws the whole fraction at 3/3', () => {
    render(<TasksPanel {...panel({ counts: { total: 3, ticked: 3 } })} />)
    expect(screen.getByText('3/3 TICKED')).toBeInTheDocument()
  })

  // I3 again: absent at N = 0, which is what makes the empty panel I27's
  // band-and-composer and nothing else.
  it('drops the fraction entirely when the Trip has no tasks', () => {
    render(
      <TasksPanel {...panel({ tasks: [], counts: { total: 0, ticked: 0 } })} />,
    )
    expect(screen.getByText('TASKS')).toBeInTheDocument()
    expect(screen.queryByText(/TICKED/)).not.toBeInTheDocument()
  })

  // No trailing link: the composer is the end-of-list row, so there is
  // nothing for one to lead to, and a slot with nothing in it draws nothing
  // rather than a disabled affordance (patterns §3.7).
  it('carries no trailing link', () => {
    render(<TasksPanel {...panel()} />)
    expect(screen.queryByText('+ TASK ›')).not.toBeInTheDocument()
    expect(screen.queryByText(/›/)).not.toBeInTheDocument()
  })
})

describe('the rows', () => {
  it('draws one row per task, in the order given', () => {
    render(<TasksPanel {...panel()} />)
    const rows = screen.getAllByRole('button', { name: /ticked$/ })
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Charge the devices'),
      expect.stringContaining('Check tire pressure'),
      expect.stringContaining('Buy the vignette'),
    ])
  })

  // The board's own strings. A plain button, deliberately not
  // `role="checkbox"` — a checkbox carries `aria-checked`, and a name that
  // also states the value would announce the state twice.
  it('states the value in the accessible name, both ways', () => {
    render(<TasksPanel {...panel()} />)
    expect(
      screen.getByRole('button', { name: 'Charge the devices, ticked' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Check tire pressure, not ticked' }),
    ).toBeInTheDocument()
  })

  it('is not a checkbox, so the state is announced once', () => {
    render(<TasksPanel {...panel()} />)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  // I22: the whole row is the target and the square is a readout, never a
  // second one.
  it('offers exactly one target per row', () => {
    render(<TasksPanel {...panel()} />)
    const row = screen.getByRole('button', {
      name: 'Charge the devices, ticked',
    })
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
  })

  it('flips an unticked task on tap', async () => {
    const onToggle = vi.fn()
    render(<TasksPanel {...panel({ onToggle })} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Check tire pressure, not ticked' }),
    )
    expect(onToggle).toHaveBeenCalledWith('k2', true)
  })

  it('flips a ticked task back on tap — one op, both directions', async () => {
    const onToggle = vi.fn()
    render(<TasksPanel {...panel({ onToggle })} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Charge the devices, ticked' }),
    )
    expect(onToggle).toHaveBeenCalledWith('k1', false)
  })
})

describe('the composer', () => {
  it('rests as the dashed row, naming the verb and the permanent fact', () => {
    render(<TasksPanel {...panel()} />)
    expect(screen.getByRole('button', { name: COMPOSER })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('opens a well on tap, with the hint and no placeholder', async () => {
    render(<TasksPanel {...panel()} />)
    await userEvent.click(screen.getByRole('button', { name: COMPOSER }))

    const well = screen.getByRole('textbox')
    expect(well).toHaveFocus()
    expect(well).not.toHaveAttribute('placeholder')
    expect(
      screen.getByText('RETURN ADDS AND KEEPS TYPING · EMPTY ADDS NOTHING'),
    ).toBeInTheDocument()
  })

  it('commits on Return and keeps the well open and focused', async () => {
    const onAdd = vi.fn()
    render(<TasksPanel {...panel({ onAdd })} />)
    await userEvent.click(screen.getByRole('button', { name: COMPOSER }))
    await userEvent.type(
      screen.getByRole('textbox'),
      'Renew the DAV card{Enter}',
    )

    expect(onAdd).toHaveBeenCalledWith('Renew the DAV card')
    const well = screen.getByRole('textbox')
    expect(well).toHaveFocus()
    expect(well).toHaveValue('')
  })

  it('commits a second line without leaving the well — the batch loop', async () => {
    const onAdd = vi.fn()
    render(<TasksPanel {...panel({ onAdd })} />)
    await userEvent.click(screen.getByRole('button', { name: COMPOSER }))
    await userEvent.type(screen.getByRole('textbox'), 'One{Enter}Two{Enter}')

    expect(onAdd.mock.calls).toEqual([['One'], ['Two']])
  })

  it('commits on blur when the well holds text', async () => {
    const onAdd = vi.fn()
    render(<TasksPanel {...panel({ onAdd })} />)
    await userEvent.click(screen.getByRole('button', { name: COMPOSER }))
    await userEvent.type(screen.getByRole('textbox'), 'Empty the fridge')
    await userEvent.tab()

    expect(onAdd).toHaveBeenCalledWith('Empty the fridge')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('commits nothing on an empty Return and keeps typing', async () => {
    const onAdd = vi.fn()
    render(<TasksPanel {...panel({ onAdd })} />)
    await userEvent.click(screen.getByRole('button', { name: COMPOSER }))
    await userEvent.type(screen.getByRole('textbox'), '{Enter}')

    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('commits nothing on an empty blur and the dashed row returns', async () => {
    const onAdd = vi.fn()
    render(<TasksPanel {...panel({ onAdd })} />)
    await userEvent.click(screen.getByRole('button', { name: COMPOSER }))
    await userEvent.tab()

    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: COMPOSER })).toBeInTheDocument()
  })

  // Whitespace is empty — S12's `Post note` gate, and the trimmed string is
  // what the payload carries.
  it('treats a whitespace-only well as empty, and trims what it commits', async () => {
    const onAdd = vi.fn()
    render(<TasksPanel {...panel({ onAdd })} />)
    await userEvent.click(screen.getByRole('button', { name: COMPOSER }))
    await userEvent.type(screen.getByRole('textbox'), '   {Enter}')
    expect(onAdd).not.toHaveBeenCalled()

    await userEvent.type(screen.getByRole('textbox'), '  Buy salt  {Enter}')
    expect(onAdd).toHaveBeenCalledWith('Buy salt')
  })

  // Code-authored (spec §4): §5b K rules Escape as *restore the committed
  // value*, and a composer has no committed value, so it discards.
  it('discards the draft on Escape and returns to the dashed row', async () => {
    const onAdd = vi.fn()
    render(<TasksPanel {...panel({ onAdd })} />)
    await userEvent.click(screen.getByRole('button', { name: COMPOSER }))
    await userEvent.type(screen.getByRole('textbox'), 'Never mind{Escape}')

    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: COMPOSER })).toBeInTheDocument()
  })
})

describe('empty', () => {
  // I27: the composer on screen IS the empty state, which is where this
  // panel departs from `0 NOTES.` and `0 ENTRIES.` — both of those have
  // their composer elsewhere and need a line to stand in for it.
  it('is the band and the composer, and never writes `0 TASKS.`', () => {
    render(
      <TasksPanel {...panel({ tasks: [], counts: { total: 0, ticked: 0 } })} />,
    )
    expect(screen.getByText('TASKS')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: COMPOSER })).toBeInTheDocument()
    expect(screen.queryByText(/0 TASKS/)).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /ticked$/ })).toHaveLength(0)
  })
})

describe('the drawn sizes', () => {
  /**
   * Ruling I22: rows are ≥48 and so need no hit extension. jsdom computes no
   * layout and `app/vitest.config.ts` processes no CSS, so reading the
   * stylesheet text is the only technique that sees this at all —
   * `EntryRow.test.tsx` and `drawnSizes.test.ts`' own.
   */
  it('draws the row and the composer at the 48px target size', () => {
    const css = moduleCss()
    for (const selector of ['.row', '.composer', '.well']) {
      expect(ruleBody(css, selector)).toMatch(/min-height:\s*3rem/)
    }
  })

  it('gives the row no hit extension, because it needs none', () => {
    expect(ruleBody(moduleCss(), '.row::after')).toBeUndefined()
  })

  // I23: shape and fill carry the state, never colour — so the parchment
  // theme has nothing to collapse (S5's trap).
  it('paints the square with no status colour', () => {
    const css = moduleCss()
    expect(css).not.toMatch(/--color-status-/)
    expect(ruleBody(css, '.square')).toMatch(/border-radius:\s*3px/)
  })
})
