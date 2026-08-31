import {
  systemIdSource,
  tripCreated,
  tripDatesSet,
  tripParticipantAdded,
  UNNAMED_PERSON_GLYPH,
} from '@foerier/shared'
import { PersonCluster } from '@foerier/ui'
import { useState } from 'react'
import { Link, useLocation } from 'wouter'

import { ParticipantPicker } from '../components/ParticipantPicker'
import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
import { peopleOn } from '../depot/trips'
import { DESKTOP, useMediaQuery, useScreenHeader } from '../shell/useMediaQuery'
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
 * **`DATES · OPTIONAL`** · **`PARTICIPANTS`** — and the primary sits at the
 * bottom, in the thumb zone, exactly as `AddGear` puts `Add gear` there. Name
 * is the only required input, said twice: the CTA is gated on it and the
 * footnote under the CTA states it.
 *
 * Participants is Add gear's bordered `HOME`/`OWNER` row, drawing the chosen
 * People as the trip card's circles — and deliberately **not** the trip
 * screen's dashed `+` ghost, which is that screen's one edit affordance on a
 * read surface. Each control matches its host: this screen is a form.
 *
 * ## Return creates at desk widths only
 *
 * Add gear's return key records unconditionally, and this screen's does not.
 * The difference is the batch: Add gear is a sitting of many records, where
 * type → return → type is the loop and reaching for the CTA every time is the
 * cost. A Trip is created once, and on a phone the OS keyboard is over the
 * screen with its own return key — which belongs to the field it is attached
 * to. At a desk there is no soft keyboard to take it from, and the hands are
 * already on the keys.
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
 * Like Add gear: local ops on a local log, and the sync marker is the only
 * thing that ever has anything to report — from this screen's own header
 * below Split, and from the shell's nav above it.
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

  // A media query, in JS, because the answer decides *behaviour* rather than
  // layout and no stylesheet can carry it (`useMediaQuery`'s own reason, one
  // step further along than a pane that exists or does not).
  const desk = useMediaQuery(DESKTOP)
  // `splitPane: false` — `/trips/new` has no two-pane view at any width, so at
  // Split the back link is the only route out of a half-typed Trip.
  const header = useScreenHeader({ splitPane: false })

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
  // picker's own `+ NEW PERSON` authors through `emit`, which folds on the
  // store's queue, so a Person recorded mid-flow is in this selection a tick
  // before `sortedPeople` has heard of them.
  const chosen = peopleOn(state, participants)
  // The circles are one letter each, so the roster lives in the row's
  // accessible name: initials read out one at a time are as easily a stray
  // alphabet as a list of People (`TripCard`'s argument, one screen along).
  // `None` is in it too — a Trip with nobody on it is a state the ledger
  // states rather than leaves blank.
  const roster =
    chosen.length === 0
      ? 'None'
      : chosen.map((person) => person.label).join(', ')

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
      {/* Below Desktop the only other way out of a half-typed Trip is the tab
          bar or the rail, neither of which names `TRIPS`, so the back link is
          what this band is for. At Desktop the 216px sidebar is labeled
          navigation and its `TRIPS` row is where `‹ TRIPS` points, so the link
          goes — the `Gear list builder` artboard that draws `‹ TRIPS` is a
          bare pane with no sidebar. The sync line is drawn at **Split alone**,
          the one mode where `AppShell`'s marker is a bare rail dot with no
          words. `useScreenHeader` decides both. */}
      {header.band && (
        <header className={styles['header']}>
          {header.backLink && (
            <Link href="/trips" className={styles['back']}>
              ‹ TRIPS
            </Link>
          )}
          {header.syncLine && (
            <span className={styles['sync']}>
              <span className={styles['syncDot']} aria-hidden="true" />
              {syncLabel(sync)}
            </span>
          )}
        </header>
      )}

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
            // Return creates at a desk, where there is no soft keyboard for
            // it to belong to. On a phone it stays the field's own key: this
            // screen is reached once per Trip, and the CTA is in the thumb
            // zone rather than behind a keyboard that has to be dismissed.
            if (event.key === 'Enter' && desk) {
              event.preventDefault()
              submit()
            }
          }}
        />
      </label>

      {/* A group, so `OPTIONAL` is stated once over both ends rather than
          twice, and so the two fields read as the one fact they are. The
          `legend` is the same mono eyebrow every other label on this screen
          uses; `fieldset`/`legend` is Add gear's own idiom for a labelled
          group of controls. */}
      <fieldset className={styles['dates']}>
        <legend className={styles['label']}>Dates · optional</legend>
        <div className={styles['dateFields']}>
          <label className={styles['field']}>
            <span className={styles['label']}>Start</span>
            {/* Native `date`, not a hand-built picker: the value it produces
                is the `YYYY-MM-DD` the registers hold by convention (spec
                §1.4), and the platform control is the one every device
                already knows how to drive with a keyboard. */}
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
      </fieldset>

      {/* The same 48px bordered row Add gear gives HOME and OWNER — a value
          that is picked rather than typed reads the same way wherever it
          appears — with the label above it, as this screen's other two
          controls carry theirs. */}
      <div className={styles['field']}>
        {/* Drawn, because the board draws it — and `aria-hidden`, because the
            button below already carries `Participants: …` as its accessible
            name, so without this a reader hears "Participants", then
            "Participants: Els, Mies, button". A plain `<span>`, unlike the
            `<label>`s above it, names nothing; removing it from the
            accessibility tree costs the control no name at all. `Trip.tsx`
            hides the same word for the same reason, and `AddGear` avoids it by
            putting the label inside the button. */}
        <span className={styles['label']} aria-hidden="true">
          Participants
        </span>
        <button
          type="button"
          className={styles['pickRow']}
          aria-label={`Participants: ${roster}`}
          onClick={() => setPickerOpen(true)}
        >
          {chosen.length === 0 ? (
            <span className={styles['pickValue']}>None</span>
          ) : (
            // `aria-hidden`, not a suppressible prop on `PersonCluster`: the
            // button above already carries `Participants: …` as its own
            // accessible name, so an unhidden `role="img"` nested inside it
            // would announce the identical roster a second time — the same
            // failure the `Participants` label span avoids two elements up.
            // An `aria-hidden` ancestor drops the whole subtree from the
            // accessibility tree regardless of what role a descendant
            // claims, so `PersonCluster`'s own `role="img"` is suppressed
            // without this component needing to know it is nested here.
            // `display: contents` (below) is what keeps that wrapper from
            // costing a box: it generates none, so `PersonCluster`'s root
            // participates directly in `.pickRow`'s flex row exactly as a
            // bare `.circles` span used to — the layout-shift failure a
            // plain wrapper `<span>` would reintroduce (`PersonCircle`'s own
            // docstring; Task 5 review), sidestepped rather than repeated.
            <span className={styles['circles']} aria-hidden="true">
              <PersonCluster
                people={chosen.map((person) => ({
                  key: person.id,
                  label:
                    person.label === UNNAMED_PERSON_GLYPH
                      ? undefined
                      : person.label.charAt(0).toUpperCase(),
                }))}
                size={22}
                label={`Participants: ${roster}`}
              />
            </span>
          )}
          <span className={styles['chevron']} aria-hidden="true">
            ›
          </span>
        </button>
      </div>

      <button
        type="button"
        className={styles['primary']}
        disabled={!canSubmit}
        onClick={submit}
      >
        Create trip
      </button>

      {/* The board's footnote, and the only thing on screen that says what
          the disabled CTA is waiting for: the label never changes, so the
          button cannot explain itself. Add gear's `RECORDED ON THIS DEVICE ·
          SYNCS IN THE BACKGROUND` is the same slot spent on the other fact
          this screen has to state, and this one is the scarcer.

          Centred, because it follows its CTA block and that block is
          full-width and pinned (boards' README §5). Two classes: the mono
          treatment, and the alignment. */}
      <p className={`${styles['fact']} ${styles['ctaFact']}`}>
        NAME IS THE ONLY REQUIRED INPUT
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
