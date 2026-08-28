import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Sheet } from './Sheet'

/**
 * The contract that was implemented eleven times and tested zero before the
 * Radix conversion (`docs/specs/2026-08-29-radix-conversion.md` §7.1).
 *
 * A `Sheet` is a **picker**: the scrim dismisses it. The rule that separates
 * it from `Confirm` is asserted in both files, from both sides.
 */

/** A trigger outside the sheet, so focus return is observable. */
function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Sheet
          title="Home"
          onClose={() => {
            setOpen(false)
            onClose()
          }}
        >
          <button type="button">Loose</button>
          <Sheet.Close>
            <button type="button">Close</button>
          </Sheet.Close>
        </Sheet>
      )}
    </>
  )
}

describe('Sheet', () => {
  it('is a dialog named by its visible title', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    const sheet = screen.getByRole('dialog', { name: 'Home' })
    expect(sheet).toBeInTheDocument()
    // The name comes from the heading on screen, not from a parallel
    // `aria-label` that could drift away from it.
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on the scrim — it is a picker, not a decision', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    // Radix dismisses on a pointer-down outside the content; the scrim is
    // outside it, since Radix draws overlay and content as siblings.
    await user.click(screen.getByRole('dialog').previousElementSibling!)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes from Sheet.Close, keeping the caller its own button', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('focuses the sheet itself, not its first control', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    // `HomePicker`'s first control is the EDIT toggle, which suspends the
    // task the sheet was opened for. Focus the sheet; the first Tab then
    // lands on the first control rather than starting inside one.
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('returns focus to whatever opened it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    // Radix restores focus from a `setTimeout(…, 0)` in the focus scope's
    // unmount, so the assertion has to wait a tick rather than read the
    // synchronous state after the keystroke.
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('draws a title action opposite the title when it is given one', async () => {
    const user = userEvent.setup()
    function WithAction() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <Sheet
              title="Home"
              onClose={() => setOpen(false)}
              titleAction={
                <button type="button" onClick={() => {}}>
                  EDIT
                </button>
              }
            >
              <p>rows</p>
            </Sheet>
          )}
        </>
      )
    }
    render(<WithAction />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    expect(screen.getByRole('button', { name: 'EDIT' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Home' })).toBeInTheDocument()
  })
})
