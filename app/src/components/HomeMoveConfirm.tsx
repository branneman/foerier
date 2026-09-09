import { Confirm } from '@foerier/ui'

import styles from './HomeMoveConfirm.module.css'

/**
 * **The home world's move confirm** — MOVE's, which no board draws, and the
 * re-home's, which §5i G15 does. `ContainerMoveConfirm`'s sibling one world
 * over, and the same three sentences apply: the confirm is owed where the act
 * cannot be seen on the screen that made it, nothing is being destroyed so
 * the primary stays accent, and the component states and hands the decision
 * back.
 *
 * ## Why it lives here rather than inside `HomePicker`
 *
 * It was drawn **inside** the sheet until after the MVP, switched on by a
 * `moving.confirm` flag the caller passed — which made `HomePicker` the one
 * picker in the app holding a business rule (`patterns.md` §4.3: a picker is
 * pure selection, and the caller decides whether a confirm stands between the
 * pick and the write). `PackPicker` had always done it the other way.
 *
 * The recorded reason the lift was "more than a cut-and-paste" was that the
 * confirm names the destination the picker had just resolved, a fact only the
 * picker held. It turned out not to need reporting back: a caller has the
 * `Residence` it was handed and the fold, so `homeLabel` derives the same
 * words the picker's own row drew — which is exactly what `Packing.tsx` does
 * for the trip world (`nameOfResidence`). Widening `onSelect` would have
 * bought nothing and made every caller carry a label it can compute.
 *
 * ## The two variants say different things because the acts differ
 *
 * `move` is the Depot's own move: the ride-along is stated as a sentence,
 * because a household moving a crate is being told what travels with it.
 * `re-home` is F5's, where the same act **also** settles an outcome — so it
 * carries the mono pair `N RIDE ALONG · OUTCOME → BACK`, both writes as
 * numbers (F8), and says in words that the contents keep their own outcomes.
 *
 * No store, no op: whichever screen opened the picker knows what is moving,
 * so it owns the write.
 */
export interface HomeMoveConfirmProps {
  /** `move` is the Depot's; `re-home` is F5's, which also settles an outcome. */
  readonly variant: 'move' | 're-home'
  /** What is being moved. */
  readonly movingName: string
  /** Where it is going — a Place's or container's name, or `Loose`. */
  readonly destinationName: string
  /** What travels with it: the whole subtree, at any depth (§5i G2). */
  readonly ridesAlong: number
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function HomeMoveConfirm({
  variant,
  movingName,
  destinationName,
  ridesAlong,
  onCancel,
  onConfirm,
}: HomeMoveConfirmProps) {
  const reHome = variant === 're-home'

  return (
    <Confirm
      title={
        reHome
          ? `Re-home ${movingName} to ${destinationName}?`
          : `Move ${movingName} to ${destinationName}?`
      }
      description={
        reHome ? (
          <>
            <span className={styles['body']}>
              {movingName} and everything inside it move at home. It is marked
              back; its contents keep their own outcomes.
            </span>
            {/* Both writes as numbers — what moves, and the outcome the pick
                implies (F8). `ContainerMoveConfirm`'s own shape one screen
                over, whose mono line states the trip-world pair. */}
            <span className={styles['fact']}>
              {ridesAlong} RIDE ALONG · OUTCOME → BACK
            </span>
          </>
        ) : ridesAlong === 1 ? (
          '1 piece of gear inside it moves too.'
        ) : (
          `${ridesAlong} pieces of gear inside it move too.`
        )
      }
      onClose={onCancel}
      actions={
        <>
          {/* Action before Cancel, in the card register too (§5n K13):
              §5d G settled the order for sheets and the S3-era cards drew
              the reverse, so the code followed whichever board it was built
              against. **Leading with Cancel was never the caution** —
              `Confirm` gives it initial focus wherever it sits (§4.2), so
              position and focus are two mechanisms and only one has to carry
              it. */}
          <Confirm.Action>
            <button
              type="button"
              className={styles['primary']}
              onClick={onConfirm}
            >
              {reHome ? 'Re-home' : 'Move gear'}
            </button>
          </Confirm.Action>
          <Confirm.Cancel>
            <button
              type="button"
              className={styles['ghost']}
              onClick={onCancel}
            >
              Cancel
            </button>
          </Confirm.Cancel>
        </>
      }
    />
  )
}
