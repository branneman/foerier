import {
  tripDatesSet,
  tripLabel,
  tripParticipantAdded,
  tripParticipantRemoved,
  tripRenamed,
  type TripState,
} from '@foerier/shared'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'wouter'

import { ParticipantPicker } from '../components/ParticipantPicker'
import { PhaseSheet } from '../components/PhaseSheet'
import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
import { tripChip, tripDateRange, tripParticipants } from '../depot/trips'
import { DESKTOP, useMediaQuery } from '../shell/useMediaQuery'
import styles from './Trip.module.css'

/**
 * **The trip screen** — `Screens B` §02A's `Trip screen` frames, which are
 * §02's `Gear list builder` header minus everything that needs Entries, with
 * the two panes below left to the slice that has a gear list to put in them.
 * That is Find's `S8 · PIECES` pattern and the People screen's missing login
 * half: an element designed final that falls through to a simpler variant
 * until its slice lands.
 *
 * The title is **the Trip's name alone**: the builder's `— gear list` names a
 * list that does not exist, and its count, its weight and its `Start pack-out`
 * are all facts about Entries. The primary here is the **phase chip**, which
 * is the board's own rule — *tapping the phase chip opens SET PHASE*.
 *
 * The gear-list region reads `0 GEAR LISTED.`, then says where a gear list
 * comes from, and offers **nothing to add**. The second line is a permanent
 * domain fact rather than meta-text about a future release: it will read the
 * same the day the builder lands, and the empty state gains its add
 * affordances then. An affordance that leads nowhere is worse than a missing
 * one, and one leading to a builder that does not exist would be worse
 * still — it would lead somewhere and lie about it.
 *
 * ## There is no `NEXT` line here
 *
 * The trip card draws one and this screen does not, which is the board's
 * split and not an omission. `NEXT — PACK THE LIST` is a **list-scanning**
 * affordance: on `/trips` a reader is deciding which of several rows wants
 * them. Here the chip already states the phase and the empty region already
 * states the task, so the line would be a third sentence restating the second
 * on the one screen nobody is scanning.
 *
 * ## Participants live on the resting screen; EDIT covers name and dates
 *
 * **One commit model.** The screen used to have two — typed fields on
 * `Save`/`Cancel`, a Participant tap landing at once — and a disclosure line
 * apologising for the difference. The board deletes the second model rather
 * than the sentence: Participants become gear detail's tag chips, the circles
 * plus a dashed `+` ghost that is *the one edit affordance on a read
 * surface*. Writes land at once because a pick is itself the decision, and
 * removal never confirms — it is cheap and instantly reversible, the tag
 * picker's rule.
 *
 * What is left inside `EDIT` is the two typed registers, and `Save` and
 * `Cancel` now cover **everything** the form shows. `EDIT` is the People
 * screen's quiet mono control, which is the Home picker's settled vocabulary
 * (`docs/design/README.md` §3c): a rename affordance on a resting row is a
 * wall of controls around a screen you mostly read.
 *
 * **It is not, however, that screen's *toggle*, and the departure is
 * deliberate.** People's button persists and swaps `EDIT`/`DONE`, so it is a
 * pressed state and carries `aria-pressed`. This one has `Save` and `Cancel`
 * standing in for `DONE` — two exits with different meanings, which one
 * `DONE` cannot express — so the button *vanishes* while editing and is
 * therefore never in a pressed state. It carries no `aria-pressed`: a control
 * rendered only when off would hard-code `"false"` forever, which announces a
 * state that never changes. Because it unmounts, `Save` and `Cancel` return
 * focus to it by hand; People's persistent button never has to.
 *
 * **Each edit emits its own op when it changes and nothing when it does not.**
 * Gear detail's Edit sheet is the precedent, and the reason bites harder here:
 * a needless write moves a stamp, and `phaseDay` reads the `phase` register's
 * stamp — so an app that wrote on every Save would teach a quartermaster that
 * saving is free while quietly adding ops to merge forever.
 *
 * ## A date the control cannot draw is stated, never swallowed
 *
 * The registers hold whatever arrived — spec §1.4 gates no format — and a
 * `date` input renders anything but `YYYY-MM-DD` as **empty**. So EDIT would
 * otherwise show a cleared field over a value that is still there, and the
 * quartermaster's only reading of it would be that the date had been lost.
 * The note beside the field quotes what is stored and says what picking will
 * do to it. It is the attention class, and it is the glyph's own element
 * rather than the line's: a `▲` inheriting the muted meta around it is a `▲`
 * in name only.
 *
 * There is **no `DELETE`**. `trip.deleted` belongs to the slice that builds
 * it (S14, with the template branch of F3); the absence is the design at this
 * slice rather than an omission, and the reducer already folds `deleted` so
 * nothing here has to change when it lands.
 *
 * ## Two frames, and therefore two sets of elements
 *
 * §02A draws this screen twice, and the 1024 frame is **not** the 393 one
 * relaid. It is one header row — name, chip, dates, then the circles and the
 * ghost at the trailing edge, then `EDIT` — and it carries **no
 * `PARTICIPANTS` group label at all**, because a labelled block stacked under
 * a title is a phone's answer to narrow width and the row has no stack to
 * label.
 *
 * An element that exists in one mode and not the other is
 * [frontend-design §3.2](../../../docs/frontend-design.md)'s media query, the
 * same call `AppShell`, `DepotView`, `Depot`, `Account` and `Trips` already
 * make. CSS `order` over one DOM was the alternative and is the worse one
 * twice over: it would still have to render the label and hide it, putting a
 * word in the accessibility tree the 1024 board does not draw, and it moves
 * the *drawing* while leaving the tab order in the 393 sequence — `EDIT`
 * looking last and focusing third.
 *
 * The back link and the sync line go with the band that held them: at Desktop
 * the 216px sidebar is the navigation, `TRIPS` in it is the very destination
 * `‹ TRIPS` points at, and the sync line belongs there and nowhere else —
 * "never in the main column at desktop". `Account` withholds the same two, at
 * the same breakpoint, for the same reason.
 */
export function Trip() {
  const params = useParams<{ id: string }>()
  const tripId = params.id
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)
  const isDesktop = useMediaQuery(DESKTOP)

  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [startDraft, setStartDraft] = useState('')
  const [endDraft, setEndDraft] = useState('')
  const [phaseOpen, setPhaseOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // The `EDIT` button unmounts while editing, so leaving EDIT mode would drop
  // focus to `<body>` and strand a keyboard on the top of the document. The
  // flag is what keeps that to the two exits that *came from* here: a Trip
  // that merely re-renders — a pulled op moving its phase, say — must not
  // steal focus from wherever it actually is.
  const editButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)

  useEffect(() => {
    if (editing || !returnFocus.current) return
    returnFocus.current = false
    editButton.current?.focus()
  }, [editing])

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
    //
    // A register holding something the `date` control cannot show — spec §1.4
    // gates no format, so a peer's `'next summer'` folds and is stored — seeds
    // the draft with that string, which the input renders as empty while the
    // draft still holds it. Saving therefore compares equal and writes
    // nothing: the quartermaster's value survives untouched rather than being
    // silently cleared by a field that could not draw it. `StoredDateNote`
    // reads the same draft, which is what lets it quote the stored value and
    // stop quoting it the moment a pick replaces it.
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

    returnFocus.current = true
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

  // The trip card draws this same control, and the string has to read
  // identically on both surfaces — so it is composed once, in `tripChip`,
  // which is also where the `DAY N`-for-active-phases-only rule (spec §3.6)
  // is stated. Every question underneath it still goes to the one function in
  // `shared/` that answers it.
  const chip = tripChip(trip, Date.now())

  const canSave = nameDraft.trim() !== ''

  // The header's five pieces, built once and placed by whichever frame is
  // drawn. Each is the *same* element at both widths — same handler, same
  // accessible name — so the frames disagree about arrangement only, plus the
  // one element the 1024 row does not have: the `PARTICIPANTS` group label.

  // The heading keeps showing the **recorded** name while EDIT holds a draft
  // below it, rather than being replaced by the field: what the ledger says is
  // what is folded, and the field is a proposal until `Save` writes an op. It
  // is also what keeps one `h1` on the screen through both modes.
  const title = <h1 className={styles['title']}>{label}</h1>

  // No `aria-pressed`: this button is rendered only when EDIT is off, so the
  // attribute could never be anything but `"false"` — a state announced and
  // never changed. See the departure in the header.
  const modeToggle = editing ? null : (
    <button
      ref={editButton}
      type="button"
      className={styles['modeToggle']}
      onClick={() => openEdit(trip)}
    >
      EDIT
    </button>
  )

  const phaseChip = (
    <button
      type="button"
      className={styles['chip']}
      data-testid="phase-chip"
      aria-haspopup="dialog"
      onClick={() => setPhaseOpen(true)}
    >
      {chip}
    </button>
  )

  // The dates drop on their own — "dates are optional and a draft usually has
  // none, so the header simply drops them" — and the chip never does.
  const dateLine =
    dates === null ? null : (
      <span className={styles['dates']} data-testid="trip-dates">
        {dates}
      </span>
    )

  // Gear detail's tag chips, in Person circles: display, then the one dashed
  // ghost that edits. Drawn for every Trip, Participants or none — a gear with
  // no tags shows the lone ghost, and so does a Trip with nobody on it yet.
  const participantCluster = (
    <div className={styles['participantRow']}>
      {participants.length > 0 && (
        // One `role="img"` over the whole cluster, `TripCard`'s treatment and
        // `AccountAvatar`'s before it: the initials are a single piece of
        // information — who is on this Trip — and read out one letter at a
        // time they are as easily a stray alphabet as a roster. An empty
        // cluster is not drawn at all: a picture of nobody.
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
              {/* A Person with no folded name draws an **empty** circle rather
                  than a placeholder letter — inventing one would be a fact the
                  app does not have. */}
              {person.label === '—' ? '' : person.label.charAt(0).toUpperCase()}
            </span>
          ))}
        </span>
      )}
      {/* Named for the surface it opens rather than for the glyph, and named
          `Participants` rather than `Add participants` because the sheet
          removes as readily as it adds — gear detail's `+ tag` opens a picker
          that does both. */}
      <button
        type="button"
        className={styles['addParticipant']}
        aria-label="Participants"
        aria-haspopup="dialog"
        onClick={() => setPickerOpen(true)}
      >
        +
      </button>
    </div>
  )

  return (
    <div className={styles['screen']}>
      {/* The phone's own band. At Desktop the sidebar is the navigation and
          carries the sync line, so neither repeats here — `Account`'s rule at
          the same breakpoint. */}
      {!isDesktop && (
        <header className={styles['header']}>
          <Link href="/trips" className={styles['back']}>
            ‹ TRIPS
          </Link>
          <span className={styles['sync']}>
            <span className={styles['syncDot']} aria-hidden="true" />
            {syncLabel(sync)}
          </span>
        </header>
      )}

      {isDesktop ? (
        // One row, and `EDIT` genuinely last in the document rather than
        // last-looking: the tab order is the DOM order, which is the whole
        // reason this is a media query and not `order`.
        <div className={styles['deskHeader']}>
          {title}
          {phaseChip}
          {dateLine}
          {participantCluster}
          {modeToggle}
        </div>
      ) : (
        <>
          <div className={styles['titleRow']}>
            {title}
            {modeToggle}
          </div>

          {/* The board's chip line: the phase, then the dates beside it. */}
          <div className={styles['phaseRow']}>
            {phaseChip}
            {dateLine}
          </div>

          <div className={styles['participants']}>
            {/* `aria-hidden`, because the two elements under it already say
                it: the cluster is named `Participants: Els, Mies` and the
                ghost `Participants`, so an announced label would make one
                block three announcements. It is drawn because the board draws
                it — the stack needs a name that the 1024 row does not. */}
            <span className={styles['groupLabel']} aria-hidden="true">
              PARTICIPANTS
            </span>
            {participantCluster}
          </div>
        </>
      )}

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

          {/* The note is a **sibling** of the `<label>`, never inside it: a
              `<label>` wrapping its input contributes its whole text to that
              input's accessible name, so a note nested there would rename the
              field to `Start ▲ STORED AS "aug sometime" …`. It reaches the
              input through `aria-describedby` instead, which is what a
              description is. */}
          <div className={styles['dateFields']}>
            <div className={styles['dateField']}>
              <label className={styles['field']}>
                <span className={styles['label']}>Start</span>
                <input
                  type="date"
                  className={styles['input']}
                  value={startDraft}
                  aria-describedby={
                    undrawable(startDraft) ? 'trip-start-note' : undefined
                  }
                  onChange={(event) => setStartDraft(event.target.value)}
                />
              </label>
              <StoredDateNote id="trip-start-note" testId="start-note">
                {startDraft}
              </StoredDateNote>
            </div>
            <div className={styles['dateField']}>
              <label className={styles['field']}>
                <span className={styles['label']}>End</span>
                <input
                  type="date"
                  className={styles['input']}
                  value={endDraft}
                  aria-describedby={
                    undrawable(endDraft) ? 'trip-end-note' : undefined
                  }
                  onChange={(event) => setEndDraft(event.target.value)}
                />
              </label>
              <StoredDateNote id="trip-end-note" testId="end-note">
                {endDraft}
              </StoredDateNote>
            </div>
          </div>

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
              onClick={() => {
                returnFocus.current = true
                setEditing(false)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* The hole the builder fills. Board copy, and no add affordance: the
          destination does not exist yet. The second line is a domain fact and
          not a promise — it is where a gear list comes from, which will still
          be true when the builder lands and the add affordances arrive here. */}
      <section className={styles['gear']} data-testid="gear-list">
        <p className={styles['gearEmpty']}>0 GEAR LISTED.</p>
        <p className={styles['gearSource']}>
          The gear list is built from the depot.
        </p>
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

/**
 * `▲ STORED AS "aug sometime" — PICKING A DATE REPLACES IT`, or nothing at all
 * when the field draws what it holds.
 *
 * `value` is the **draft**, and while EDIT is untouched the draft *is* the
 * stored string — `openEdit` seeds it from the register verbatim, precisely so
 * that an untouched `Save` compares equal and writes nothing. So the sentence
 * quotes what the ledger holds, and it goes the moment a pick replaces it:
 * once the field draws a date it no longer looks cleared, and a sentence
 * explaining that it only looked cleared has nothing left to say.
 *
 * The `▲` is its own element so the attention class lands on the glyph rather
 * than on the whole line — the line is meta, the glyph is the warning, and a
 * `▲` inheriting the muted meta around it says nothing the text does not.
 */
function StoredDateNote({
  id,
  testId,
  children,
}: {
  id: string
  testId: string
  children: string
}) {
  if (!undrawable(children)) return null
  return (
    <p className={styles['storedNote']} id={id} data-testid={testId}>
      {/* Not `aria-hidden`: `GearRow` reads its `▲ ×1 TESSIN 2025` out whole,
          and a glyph the sighted half of the household sees is a glyph the
          rest hear. The element exists for the colour, not to hide anything. */}
      <span className={styles['attention']}>▲</span> STORED AS &quot;{children}
      &quot; — PICKING A DATE REPLACES IT
    </p>
  )
}

/**
 * Whether a `date` control would render `value` as **empty** — the one
 * question the note above turns on, and a different question from the one
 * `tripDateRange` asks. That one is formatting a stored string for display and
 * falls through to the raw value; this one is deciding whether a *control* can
 * show it at all, which is why it lives beside the control rather than in
 * `depot/trips.ts`.
 *
 * An empty draft is drawable: it is what "no date" looks like, and a Trip that
 * never had one must not be annotated.
 *
 * The calendar is checked and not only the shape, because `2026-02-30` has the
 * right spelling and is not a day — a `date` input renders it empty exactly as
 * it renders `aug sometime` empty, so the same silence needs the same
 * sentence. `Date.UTC` and not local midnight: these are calendar dates with
 * no clock attached, so the viewing device's zone must not change the answer.
 */
function undrawable(value: string): boolean {
  if (value === '') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return true
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  return (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  )
}
