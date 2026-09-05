import { Confirm } from '@foerier/ui'

import styles from './ContainerMoveConfirm.module.css'

/**
 * **Moving a container is the one move that confirms** — ruling A2b,
 * `docs/design/README.md` §1's "Which move confirms" bullet.
 *
 * One rule covers three acts: *the confirm is owed where the act cannot be
 * seen on the screen that made it.*
 *
 * - A plain **Entry or Piece** move does not confirm — it is one op, and the
 *   row visibly jumps to its new group.
 * - A **container** move does. Its ride-along is elsewhere on the screen and
 *   may be filtered out of view by `○ LEFT` entirely, so the one thing the
 *   Quartermaster would check is the one thing they cannot see; and story 36,
 *   Undo, is Later, so there is nothing to lean on afterwards.
 * - A **rail tap** never confirms: it writes one register and rewrites
 *   nobody else's, the contents' whereabouts following a pointer.
 *
 * ## The second sentence is invariant 13, and it is not reassurance
 *
 * `Nothing at home moves.` states a fact about *two different registers*: a
 * `trip.entry_moved` writes an Entry's trip residence and touches the Gear's
 * home residence not at all. It reads like comfort text and is not — the
 * Quartermaster reaching this sheet has very likely used the **Home picker's
 * identically-shaped one**, where picking a destination moves the gear in the
 * depot for good, and fearing that this does the same is the correct
 * inference from everything else the app has taught them. Trimming the
 * sentence would remove the only place the app says otherwise.
 *
 * ## It states, and hands the decision back
 *
 * No store, no op, no `useHousehold`: whichever screen opened the Pack picker
 * knows what is moving, which is the fact that decides whether a confirm is
 * owed at all, so it also owns the write. That is why {@link PackPicker}
 * simply selects and closes rather than holding a pending move the way
 * `HomePicker` does.
 *
 * The primary stays **accent** rather than the attention colour: nothing is
 * being destroyed, and the body says so. `Confirm.Action` sits above
 * `Confirm.Cancel` in the DOM — the boards' order, and `ReopenConfirm`'s
 * settled comment: Radix gives initial focus to `Cancel` wherever it sits, so
 * this is a DOM-order decision rather than a visual one.
 *
 * The `card` variant, not `sheet`: the board (`S9 Round`, the
 * `Container move confirm` artboard) draws a bordered card with no grabber.
 * The mono count line rides **inside** `description` rather than in
 * `children`, because the board draws it *under* the body sentence and
 * `children` renders above — the same one-slot constraint `ReopenConfirm`
 * records, resolved the other way here because this block is a count rather
 * than a `▲` condition.
 */
export interface ContainerMoveConfirmProps {
  /** The container being moved. */
  movingName: string
  /** Where it is being moved to — a container's name, or `Loose`. */
  destinationName: string
  /** How many Entries ride along inside it. */
  insideCount: number
  onConfirm: () => void
  onCancel: () => void
}

export function ContainerMoveConfirm({
  movingName,
  destinationName,
  insideCount,
  onConfirm,
  onCancel,
}: ContainerMoveConfirmProps) {
  return (
    <Confirm
      // Stated rather than inherited: this docblock claims the card, and a
      // claim that rests on another component's default rots silently the
      // day that default changes.
      variant="card"
      title={`Move ${movingName} into ${destinationName}?`}
      description={
        <>
          <span className={styles['body']}>
            {movingName} and everything inside it move on the trip. Nothing at
            home moves.
          </span>
          {/* The count the body sentence does not carry, and the half of it
              a Quartermaster mid-pack-out most wants: the ride-along keeps
              every status it already had. */}
          <span className={styles['fact']}>
            {insideCount} INSIDE RIDE ALONG · STATUS UNCHANGED
          </span>
        </>
      }
      onClose={onCancel}
      actions={
        <>
          <Confirm.Action>
            <button
              type="button"
              className={styles['primary']}
              onClick={onConfirm}
            >
              Move
            </button>
          </Confirm.Action>
          <Confirm.Cancel>
            <button type="button" className={styles['ghost']}>
              Cancel
            </button>
          </Confirm.Cancel>
        </>
      }
    />
  )
}
