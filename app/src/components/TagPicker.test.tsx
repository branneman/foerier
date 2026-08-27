import type { DimensionValue } from '@foerier/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TagPicker } from './TagPicker'

/**
 * "The only place a tag's spelling is ever decided" (`docs/design/README.md`
 * §4a). One anatomy, two modes.
 *
 * The vocabulary is derived, never an entity, and there is no rename — so the
 * moment of typing is the only defence against `#Cooking` beside `#cooking`.
 * That is what the counts are for, and what the two modes differ over.
 */

const VOCABULARY: readonly DimensionValue[] = [
  { value: 'winter', count: 23 },
  { value: 'cooking', count: 14 },
  { value: 'cook-set', count: 3 },
]

function renderPicker(
  overrides: Partial<Parameters<typeof TagPicker>[0]> = {},
) {
  const onApply = vi.fn()
  const onRemove = vi.fn()
  const onClose = vi.fn()
  render(
    <TagPicker
      mode="gear"
      vocabulary={VOCABULARY}
      applied={['winter']}
      onApply={onApply}
      onRemove={onRemove}
      onClose={onClose}
      {...overrides}
    />,
  )
  return { onApply, onRemove, onClose }
}

describe('TagPicker — the gear-detail sheet', () => {
  it('lists what is on this gear, each with a remove', () => {
    renderPicker()
    expect(screen.getByTestId('on-this-gear')).toHaveTextContent('#winter')
    expect(
      screen.getByRole('button', { name: 'Remove #winter' }),
    ).toBeInTheDocument()
  })

  it('removes a tag without confirming — one op, instantly reversible', () => {
    const { onRemove } = renderPicker()
    return userEvent
      .click(screen.getByRole('button', { name: 'Remove #winter' }))
      .then(() => {
        expect(onRemove).toHaveBeenCalledWith('winter')
        expect(screen.queryByRole('alertdialog')).toBeNull()
      })
  })

  /**
   * "Near-duplicates become visible at the moment they'd be created" — the
   * counts are the whole defence, so a picker without them is the wrong
   * picker.
   */
  it('offers the depot vocabulary with counts', () => {
    renderPicker()
    const depot = screen.getByTestId('in-the-depot')
    expect(depot).toHaveTextContent('#cooking')
    expect(depot).toHaveTextContent('14')
  })

  it('applies a tag from the vocabulary', async () => {
    const { onApply } = renderPicker()
    await userEvent.click(screen.getByRole('button', { name: /#cooking 14/ }))
    expect(onApply).toHaveBeenCalledWith('cooking')
  })

  it('narrows the vocabulary as the spelling is typed', async () => {
    renderPicker()
    await userEvent.type(screen.getByLabelText('Tag'), 'coo')

    const depot = screen.getByTestId('in-the-depot')
    expect(depot).toHaveTextContent('#cooking')
    expect(depot).toHaveTextContent('#cook-set')
    expect(depot).not.toHaveTextContent('#winter')
  })

  it('offers creating only once something has been typed', async () => {
    renderPicker()
    expect(screen.queryByTestId('create-tag')).toBeNull()

    await userEvent.type(screen.getByLabelText('Tag'), 'alpine')
    expect(screen.getByTestId('create-tag')).toHaveTextContent(
      '+ CREATE #alpine',
    )
  })

  /**
   * "Input is normalised — lowercased as typed, spaces become one hyphen,
   * charset a–z 0–9 –" and "that normalisation **is** the op payload". So
   * what the create row offers is what gets stored, visibly, before the tap.
   */
  it('normalises as it is typed, so what is offered is what is stored', async () => {
    const { onApply } = renderPicker()
    await userEvent.type(screen.getByLabelText('Tag'), 'Alpine Kit!')

    expect(screen.getByTestId('create-tag')).toHaveTextContent(
      '+ CREATE #alpine-kit',
    )
    await userEvent.click(screen.getByTestId('create-tag'))
    expect(onApply).toHaveBeenCalledWith('alpine-kit')
  })

  /**
   * The near-duplicate defence, working. Typing `Cook Set!` normalises to a
   * tag the depot already has, so the picker offers **that** — with its
   * count — and refuses to offer creating a second one. This is the whole
   * reason existing tags are listed before creating is possible.
   */
  it('surfaces an existing tag rather than offering to create it again', async () => {
    const { onApply } = renderPicker()
    await userEvent.type(screen.getByLabelText('Tag'), 'Cook Set!')

    expect(screen.queryByTestId('create-tag')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /#cook-set 3/ }))
    expect(onApply).toHaveBeenCalledWith('cook-set')
  })

  /**
   * The keystroke that found the bug this function exists for: a trailing
   * space must survive as the hyphen the next word hangs off, or `cook set`
   * silently becomes `cookset`.
   */
  it('keeps a typed space as a hyphen while the next word is still coming', async () => {
    renderPicker()
    const field = screen.getByLabelText('Tag')
    await userEvent.type(field, 'alpine ')
    expect(field).toHaveValue('alpine-')

    await userEvent.type(field, 'kit')
    expect(field).toHaveValue('alpine-kit')
  })

  it('offers no create row for input that normalises to nothing', async () => {
    renderPicker()
    await userEvent.type(screen.getByLabelText('Tag'), '###')
    expect(screen.queryByTestId('create-tag')).toBeNull()
  })

  // `##winter` is unreachable: the `#` is drawn by the field, never typed
  // into the value.
  it('draws the # as a fixed prefix rather than letting it be typed', async () => {
    renderPicker()
    const field = screen.getByLabelText('Tag')
    await userEvent.type(field, '#winter')
    expect(field).toHaveValue('winter')
  })

  it('does not offer creating a tag that is already on this gear', async () => {
    renderPicker()
    await userEvent.type(screen.getByLabelText('Tag'), 'winter')
    expect(screen.queryByTestId('create-tag')).toBeNull()
  })
})

/**
 * "Picks from what exists, **never creates**" — the slice bar cannot invent a
 * spelling, because a filter for a tag nothing carries is a filter for
 * nothing.
 */
describe('TagPicker — the slice-bar mode', () => {
  it('shows neither the applied section nor a create row', async () => {
    renderPicker({ mode: 'slice', applied: [] })
    expect(screen.queryByTestId('on-this-gear')).toBeNull()

    await userEvent.type(screen.getByLabelText('Tag'), 'alpine')
    expect(screen.queryByTestId('create-tag')).toBeNull()
  })

  it('still offers the vocabulary with its counts', () => {
    renderPicker({ mode: 'slice', applied: [] })
    expect(screen.getByTestId('in-the-depot')).toHaveTextContent('#winter')
    expect(screen.getByTestId('in-the-depot')).toHaveTextContent('23')
  })

  it('picks an existing tag', async () => {
    const { onApply } = renderPicker({ mode: 'slice', applied: [] })
    await userEvent.click(screen.getByRole('button', { name: /#winter 23/ }))
    expect(onApply).toHaveBeenCalledWith('winter')
  })

  it('says so plainly when the depot has no vocabulary yet', () => {
    renderPicker({ mode: 'slice', applied: [], vocabulary: [] })
    expect(screen.getByTestId('in-the-depot')).toHaveTextContent(
      'No tags in the depot yet.',
    )
  })
})
