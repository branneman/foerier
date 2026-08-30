import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { EntryRow } from './EntryRow'

describe('EntryRow', () => {
  describe('editable anatomy, by Kind', () => {
    it('draws a dense Stepper on a Counted Entry', () => {
      render(
        <EntryRow
          label="Tent, tunnel 4p"
          kind="counted"
          bringCount={2}
          pieceCount={2}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(
        screen.getByRole('button', { name: /increase bring-count/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('textbox', { name: /bring-count for tent/i }),
      ).toHaveValue('2')
    })

    it('draws ×N mono, no circles, on a per-person Entry', () => {
      render(
        <EntryRow
          label="Trekking pole"
          kind="per_person"
          bringCount={null}
          pieceCount={3}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×3')
      // No Stepper, and no per-Person circle of any kind at S7.
      expect(screen.queryByRole('spinbutton')).toBeNull()
      expect(screen.queryByTestId('entry-row-badge')).toBeNull()
    })

    it('draws nothing in the trailing slot on a Single Entry', () => {
      render(
        <EntryRow
          label="Headlamp"
          kind="single"
          bringCount={null}
          pieceCount={1}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.queryByTestId('entry-row-count')).toBeNull()
      expect(screen.queryByTestId('entry-row-badge')).toBeNull()
      expect(screen.queryByRole('spinbutton')).toBeNull()
    })

    it('draws the amber TRIP-ONLY badge on a trip-only Entry', () => {
      render(
        <EntryRow
          label="Passports"
          kind="trip_only"
          bringCount={null}
          pieceCount={1}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-badge')).toHaveTextContent(
        'TRIP-ONLY',
      )
    })
  })

  describe('editable rows end in a remove control', () => {
    it('renders ✕ and calls onRemove without a confirm', async () => {
      const user = userEvent.setup()
      const onRemove = vi.fn()
      render(
        <EntryRow
          label="Headlamp"
          kind="single"
          bringCount={null}
          pieceCount={1}
          editable
          onBringCountChange={vi.fn()}
          onRemove={onRemove}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Remove Headlamp' }))
      expect(onRemove).toHaveBeenCalledTimes(1)
    })
  })

  describe('read-only mode (editable={false})', () => {
    it('renders no remove control', () => {
      render(
        <EntryRow
          label="Headlamp"
          kind="single"
          bringCount={null}
          pieceCount={1}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.queryByTestId('entry-row-remove')).toBeNull()
    })

    it('reads ×N for a Counted Entry, with no Stepper', () => {
      render(
        <EntryRow
          label="Tent, tunnel 4p"
          kind="counted"
          bringCount={4}
          pieceCount={4}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×4')
      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('reads — for a per-person Entry, not ×N', () => {
      render(
        <EntryRow
          label="Trekking pole"
          kind="per_person"
          bringCount={null}
          pieceCount={3}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('—')
    })

    it('reads — for a trip-only Entry, with no badge', () => {
      render(
        <EntryRow
          label="Passports"
          kind="trip_only"
          bringCount={null}
          pieceCount={1}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('—')
      expect(screen.queryByTestId('entry-row-badge')).toBeNull()
    })

    it('reads — for a Single Entry', () => {
      render(
        <EntryRow
          label="Headlamp"
          kind="single"
          bringCount={null}
          pieceCount={1}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('—')
    })
  })

  describe('the needless-write guard (spec §4.9, decision 2)', () => {
    it('does not call onBringCountChange when the stepper reports the current value', async () => {
      const user = userEvent.setup()
      const onBringCountChange = vi.fn()
      render(
        <EntryRow
          label="Tent, tunnel 4p"
          kind="counted"
          bringCount={2}
          pieceCount={2}
          editable
          onBringCountChange={onBringCountChange}
          onRemove={vi.fn()}
        />,
      )
      const well = screen.getByRole('textbox', {
        name: /bring-count for tent/i,
      })
      // Clear and retype the same digits — Stepper's own docstring names
      // this exact case as one where onChange still fires.
      await user.clear(well)
      await user.type(well, '2')
      expect(onBringCountChange).not.toHaveBeenCalled()
    })

    it('does not call onBringCountChange when the well is cleared to blank', async () => {
      const user = userEvent.setup()
      const onBringCountChange = vi.fn()
      render(
        <EntryRow
          label="Tent, tunnel 4p"
          kind="counted"
          bringCount={2}
          pieceCount={2}
          editable
          onBringCountChange={onBringCountChange}
          onRemove={vi.fn()}
        />,
      )
      const well = screen.getByRole('textbox', {
        name: /bring-count for tent/i,
      })
      await user.clear(well)
      expect(onBringCountChange).not.toHaveBeenCalled()
    })

    it('calls onBringCountChange with the new value on a genuine change', async () => {
      const user = userEvent.setup()
      const onBringCountChange = vi.fn()
      render(
        <EntryRow
          label="Tent, tunnel 4p"
          kind="counted"
          bringCount={2}
          pieceCount={2}
          editable
          onBringCountChange={onBringCountChange}
          onRemove={vi.fn()}
        />,
      )
      await user.click(
        screen.getByRole('button', { name: /increase bring-count/i }),
      )
      expect(onBringCountChange).toHaveBeenCalledOnce()
      expect(onBringCountChange).toHaveBeenCalledWith(3)
    })
  })
})
