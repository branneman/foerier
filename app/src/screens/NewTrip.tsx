import {
  systemIdSource,
  tripCreated,
  tripDatesSet,
  tripParticipantAdded,
} from '@foerier/shared'
import { useState } from 'react'
import { Link, useLocation } from 'wouter'

import { ParticipantPicker } from '../components/ParticipantPicker'
import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
import { peopleOn } from '../depot/trips'
import styles from './NewTrip.module.css'

/**
 * **F3 step 1** — `Trips → + NEW → name · dates · participants`, and then the
 * trip screen, which is where the flow's arrow points.
 *
 * ## A screen, not a sheet
 *
 * F3 is labelled *desk work, dense picker, keyboard-friendly*, and Add gear
 * already settled that shape for the same reasons: the OS keyboard owns the
 * lower half for the whole sitting, and the one sheet that opens on top of it
 * (the participant picker) stacks rather than competes.
 *
 * The rows are in the order the ledger line is written — **`NAME`** ·
 * **`DATES`** · **`PARTICIPANTS`** — and the primary sits at the bottom, in
 * the thumb zone, exactly as `AddGear` puts `Add gear` there.
 *
 * ## Three ops at most, and one for a bare Trip
 *
 * Creating authors, in this order:
 *
 * 1. `trip.created{name}`
 * 2. `trip.dates_set` — **only if a date was entered**, carrying **only the
 *    fields entered**
 * 3. one `trip.participant_added` per Participant
 *
 * Never `{start: null, end: null}`. A `null` is a *clear*, and a clear over a
 * register nothing has ever written is a needless op that moves a stamp —
 * which at this slice is visible, because `phaseDay` reads the `phase`
 * register's stamp and every op on a Trip is one more thing to merge. The
 * spread idiom that omits an absent key is `gearRecorded`'s, and
 * {@link tripDatesSet} keeps the same discipline one level down.
 *
 * Several ops in one gesture is ordinary — `sync-protocol.md` §4.5 names three
 * such gestures — and needs no transaction of any kind: every op merges
 * independently against its own register, so a burst that is half-delivered is
 * a Trip with a name and no dates rather than a Trip in a broken state.
 *
 * ## The template branch is not built
 *
 * F3 draws `+ NEW → ? BLANK OR TEMPLATE → …`. The template branch is
 * `trip.created{from_trip_id}` plus the materialised copy of a previous
 * Trip's entries, which needs entries to copy; it belongs to the slice that
 * builds them (S14), and `tripCreated` deliberately exposes no `from_trip_id`
 * parameter until then. Nothing on screen mentions it: an affordance that
 * leads nowhere is worse than a missing one.
 *
 * ## No failure state
 *
 * Like Add gear: local ops on a local log, and the sync line in the header is
 * the only thing that ever has anything to report.
 */
export function NewTrip() {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)
  const [, navigate] = useLocation()

  const [name, setName] = useState('')
  // The two dates are held as the strings the native control produces —
  // `YYYY-MM-DD`, or `''` for "not entered". Empty is a real state that
  // decides whether an op is authored at all, so it is never coerced to
  // `null` on the way in.
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  // Draft state, because there is no Trip to address yet: the picker is
  // controlled and authors no `trip.*` op, so the selection lives here until
  // `trip.created` gives it something to be about (spec §4.4).
  const [participants, setParticipants] = useState<readonly string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  const trimmedName = name.trim()
  // The name is the only requirement. Dates are optional by story 5 — "a
  // draft usually has none" — and a Trip with no Participants is an ordinary
  // state, not an unfinished one.
  const canSubmit = trimmedName !== ''

  // The same path the trip screen and the trip card draw their Participants
  // through, over a draft selection instead of a Trip's registers: display
  // order from `sortedPeople`, so "the third one down" means one Person
  // everywhere, and an id the fold has not caught up with listed as `—`
  // rather than dropped. That last part is not hypothetical here — the
  // picker's own `+ New person` authors through `emit`, which folds on the
  // store's queue, so a Person recorded mid-flow is in this selection a tick
  // before `sortedPeople` has heard of them.
  const chosenLabels = peopleOn(state, participants).map(
    (person) => person.label,
  )

  function submit() {
    if (!canSubmit) return

    const id = systemIdSource.next()
    emit(tripCreated(id, trimmedName))

    if (start !== '' || end !== '') {
      emit(
        tripDatesSet(id, {
          ...(start === '' ? {} : { start }),
          ...(end === '' ? {} : { end }),
        }),
      )
    }

    // Order is the selection's, and it does not matter: each Participant is
    // its own register (`sync-protocol.md` §3.4), so these three ops commute
    // with each other and with everything else on the Trip.
    for (const personId of participants) {
      emit(tripParticipantAdded(id, personId))
    }

    navigate(`/trips/${id}`)
  }

  return (
    <div className={styles['screen']}>
      {/* The header every form in the app carries. Without it the only way
          out of a half-typed Trip is the tab bar. */}
      <header className={styles['header']}>
        <Link href="/trips" className={styles['back']}>
          ‹ TRIPS
        </Link>
        <span className={styles['sync']}>
          <span className={styles['syncDot']} aria-hidden="true" />
          {syncLabel(sync)}
        </span>
      </header>

      <h1 className={styles['title']}>New trip</h1>

      <label className={styles['field']}>
        <span className={styles['label']}>Name</span>
        <input
          className={styles['input']}
          value={name}
          autoComplete="off"
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            // Return creates, as it records on Add gear: this screen is one
            // required field and two optional ones, and the keyboard never
            // dismisses to reach the CTA.
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
      </label>

      <div className={styles['dates']}>
        <label className={styles['field']}>
          <span className={styles['label']}>Start</span>
          {/* Native `date`, not a hand-built picker: the value it produces is
              the `YYYY-MM-DD` the registers hold by convention (spec §1.4),
              and the platform control is the one every device already knows
              how to drive with a keyboard. */}
          <input
            type="date"
            className={styles['input']}
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label className={styles['field']}>
          <span className={styles['label']}>End</span>
          <input
            type="date"
            className={styles['input']}
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
      </div>

      {/* The same 48px bordered row Add gear gives HOME and OWNER — a value
          that is picked rather than typed reads the same way wherever it
          appears. */}
      <button
        type="button"
        className={styles['pickRow']}
        aria-label="Participants"
        onClick={() => setPickerOpen(true)}
      >
        <span className={styles['label']}>Participants</span>
        <span className={styles['pickValue']}>
          {/* `None`, not an empty slot: a Trip with nobody on it is a state
              the ledger states rather than leaves blank. */}
          {chosenLabels.length === 0 ? 'None' : chosenLabels.join(', ')}{' '}
          <span aria-hidden="true">›</span>
        </span>
      </button>

      <button
        type="button"
        className={styles['primary']}
        disabled={!canSubmit}
        onClick={submit}
      >
        Create trip
      </button>

      <p className={styles['fact']}>
        RECORDED ON THIS DEVICE · SYNCS IN THE BACKGROUND
      </p>

      {pickerOpen && (
        <ParticipantPicker
          selected={participants}
          onToggle={(personId, next) =>
            setParticipants((current) =>
              next
                ? current.includes(personId)
                  ? current
                  : [...current, personId]
                : current.filter((id) => id !== personId),
            )
          }
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
