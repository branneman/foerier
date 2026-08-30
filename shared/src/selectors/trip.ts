import { parseHlc } from '../hlc.ts'
import { stampOf } from '../registers.ts'
import type { DepotState, PhaseValue, TripState } from '../state.ts'
import { byNameThenId } from './order.ts'

/**
 * **The Trip's read side** — beside `owner.ts` and `whereabouts.ts`, and the
 * same shape of problem solved the same way: a handful of facts several
 * surfaces must agree on, stated once here rather than at each of them.
 *
 * Two of those facts outlive this slice, which is why they are functions and
 * not idioms:
 *
 * - **An absent `phase` register reads `draft`**, and only {@link phaseOf}
 *   says so. A call site re-deriving `trip.phase?.value ?? 'draft'` will drift
 *   from the one here the first time the rule gains a nuance, and the symptom
 *   is a Trip that appears in one section drawn with another section's chip.
 * - **{@link isActive} is the only definition of active-ness in the
 *   codebase.** S7's claim selector, S9's whereabouts and S10's close gate all
 *   call it. Invariant 17 enumerates three phases by name; that enumeration
 *   lives in {@link PHASES} and nowhere else.
 */

/**
 * The five phases this build knows, as a **closed** union — deliberately
 * narrower than {@link PhaseValue}, which stays open past them so a peer on a
 * later build can hand us a sixth (`sync-protocol.md` §5.3, obligation 4).
 *
 * The split is the whole of §3.4's answer in the type system: a `PhaseKey` is
 * a row in {@link PHASES} and therefore has a label, an active flag and a next
 * step; a `PhaseValue` is whatever arrived, and asking it those questions has
 * to go through a lookup that can miss.
 */
export type PhaseKey = 'draft' | 'pack_out' | 'on_trip' | 'unpack' | 'closed'

/**
 * A phase is **a row in a table** — S3's pattern for dimensions and S4's for
 * groupings, applied a third time. It is emphatically *not* a transition
 * graph: invariant 16 makes every move expressible in either direction, so
 * there is nothing to encode beyond the sequence itself.
 */
export interface Phase {
  id: PhaseKey
  /** `DRAFT` · `PACK-OUT` · `ON TRIP` · `UNPACK` · `CLOSED`. */
  label: string
  /**
   * The same phase **in a sentence** — `Draft` · `Pack-out` · `On trip` ·
   * `Unpack` · `Closed`.
   *
   * A second field rather than a transform of {@link label}, because the
   * transform does not exist: `PACK-OUT` is `Pack-out` and `ON TRIP` is `On
   * trip`, and no casing function gets both right without knowing which words
   * a phase name is made of — which is exactly what the table knows and a
   * screen does not. The alternative is a lower-casing helper at the one
   * screen that needs it, and that is the table re-derived somewhere it
   * cannot be kept in step (the same argument {@link phaseNext} makes for
   * living here).
   *
   * The chip, the sheet's rows and the sections draw {@link label}; prose
   * draws this. Today the reopen confirm is prose's only caller — *"It
   * returns to Unpack exactly as it stood."*
   */
  name: string
  /** Invariant 17: only these three give a Trip's arrangement effect. */
  active: boolean
  /**
   * The next thing to do, stated — §8.3's actual requirement for this slice.
   * It stands in for the board's `● 48/61 PIECES` progress line, which has
   * nothing to count until S7 builds the gear list, and it is a fact of *the
   * phase* rather than of the Trip, so it stays correct as later slices build
   * the things it names. `null` when closed: there is nothing next.
   */
  next: string | null
}

/**
 * In order — `draft → pack_out → on_trip → unpack → closed` — because the SET
 * PHASE sheet draws its rows straight off this array, and the order it draws
 * is the sequence a Trip usually runs.
 *
 * The `next` lines are the boards' table verbatim (`Screens B` 02A, README
 * §5). Ledger voice: terse, factual, mono caps, no cheerleading. The design
 * round redrew two of the five, and `on_trip`'s is the one worth the reason:
 * `SET UNPACK WHEN BACK` **names the actual control** — the quartermaster
 * sets the phase, and `SET UNPACK` is the thing they do. Spec §6.2's table
 * holds the superseded pair; it is a dated record of the slice, and the
 * boards outrank it.
 */
export const PHASES: readonly Phase[] = [
  {
    id: 'draft',
    label: 'DRAFT',
    name: 'Draft',
    active: false,
    next: 'NEXT — BUILD THE GEAR LIST',
  },
  {
    id: 'pack_out',
    label: 'PACK-OUT',
    name: 'Pack-out',
    active: true,
    next: 'NEXT — PACK THE LIST',
  },
  {
    id: 'on_trip',
    label: 'ON TRIP',
    name: 'On trip',
    active: true,
    next: 'NEXT — SET UNPACK WHEN BACK',
  },
  {
    id: 'unpack',
    label: 'UNPACK',
    name: 'Unpack',
    active: true,
    next: 'NEXT — RESOLVE EVERY ENTRY, THEN CLOSE',
  },
  { id: 'closed', label: 'CLOSED', name: 'Closed', active: false, next: null },
]

/**
 * The row for a phase, or `undefined` for one this build has never heard of.
 *
 * Private on purpose: every question the table answers has a named function
 * beside it — {@link phaseLabel}, {@link phaseName}, {@link isActive},
 * {@link phaseNext}, {@link isKnownPhase} — so no caller has to remember what
 * a missing row means, and every answer to "this build has never heard of that
 * phase" is decided here rather than at a screen. A question wanting the row
 * exports a named function beside these rather than the lookup.
 */
function phaseRow(phase: PhaseValue): Phase | undefined {
  return PHASES.find((row) => row.id === phase)
}

/**
 * The Trip's phase, with an absent register read as `draft`.
 *
 * This is S4's `ownerOf` rule transplanted, and it earns the same defence: the
 * **fold** conflates nothing — absent and an explicit `"draft"` stay different
 * facts about the op log — but every reader treats them alike, and saying so
 * exactly once is what stops the list, the chip and the sections drifting
 * apart.
 *
 * The absent case is reachable in ordinary use, not just in a fixture, and the
 * rule is worth stating rather than the instances: `trip.created` and
 * `trip.phase_moved` are the register's **only** writers, while `writeTrip`
 * creates the entity for any trip op at all, out of authoring order, exactly
 * as the other three maps do. So a `trip.renamed`, a `trip.dates_set` or a
 * participant op that lands while the creation is still queued on another
 * device yields a Trip with no phase register. The out-of-order
 * `trip.phase_moved` is the *contrast* and not a third instance (spec §3.2):
 * it writes the register unconditionally, so that Trip has a phase before it
 * has a name — which is the property `trip.created` seeding `draft` from the
 * handler buys, not a hole in it.
 */
export function phaseOf(trip: TripState): PhaseValue {
  return trip.phase?.value ?? 'draft'
}

/**
 * How one phase is drawn — the chip on the card and on the trip screen.
 *
 * An unrecognised phase is drawn **exactly as it arrived**, which is
 * `dimension('kind').format`'s rule (`slice.ts`) applied to a second open
 * enum: §5.3 obligation 4 stores the value verbatim, and inventing a casing
 * for it here would be coercion by another name.
 *
 * It takes a {@link PhaseValue} rather than a Trip because the value is what
 * varies — `phaseLabel(phaseOf(trip))` at a surface holding a Trip, and
 * `phaseLabel(row.id)` nowhere, since a row already carries its label.
 */
export function phaseLabel(phase: PhaseValue): string {
  return phaseRow(phase)?.label ?? phase
}

/**
 * The phase **in a sentence** — `Unpack`, not `UNPACK`.
 *
 * {@link phaseLabel}'s twin, and unrecognised values fall through the same
 * way and for the same reason: the value is drawn exactly as it arrived, and
 * a casing invented for it here would be coercion by another name.
 *
 * The reopen confirm is its one caller today: *"It returns to Unpack exactly
 * as it stood."* The sentence names **the phase the move goes to**, which is
 * any of the four a closed Trip can be reopened into (invariant 16), so it is
 * the table that supplies the word rather than the boards' single drawn
 * example.
 */
export function phaseName(phase: PhaseValue): string {
  return phaseRow(phase)?.name ?? phase
}

/**
 * Whether this build has a row for `phase` at all.
 *
 * The one question the other accessors cannot answer, because each of them
 * *resolves* an unrecognised phase — to the raw value, to not-active, to no
 * next step — and a surface that has to draw the unrecognised case
 * differently needs to know before it asks. The SET PHASE sheet is that
 * surface: no row draws `● NOW`, and a mono line states the value verbatim
 * above them (spec §3.4).
 *
 * It exists so that no caller writes `PHASES.some(…)` or `PHASES.find(…)` of
 * its own. The moment one does, "what an unrecognised phase means" is decided
 * in two places, and the screen's copy is the one that drifts.
 */
export function isKnownPhase(phase: PhaseValue): boolean {
  return phaseRow(phase) !== undefined
}

/**
 * Whether a **phase value** — not yet a Trip — is one of invariant 17's three
 * arranging phases. `isActive` is `isActivePhase(phaseOf(trip))`; this one
 * exists on its own for a caller that has a *hypothetical* phase and no Trip
 * to read it from — `ReopenConfirm`'s `to` prop names the phase a reopen is
 * headed for, and asking whether reopening *there* creates a claim needs the
 * phase table's own answer, not a second inline `phaseRow(...)?.active`
 * mirroring it (Task 14 review F2: a screen re-deriving this is exactly the
 * failure three separate S6 reviews already caught for its five siblings).
 *
 * An unrecognised phase is **not** active, which is the conservative
 * direction and the one §3.4 argues for: an unknown phase holds no claims and
 * reports no whereabouts, so an old build never *over*-states what a Trip is
 * doing. The failure mode of the other choice is gear reported as taken by a
 * Trip this build cannot describe.
 */
export function isActivePhase(phase: PhaseValue): boolean {
  return phaseRow(phase)?.active ?? false
}

/**
 * Whether the Trip is one of invariant 17's three arranging phases — the
 * **only** definition of active-ness in the codebase.
 */
export function isActive(trip: TripState): boolean {
  return isActivePhase(phaseOf(trip))
}

/**
 * Whether a Trip is filed away.
 *
 * Beside `isActive` and answering a different question: `isActive` names the
 * three phases whose packing has effect, and this names the one whose list is
 * history. An **unrecognised** phase is not closed, for the same reason it is
 * not active — an old build never over-states what a Trip is doing.
 *
 * The Trip-membership dimension needs this and cannot use `isActive`: a Draft
 * speaks for gear as surely as a Pack-out does.
 */
export function isClosed(trip: TripState): boolean {
  return phaseOf(trip) === 'closed'
}

/**
 * The next thing to do, for the line the card and the trip screen draw in
 * place of the board's `● 48/61 PIECES` progress bar — which has nothing to
 * count until S7 builds the gear list (spec §6.2).
 *
 * `null` twice over, and the two are different facts that happen to draw the
 * same way. A **closed** Trip has nothing next, which is its row's own value.
 * An **unrecognised** phase states no next step because the next thing to do
 * is a fact of the phase table and there is no row (§3.4's fourth bullet) —
 * and that bullet is stated once, here, so neither screen re-derives it. The
 * chip beside the line still draws the raw value ({@link phaseLabel}); only
 * the next-step line goes away.
 *
 * It takes a Trip rather than a {@link PhaseValue}, as {@link isActive} and
 * {@link phaseDay} do: a surface asks this about the Trip in front of it, and
 * routing through {@link phaseOf} is what makes an absent register answer with
 * the draft line instead of nothing.
 */
export function phaseNext(trip: TripState): string | null {
  return phaseRow(phaseOf(trip))?.next ?? null
}

/**
 * The Trip's name for a card, a header or a chip — sentence case, as
 * recorded, never upper-cased here (CAPS is a CSS transform where a surface
 * wants it).
 *
 * An unnamed Trip reads `—`, which is `personLabel`'s rule and the same glyph
 * the ungrouped bucket uses. It is reachable two ways even though F3 requires
 * a name: a `trip.renamed` carrying an explicit `null`, and a Trip whose
 * `trip.created` is still queued on another device while a participant op for
 * it has already arrived.
 */
export function tripLabel(trip: TripState): string {
  const name = trip.name?.value ?? ''
  return name.trim() === '' ? '—' : name
}

/**
 * How a Trip with no name reads **in a sentence**.
 *
 * `tripLabel` returns `—`, which is right in a list column and wrong in the
 * over-claim band's prose. The same split `UNNAMED_PERSON` already carries;
 * `tripLabel` is deliberately unchanged.
 */
export const UNNAMED_TRIP = 'Unnamed trip'

/**
 * The People currently on the Trip, by id.
 *
 * Only registers holding `true`. A register holding `false` is a **removal**,
 * which is a write with a clock rather than an absence
 * (`sync-protocol.md` §3.4) — it stays in the fold so a concurrent re-add can
 * win on its own stamp, and it is this selector's job not to show it. Exactly
 * `tagsOf`'s shape, over the other per-key register map.
 *
 * Sorted **by id**, which is total and replica-identical. The *display* order
 * is by Person label instead, and a screen gets it by filtering
 * `sortedPeople(state)` — the list the People screen and the owner picker
 * already share, so "the third circle along" means one Person everywhere.
 */
export function participantIds(trip: TripState): readonly string[] {
  const participants = trip.participants
  if (participants === undefined) return []
  return Object.keys(participants)
    .filter((personId) => participants[personId]?.value === true)
    .sort()
}

/**
 * `DAY N` for the phase chip, in **local calendar days** from the phase
 * change: `DAY 1` is the day of the change, and `DAY 2` arrives at local
 * midnight rather than 24 hours after the tap.
 *
 * The moment is already recorded — it is the `phase` register's **own
 * stamp** — so this needs no new field, no new op and no migration, and it is
 * identical on every replica because the register is. That is `recordedAt`'s
 * trick from S3 applied to one register instead of the earliest of many.
 *
 * The HLC's physical component is the authoring device's wall clock, bounded
 * by `DRIFT_BOUND_MS` (five minutes). For a day count that is far inside
 * tolerance, and the failure mode of a badly-skewed peer is a chip reading
 * `DAY 2` on the first day — visible, harmless, and not worth a second field
 * to prevent. Past the bound the op is still applied (§2.6), so the count is
 * floored at 1: a stamp in the future would otherwise read `DAY 0` or
 * negative, which is not a fact about anything.
 *
 * `null` when the register is absent — the chip then draws the label alone —
 * and equally when the stamp will not parse, because the reader that folded it
 * was tolerant and this is the one caller that has to make sense of the clock.
 */
export function phaseDay(trip: TripState, now: number): number | null {
  const register = trip.phase
  if (register === undefined) return null
  const parts = parseHlc(stampOf(register).hlc)
  if (parts === null) return null
  return Math.max(1, localDaysBetween(parts.ms, now) + 1)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Whole local calendar days from `from` to `to`. Both ends are collapsed to
 * local midnight first, so the answer is a difference of *dates* and not of
 * durations; `Math.round` then absorbs the 23- and 25-hour days a DST
 * transition puts between two midnights.
 */
function localDaysBetween(from: number, to: number): number {
  return Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / MS_PER_DAY)
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Every Trip the household still has, in a total order.
 *
 * `deleted` is S14's register and no S6 op writes it, but this reads it now
 * rather than assuming absence — the same line `visiblePlaces` draws for
 * `place.removed`, and the reason is that every later surface counts through
 * this function, including the sidebar's Trips badge.
 */
export function visibleTrips(state: DepotState): readonly TripState[] {
  return Object.values(state.trips)
    .filter((trip) => trip.deleted?.value !== true)
    .sort(byNameThenId)
}

/** The Trips list's three sections, each already in its own order. */
export interface TripSections {
  /** `pack_out`, `on_trip`, `unpack` — start date ascending, undated last. */
  readonly active: readonly TripState[]
  /**
   * `draft` **and anything unrecognised** — start date ascending, undated
   * last. Named for the class rather than for `draft`, because calling a
   * phase this build has never heard of a draft would state something false
   * (§3.4). `draft` is simply its most common member.
   */
  readonly planned: readonly TripState[]
  /** `closed` — start date **descending**, undated last. */
  readonly closed: readonly TripState[]
}

/**
 * The Trips list, partitioned and ordered.
 *
 * **Ascending forward and descending back**, because the two halves answer
 * opposite questions: *what is coming* wants the soonest first, *what
 * happened* wants the most recent first. Undated stays last in both — a Draft
 * usually has no dates (story 5), and burying the dated ones under them would
 * be wrong in the forward sections and meaningless in the closed one.
 *
 * Nothing constrains `active` to one member. The boards draw a single active
 * card, but over-claim is guarded rather than prevented (§5.2), so two active
 * Trips are a reachable and legitimate state and the section renders N.
 */
export function tripSections(state: DepotState): TripSections {
  const active: TripState[] = []
  const planned: TripState[] = []
  const closed: TripState[] = []
  for (const trip of visibleTrips(state)) {
    if (isActive(trip)) active.push(trip)
    else if (isClosed(trip)) closed.push(trip)
    else planned.push(trip)
  }
  return {
    active: active.sort(byStartDateThen('asc')),
    planned: planned.sort(byStartDateThen('asc')),
    closed: closed.sort(byStartDateThen('desc')),
  }
}

/**
 * By start date in `direction`, undated last **in both directions**, ties
 * broken all the way down to the id.
 *
 * The dates compare as strings, which is exactly right for the `YYYY-MM-DD`
 * convention and still **total** for anything else — and anything else does
 * arrive, because the reader gates no format (§1.4). A comparator that parsed
 * would have to decide what an unparseable date sorts as, which is a second
 * undated class nobody asked for.
 *
 * Undated is absent *or* `null`: the two are different facts about the log
 * (§1.3) and the same fact about the Trip, and this is where they meet.
 */
function byStartDateThen(
  direction: 'asc' | 'desc',
): (a: TripState, b: TripState) => number {
  return (a, b) => {
    const ad = a.startDate?.value ?? null
    const bd = b.startDate?.value ?? null
    if (ad !== bd) {
      if (ad === null) return 1
      if (bd === null) return -1
      const order = ad < bd ? -1 : 1
      return direction === 'asc' ? order : -order
    }
    return byNameThenId(a, b)
  }
}
