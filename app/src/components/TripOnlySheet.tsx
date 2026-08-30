import { systemIdSource, tripEntryAdded } from '@foerier/shared'
import { Sheet } from '@foerier/ui'
import { useCallback, useState } from 'react'

import { useDepot } from '../depot/store'
import styles from './TripOnlySheet.module.css'

/**
 * **The trip-only entry sheet** — spec §4.6, the dashed `+ TRIP-ONLY ENTRY`
 * row's destination on both hosts (`Trip.tsx` below Split, and
 * `GearListBuilder.tsx`'s own identical row at Split and up). A `Sheet` — a
 * decision, not a sitting, so `AddGear.tsx`'s "the screen stays" argument does
 * not transfer — but the **field order is Add gear's**: `Name`, then the
 * `Item · Container` trait last beside the CTA, because it is the rarest
 * decision on this sheet and the only irreversible one. Add gear's own reason
 * ("it sits where the eye lands before committing") applies unchanged; only
 * `Kind`, `Home` and `Owner` are absent, because a trip-only Entry has none of
 * those — it is not Gear.
 *
 * **No tag chip and no tag picker ever mounts here** (invariant 9) —
 * `Screens B` §01B's own rule, stated because the trip-side screens reuse
 * this exact chip and picker from S7 on. This sheet imports neither.
 *
 * **Un-renameability stays unsaid.** There is no `trip.entry_renamed`;
 * correcting a typo is remove-and-re-add. Stating a missing op at creation is
 * release meta-text (the boards' own ruling on `AddGear.tsx`'s retired
 * `UNDO`), so nothing here says so — the bottom fact line states what *is*
 * true (`NOT KEPT IN THE DEPOT · CLEARED AT CLOSE`), not what is missing.
 *
 * It emits its own **one** `trip.entry_added`, `PhaseSheet`'s shape rather
 * than `ReopenConfirm`'s: there is exactly one caller shape per host — the
 * dashed row on the Trip this sheet is opened against — so nothing is served
 * by handing the write back up to two near-identical callers.
 *
 * **Mounted is open.** `ui/`'s primitives have no `open` prop, so both hosts
 * write `{open && <TripOnlySheet …/>}`, and unmounting on close is what
 * resets the two drafts below — `HomePicker`'s bug, not repeated here: a
 * reopened sheet starts from `Name` empty and `Item` selected, never a
 * declined attempt's leftovers.
 *
 * **`Name` is focused on open**, per spec §4.6 and `design/README.md` §3b —
 * "the only always-required input" on the sheet. Two things that look like
 * the obvious fix do not work, both verified rather than assumed:
 *
 * - A plain `autoFocus` prop loses: Radix's `FocusScope` fires
 *   `onOpenAutoFocus` on mount, and `Sheet.tsx` deliberately moves focus to
 *   the sheet's own container there instead of the first tabbable control —
 *   right for a picker like `HomePicker`, whose first control is an EDIT
 *   toggle unrelated to the task the sheet was opened for, wrong here where
 *   the first control *is* that task.
 * - A `useEffect` calling `.focus()` on a ref also loses, for a subtler
 *   reason: `@radix-ui/react-portal`'s `Portal` renders `null` on its first
 *   commit and only creates the real DOM (inside a `useLayoutEffect`, to
 *   dodge an SSR mismatch) on a second, nested commit — so this component's
 *   own effect, tied to the *first* commit, fires while the field does not
 *   exist yet in the DOM. Confirmed by instrumenting both call sites rather
 *   than inferred: the effect ran and found `null` before Radix's own
 *   auto-focus ran at all.
 *
 * A **ref callback** fires exactly when the input's DOM node is attached —
 * the portal's second, real commit — which is *before* any effect of that
 * commit runs, `FocusScope`'s auto-focus-on-mount included. Its own guard
 * (`container.contains(previouslyFocusedElement)`) is what makes this stick
 * rather than merely win a race: once the field already holds focus when that
 * check runs, `FocusScope` sees a focused candidate already inside its
 * container and skips dispatching the auto-focus event Radix would otherwise
 * fire — so `Sheet.tsx`'s own container-focusing `onOpenAutoFocus` never runs
 * at all, rather than running and losing.
 */
export interface TripOnlySheetProps {
  readonly tripId: string
  readonly onClose: () => void
}

export function TripOnlySheet({ tripId, onClose }: TripOnlySheetProps) {
  const emit = useDepot((depot) => depot.emit)

  const [name, setName] = useState('')
  const [container, setContainer] = useState(false)

  // A stable identity, so React calls it once on mount (with the node) and
  // once on unmount (with `null`) rather than on every keystroke's re-render.
  const focusName = useCallback((node: HTMLInputElement | null) => {
    node?.focus()
  }, [])

  const trimmedName = name.trim()
  const canSubmit = trimmedName !== ''

  function submit() {
    if (!canSubmit) return
    emit(
      tripEntryAdded(tripId, systemIdSource.next(), {
        from: 'trip_only',
        name: trimmedName,
        container,
      }),
    )
    onClose()
  }

  return (
    <Sheet title="Trip-only entry" onClose={onClose}>
      <label className={styles['field']}>
        <span className={styles['label']}>Name</span>
        <input
          ref={focusName}
          className={styles['input']}
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSubmit) {
              event.preventDefault()
              submit()
            }
          }}
        />
      </label>

      <fieldset className={styles['segmentedField']}>
        <legend className={styles['label']}>Recorded as</legend>
        <div className={styles['segmented']}>
          <label className={styles['segment']}>
            <input
              type="radio"
              name="trip-only-trait"
              checked={!container}
              onChange={() => setContainer(false)}
            />
            <span>Item</span>
          </label>
          <label className={styles['segment']}>
            <input
              type="radio"
              name="trip-only-trait"
              checked={container}
              onChange={() => setContainer(true)}
            />
            <span>Container</span>
          </label>
        </div>
        <p className={styles['fact']}>
          CONTAINERS HOLD OTHER GEAR · FIXED WHEN RECORDED
        </p>
      </fieldset>

      <button
        type="button"
        className={styles['primary']}
        disabled={!canSubmit}
        onClick={submit}
      >
        Add entry
      </button>

      {/* Restates the launcher's own promise at the moment of commitment —
          the dashed row's copy, verbatim, one more time right where the write
          actually lands. */}
      <p className={`${styles['fact']} ${styles['ctaFact']}`}>
        NOT KEPT IN THE DEPOT · CLEARED AT CLOSE
      </p>
    </Sheet>
  )
}
