import {
  isActive,
  participantIds,
  personLabel,
  phaseDay,
  phaseLabel,
  phaseOf,
  type DepotState,
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

/**
 * `AUG 14 → SEP 02 · 20 DAYS` — the trip card's meta line, or `null` when the
 * Trip carries no dates at all and the line simply drops (the board's own
 * variant: *"dates are optional and a draft usually has none — the meta row
 * simply drops"*).
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
 * The `▲` is the system's attention class (`#D98263`) — *missing, lost,
 * disagreement* — and never progress. Which is also why the day count goes
 * while the range is reversed: `· 20 DAYS` beside the ▲ would be a second,
 * confident, false statement about the same pair of dates.
 *
 * The comparison is on the **stored strings**, which is exact rather than
 * lucky: it is reached only once both ends have been read as `YYYY-MM-DD`, and
 * within that spelling lexical order *is* chronological order. Gating it on
 * that is the whole of the care — compared as bare strings `'2026-09-02' <
 * 'next summer'`, so an ungated comparison would spend the attention class on
 * a Trip whose dates disagree with nothing. A range with an end this module
 * cannot read is left alone: it cannot be counted and it cannot be judged.
 */
export function tripDateRange(trip: TripState): string | null {
  const start = trip.startDate?.value ?? null
  const end = trip.endDate?.value ?? null
  if (start === null && end === null) return null
  if (start === null) return `→ ${formatDay(end as string)}`
  if (end === null) return `${formatDay(start)} →`

  const span = inclusiveDays(start, end)
  const range = `${formatDay(start)} → ${formatDay(end)}`
  if (span === null) return range
  if (end < start) return `${range} · ▲ ENDS BEFORE IT STARTS`
  return `${range} · ${span} ${span === 1 ? 'DAY' : 'DAYS'}`
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

interface IsoDate {
  year: number
  month: number
  day: number
}

/**
 * The `YYYY-MM-DD` convention, read strictly *here* precisely because the
 * reducer reads it loosely: the fold stores whatever arrived, and this is the
 * one place that has to decide whether it can be treated as a date. A miss is
 * not an error — every caller above falls through to the raw string.
 *
 * The calendar is checked by round-tripping through `Date.UTC`, so
 * `2026-02-30` misses rather than silently drawing as `FEB 30`.
 */
function parseIsoDate(value: string): IsoDate | null {
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
 * Negative when the range is reversed, and `null` only when an end will not
 * read as a date.
 *
 * `null` means *one* thing on purpose. It used to mean two — unreadable, and
 * reversed — which was fine while both drew the bare range, and stopped being
 * fine the moment the reversed case gained a line of its own: the caller has
 * to tell "there is nothing to say" from "there is something to say and it is
 * ▲". Sign says the second; `null` is left holding only the first.
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
