import { systemIdSource, tripEntryAdded } from '@foerier/shared'
import { Sheet } from '@foerier/ui'
import { useState } from 'react'

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
 */
export interface TripOnlySheetProps {
  readonly tripId: string
  readonly onClose: () => void
}

export function TripOnlySheet({ tripId, onClose }: TripOnlySheetProps) {
  const emit = useDepot((depot) => depot.emit)

  const [name, setName] = useState('')
  const [container, setContainer] = useState(false)

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
