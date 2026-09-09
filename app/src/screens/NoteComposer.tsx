import {
  entryLabel,
  systemIdSource,
  tripNotePosted,
  tripStandingOf,
  visibleEntry,
} from '@foerier/shared'
import { useState } from 'react'
import { useParams } from 'wouter'

import { AboutPicker } from '../components/AboutPicker'
import { useFoldSettled, useHousehold } from '../household/store'
import { ScreenBand } from '../shell/ScreenBand'
import { useScreenHeader } from '../shell/useMediaQuery'
import styles from './NoteComposer.module.css'

/**
 * **The note composer** — `/trips/:id/note`, design `README.md` §5l I9–I12,
 * and `docs/specs/2026-09-08-trip-notes.md` §5.
 *
 * ## A screen, not a sheet
 *
 * Ruling I9, for a mechanical reason rather than a stylistic one: the `ABOUT`
 * picker has to stack **on top of** the composer, and a picker over a picker
 * is the shape `/trips/new` and Add gear already refused. Every other reason
 * agrees — the OS keyboard owns the lower half for the whole sitting, and a
 * note is written at a keyboard.
 *
 * ## Return is a newline
 *
 * `NewTrip` creates on return at desk widths and `AddGear` records on it
 * unconditionally; this screen does neither, and the difference is what is
 * being typed. Those two fields hold a **name** — one line by construction,
 * where return can only mean *done*. A Note is prose, and prose has
 * paragraphs. Taking return from a textarea to save a tap would make the one
 * key every writer reaches for do something else.
 *
 * ## Gated on non-blank text, and nothing else
 *
 * Whitespace is empty (I9). `ABOUT` needs no answer — a Note about the Trip
 * is the ordinary case, not a failure to choose — and there is no counter and
 * no cap, because a Quartermaster's own sentence is not something this app
 * has an opinion about the length of.
 *
 * ## One op, and no edit after it
 *
 * `trip.note_posted` carries the text and, if one was picked, `entry_id` —
 * the only write that register will ever get (I10). There is no rename op and
 * no delete op for a Note, and **nothing on this screen says so** (I12): S7's
 * un-renameable trip-only Entry is the precedent, and the defence here is
 * better than it was there, because the text is on screen before `Post note`.
 *
 * ## It returns to its caller
 *
 * The trip screen and F5 both open it (I20), and both are `‹ ALPS 2026`'s
 * destination — so `history.back()` is right where a hardcoded route would be
 * wrong on one of the two. The sidebar's `TRIPS` row does not name *this*
 * Trip, which is `GearListBuilder`'s trip door's own argument — and since
 * §5n K27 the destination says so rather than the screen. **This screen asks
 * twice**, because it draws two different back links: `‹ ALPS 2026` on the
 * ordinary path and `‹ TRIPS` on the `No such trip.` one, which points at a
 * row the sidebar does carry. Under the old boolean the second was drawn at
 * Desktop against the sidebar's own `Trips` row; it is withheld now, and no
 * clause was needed to say so.
 */
export function NoteComposer() {
  const params = useParams<{ id: string }>()
  const tripId = params.id ?? ''
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)
  const sync = useHousehold((depot) => depot.sync)

  const [text, setText] = useState('')
  const [entryId, setEntryId] = useState<string | undefined>(undefined)
  const [pickerOpen, setPickerOpen] = useState(false)

  const header = useScreenHeader({
    splitPane: false,
    back: `/trips/${tripId}`,
  })
  // The `No such trip.` band's own answer: its link names the Trips list,
  // which the sidebar carries. Two calls rather than one because a screen
  // that draws two destinations has two answers (§5n K27); both are
  // unconditional, so the hook order never moves.
  const missingHeader = useScreenHeader({ splitPane: false, back: '/trips' })
  const settled = useFoldSettled()

  const trip = state.trips[tripId]
  const tripLabel = trip?.name?.value ?? ''
  const trimmed = text.trim()
  const canPost = trimmed !== ''

  // The chosen Entry, read back through `visibleEntry` rather than the raw
  // map: an Entry removed while this screen was open is one the gear list no
  // longer draws, and offering it as the current value would let a Note be
  // posted about a line nobody can see. The reference falls back to the Trip
  // rather than being held on a row that has gone.
  const chosen =
    entryId === undefined || trip === undefined
      ? undefined
      : visibleEntry(trip, entryId)
  const about = chosen === undefined ? undefined : entryLabel(chosen, state)

  function post() {
    if (!canPost) return
    emit(
      tripNotePosted(
        tripId,
        systemIdSource.next(),
        // The trimmed text, not the raw: leading and trailing whitespace is
        // an artefact of typing, and the gate above has already decided that
        // whitespace alone is nothing at all.
        trimmed,
        chosen?.id,
      ),
    )
    // Back to whichever surface opened this — the trip screen's panel or
    // F5's review card.
    globalThis.history.back()
  }

  // **A deleted Trip is not a Trip this screen may draw** (S14). `trip.deleted`
  // writes a register on an entity the fold *keeps*, so `state.trips[id]` stays
  // defined after a delete and a guard testing `undefined` alone goes on
  // drawing. `tripStandingOf` is the one place that question is asked
  // (`selectors/trip.ts`), and the tombstone falls into the state this screen
  // already has rather than restating J5's two sentences: those are the trip
  // screen's, drawn for the route somebody is most likely to be standing on
  // when a peer deletes, and a sub-route of a Trip that is gone has nothing
  // more to add.
  if (trip === undefined || tripStandingOf(state, tripId) !== 'live') {
    // `patterns.md` §3.4's guard, after every hook: a Trip this replica has
    // not folded is not an error state, it is a route to nothing.
    return (
      <div className={styles['screen']}>
        <ScreenBand
          header={missingHeader}
          back={{ href: '/trips', label: 'TRIPS' }}
          sync={sync}
        />
        {/* Withheld until the fold has settled (§5n K25): one queue turn
            after a local write, an absence says only that this Device has
            not caught up. `TripNotHere` draws the two sentences that pull
            apart; a sub-route has one line for both standings, so the line
            waits. */}
        {settled && <p className={styles['missing']}>No such trip.</p>}
      </div>
    )
  }

  return (
    <div className={styles['screen']}>
      <ScreenBand
        header={header}
        back={{ href: `/trips/${tripId}`, label: tripLabel.toUpperCase() }}
        sync={sync}
      />

      <h1 className={styles['title']}>Note</h1>

      {/* The well is the screen's subject, so it carries no visible label —
          the title above it is what names it, and the board draws none. The
          accessible name still has to exist, so it is an `aria-label` rather
          than a hidden `<span>`: nothing is drawn, so nothing is hidden. */}
      <textarea
        className={styles['well']}
        aria-label="Note"
        value={text}
        autoFocus
        rows={6}
        onChange={(event) => setText(event.target.value)}
      />

      <div className={styles['field']}>
        {/* `aria-hidden` for `NewTrip`'s stated reason: the button below
            carries `About: …` as its own accessible name, so an announced
            label would make one control two announcements. */}
        <span className={styles['label']} aria-hidden="true">
          About
        </span>
        <button
          type="button"
          className={styles['pickRow']}
          aria-label={`About: ${about ?? 'The trip'}`}
          onClick={() => setPickerOpen(true)}
        >
          <span className={styles['pickValue']}>{about ?? 'The trip'}</span>
          <span className={styles['chevron']} aria-hidden="true">
            ›
          </span>
        </button>
      </div>

      <button
        type="button"
        className={styles['primary']}
        disabled={!canPost}
        onClick={post}
      >
        Post note
      </button>

      {pickerOpen && (
        <AboutPicker
          tripId={tripId}
          value={chosen?.id}
          onSelect={setEntryId}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
