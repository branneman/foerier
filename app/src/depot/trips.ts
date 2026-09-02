import {
  isActive,
  participantIds,
  personLabel,
  phaseDay,
  phaseLabel,
  phaseOf,
  pieceInclusion,
  statusGlyph,
  tripLabel,
  UNNAMED_TRIP,
  type DepotState,
  type EntryState,
  type PackingCount,
  type TripState,
} from '@foerier/shared'

import { sortedPeople, type PersonRow } from './people'

/**
 * **The Trip as a screen draws it** — `people.ts`'s companion, and the shelf
 * for the handful of Trip facts that are *display* decisions rather than
 * replica-identical ones.
 *
 * {@link tripParticipants} is the only place the Trip's membership meets the
 * household's roster; {@link tripDateRange} and {@link tripStartMonth} are the
 * only place its two date registers become words; {@link tripChip} is the only
 * place the phase and its day count become one string. None of the four
 * belongs beside `participantIds` in `shared/`: the first produces an order
 * decided by `sortedPeople`, an `app/` module, the next two a rendering of a
 * string the reducer deliberately does not gate, and the last a composition of
 * answers `shared/` already gives. `shared/` keeps the facts every replica has
 * to agree on; this keeps how a screen shows them — and, where two screens
 * show the same thing, keeps them showing it identically.
 */

/**
 * The People on `trip`, as `PersonRow`s the trip card and the participant
 * picker can draw directly.
 *
 * ## The order comes from `sortedPeople`, not from `participantIds`
 *
 * `participantIds` sorts by **id**, which is total, replica-identical and
 * meaningless to read — it is the order the fold has to agree on, not the one
 * a person scans. The display order is by label, and it is taken from
 * `sortedPeople(state)` rather than re-sorted here, because the People screen
 * and the owner picker already share that list: if the trip's circles sorted
 * one way and the picker's rows another, "the third one down" would mean two
 * different People (spec §3.3).
 *
 * ## A Participant whose Person has not folded is still listed
 *
 * `participantIds` names person ids; `sortedPeople` lists only People whose
 * `person.recorded` has folded. The two disagree whenever a
 * `trip.participant_added` overtakes the `person.recorded` it names — a
 * `trip.*` op authored on a phone that already knew the Person, pulled by a
 * device that does not yet. Filtering `sortedPeople` alone would make that
 * Participant **vanish**, and vanishing is the one behaviour a membership list
 * must never have: the count would drop, a removal would look like it had
 * already happened, and nothing on screen would say why.
 *
 * So the unfolded ones are appended after the folded ones, in
 * `participantIds`' own id order — there is no label to sort them among the
 * rest by — and labelled `—`, which costs no new code because `personLabel`
 * already reads an unknown id that way and draws every other unnamed Person
 * identically. The row is honest and the next pull fills the name in.
 */
export function tripParticipants(
  state: DepotState,
  trip: TripState,
): readonly PersonRow[] {
  return peopleOn(state, participantIds(trip))
}

/**
 * {@link tripParticipants}' core, over a bare set of person ids — and the
 * create screen's only way in, because `/trips/new` holds a **draft**
 * selection and has no Trip to ask.
 *
 * It is exported so that "who is on this Trip" has one code path rather than
 * two. The create screen used to filter `sortedPeople` itself, which looks
 * equivalent and is not: `emit` folds on the store's queue, so a Person
 * recorded from inside the picker sits in the selection for a tick before
 * `sortedPeople` has heard of them — and a list that filters would drop the
 * Person it had just been told to add. Here that Person is listed, as `—`,
 * until the fold catches up, which is the same behaviour and the same reason
 * as the paragraph above.
 *
 * The ids arrive in whatever order the caller holds them — `participantIds`'
 * id order from a Trip, tap order from a draft. Neither reaches the display:
 * the folded ones are ordered by `sortedPeople` and only the unfolded tail
 * keeps the caller's order, because there is no label to sort it by.
 */
export function peopleOn(
  state: DepotState,
  ids: readonly string[],
): readonly PersonRow[] {
  if (ids.length === 0) return []

  const onTrip = new Set(ids)
  const folded = sortedPeople(state).filter((person) => onTrip.has(person.id))

  const drawn = new Set(folded.map((person) => person.id))
  const unfolded = ids
    .filter((id) => !drawn.has(id))
    .map((id) => ({ id, label: personLabel(state, id) }))

  return [...folded, ...unfolded]
}

/** One row of {@link tripPieces}' join — the shape `EntryRow`'s `pieces`
 * prop and `PiecePicker`'s own rows both carry. */
export interface TripPieceRow {
  readonly personId: string
  readonly label: string
  readonly included: boolean
}

/**
 * **The one join `EntryRow`'s trailing slot and `PiecePicker` must agree
 * on** — ruling C's "the circle mirrors the row's state" is a promise about
 * two surfaces, not one, and `pieceInclusion` alone does not keep it: its
 * own order is by id, deliberately not the drawn one
 * (`shared/src/selectors/piece.ts`'s own docstring), so every caller that
 * wants to *draw* a roster has to re-join it against display order. This is
 * the `ownerOf`/`phaseOf` failure mode restated for a join instead of a
 * register default — `piece.ts`'s own words: "a call site re-deriving it
 * will drift, and the symptom is a row whose `×N` disagrees with the
 * circles beside it" — so the join lives here once, and `GearListSection`
 * and `PiecePicker` both call it rather than each rebuilding the same
 * `Map`.
 */
export function tripPieces(
  state: DepotState,
  trip: TripState,
  entry: EntryState,
): readonly TripPieceRow[] {
  const included = new Map(
    pieceInclusion(entry, trip).map((piece) => [
      piece.personId,
      piece.included,
    ]),
  )
  // Every row here comes from `trip`'s own Participant set
  // (`tripParticipants` from `participantIds`), and so does `pieceInclusion`
  // from the same — the `!` is that agreement, not an assumption.
  return tripParticipants(state, trip).map((person) => ({
    personId: person.id,
    label: person.label,
    included: included.get(person.id)!,
  }))
}

/** The meta line's pieces — {@link tripDateRange}'s whole answer. */
export interface TripDates {
  /**
   * `AUG 14 → SEP 02`, `AUG 14 →` or `→ SEP 02` — and an end this module
   * cannot read passes through verbatim beside one it can
   * (`next summer → SEP 02`). Always drawn.
   */
  range: string
  /** `20 DAYS`, or `null` where there is no arithmetic to do. */
  span: string | null
  /**
   * `ENDS BEFORE IT STARTS`, or `null`. Never set at the same time as
   * {@link span}, and drawn with the `▲` and the attention class by whichever
   * surface draws it.
   */
  warning: string | null
}

/**
 * `AUG 14 → SEP 02 · 20 DAYS` — the trip card's and the trip screen's meta
 * line, in **parts** — or `null` when the Trip carries no dates at all and the
 * line simply drops (the board's own variant: *"dates are optional and a draft
 * usually has none — the meta row simply drops"*).
 *
 * ## Parts, and not one string
 *
 * The board paints `▲ ENDS BEFORE IT STARTS` in the attention class and the
 * range beside it in muted meta, so the two cannot be one text node: a caller
 * handed a single string can only colour all of it or none of it, and
 * colouring the whole line makes a sentence shout where one mark is meant to.
 * The `▲` itself is the caller's for the same reason `StoredDateNote` gives it
 * an element of its own — a glyph inheriting the muted meta around it is a `▲`
 * in name only.
 *
 * ## It formats here rather than in `shared/`
 *
 * The registers hold `YYYY-MM-DD` **by convention and verbatim in fact**
 * (spec §1.4): the reader gates no format, because a reader reporting anything
 * else absent would be rejecting a quartermaster's work to enforce a spelling.
 * So this is a *display* decision over an ungated string, which is exactly the
 * boundary `tripParticipants` sits on — `shared/` keeps the replica-identical
 * facts, `app/` decides how they are drawn.
 *
 * ## What a half-dated Trip reads as
 *
 * The two dates are independent registers with no end-before-start guard, so
 * one alone is an ordinary state rather than an error. The arrow is what says
 * which end is missing — `AUG 14 →` is a departure with no return, `→ SEP 02`
 * a return with no departure. Dropping the arrow would leave a bare `SEP 02`
 * that reads as a start date, which is a fact the Trip does not hold.
 *
 * ## The span is inclusive, and appears only when it can be counted
 *
 * `AUG 14 → SEP 02` is `20 DAYS` on the board, which is the count of days the
 * Trip is away rather than the difference between two dates. It is drawn only
 * when both ends parse: an unparseable date has no arithmetic.
 *
 * ## A reversed range is reported, never prevented
 *
 * `SEP 02 → AUG 14 · ▲ ENDS BEFORE IT STARTS` (the boards, `Screens B` 02A).
 * There is deliberately **no end-before-start guard** anywhere in the slice,
 * and the reason is the op log rather than leniency: the two ends are
 * independent registers, two devices may legitimately write one each while
 * offline, and a guard would have to reject one of two writes that were both
 * valid when they were made. Nothing can be rejected after the fact, so the
 * only honest move is to say so.
 *
 * The `▲` marks the system's attention class (`#D98263`) — *missing, lost,
 * disagreement* — and never progress. Which is also why the day count goes
 * while the range is reversed: `· 20 DAYS` beside the ▲ would be a second,
 * confident, false statement about the same pair of dates. `warning` and
 * `span` are therefore never both set.
 *
 * The comparison is on the **stored strings**, which is exact rather than
 * lucky: it is reached only once both ends have been read as `YYYY-MM-DD`, and
 * within that spelling lexical order *is* chronological order. Gating it on
 * that is the whole of the care — compared as bare strings `'2026-09-02' <
 * 'next summer'`, so an ungated comparison would spend the attention class on
 * a Trip whose dates disagree with nothing. A range with an end this module
 * cannot read is left alone: it cannot be counted and it cannot be judged.
 */
export function tripDateRange(trip: TripState): TripDates | null {
  const start = trip.startDate?.value ?? null
  const end = trip.endDate?.value ?? null
  if (start === null && end === null) return null
  if (start === null) return rangeOnly(`→ ${formatDay(end as string)}`)
  if (end === null) return rangeOnly(`${formatDay(start)} →`)

  const span = inclusiveDays(start, end)
  const range = `${formatDay(start)} → ${formatDay(end)}`
  if (span === null) return rangeOnly(range)
  if (end < start) {
    return { range, span: null, warning: 'ENDS BEFORE IT STARTS' }
  }
  return {
    range,
    span: `${span} ${span === 1 ? 'DAY' : 'DAYS'}`,
    warning: null,
  }
}

/** A range with nothing to add to it: one end, or an end that will not read. */
function rangeOnly(range: string): TripDates {
  return { range, span: null, warning: null }
}

/**
 * `JUL 2025` — the closed ledger row's meta, from **the start date** and from
 * nothing else, or `null` when there is no start date.
 *
 * The board draws `JUL 2025 · 54 PIECES · 1 LOST`; the two counts need S7's
 * Entries and S10's outcomes, so at S6 the segment that exists is the date and
 * a Trip with no start date simply has no meta. Deriving one from the end date
 * instead would state a month the Trip never claimed to have started in — the
 * closed row is the ledger keeping score, and a ledger does not guess.
 */
export function tripStartMonth(trip: TripState): string | null {
  const start = trip.startDate?.value ?? null
  if (start === null) return null
  const parts = parseIsoDate(start)
  // Verbatim when it will not parse, for `phaseLabel`'s reason one level out:
  // inventing a rendering for a value the reader deliberately did not gate
  // would be coercion by another name.
  if (parts === null) return start
  return `${MONTHS[parts.month - 1]} ${String(parts.year).padStart(4, '0')}`
}

/** Mono caps, and the boards' own spelling. */
const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const

/**
 * `2026-08-14` → `AUG 14`, and anything this cannot read → itself.
 *
 * A hand-written month table rather than `toLocaleDateString`, for two reasons
 * that point the same way: the boards' `AUG 14 → SEP 02` is one fixed
 * spelling, and an `Intl` rendering would make the same op log draw
 * differently on two devices in one household — the thing every selector in
 * `shared/` exists to prevent.
 */
function formatDay(value: string): string {
  const parts = parseIsoDate(value)
  if (parts === null) return value
  return `${MONTHS[parts.month - 1]} ${String(parts.day).padStart(2, '0')}`
}

/** {@link parseIsoDate}'s answer: the three fields, already checked. */
export interface IsoDate {
  year: number
  month: number
  day: number
}

/**
 * The `YYYY-MM-DD` convention, read strictly *here* precisely because the
 * reducer reads it loosely: the fold stores whatever arrived, and this is the
 * one place that has to decide whether a stored string can be treated as a
 * date. A miss is not an error — every caller in this module falls through to
 * the raw string.
 *
 * The calendar is checked by round-tripping through `Date.UTC`, so
 * `2026-02-30` misses rather than silently drawing as `FEB 30`.
 *
 * **Exported because there is exactly one calendar validator in `app/`.**
 * `Trip.tsx`'s `undrawable` asks a different *question* — whether a `date`
 * control can draw the value at all, rather than how to render it — but it is
 * the same calendar underneath, and two independent validators can drift:
 * one would start accepting a spelling the other rejects, and a stored date
 * would then be drawn as a date and annotated as unreadable on the same
 * screen. So the question stays beside its control and the calendar lives
 * here.
 */
export function parseIsoDate(value: string): IsoDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day }
}

/**
 * Days from `start` to `end` **inclusive of both ends** — `AUG 14 → SEP 02` is
 * 20, which is the board's number and the number of days a Trip is away.
 * `null` **only** when an end will not read as a date.
 *
 * **The sign says nothing, and must not be read as if it did.** Inclusive
 * counting adds one, so a range reversed by a single day —
 * `start 2026-08-15`, `end 2026-08-14` — comes back as `0` rather than as
 * anything negative, and `span < 0` would call that Trip well-ordered. Whether
 * a range is reversed is the caller's question and {@link tripDateRange}
 * answers it the one exact way there is, by comparing the stored `YYYY-MM-DD`
 * strings; this function is asked only for the count and returns a number that
 * means nothing at all unless `start <= end`.
 *
 * `Date.UTC` and not local midnight: these are calendar dates with no clock
 * attached, so there is no DST transition to absorb and no reason to let the
 * viewing device's time zone change the answer.
 */
function inclusiveDays(start: string, end: string): number | null {
  const from = parseIsoDate(start)
  const to = parseIsoDate(end)
  if (from === null || to === null) return null
  const days =
    (Date.UTC(to.year, to.month - 1, to.day) -
      Date.UTC(from.year, from.month - 1, from.day)) /
    86_400_000
  return days + 1
}

/**
 * `PACK-OUT · DAY 2` — the phase chip's whole string, on the trip card and on
 * the trip screen.
 *
 * Both surfaces draw the same control opening the same sheet, and it has to
 * read identically on the two of them; composed at each of them it is one
 * separator and one word away from not doing. Every *question* it asks is
 * still answered by the one function that owns it — {@link phaseOf} resolves
 * an absent register to `draft`, {@link phaseLabel} draws an unrecognised
 * phase exactly as it arrived, {@link isActive} is the only definition of
 * active-ness and {@link phaseDay} counts the days — so what lives here is the
 * *composition* and nothing else. The rules stay in `shared/`.
 *
 * **`DAY N` is drawn for active phases only** (spec §3.6). A Draft has not
 * started anything and a closed Trip is settled history, so the register being
 * present is not the test: `isActive` is. That is also what keeps the count
 * off a phase this build has never heard of, which `isActive` conservatively
 * calls inactive.
 *
 * `now` is passed rather than read here, because the wall clock is a
 * *rendering* input — the caller reads it once per render, and a test pins it.
 */
export function tripChip(trip: TripState, now: number): string {
  const phase = phaseLabel(phaseOf(trip))
  const day = isActive(trip) ? phaseDay(trip, now) : null
  return day === null ? phase : `${phase} · DAY ${day}`
}

/**
 * `tripLabel`'s `—` substituted for the word an unnamed Trip reads as
 * anywhere its name stands as a word rather than a glyph — a row, a title, a
 * sentence's subject. `tripLabel` is right in a list column; wrong
 * everywhere else, the same split `UNNAMED_PERSON` already carries.
 *
 * The one place this substitution is decided. `OverClaimBand`'s row fact and
 * settle route (`tripRowLabel`) and `RemoveElsewhereConfirm`'s title and body
 * both call this rather than repeating the rule — the drift it guards
 * against is concrete, not hypothetical: a Trip reading `Unnamed trip` in one
 * surface and `—` in the very confirm that surface's own route opens.
 */
export function tripNameOrUnnamed(trip: TripState): string {
  const label = tripLabel(trip)
  return label === '—' ? UNNAMED_TRIP : label
}

/**
 * **The Trip's own totals line, in the two places that draw it** —
 * `● 48/61 PIECES` · `13 LEFT` and the 6px bar beneath it: the packing view's
 * head (`Packing.tsx`) and the active trip card (`TripCard.tsx`, ruling A11).
 *
 * `pieceLabel`'s own precedent (`GearListSection.tsx`), for the identical
 * reason one step along: two files spelling `48/61 PIECES` and rounding
 * `48/61` to a bar width would let the two disagree the moment either one
 * changed, and here the disagreement is *visible* — the card and the screen
 * its CTA opens would draw different bars for one Trip. The arithmetic
 * itself stays in `shared/`: {@link packingTotals} is what both callers ask,
 * and these three only turn its answer into words and a width.
 *
 * The glyph is `statusGlyph('packed')` and never a literal, for the reason
 * the packing screen already gave: the numerator and the `●` state the same
 * fact, and a ruling that repaints `packed` must not be able to leave them
 * disagreeing.
 */
export function packedLabel(count: PackingCount): string {
  return `${statusGlyph('packed')} ${count.packed}/${count.total} PIECES`
}

/** `13 LEFT` — the totals line's trailing half. See {@link packedLabel}. */
export function leftLabel(count: PackingCount): string {
  return `${count.left} LEFT`
}

/**
 * The bar's fill, as a percentage of the denominator the count line draws.
 *
 * `total === 0` is **reachable and not defensive**: ruling A5 excludes a
 * container from PIECES, so a Trip whose only Entries are containers has a
 * genuine `0/0` — a list with something on it and nothing to pack yet. An
 * empty bar is the honest paint for it.
 */
export function packedPercent(count: PackingCount): number {
  if (count.total === 0) return 0
  return Math.round((count.packed / count.total) * 100)
}
