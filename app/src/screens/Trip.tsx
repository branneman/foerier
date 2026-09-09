import {
  listTotals,
  overClaimsFor,
  systemIdSource,
  taskCounts,
  tasksOf,
  tripDatesSet,
  tripDeleted,
  tripEntryBringCountSet,
  tripEntryRemoved,
  tripLabel,
  tripNameOrUnnamed,
  tripParticipantAdded,
  tripParticipantRemoved,
  tripPieceRemoved,
  tripRenamed,
  tripStandingOf,
  tripTaskAdded,
  tripTaskTicked,
  UNNAMED_PERSON_GLYPH,
  type TripState,
} from '@foerier/shared'
import { Band, PersonCluster } from '@foerier/ui'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'wouter'

import {
  entryCountLabel,
  GearListSection,
  pieceLabel,
} from '../components/GearListSection'
import { DeleteTripConfirm } from '../components/DeleteTripConfirm'
import { NotesPanel } from '../components/NotesPanel'
import { OverClaimBand } from '../components/OverClaimBand'
import { ParticipantPicker } from '../components/ParticipantPicker'
import { PhaseSheet } from '../components/PhaseSheet'
import { RemoveElsewhereConfirm } from '../components/RemoveElsewhereConfirm'
import { TasksPanel } from '../components/TasksPanel'
import { TripOnlySheet } from '../components/TripOnlySheet'
import { TripPanels } from '../components/TripPanels'
import { useHousehold } from '../household/store'
import {
  parseIsoDate,
  tripChip,
  tripDateRange,
  tripParticipants,
} from '../household/trips'
import { ScreenBand } from '../shell/ScreenBand'
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
 * **The empty region carries `EDIT LIST ›` from Split up, and that closes a
 * dead end.** `+ Add from the depot` is gated on `editable`, which is
 * `!isSplitOrWider`, so it belongs to the phone; `EDIT LIST ›` lived inside
 * the `GEAR LIST` band, which renders only once the Trip *has* Entries —
 * between them the **first** Entry was unreachable at these widths except by
 * typing the route. The region now draws the band's own door: same route,
 * same copy, same `!editable` gate, placed where the phone's add affordances
 * sit, after the region's two lines.
 *
 * It is deliberately **not** the sibling case below, which stands: an empty
 * list still hides `PACKING ›`, because a route to a screen that can only
 * say `0 ENTRIES.` back is a dead affordance, while an empty gear list is
 * the one state in which the *builder* is most wanted. Two doors, opposite
 * answers, one reason each. Placement is a code-authored call — no board
 * draws this region with a control at these widths — and is carried into
 * `docs/design/README.md` §5 so the next round meets it where it looks.
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
 * ## `PACKING ›` and `UNPACK ›` are the band's second and third doors, and
 * neither is width-gated or phase-gated
 *
 * Ruling A11's second entry point to F4 sits in the `GEAR LIST` band's
 * trailing slot **at every width and at every phase, Draft included** — a
 * phase locks nothing, and hiding a route is a soft lock the phase model
 * does not have. `UNPACK ›` (F14, S10) sits beside it on the identical
 * terms: same width rule, same phase rule, and **no swap between the two**
 * by phase — a Draft that has never been anywhere still gets both doors,
 * because whether a route is useful today is not this band's question to
 * answer on the model's behalf. Note the asymmetry with `EDIT LIST ›`
 * beside them, which is *withheld* below Split because this screen is
 * itself the editor there: `/trips/:id/packing` and `/trips/:id/unpack` are
 * both their own routes at every width rather than panes, so nothing about
 * either link turns on the breakpoint.
 *
 * **A Trip with an empty gear list therefore has no drawn door to F4 or
 * F5**, and that is the answer rather than a gap: the band renders only in
 * the non-empty branch, and the `0 ENTRIES.` region that replaces it would
 * otherwise carry a route to a screen that can only say `0 ENTRIES.` back —
 * the dead affordance that region's own rule forbids. Both screens' empty
 * states still exist, for the reader already standing there when another
 * Device removes the last Entry and for a direct link. The consequence is
 * **recorded and flagged for the next design round**, spec §4.9, in case the
 * boards want a door there anyway; it is not papered over here.
 *
 * **At Compact the trailing slot wraps its two routes to a second,
 * right-aligned line** (F14) — `PACKING ›` and `UNPACK ›` are grouped in
 * their own wrapper (`.gearListRoutes`) precisely so `flex-wrap` moves them
 * together rather than splitting the pair mid-band, and the count stays on
 * the label's own line. This is organic reflow, not a named breakpoint: the
 * pair wraps whenever the band's own available width will not hold it,
 * which is the Compact tier for the copy this band actually draws. See
 * `Trip.module.css`'s `.gearListTrailing`.
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
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)
  const sync = useHousehold((depot) => depot.sync)
  const isDesktop = useMediaQuery(DESKTOP)
  const isSplitOrWider = useMediaQuery(SPLIT)
  // `splitPane: false` because the trip screen is not a pane of a list that
  // is also on screen — a Trip is nobody's pane, so at Split this screen
  // stands alone. The builder Task 11 adds (`/trips/:id/list`) is its own
  // route, not a second pane grafted onto this one.
  const header = useScreenHeader({ splitPane: false, back: '/trips' })
  // Below Split this screen edits; from Split up it reads (spec §4.2).
  const editable = !isSplitOrWider

  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [startDraft, setStartDraft] = useState('')
  const [endDraft, setEndDraft] = useState('')
  const [phaseOpen, setPhaseOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tripOnlyOpen, setTripOnlyOpen] = useState(false)
  const [, navigate] = useLocation()
  // The delete confirm, mounted only while it is open — `ui/`'s primitives
  // have no `open` prop, and mount is what resets a sheet's own state.
  const [deleting, setDeleting] = useState(false)
  // The pending cross-Trip removal, or `null` when nothing is — mount is the
  // reset, same as every other `ui/`-backed sheet on this screen, so a
  // declined removal cannot come back attached to the next row tapped.
  // `personId` is present only for ruling F's `REMOVE <name>'S PIECE ON
  // <trip>` route — `RemoveElsewhereConfirm`'s Piece variant (ruling G).
  const [removingElsewhere, setRemovingElsewhere] = useState<{
    otherTripId: string
    entryId: string
    personId?: string
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

  // **Three standings, two of which draw no Trip** (ruling J5). The fold
  // tells them apart and `tripStandingOf` is the only place that asks, so a
  // deleted Trip cannot be mistaken here for a live one — which it was until
  // S14, because `trip.deleted` writes a register on an entity the fold
  // *keeps* and the guard here tested only `undefined`.
  //
  // A Trip that exists and carries nothing is a third, *live* case and is
  // emphatically not either of these: it draws as an ordinary unnamed Trip.
  const standing =
    tripId === undefined ? 'unknown' : tripStandingOf(state, tripId)
  if (standing !== 'live' || trip === undefined) {
    return (
      <TripNotHere standing={standing === 'deleted' ? 'deleted' : 'unknown'} />
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

  // S13's two reads, pure folds like the four above. `tasksOf`'s order is a
  // convergence property (`selectors/task.ts`) and this screen never sorts
  // it — a second opinion here is how two Devices start drawing different
  // checklists.
  const tasks = tasksOf(trip)
  const tasksCount = taskCounts(trip)

  // Ruling I21's batch loop. The id is minted here, at the call site, as
  // every creation's is (`patterns.md` §2.1); the panel has already trimmed
  // and refused a blank line, so no op ever carries one.
  function handleAddTask(text: string) {
    emit(tripTaskAdded(tripId, systemIdSource.next(), text))
  }

  // One op per tap, both directions (I22). No needless-write guard, unlike
  // `PhaseSheet`'s and `JourneyRail`'s: the row's only gesture flips the
  // value, so an op equal to the current one is unreachable
  // (`patterns.md` §2.3).
  function handleToggleTask(taskId: string, ticked: boolean) {
    emit(tripTaskTicked(tripId, taskId, ticked))
  }

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

  // Ruling F's per-person routes. `onRemovePieceHere` mirrors
  // `handleRemoveHere`'s reasoning exactly — this Trip's own aggregate,
  // never confirms — and `onRemovePieceThere` mirrors `handleRemoveThere`'s:
  // a write against a Trip this screen is not showing goes through the same
  // confirm, now carrying `personId` so `RemoveElsewhereConfirm` renders its
  // Piece variant (ruling G) instead of the Entry one.
  function handleRemovePieceHere(entryId: string, personId: string) {
    emit(tripPieceRemoved(tripId, entryId, personId))
  }

  function handleRemovePieceThere(
    otherTripId: string,
    entryId: string,
    personId: string,
  ) {
    setRemovingElsewhere({ otherTripId, entryId, personId })
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

  // **`STARTED FROM VOSGES 2025`** — `from_trip_id`'s one reader (J18), and
  // the first thing to read it since S6 folded it.
  //
  // **A property of the Trip, not of the gear list** (J20), so it sits in the
  // header block where the Trip's other facts are and *not* in the builder's
  // right pane. §5b H — the over-claim band as a property of the list rather
  // than of a route — is deliberately not extended by analogy: a claim is a
  // fact about listed gear, and a Trip's origin is not. The copy brought
  // tasks and notes across as well as Entries, so a band above the gear list
  // would file the fact at one register of three.
  //
  // **Withdrawn rather than falsified** (J19). The line *is* the claim that
  // the source can be named, so when `tripStandingOf` says it cannot — the
  // source deleted, or its ops not folded on this Device — the whole line
  // goes, never `STARTED FROM —`. S5's login ring, one surface over. A
  // source that folded *without a name* is a different case and keeps the
  // line: `tripNameOrUnnamed` puts the prose sentinel in a name slot (§5c),
  // where `tripLabel`'s `—` would be wrong.
  //
  // Not dismissible and not a route: it is a fact, and the over-claim band
  // already names another Trip without becoming a link.
  const sourceId = trip.fromTripId?.value
  const sourceTrip =
    sourceId !== undefined && tripStandingOf(state, sourceId) === 'live'
      ? state.trips[sourceId]
      : undefined
  const provenance =
    sourceTrip === undefined ? null : (
      <span className={styles['provenance']} data-testid="trip-provenance">
        {`STARTED FROM ${tripNameOrUnnamed(sourceTrip)}`}
      </span>
    )

  // Gear detail's tag chips, in Person circles: display, then the one dashed
  // ghost that edits. Drawn for every Trip, Participants or none — a gear with
  // no tags shows the lone ghost, and so does a Trip with nobody on it yet.
  const participantCluster = (
    <div className={styles['participantRow']}>
      {participants.length > 0 && (
        // `PersonCluster` owns the `role="img"` over the whole cluster,
        // `TripCard`'s treatment and `AccountAvatar`'s before it: the
        // initials are a single piece of information — who is on this Trip
        // — and read out one letter at a time they are as easily a stray
        // alphabet as a roster. It also caps painted circles at four, `+N`
        // beyond that (ruling E, `docs/design/README.md` §5d E). An empty
        // cluster is not drawn at all: a picture of nobody.
        <PersonCluster
          people={participants.map((person) => ({
            key: person.id,
            label:
              person.label === UNNAMED_PERSON_GLYPH
                ? undefined
                : person.label.charAt(0).toUpperCase(),
          }))}
          size={22}
          label={`Participants: ${participants
            .map((person) => person.label)
            .join(', ')}`}
        />
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
      <ScreenBand
        header={header}
        back={{ href: '/trips', label: 'TRIPS' }}
        sync={sync}
      />

      {isDesktop ? (
        // One row, and `EDIT` genuinely last in the document rather than
        // last-looking: the tab order is the DOM order, which is the whole
        // reason this is a media query and not `order`.
        <div className={styles['deskHeader']}>
          {title}
          {phaseChip}
          {dateLine}
          {provenance}
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

          {provenance}

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
          onRemovePieceHere: handleRemovePieceHere,
          onRemovePieceThere: handleRemovePieceThere,
        }}
      />

      {/* Ruling I1's slot: the two panels sit here, between the over-claim
          band and the `GEAR LIST` band, `TASKS` first. It draws nothing until
          a panel is passed (I2), which is what lets S12 and S13 land in
          either order — each adds one child and neither edits the other's
          line. See `docs/specs/2026-09-08-trip-notes.md` §1. */}
      <TripPanels>
        <TasksPanel
          tasks={tasks}
          counts={tasksCount}
          onAdd={handleAddTask}
          onToggle={handleToggleTask}
        />
        <NotesPanel tripId={tripId} />
      </TripPanels>

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
          {/* From Split up this is the region's only door, and it closes a
              dead end rather than adding an affordance: `+ Add from the
              depot` below is the phone's, and `EDIT LIST ›` lives in the
              `GEAR LIST` band, which renders only once the Trip *has*
              Entries — so a Quartermaster on a laptop could not add the
              **first** Entry to a Trip at all.

              The band's own door, unchanged: same route, same copy, same
              `!editable` gate, sitting where the phone's add affordances sit
              — after the region's two lines. **Not** a second `PACKING ›`:
              that one stays withheld here for the reason the code-authored
              line in `design/README.md` §1 gives (a route to a screen that
              can only say `0 ENTRIES.` back), and an empty gear list is the
              one state in which the *builder* is most needed. */}
          {!editable && (
            <Link
              href={`/trips/${tripId}/list`}
              className={styles['editListEmpty']}
            >
              EDIT LIST ›
            </Link>
          )}
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
          {/* `GEAR LIST` left, the trailing group wrapped together on the
              right — the count and `PACKING ›` below Split, plus
              `EDIT LIST ›` between them from Split up —
              `justify-content: space-between` between the two groups,
              exactly `GearListSection`'s own group bands
              (`GearListSection.module.css`'s `.groupHeader`), so this one
              reads as their parent rather than the one row on the screen
              that doesn't line up with them. */}
          <Band
            label="GEAR LIST"
            labelId="gear-list-label"
            testId="gear-list-band"
            trailing={
              <>
                <span
                  className={styles['gearListCount']}
                  data-testid="gear-list-count"
                >
                  {entryCountLabel(totals.entries)} ·{' '}
                  {pieceLabel(totals.pieces)}
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
                {/* `PACKING ›` and `UNPACK ›` (ruling A11, F14), grouped so
                  `.gearListTrailing`'s wrap moves the pair together rather
                  than splitting it — the trailing-most thing in the band at
                  every width, which is where the drawn phone frame puts it,
                  so its position does not move across the breakpoint that
                  adds `EDIT LIST ›` beside it. Neither is gated on
                  `editable`, and neither is gated on the phase, and there is
                  no swap between them by phase either: both are their own
                  route at every width rather than a pane, and a phase locks
                  nothing, so hiding either — or trading one for the other —
                  would be a soft lock the phase model does not have. */}
                <span className={styles['gearListRoutes']}>
                  <Link
                    href={`/trips/${tripId}/packing`}
                    className={styles['packing']}
                    // Ruling D: the `›` is decoration and stays out of the
                    // name, which `aria-label` does wholesale — read as text
                    // content it would be spoken "greater-than sign".
                    // `Build list for …`'s own pattern (`TripCard.tsx`), down
                    // to the name it interpolates: an accessible name is a
                    // sentence, so it takes `tripNameOrUnnamed`'s prose and
                    // not the `—` this screen's own title draws (§5c's
                    // glyph/prose split).
                    aria-label={`Open packing for ${tripNameOrUnnamed(trip)}`}
                  >
                    PACKING ›
                  </Link>
                  <Link
                    href={`/trips/${tripId}/unpack`}
                    className={styles['unpack']}
                    aria-label={`Open unpack for ${tripNameOrUnnamed(trip)}`}
                  >
                    UNPACK ›
                  </Link>
                </span>
              </>
            }
          />
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

      {/* **The footer** (rulings J1, J7) — two controls in opposite registers,
          destructive last, under a rule, at every width.

          It sits **after** the phone's add affordances rather than between
          the panels: a destructive control never interrupts a list. And
          neither control folds, re-docks or becomes a button in a pane mode —
          unlike `+ NEW`, neither accompanies the tab bar, so there is nothing
          for a pane mode to re-dock.

          `/trips/:id` is the only door to a delete (J6). The closed ledger
          row keeps `REOPEN` alone: a destructive control at the end of that
          row would sit a thumb-width from the one control that brings a Trip
          back.

          Both are standalone controls and therefore drawn ≥48 with no hit
          extension — ruling O's standalone clause. Both name the Trip in
          their accessible name, because a screen-reader user meeting
          `DELETE TRIP` in a control list has no other way to know which. */}
      <footer className={styles['footer']}>
        <Link
          href={`/trips/new?from=${tripId}`}
          className={styles['startFrom']}
          aria-label={`Start a new trip from ${tripNameOrUnnamed(trip)}`}
        >
          START A NEW TRIP FROM THIS ›
        </Link>
        <button
          type="button"
          className={styles['deleteTrip']}
          aria-label={`Delete ${tripNameOrUnnamed(trip)}`}
          onClick={() => setDeleting(true)}
        >
          DELETE TRIP
        </button>
      </footer>

      {deleting && (
        <DeleteTripConfirm
          trip={trip}
          state={state}
          onCancel={() => setDeleting(false)}
          onConfirm={() => {
            // No UNDO and no toast (J4). The list, whereabouts, claims, the
            // TRIP dimension and the nav count are all already right through
            // the one selector that filters the tombstone, so there is
            // nothing to refresh — and no op restores a Trip, so an UNDO
            // would offer a route the catalogue does not hold.
            emit(tripDeleted(tripId))
            navigate('/trips')
          }}
        />
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
          personId={removingElsewhere.personId}
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

/**
 * **A Trip that is not there** — ruling J5, drawn at 393 and 1024 because it
 * is the one S14 surface whose element set differs by width.
 *
 * ## Two states, because the fold knows two things
 *
 * A **tombstone** is a fact this Device holds: somebody deleted this Trip,
 * here or on another Device, and it is not coming back. An **unfolded id**
 * is an absence: the ops may simply not have arrived yet, and the state
 * clears itself when they do. One string for both would be wrong half the
 * time, and the fold has never needed to guess — `tripStandingOf` reads it.
 *
 * ## It renders in place; it never redirects
 *
 * A screen that teleports when a peer's op lands reads as a defect and takes
 * the reason with it. The route the Quartermaster is standing on keeps
 * rendering and says what happened. `/trips` is one tap away, and after
 * their *own* delete they are sent there anyway (J4) — this is the surface
 * for somebody *else's*.
 *
 * ## Neither state takes amber or `▲`
 *
 * §5b F's rule: a sync race is not an error. Nothing here needs settling and
 * nothing was discarded, so the attention class stays where it belongs.
 *
 * No title, no phase chip, no panels, no footer — there is no Trip to carry
 * them. The screen band above still follows `useScreenHeader`'s own rule, so
 * at Desktop there is no back link (the sidebar draws `TRIPS`) and
 * `Open trips` is the only route out; below it, the second.
 */
function TripNotHere({ standing }: { standing: 'deleted' | 'unknown' }) {
  const header = useScreenHeader({ splitPane: false, back: '/trips' })
  const sync = useHousehold((depot) => depot.sync)
  const deleted = standing === 'deleted'
  return (
    <div className={styles['screen']}>
      <ScreenBand
        header={header}
        back={{ href: '/trips', label: 'TRIPS' }}
        sync={sync}
      />
      <section className={styles['gear']}>
        <p className={styles['gearEmpty']}>
          {deleted ? 'TRIP DELETED' : 'TRIP NOT ON THIS DEVICE'}
        </p>
        <p className={styles['gearSource']}>
          {deleted
            ? 'It was deleted on this or another device. The depot is untouched.'
            : 'It may not have synced here yet. This clears itself.'}
        </p>
        <Link href="/trips" className={styles['openTrips']}>
          Open trips
        </Link>
      </section>
    </div>
  )
}
