import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Confirm } from './Confirm'

/**
 * The other half of the rule `Sheet.test.tsx` asserts: a decision is not
 * dismissed by a stray tap on the dim area
 * (`docs/specs/2026-08-29-radix-conversion.md` §3.1).
 */

function Harness({
  onClose = () => {},
  onConfirm = () => {},
  variant,
  children,
}: {
  onClose?: () => void
  onConfirm?: () => void
  variant?: 'card' | 'sheet'
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Confirm
          {...(variant === undefined ? {} : { variant })}
          title="Remove Shed?"
          description="4 pieces of gear become loose."
          onClose={() => {
            setOpen(false)
            onClose()
          }}
          actions={
            <>
              <Confirm.Cancel>
                <button type="button">Cancel</button>
              </Confirm.Cancel>
              <Confirm.Action>
                <button type="button" onClick={onConfirm}>
                  Remove place
                </button>
              </Confirm.Action>
            </>
          }
        >
          {children}
        </Confirm>
      )}
    </>
  )
}

describe('Confirm', () => {
  it('is an alertdialog named by its visible title', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    expect(
      screen.getByRole('alertdialog', { name: 'Remove Shed?' }),
    ).toBeInTheDocument()
  })

  it('does not close on the scrim, on either variant', async () => {
    for (const variant of ['card', 'sheet'] as const) {
      const onClose = vi.fn()
      const user = userEvent.setup()
      const view = render(<Harness variant={variant} onClose={onClose} />)
      await user.click(screen.getByRole('button', { name: 'Open' }))

      const confirm = screen.getByRole('alertdialog')
      await user.click(confirm.previousElementSibling!)

      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      view.unmount()
    }
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Harness onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('closes from Cancel without running the action', async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<Harness onClose={onClose} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('runs the caller’s own handler from the action, and closes', async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<Harness onClose={onClose} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    await user.click(screen.getByRole('button', { name: 'Remove place' }))
    expect(onConfirm).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('focuses Cancel — on a destructive decision the safe control wins', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('returns focus to whatever opened it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    // See `Sheet.test.tsx`: Radix restores focus from a `setTimeout(…, 0)`.
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('renders title, children, description and actions in that order', async () => {
    const user = userEvent.setup()
    render(
      <Harness variant="sheet">
        <p>▲ 3 changes not yet synced.</p>
      </Harness>,
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))

    // The `▲` lines sit above the body paragraph, as `Devices` draws them.
    const text = screen.getByRole('alertdialog').textContent ?? ''
    expect(text.indexOf('▲ 3 changes')).toBeGreaterThan(
      text.indexOf('Remove Shed?'),
    )
    expect(text.indexOf('4 pieces of gear')).toBeGreaterThan(
      text.indexOf('▲ 3 changes'),
    )
    expect(text.indexOf('Remove place')).toBeGreaterThan(
      text.indexOf('4 pieces of gear'),
    )
  })

  /**
   * **Ruling H9 — two prose registers, one slot each.** `description` is the
   * answer and takes default ink; `note` is the explainer beneath it and is
   * muted. They were one slot until S11, with `.descriptionSheet` drawing
   * every body in the explainer's own colour, so the distinction the boards
   * have drawn since S6 did not exist on any screen.
   *
   * The colours are tokens the jsdom run resolves to nothing, so what is
   * asserted is the **structure** the colours hang on: the note is its own
   * element, carries `.note`, and sits after the description's own text
   * inside the one `AlertDialog.Description` — which is what puts both
   * sentences in a single announcement.
   */
  it('draws the note as its own element after the description', () => {
    render(
      <Confirm
        variant="sheet"
        title="Reopen Tessin 2025?"
        description="It returns to Unpack exactly as it stood."
        note="A count corrected by hand is never rewritten."
        onClose={() => {}}
        actions={
          <Confirm.Cancel>
            <button type="button">Cancel</button>
          </Confirm.Cancel>
        }
      />,
    )

    const note = screen.getByText(
      'A count corrected by hand is never rewritten.',
    )
    expect(note.className).toContain('note')

    const described = note.closest('p')
    expect(described?.textContent).toContain('It returns to Unpack')

    const text = described?.textContent ?? ''
    expect(text.indexOf('A count corrected')).toBeGreaterThan(
      text.indexOf('It returns to Unpack'),
    )
  })

  /**
   * A confirm whose `children` block **is** its answer carries only a note —
   * the over-claim sheet's own shape (H9). Radix still needs a Description,
   * so the note fills it rather than the sheet announcing a title and two
   * buttons.
   */
  it('accepts a note with no description, and it is still the accessible description', async () => {
    render(
      <Confirm
        variant="sheet"
        title="Start pack-out — Alps 2026?"
        note="Starting warns, never blocks."
        onClose={() => {}}
        actions={
          <Confirm.Cancel>
            <button type="button">Cancel</button>
          </Confirm.Cancel>
        }
      >
        <p>▲ 1 entry is already claimed by Tessin 2025.</p>
      </Confirm>,
    )

    const confirm = screen.getByRole('alertdialog')
    const describedBy = confirm.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      'Starting warns, never blocks.',
    )
  })
})
