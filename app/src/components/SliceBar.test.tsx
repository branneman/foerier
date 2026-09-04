import {
  EMPTY_SLICE,
  type DimensionValue,
  type SliceResult,
  type SliceSpec,
} from '@foerier/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { SliceBar } from './SliceBar'

/**
 * **Tier 3's named target for this slice: the filter cluster.**
 *
 * Components §04, "SLICE BAR (LIVE) · S3 SHIP STATE". The rules under test
 * are all settled there:
 *
 * - ghost add-chips are **dimension-only** (`+ TAG`); the value-carrying
 *   ghost (`+ TAG: #WINTER`) is retired;
 * - single-valued dimensions hide their ghost while active, TAG keeps its,
 *   because several tags AND together;
 * - **one count line** — `N OF M` covers search and filters together;
 * - `CLEAR (n)` is story 13's undo and stays visible while anything narrows.
 */

const VOCABULARY: Record<string, readonly DimensionValue[]> = {
  tag: [
    { value: 'winter', count: 23 },
    { value: 'sleep', count: 9 },
  ],
  kind: [
    { value: 'counted', count: 12 },
    { value: 'single', count: 5 },
  ],
  ownership: [
    { value: 'shared', count: 84 },
    { value: 'personal', count: 44 },
  ],
  person: [
    { value: 'els', count: 22 },
    { value: 'mark', count: 14 },
  ],
}

/**
 * The bound formatter the screen supplies. Person ids draw as names, which is
 * the whole reason `formatFor` is a prop rather than a call into the
 * dimension table: the label is not in the value.
 */
const NAMES: Record<string, string> = { els: 'Els', mark: 'Mark' }

const KINDS: Record<string, string> = {
  single: 'Single',
  per_person: 'Per-person',
  counted: 'Counted',
}

function formatValue(id: string, value: string): string {
  if (id === 'tag') return `#${value}`
  if (id === 'kind') return KINDS[value] ?? value
  if (id === 'person') return NAMES[value] ?? '—'
  if (id === 'ownership') return value === 'shared' ? 'Shared' : 'Personal'
  return value
}

function aResult(overrides: Partial<SliceResult> = {}): SliceResult {
  return { groups: [], shown: 9, total: 128, active: 0, ...overrides }
}

function renderBar(
  spec: Partial<SliceSpec> = {},
  result: Partial<SliceResult> = {},
) {
  const onChange = vi.fn()
  render(
    <SliceBar
      spec={{ ...EMPTY_SLICE, ...spec }}
      result={aResult(result)}
      valuesFor={(id) => VOCABULARY[id] ?? []}
      formatFor={formatValue}
      onChange={onChange}
    />,
  )
  return { onChange }
}

describe('SliceBar — the chips', () => {
  it('offers a dimension-only ghost per dimension when nothing is active', () => {
    renderBar()
    expect(screen.getByRole('button', { name: '+ TAG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ KIND' })).toBeInTheDocument()
    // S4's two rows, S7's one more, and the whole of what the bar needed to
    // learn to draw any of them: nothing. Ghosts come from `DIMENSIONS`.
    expect(
      screen.getByRole('button', { name: '+ OWNERSHIP' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ PERSON' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ TRIP' })).toBeInTheDocument()
    // The retired value-carrying ghost.
    expect(screen.queryByRole('button', { name: /\+ TAG: / })).toBeNull()
  })

  it('labels a selected PERSON chip with the name, never the id', () => {
    renderBar({ filters: { person: ['els'] } })
    expect(
      screen.getByRole('button', { name: 'PERSON: Els' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /PERSON: els/ })).toBeNull()
  })

  it('hides the OWNERSHIP ghost while it is active, and keeps TAG`s', () => {
    // Both fall out of `arity` alone — neither dimension is special-cased in
    // this component.
    renderBar({ filters: { ownership: ['shared'] } })
    expect(screen.queryByRole('button', { name: '+ OWNERSHIP' })).toBeNull()
    expect(screen.getByRole('button', { name: '+ TAG' })).toBeInTheDocument()
  })

  /**
   * The board draws `TAG: #WINTER`, and the chip renders `TAG: #winter` —
   * CAPS is a `text-transform` on the chip, not applied here, matching how
   * the rest of this codebase renders label text. The `#` is drawn and never
   * stored, so it comes from the dimension's `format`.
   */
  it('draws an active chip as dimension:value', () => {
    renderBar({ filters: { tag: ['winter'] } })
    expect(screen.getByText('TAG: #winter')).toBeInTheDocument()
  })

  it('draws a Kind chip with the glossary Kind, never the containment trait', () => {
    renderBar({ filters: { kind: ['per_person'] } })
    expect(screen.getByText('KIND: Per-person')).toBeInTheDocument()
  })

  it('keeps the TAG ghost while a tag is active, because tags AND', () => {
    renderBar({ filters: { tag: ['winter'] } })
    expect(screen.getByRole('button', { name: '+ TAG' })).toBeInTheDocument()
  })

  it('hides a single-valued dimension ghost while it is active', () => {
    renderBar({ filters: { kind: ['counted'] } })
    expect(screen.queryByRole('button', { name: '+ KIND' })).toBeNull()
    expect(screen.getByRole('button', { name: '+ TAG' })).toBeInTheDocument()
  })

  it('removes one value without disturbing the others', async () => {
    const { onChange } = renderBar({
      filters: { tag: ['winter', 'sleep'], kind: ['counted'] },
    })

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove TAG: #winter' }),
    )

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { tag: ['sleep'], kind: ['counted'] },
      }),
    )
  })

  it('opens a picker from the TAG ghost and applies what is chosen', async () => {
    const { onChange } = renderBar()

    await userEvent.click(screen.getByRole('button', { name: '+ TAG' }))
    await userEvent.click(screen.getByRole('button', { name: /#winter 23/ }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { tag: ['winter'] } }),
    )
  })

  it('replaces rather than adds when a single-valued dimension is picked', async () => {
    const { onChange } = renderBar({ filters: { kind: ['single'] } })

    await userEvent.click(screen.getByRole('button', { name: 'KIND: Single' }))
    await userEvent.click(screen.getByRole('button', { name: /Counted 12/ }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { kind: ['counted'] } }),
    )
  })
})

describe('SliceBar — the count line', () => {
  // One count line: `N OF M` covers filters and search together. The shipped
  // `4 MATCHES` search read becomes `4 OF 128` now that the bar has landed.
  it('reads N OF M, always both numbers', () => {
    renderBar({}, { shown: 9, total: 128 })
    expect(screen.getByTestId('count-line')).toHaveTextContent('9 OF 128')
  })

  it('offers CLEAR with a count while anything narrows', () => {
    renderBar({ filters: { tag: ['winter'] } }, { active: 1 })
    expect(
      screen.getByRole('button', { name: 'CLEAR (1)' }),
    ).toBeInTheDocument()
  })

  it('offers no CLEAR when nothing narrows', () => {
    renderBar({}, { active: 0 })
    expect(screen.queryByRole('button', { name: /CLEAR/ })).toBeNull()
  })

  /**
   * `CLEAR` returns the **filters and search** to nothing. It deliberately
   * leaves sort and group alone: those persist per device, and clearing a
   * narrowing is not a request to re-sort the list under the reader.
   */
  it('clears the filters and the search but not the sort or the group', async () => {
    const { onChange } = renderBar(
      {
        search: 'tent',
        filters: { tag: ['winter'] },
        sort: 'newest',
        group: 'kind',
      },
      { active: 2 },
    )

    await userEvent.click(screen.getByRole('button', { name: 'CLEAR (2)' }))

    expect(onChange).toHaveBeenCalledWith({
      search: '',
      filters: {},
      sort: 'newest',
      group: 'kind',
    })
  })
})

describe('SliceBar — the arrange readout', () => {
  it('reads the sort alone when nothing is grouped', () => {
    renderBar({ sort: 'name-asc', group: 'none' })
    expect(screen.getByTestId('arrange-readout')).toHaveTextContent('NAME A→Z')
  })

  it('reads group then sort when grouped', () => {
    renderBar({ sort: 'name-asc', group: 'kind' })
    expect(screen.getByTestId('arrange-readout')).toHaveTextContent(
      'KIND · NAME A→Z',
    )
  })

  it('reads OWNER for S4`s grouping, with no label of its own to keep', () => {
    // The readout takes the group's name from `shared/`'s grouping table, so
    // adding OWNER taught this component nothing.
    renderBar({ sort: 'name-asc', group: 'owner' })
    expect(screen.getByTestId('arrange-readout')).toHaveTextContent(
      'OWNER · NAME A→Z',
    )
  })

  it('opens the sort-and-group sheet', async () => {
    renderBar()
    await userEvent.click(screen.getByTestId('arrange-readout'))
    expect(
      screen.getByRole('dialog', { name: 'Sort and group' }),
    ).toBeInTheDocument()
  })

  // The sheet primitive: rows 40+, current marked `● NOW` — the SET PHASE
  // anatomy, reused so one control does not invent a second way to say
  // "this is the one you are on".
  it('marks the current sort and group with the SET PHASE anatomy', async () => {
    renderBar({ sort: 'newest', group: 'kind' })
    await userEvent.click(screen.getByTestId('arrange-readout'))

    // Scoped to each group: the readout itself reads `KIND · NEWEST FIRST`,
    // so an unscoped query matches the control that opened the sheet as well
    // as the row inside it.
    const sort = within(screen.getByTestId('sort-options'))
    const group = within(screen.getByTestId('group-options'))
    expect(
      sort.getByRole('button', { name: /NEWEST FIRST/ }),
    ).toHaveTextContent('● NOW')
    expect(group.getByRole('button', { name: /KIND/ })).toHaveTextContent(
      '● NOW',
    )
  })

  it('changes the sort from the sheet', async () => {
    const { onChange } = renderBar()
    await userEvent.click(screen.getByTestId('arrange-readout'))
    await userEvent.click(
      within(screen.getByTestId('sort-options')).getByRole('button', {
        name: /NEWEST FIRST/,
      }),
    )

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'newest' }),
    )
  })

  /**
   * `GROUP BY` never offers TAG — deliberate, and a domain fact: tags are
   * multi-valued, so a three-tag piece of gear would land in three groups and
   * the groups would not partition the list.
   */
  it('never offers grouping by tag', async () => {
    renderBar()
    await userEvent.click(screen.getByTestId('arrange-readout'))

    const group = screen.getByTestId('group-options')
    expect(group).toHaveTextContent('NONE')
    expect(group).toHaveTextContent('KIND')
    expect(group).toHaveTextContent('OWNER')
    expect(group).not.toHaveTextContent('TAG')
  })

  it('changes the group to owner from the sheet', async () => {
    const { onChange } = renderBar()
    await userEvent.click(screen.getByTestId('arrange-readout'))
    await userEvent.click(
      within(screen.getByTestId('group-options')).getByRole('button', {
        name: /OWNER/,
      }),
    )
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ group: 'owner' }),
    )
  })

  it('offers only the sort keys S3 carries', async () => {
    renderBar()
    await userEvent.click(screen.getByTestId('arrange-readout'))

    const sort = screen.getByTestId('sort-options')
    expect(sort).toHaveTextContent('NAME A→Z')
    expect(sort).toHaveTextContent('NAME Z→A')
    expect(sort).toHaveTextContent('NEWEST FIRST')
  })
})

/**
 * "The expanded GROUP BY row appears only ≥600px container — desktop's."
 * That is a **shell** decision (which panes exist, how dense the page is),
 * so it arrives as a prop from the screen's media query rather than as a
 * container query on the bar — frontend-design §3.1's own split.
 */
describe('SliceBar — expanded', () => {
  it('shows GROUP BY inline instead of behind the readout', () => {
    render(
      <SliceBar
        spec={EMPTY_SLICE}
        result={aResult()}
        valuesFor={() => []}
        formatFor={formatValue}
        onChange={() => {}}
        layout="expanded"
      />,
    )

    expect(screen.getByTestId('group-options')).toBeInTheDocument()
    expect(screen.queryByTestId('arrange-readout')).toBeNull()
  })
})

/**
 * Whether the chips scroll or wrap is how what exists *lays out*, so it is a
 * container query, never a media query (frontend-design §3.2). The two differ
 * exactly where it matters: at Split the bar sits in the Depot's 308px list
 * pane at a viewport of 900, where a `min-width: 40em` media query is already
 * true and would wrap the chips in a pane narrower than a phone —
 * `Depot.module.css`'s title-row fold makes the same call for the same pane.
 * jsdom computes no layout, so the assertion reads the stylesheet text.
 */
describe('SliceBar — the wrap fold', () => {
  it('resolves against the pane it is in, not the viewport', () => {
    const css = readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'SliceBar.module.css'),
      'utf8',
    )
    expect(css).toMatch(/@container \(min-width: 40rem\)/)
    expect(css).not.toMatch(/@media/)
  })
})
