import {
  listTotals,
  overClaimsFor,
  tripDatesSet,
  tripEntryBringCountSet,
  tripEntryRemoved,
  tripLabel,
  tripParticipantAdded,
  tripParticipantRemoved,
  tripRenamed,
  UNNAMED_PERSON_GLYPH,
  type TripState,
} from '@foerier/shared'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'wouter'

import {
  entryCountLabel,
  GearListSection,
  pieceLabel,
} from '../components/GearListSection'
import { OverClaimBand } from '../components/OverClaimBand'
import { ParticipantPicker } from '../components/ParticipantPicker'
import { PhaseSheet } from '../components/PhaseSheet'
import { RemoveElsewhereConfirm } from '../components/RemoveElsewhereConfirm'
import { TripOnlySheet } from '../components/TripOnlySheet'
import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
import {
  parseIsoDate,
  tripChip,
  tripDateRange,
  tripParticipants,
} from '../depot/trips'
import {
  DESKTOP,
  SPLIT,
  useMediaQuery,
  useScreenHeader,
} from '../shell/useMediaQuery'
import styles from './Trip.module.css'

/**
 * **The trip screen** — `Screens B` §02A's `Trip screen` frames, extended at
 * S7 to fill the hole S6 left in the region below them: the gear list itself
 * (spec `docs/specs/2026-08-29-the-gear-list.md` §4.2). Below Split this
 * screen *is* the builder — inline steppers, `✕`, the dashed trip-only row,
 * the pinned `+ Add from the depot` primary. From Split up it **reads**
 * only, and the `GEAR LIST` section band's trailing `EDIT LIST ›` is where
 * editing moves to — the builder is its own route, `/trips/:id/list`, not a
 * second pane grafted onto this screen.
 *
 * The title is **the Trip's name alone**: the builder's `— gear list` names a
 * list that does not exist, and its count, its weight and its `Start pack-out`
 * are all facts about Entries. The primary here is the **phase chip**, which
 * is the board's own rule — *tapping the phase chip opens SET PHASE*.
 *
 * The gear-list region reads `0 ENTRIES.` when the Trip has none, then says
 * where a gear list comes from — a permanent domain fact rather than
 * meta-text about a future release, true before this slice and after it —
 * with the add affordances beneath it below Split exactly as they sit
 * beneath a non-empty list. Once the Trip holds at least one Entry, the
 * `GEAR LIST` section band and `GearListSection`'s groups take the region
 * instead.
 *
 * **The dashed trip-only row opens `TripOnlySheet` (Task 12).** The pinned
 * primary and `EDIT LIST ›` were wired one task earlier: `/trips/:id/add`
 * (Task 10) and `/trips/:id/list` (Task 11) are real `<Link>`s, and the
 * over-claim band's `REMOVE ON <trip>` now opens `RemoveElsewhereConfirm`
 * (Task 12) rather than doing nothing — the last two documented no-ops this
 * slice's screens carried.
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
 * The back link and the sync line go with the band that held them — but on
 * different questions, which is `useScreenHeader`'s whole reason for existing.
 * `‹ TRIPS` survives to Split, because the 56px rail there draws no labels and
 * a Trip is nobody's pane, so nothing else on the page names where the reader
 * came from; it goes at Desktop, where the 216px sidebar's `TRIPS` row *is* the
 * destination it points at. The sync line is drawn at **Split alone**:
 * `AppShell` states the status in words in the phone header and in the sidebar,
 * and on the rail it draws a bare dot whose words are only an `aria-label`.
 * Every other screen `useScreenHeader` reaches reads the same rule off the
 * same hook (`frontend-design.md` §3.3).
 */
export function Trip() {
  const params = useParams<{ id: string }>()
  const tripId = params.id
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)
  const isDesktop = useMediaQuery(DESKTOP)
  const isSplitOrWider = useMediaQuery(SPLIT)
  // `splitPane: false` because the trip screen is not a pane of a list that
  // is also on screen — a Trip is nobody's pane, so at Split this screen
  // stands alone. The builder Task 11 adds (`/trips/:id/list`) is its own
  // route, not a second pane grafted onto this one.
  const header = useScreenHeader({ splitPane: false })
  // Below Split this screen edits; from Split up it reads (spec §4.2).
  const editable = !isSplitOrWider

  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [startDraft, setStartDraft] = useState('')
  const [endDraft, setEndDraft] = useState('')
  const [phaseOpen, setPhaseOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tripOnlyOpen, setTripOnlyOpen] = useState(false)
  // The pending cross-Trip removal, or `null` when nothing is — mount is the
  // reset, same as every other `ui/`-backed sheet on this screen, so a
  // declined removal cannot come back attached to the next row tapped.
  const [removingElsewhere, setRemovingElsewhere] = useState<{
    otherTripId: string
    entryId: string
  } | null>(null)

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

  // The four numbers behind the `GEAR LIST` band's `N ENTRIES · N PIECES`
  // (spec §4.2) and the over-claims that name this Trip (spec §3.5) — both
  // pure folds of registers, recomputed on every render like `chip` above.
  const totals = listTotals(trip, state)
  const overClaims = overClaimsFor(state, tripId)

  function handleBringCountChange(entryId: string, next: number) {
    emit(tripEntryBringCountSet(tripId, entryId, next))
  }

  // The tag-chip rule, restated for this list: one op, the gear untouched,
  // re-adding two taps. Never confirms — `RemoveElsewhereConfirm` (Task 12)
  // is a different control for a different write, below.
  function handleRemoveEntry(entryId: string) {
    emit(tripEntryRemoved(tripId, entryId))
  }

  // `OverClaimBand`'s `REMOVE HERE` and `BRING FEWER` settle routes both
  // write against **this** Trip's own aggregate, so — like the list's own
  // `✕` above — neither confirms.
  function handleRemoveHere(entryId: string) {
    emit(tripEntryRemoved(tripId, entryId))
  }

  function handleBringFewer(entryId: string, count: number) {
    emit(tripEntryBringCountSet(tripId, entryId, count))
  }

  // `REMOVE ON <trip>` writes against a Trip this screen is not showing —
  // the first write any surface here makes against another aggregate, and
  // its undo is a navigation away. Spec §4.7 puts a confirm
  // (`RemoveElsewhereConfirm`) between the click and the op landing; the
  // confirm owns the actual `tripEntryRemoved` emit once the Quartermaster
  // decides, so this handler only opens it.
  function handleRemoveThere(otherTripId: string, entryId: string) {
    setRemovingElsewhere({ otherTripId, entryId })
  }

  // The dashed row opens `TripOnlySheet`, which owns its own
  // `trip.entry_added` emit.
  function handleAddTripOnly() {
    setTripOnlyOpen(true)
  }

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
        {dates.range}
        {dates.span !== null && ` · ${dates.span}`}
        {dates.warning !== null && (
          <>
            {' · '}
            {/* The glyph in its own element, as `StoredDateNote` draws it one
                block down: the range beside it is muted meta and only the mark
                is the warning. Handed one string these would be one text node
                and the attention class could only take the whole line. */}
            <span className={styles['attention']}>▲</span> {dates.warning}
          </>
        )}
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
              {person.label === UNNAMED_PERSON_GLYPH
                ? ''
                : person.label.charAt(0).toUpperCase()}
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
      {/* Both halves of `useScreenHeader`'s rule (`frontend-design.md` §3.3):
          `‹ TRIPS` goes at Desktop, where the sidebar's own `TRIPS` row is
          what it points at, and the sync line is drawn at **Split alone**,
          where `AppShell` puts only a bare dot in the rail. */}
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

      {/* Never dismissible: rendering nothing is the only way it goes away,
          which is `OverClaimBand`'s own contract — it returns `null` when
          `overClaimsFor` finds nothing to say. Sits between the header and
          the `GEAR LIST` band at every width (spec §4.5). */}
      <OverClaimBand
        tripId={tripId}
        overClaims={overClaims}
        settle={{
          onRemoveHere: handleRemoveHere,
          onRemoveThere: handleRemoveThere,
          onBringFewer: handleBringFewer,
        }}
      />

      {totals.entries === 0 ? (
        // The noun ruling's empty state: the second line is a domain fact
        // and not a promise — it is where a gear list comes from, true
        // before this slice and after it. Below Split the add affordances
        // still follow it, as the S6 board promised.
        <section className={styles['gear']} data-testid="gear-list">
          <p className={styles['gearEmpty']}>0 ENTRIES.</p>
          <p className={styles['gearSource']}>
            The gear list is built from the depot.
          </p>
        </section>
      ) : (
        <div
          className={styles['gearList']}
          data-testid="gear-list"
          // `GearListSection`'s own groups each carry `role="group"` +
          // `aria-labelledby` (Task 8's review round) — without this, a
          // screen-reader user hears four named groups with no named parent,
          // the accessibility half of "reads as their parent" spec §4.2
          // asks for visually.
          role="group"
          aria-labelledby="gear-list-label"
        >
          {/* `GEAR LIST` left, the count and (from Split up) `EDIT LIST ›`
              wrapped together on the right — `justify-content: space-between`
              between the two groups, exactly `GearListSection`'s own group
              bands (`GearListSection.module.css`'s `.groupHeader`), so this
              one reads as their parent rather than the one row on the screen
              that doesn't line up with them. */}
          <div className={styles['gearListBand']} data-testid="gear-list-band">
            <span id="gear-list-label" className={styles['gearListLabel']}>
              GEAR LIST
            </span>
            <span className={styles['gearListTrailing']}>
              <span
                className={styles['gearListCount']}
                data-testid="gear-list-count"
              >
                {entryCountLabel(totals.entries)} · {pieceLabel(totals.pieces)}
              </span>
              {!editable && (
                // A real `<Link>` now that `/trips/:id/list` (Task 11)
                // exists — carries no door param, so the builder's own
                // default (the "trip" door) applies, giving `‹ {label}`
                // back rather than `‹ TRIPS`.
                <Link
                  href={`/trips/${tripId}/list`}
                  className={styles['editList']}
                >
                  EDIT LIST ›
                </Link>
              )}
            </span>
          </div>
          <GearListSection
            trip={trip}
            editable={editable}
            onBringCountChange={handleBringCountChange}
            onRemove={handleRemoveEntry}
          />
        </div>
      )}

      {/* Below Split only: the one add affordance a trip-only Entry needs
          (dashed, per Add gear's own rule for an irreversible decision), then
          a flex spacer and the pinned full-width primary — a flex child,
          never a fixed FAB (spec §4.2; the S3 Depot FAB `container-type`
          trap this sidesteps). */}
      {editable && (
        <>
          <button
            type="button"
            className={styles['tripOnlyRow']}
            onClick={handleAddTripOnly}
          >
            + TRIP-ONLY ENTRY — NOT KEPT IN THE DEPOT, CLEARED AT CLOSE
          </button>
          <div className={styles['spacer']} aria-hidden="true" />
          {/* `/trips/:id/add`, Task 10's route — a real `<Link>` now that it
              exists, following `Depot.tsx`'s own FAB precedent for a
              button-styled anchor. */}
          <Link href={`/trips/${tripId}/add`} className={styles['addPrimary']}>
            + Add from the depot
          </Link>
        </>
      )}

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

      {tripOnlyOpen && (
        <TripOnlySheet tripId={tripId} onClose={() => setTripOnlyOpen(false)} />
      )}

      {removingElsewhere !== null && (
        <RemoveElsewhereConfirm
          otherTripId={removingElsewhere.otherTripId}
          entryId={removingElsewhere.entryId}
          onClose={() => setRemovingElsewhere(null)}
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
 * show it at all, which is why the question lives beside the control.
 *
 * The **calendar** underneath the question does not: it is `parseIsoDate`'s,
 * the one in `depot/trips.ts`, because two independent validators can drift —
 * one would start accepting a spelling the other rejects, and the same stored
 * string would then be drawn as a date by the header and annotated as
 * unreadable by this note, on one screen. `2026-02-30` is why the calendar has
 * to be checked at all and not only the shape: it is spelled right, is not a
 * day, and a `date` input renders it empty exactly as it renders
 * `aug sometime` empty.
 *
 * An empty draft is drawable: it is what "no date" looks like, and a Trip that
 * never had one must not be annotated.
 */
function undrawable(value: string): boolean {
  return value !== '' && parseIsoDate(value) === null
}
