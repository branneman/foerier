import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ContainerMoveConfirm } from './ContainerMoveConfirm'

/**
 * Ruling A2b's one confirm. No store and no ops: this component reads
 * nothing and writes nothing — it states a consequence and hands the
 * decision back.
 */

type ConfirmProps = Parameters<typeof ContainerMoveConfirm>[0]

function renderConfirm(props: Partial<ConfirmProps> = {}) {
  // Real counters, not `vi.fn()` — `HomePicker.test.tsx`'s rule for the
  // sheet this one stands beside.
  const confirms: number[] = []
  const cancels: number[] = []
  render(
    <ContainerMoveConfirm
      movingName="Crate B"
      destinationName="Duffel 90 L"
      insideCount={5}
      onConfirm={() => confirms.push(1)}
      onCancel={() => cancels.push(1)}
      {...props}
    />,
  )
  return { confirms: () => confirms.length, cancels: () => cancels.length }
}

describe('the container move confirm', () => {
  it('states the destination in the title and the ride-along in the fact', async () => {
    renderConfirm()

    expect(
      screen.getByText('Move Crate B into Duffel 90 L?'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Crate B and everything inside it move on the trip. Nothing at home moves.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('5 INSIDE RIDE ALONG · STATUS UNCHANGED'),
    ).toBeInTheDocument()
  })

  /**
   * **The second sentence is invariant 13, not reassurance.** A container's
   * trip residence and its home residence are two different registers, and
   * the Quartermaster who reached this sheet through the Home picker's
   * identically-shaped one has every reason to fear otherwise. Asserted by
   * exact text so nobody trims it.
   */
  it('says that nothing at home moves, in those words', async () => {
    renderConfirm({ movingName: 'Duffel 90 L', destinationName: 'Loose' })

    expect(
      screen.getByText(
        'Duffel 90 L and everything inside it move on the trip. Nothing at home moves.',
      ),
    ).toBeInTheDocument()
  })

  it('offers accent Move and ghost Cancel, and Cancel writes nothing', async () => {
    const user = userEvent.setup()
    const { confirms, cancels } = renderConfirm()

    expect(screen.getByRole('button', { name: 'Move' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(confirms()).toBe(0)
    expect(cancels()).toBe(1)
  })

  /**
   * `Confirm.Action` closes the dialog as well as running the caller's
   * `onClick`, and Radix reports that close through `onOpenChange` — which
   * is this component's `onCancel`. So **`Move` calls both**, `onConfirm`
   * first: `onCancel` is "the confirm is closing", not "the move was
   * refused". Pinned rather than worked around, so a caller that reopens
   * something on cancel knows it will fire here too (`ReopenConfirm` carries
   * the identical shape).
   */
  it('takes the decision on Move, and closes behind it', async () => {
    const user = userEvent.setup()
    const { confirms, cancels } = renderConfirm()

    await user.click(screen.getByRole('button', { name: 'Move' }))

    expect(confirms()).toBe(1)
    expect(cancels()).toBe(1)
  })

  /**
   * `ui/Confirm` withholds scrim dismissal (Radix AlertDialog's default, and
   * the house rule: a picker dismisses on the scrim, a decision does not).
   * Escape still closes.
   */
  it('does not dismiss on the scrim — a decision is not a picker', async () => {
    const user = userEvent.setup()
    const { confirms, cancels } = renderConfirm()

    const confirm = screen.getByRole('alertdialog')
    const scrim = confirm.previousElementSibling
    if (scrim === null) throw new Error('the confirm drew no scrim')
    await user.click(scrim)

    expect(cancels()).toBe(0)
    expect(confirms()).toBe(0)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const { confirms, cancels } = renderConfirm()

    await user.keyboard('{Escape}')

    expect(cancels()).toBe(1)
    expect(confirms()).toBe(0)
  })

  /** One rider or five, the count line reads the same shape — there is no
   * noun in it to pluralise. */
  it('states a single rider without pluralising', async () => {
    renderConfirm({ insideCount: 1 })

    expect(
      screen.getByText('1 INSIDE RIDE ALONG · STATUS UNCHANGED'),
    ).toBeInTheDocument()
  })

  /**
   * The name is the sheet's own accessible name, which is the drawn title —
   * `ui/Confirm` puts it on `AlertDialog.Title` precisely so the two cannot
   * drift.
   */
  it('is named by the question it asks', async () => {
    renderConfirm()

    expect(
      screen.getByRole('alertdialog', {
        name: 'Move Crate B into Duffel 90 L?',
      }),
    ).toBeInTheDocument()
  })
})
