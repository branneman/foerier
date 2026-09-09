import {
  listTotals,
  notesOf,
  sourceTrips,
  startTripFrom,
  systemIdSource,
  tripCreated,
  tripDatesSet,
  tripNameOrUnnamed,
  tripParticipantAdded,
  taskCounts,
  tripStandingOf,
  UNNAMED_PERSON_GLYPH,
  type HouseholdState,
  type TripState,
} from '@foerier/shared'
import { PersonCluster } from '@foerier/ui'
import { useState } from 'react'
import { useLocation, useSearch } from 'wouter'

import { ParticipantPicker } from '../components/ParticipantPicker'
import { SourcePicker } from '../components/SourcePicker'
import { useHousehold } from '../household/store'
import { peopleOn } from '../household/trips'
import { ScreenBand } from '../shell/ScreenBand'
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
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)
  const emitAll = useHousehold((depot) => depot.emitAll)
  const sync = useHousehold((depot) => depot.sync)
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

  // **`START FROM`, the first row** (rulings J7, J10, J13). The second door —
  // the trip screen's own footer control — arrives as `?from=<id>`, so the
  // choice is *seeded* from the search string and then owned here: a
  // Quartermaster who arrives pre-chosen can still clear it through the
  // picker's first row.
  //
  // A source that is not `live` is ignored rather than honoured. The id can
  // name a Trip this Device has never folded, or one deleted since the link
  // was drawn, and a create screen is the wrong place to explain either —
  // the row simply opens unchosen.
  const search = useSearch()
  const requested = new URLSearchParams(search).get('from')
  // **The request is derived on every render, never frozen at mount.** The
  // obvious shape — seeding a `useState` from the search string — pins the
  // answer to the fold as it stood on the *first* render, and on a cold start
  // that fold is empty: `store.load()` fills it asynchronously from IndexedDB
  // and `App` gates only on the auth flag, so a refresh or a PWA restore on
  // `/trips/new?from=<id>` would evaluate the standing against `emptyState()`,
  // read `unknown`, and pin the row to `None` for the life of the screen —
  // permanently, and indistinguishably from a stale link, while every other
  // value on this screen self-corrected on the next render.
  //
  // So state holds only the Quartermaster's own **override**: `undefined`
  // means untouched, and everything else is a choice they made, including the
  // `null` the picker's first row writes. That is what lets the clear survive
  // a re-render without the request re-applying itself underneath it.
  const [override, setOverride] = useState<string | null | undefined>(undefined)
  const [sourceOpen, setSourceOpen] = useState(false)

  // With nothing to offer, the row is not drawn at all (J13) — not disabled,
  // and not opening a picker holding only its own clear row: the withdrawal
  // rule, and the same answer §1 gives an empty gear list's `PACKING ›`.
  //
  // **`sourceTrips`, not `Object.keys(state.trips)`** — the same list the
  // picker itself draws, so the row and its contents can never disagree. The
  // raw map counts tombstones, so a household whose only Trip has been
  // deleted would draw a row opening on nothing, which is exactly the dead
  // affordance this condition exists to prevent.
  const anySource = sourceTrips(state).length > 0

  // **One predicate for the chosen source, the same one the seed and the trip
  // screen's provenance line use.** A raw `state.trips[id]` lookup would go on
  // resolving a Trip a peer deleted while this screen was open — and if it was
  // the household's only other Trip, `anySource` would drop the whole row at
  // the same moment, leaving the choice held invisibly and `submit()` still
  // taking the copy branch: a silent full copy of a deleted Trip, whose
  // `from_trip_id` then points at a tombstone and whose provenance line the
  // trip screen correctly withholds. Nothing on any screen would say where
  // the list came from.
  const sourceId = override === undefined ? requested : override
  const sourceTrip =
    sourceId !== null && tripStandingOf(state, sourceId) === 'live'
      ? state.trips[sourceId]
      : undefined

  // A media query, in JS, because the answer decides *behaviour* rather than
  // layout and no stylesheet can carry it (`useMediaQuery`'s own reason, one
  // step further along than a pane that exists or does not).
  const desk = useMediaQuery(DESKTOP)
  // `splitPane: false` — `/trips/new` has no two-pane view at any width, so at
  // Split the back link is the only route out of a half-typed Trip.
  const header = useScreenHeader({ splitPane: false, back: '/trips' })

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

    // **The copy is a batch of ordinary ops, materialised here** (sync §4.5).
    // `startTripFrom` authors the `trip.created` itself — carrying
    // `from_trip_id` — so the two branches are exclusive rather than one
    // adding to the other.
    //
    // Dates and Participants are authored by *this screen* in both branches:
    // the copy deliberately supplies neither (they start fresh), and a
    // Quartermaster may well pick both on the same sitting.
    if (sourceTrip !== undefined) {
      // The copy is one write: a Trip created with half its gear list is
      // a Trip nobody asked for, and the retry would create a second one.
      emitAll(startTripFrom(id, trimmedName, sourceTrip, state, systemIdSource))
    } else {
      emit(tripCreated(id, trimmedName))
    }

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
      <ScreenBand
        header={header}
        back={{ href: '/trips', label: 'TRIPS' }}
        sync={sync}
      />

      <h1 className={styles['title']}>New trip</h1>

      {/* **First, above `NAME`** — §5's ledger-line order gaining its one
          stated exception (J13). It is the row answered before the Trip is
          conceived, and it changes what every row below it means. **The
          order changes and the focus does not**: `autoFocus` stays on the
          name field, which is still the only required input.

          Add gear's `HOME` anatomy, because a value that is picked rather
          than typed reads the same way wherever it appears. */}
      {anySource && (
        <div className={styles['field']}>
          <span className={styles['label']} aria-hidden="true">
            Start from
          </span>
          <button
            type="button"
            className={styles['pickRow']}
            aria-label={`Start from: ${
              sourceTrip === undefined ? 'None' : tripNameOrUnnamed(sourceTrip)
            }`}
            onClick={() => setSourceOpen(true)}
          >
            <span
              className={
                sourceTrip === undefined
                  ? styles['pickNone']
                  : styles['pickChosen']
              }
            >
              {sourceTrip === undefined
                ? 'None'
                : tripNameOrUnnamed(sourceTrip)}
            </span>
            <span className={styles['chevron']} aria-hidden="true">
              ›
            </span>
          </button>

          {/* One line unchosen, two chosen — and the second is where
              `PARTICIPANTS` is disclosed **before the Trip exists** (J10,
              J17). Every per-person Entry lands on the copy inert, with no
              Pieces, because Participants do not come across; a fact belongs
              at the decision, not in an explainer after it. */}
          {sourceTrip === undefined ? (
            <span className={styles['fieldNote']} data-testid="start-from-note">
              A PAST TRIP&apos;S LIST, TASKS AND NOTES CAN COME ACROSS
            </span>
          ) : (
            <>
              <span
                className={styles['fieldNote']}
                data-testid="start-from-carries"
              >
                {carriesLine(sourceTrip, state)}
              </span>
              <span
                className={styles['fieldNote']}
                data-testid="start-from-fresh"
              >
                STARTS FRESH · PACKING · JOURNEYS · OUTCOMES · DATES ·
                PARTICIPANTS
              </span>
            </>
          )}
        </div>
      )}

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

      {sourceOpen && (
        <SourcePicker
          selected={sourceTrip?.id ?? null}
          // The picker is pure selection and the caller closes it — the Home
          // picker's rule, and why its first row is the clear rather than an
          // `✕` on the field.
          onSelect={(id) => {
            setOverride(id)
            setSourceOpen(false)
          }}
          onClose={() => setSourceOpen(false)}
        />
      )}

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

/**
 * `COMES ACROSS · 35 ENTRIES · BRING-COUNTS · 7 TASKS, UNTICKED · 4 NOTES` —
 * what the Quartermaster is agreeing to, stated before the Trip exists.
 *
 * Segments are absent at zero (G3), so a source with no notes does not
 * mention notes. `BRING-COUNTS` rides with `ENTRIES` and carries no number of
 * its own: it is a property of the lines above it rather than a count, and a
 * figure there would invite the reader to check it against a list they cannot
 * see. `TASKS, UNTICKED` states the one thing about the copy that differs
 * from the source in kind rather than in quantity.
 *
 * `NOTES` counts what will actually travel — kept **and** unreviewed, never
 * discarded (I13, I16) — rather than `noteCounts(...).total`, which counts
 * discarded ones too because a discarded Note never vanishes from its own
 * Trip. This is the one place in the app where those two numbers differ, and
 * this line has to be the copy's.
 */
function carriesLine(trip: TripState, state: HouseholdState): string {
  const list = listTotals(trip, state)
  const tasks = taskCounts(trip)
  const copiedNotes = notesOf(trip).filter((note) => note.kept !== false).length

  const segments = ['COMES ACROSS']
  if (list.entries > 0) {
    segments.push(`${list.entries} ENTRIES`, 'BRING-COUNTS')
  }
  if (tasks.total > 0) segments.push(`${tasks.total} TASKS, UNTICKED`)
  if (copiedNotes > 0) segments.push(`${copiedNotes} NOTES`)
  return segments.join(' · ')
}
