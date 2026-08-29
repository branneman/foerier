import {
  isActive,
  phaseDay,
  phaseLabel,
  phaseNext,
  phaseOf,
  tripDatesSet,
  tripLabel,
  tripParticipantAdded,
  tripParticipantRemoved,
  tripRenamed,
  type TripState,
} from '@foerier/shared'
import { useState } from 'react'
import { Link, useParams } from 'wouter'

import { ParticipantPicker } from '../components/ParticipantPicker'
import { PhaseSheet } from '../components/PhaseSheet'
import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
import { tripDateRange, tripParticipants } from '../depot/trips'
import styles from './Trip.module.css'

/**
 * **The trip screen** — `Screens B` §02's `Gear list builder` header, built
 * now, with the two panes below it left to the slice that has a gear list to
 * put in them. That is Find's `S8 · PIECES` pattern and the People screen's
 * missing login half: an element designed final that falls through to a
 * simpler variant until its slice lands.
 *
 * What the board draws at 1024 and this draws today:
 *
 * ```
 * ‹ TRIPS    Alps 2026 — gear list    61 PIECES · EST 48.2 KG  [ Start pack-out ]
 * ```
 *
 * The title is **the Trip's name alone**: `— gear list` names a list that does
 * not exist, and the right-hand count, the weight and `Start pack-out` are all
 * facts about Entries. The primary here is the **phase chip**, which is the
 * board's own rule — *tapping the phase chip opens SET PHASE* — and the one
 * control this slice owes.
 *
 * The gear-list region reads `0 GEAR LISTED.` and offers **nothing to add**.
 * Board copy, true today, and no meta-text about a future release: an
 * affordance that leads nowhere is worse than a missing one, and one leading
 * to a builder that does not exist would be worse still — it would lead
 * somewhere and lie about it.
 *
 * ## EDIT carries all three of story 5's facts
 *
 * *"and change that later"* is name, dates **and** Participants. The toggle is
 * the People screen's quiet mono `EDIT`, which is the Home picker's settled
 * vocabulary (`docs/design/README.md` §3c): a rename affordance on a resting
 * row is a wall of controls around a screen you mostly read.
 *
 * **Each edit emits its own op when it changes and nothing when it does not.**
 * Gear detail's Edit sheet is the precedent, and the reason bites harder here:
 * a needless write moves a stamp, and `phaseDay` reads the `phase` register's
 * stamp — so an app that wrote on every Save would teach a quartermaster that
 * saving is free while quietly adding ops to merge forever.
 *
 * **Two commit points, deliberately.** Name and dates are typed, so they wait
 * for `Save` — the shape People's rename row and gear detail's Edit sheet both
 * settled. A Participant is *picked*, and the pick is itself the decision, so
 * the picker emits immediately; unlike `/trips/new` there is a Trip to address.
 * `Cancel` therefore discards the two typed drafts and nothing else, which is
 * the honest thing for it to claim.
 *
 * There is **no `DELETE`**. `trip.deleted` belongs to the slice that builds
 * it (S14, with the template branch of F3); the absence is the design at this
 * slice rather than an omission, and the reducer already folds `deleted` so
 * nothing here has to change when it lands.
 */
export function Trip() {
  const params = useParams<{ id: string }>()
  const tripId = params.id
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)

  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [startDraft, setStartDraft] = useState('')
  const [endDraft, setEndDraft] = useState('')
  const [phaseOpen, setPhaseOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const trip: TripState | undefined =
    tripId === undefined ? undefined : state.trips[tripId]

  function openEdit(current: TripState) {
    // Seeded from the **registers**, not from `tripLabel`: an unnamed Trip
    // reads `—` there, and seeding a draft with that glyph would let a Save
    // write a literal em dash as somebody's Trip name. An empty field is what
    // the disabled Save then holds.
    setNameDraft(current.name?.value ?? '')
    // `''` for an absent date, which is exactly what the native control
    // produces for "not entered" — so an untouched field compares equal and
    // writes nothing, and a Trip that never had dates cannot acquire a pair of
    // clears by being opened in EDIT.
    setStartDraft(current.startDate?.value ?? '')
    setEndDraft(current.endDate?.value ?? '')
    setEditing(true)
  }

  function submitEdit(id: string, current: TripState) {
    const trimmedName = nameDraft.trim()
    if (trimmedName !== '' && trimmedName !== (current.name?.value ?? '')) {
      emit(tripRenamed(id, trimmedName))
    }

    // One key per date that actually moved. `null` clears a nullable register
    // and an **absent** field leaves it alone (`sync-protocol.md` §1.3), so
    // the date this edit says nothing about is not in the payload at all —
    // which is what stops one device's edit of the end date from reverting
    // another device's edit of the start.
    const currentStart = current.startDate?.value ?? ''
    const currentEnd = current.endDate?.value ?? ''
    const dates: { start?: string | null; end?: string | null } = {
      ...(startDraft === currentStart
        ? {}
        : { start: startDraft === '' ? null : startDraft }),
      ...(endDraft === currentEnd
        ? {}
        : { end: endDraft === '' ? null : endDraft }),
    }
    if (Object.keys(dates).length > 0) emit(tripDatesSet(id, dates))

    setEditing(false)
  }

  if (tripId === undefined || trip === undefined) {
    // A Trip the fold has never seen is a different fact from a Trip that
    // exists and carries nothing: `state.trips[id]` is `undefined` for the
    // first and an entity with no registers for the second, which draws as an
    // ordinary unnamed Trip. Gear detail's `No such gear.` is the register.
    return (
      <div className={styles['screen']}>
        <p className={styles['empty']}>No such trip.</p>
      </div>
    )
  }

  const label = tripLabel(trip)
  const dates = tripDateRange(trip)
  const participants = tripParticipants(state, trip)
  const next = phaseNext(trip)

  // The chip's two facts, each asked of the one function that answers it:
  // `phaseOf` resolves an absent register to `draft`, `isActive` is the only
  // definition of active-ness, and `phaseDay` counts local calendar days from
  // the `phase` register's own stamp. `DAY N` is drawn for **active** phases
  // only (spec §3.6) — a Draft has not started anything, and a closed Trip is
  // settled history.
  const day = isActive(trip) ? phaseDay(trip, Date.now()) : null
  const phase = phaseLabel(phaseOf(trip))
  const chip = day === null ? phase : `${phase} · DAY ${day}`

  const canSave = nameDraft.trim() !== ''

  return (
    <div className={styles['screen']}>
      <header className={styles['header']}>
        <Link href="/trips" className={styles['back']}>
          ‹ TRIPS
        </Link>
        <span className={styles['sync']}>
          <span className={styles['syncDot']} aria-hidden="true" />
          {syncLabel(sync)}
        </span>
      </header>

      <div className={styles['titleRow']}>
        {/* The heading keeps showing the **recorded** name while EDIT holds a
            draft below it, rather than being replaced by the field: what the
            ledger says is what is folded, and the field is a proposal until
            `Save` writes an op. It is also what keeps one `h1` on the screen
            through both modes. */}
        <h1 className={styles['title']}>{label}</h1>
        {!editing && (
          <button
            type="button"
            className={styles['modeToggle']}
            aria-pressed={editing}
            onClick={() => openEdit(trip)}
          >
            EDIT
          </button>
        )}
      </div>

      {/* The board's meta row: dates, then the Participants. It drops entirely
          for a Trip carrying neither — "dates are optional and a draft usually
          has none — the meta row simply drops". */}
      {(dates !== null || participants.length > 0) && (
        <div className={styles['meta']}>
          {dates !== null && (
            <span className={styles['dates']} data-testid="trip-dates">
              {dates}
            </span>
          )}
          {participants.length > 0 && (
            // One `role="img"` over the whole cluster, `TripCard`'s treatment
            // and `AccountAvatar`'s before it: the initials are a single piece
            // of information — who is on this Trip — and read out one letter
            // at a time they are as easily a stray alphabet as a roster.
            <span
              className={styles['circles']}
              role="img"
              aria-label={`Participants: ${participants
                .map((person) => person.label)
                .join(', ')}`}
            >
              {participants.map((person) => (
                <span
                  key={person.id}
                  className={styles['circle']}
                  aria-hidden="true"
                >
                  {/* A Person with no folded name draws an **empty** circle
                      rather than a placeholder letter — inventing one would be
                      a fact the app does not have. */}
                  {person.label === '—'
                    ? ''
                    : person.label.charAt(0).toUpperCase()}
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      <div className={styles['phaseRow']}>
        <button
          type="button"
          className={styles['chip']}
          data-testid="phase-chip"
          aria-haspopup="dialog"
          onClick={() => setPhaseOpen(true)}
        >
          {chip}
        </button>
        {next !== null && (
          // `null` twice over, drawing the same way: a closed Trip has nothing
          // next, and a phase this build has never heard of states no next
          // step because there is no row to state one. The chip still draws
          // the raw value; only this line goes away.
          <p className={styles['next']} data-testid="trip-next">
            {next}
          </p>
        )}
      </div>

      {editing && (
        <div className={styles['edit']}>
          <label className={styles['field']}>
            <span className={styles['label']}>Name</span>
            <input
              className={styles['input']}
              value={nameDraft}
              autoComplete="off"
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSave) {
                  event.preventDefault()
                  submitEdit(tripId, trip)
                }
              }}
            />
          </label>

          <div className={styles['dateFields']}>
            <label className={styles['field']}>
              <span className={styles['label']}>Start</span>
              <input
                type="date"
                className={styles['input']}
                value={startDraft}
                onChange={(event) => setStartDraft(event.target.value)}
              />
            </label>
            <label className={styles['field']}>
              <span className={styles['label']}>End</span>
              <input
                type="date"
                className={styles['input']}
                value={endDraft}
                onChange={(event) => setEndDraft(event.target.value)}
              />
            </label>
          </div>

          {/* Outside `Save`'s reach on purpose: a Participant tap is its own
              decision and its own op, so this row commits nothing and cancels
              nothing. */}
          <button
            type="button"
            className={styles['pickRow']}
            aria-label="Participants"
            onClick={() => setPickerOpen(true)}
          >
            <span className={styles['label']}>Participants</span>
            <span className={styles['pickValue']}>
              {participants.length === 0
                ? 'None'
                : participants.map((person) => person.label).join(', ')}{' '}
              <span aria-hidden="true">›</span>
            </span>
          </button>

          <div className={styles['editActions']}>
            <button
              type="button"
              className={styles['save']}
              // A blank name never overwrites one the Trip has. `trip.renamed`
              // *can* carry `null` — the reader accepts it, so a peer clearing
              // a name folds — but no screen authors that, and F3 requires a
              // name to create one at all.
              disabled={!canSave}
              onClick={() => submitEdit(tripId, trip)}
            >
              Save
            </button>
            <button
              type="button"
              className={styles['cancel']}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>

          {/* Said once, in EDIT mode, rather than left as an absence a reader
              has to notice — the People screen's "a Person is never removed"
              line, in the same slot and the same register. */}
          <p className={styles['hint']}>
            A PARTICIPANT IS PICKED, NOT SAVED — IT TAKES EFFECT AT ONCE.
          </p>
        </div>
      )}

      {/* The hole S7 fills. Board copy, and no add affordance: the builder is
          the destination that does not exist yet. */}
      <section className={styles['gear']} data-testid="gear-list">
        <p className={styles['gearEmpty']}>0 GEAR LISTED.</p>
      </section>

      {phaseOpen && (
        <PhaseSheet trip={trip} onClose={() => setPhaseOpen(false)} />
      )}

      {pickerOpen && (
        <ParticipantPicker
          selected={participants.map((person) => person.id)}
          // Emitted immediately, unlike `/trips/new`: there is a Trip to
          // address, and a removal is a write carrying a clock rather than an
          // absence, so a concurrent re-add on another device wins on its own
          // stamp (`sync-protocol.md` §3.4).
          onToggle={(personId, joins) =>
            emit(
              joins
                ? tripParticipantAdded(tripId, personId)
                : tripParticipantRemoved(tripId, personId),
            )
          }
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
