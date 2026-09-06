import type {
  HouseholdState,
  EntryState,
  KindValue,
  TripState,
} from '../state.ts'
import { ownedCountOf } from './depot.ts'
import {
  bringCountOf,
  entriesOf,
  entryKind,
  isContainerEntry,
} from './entry.ts'
import { piecesOf } from './piece.ts'
import { isActive, visibleTrips } from './trip.ts'
import { outcomeOf, pieceOutcomeOf } from './unpack.ts'

/**
 * **The over-claim** — domain §5.2's supply rule, read once per kind
 * (spec §3.2). Beside `entry.ts` and `trip.ts`, and the same shape of
 * problem: a fact several surfaces must agree on, computed once here.
 *
 * A claim is held by an **unresolved** Entry — one whose {@link outcomeOf}
 * reads `null` — and, for a **non-container** Per-person Entry, by its
 * unresolved Pieces alone: {@link claimsByGear} skips a resolved Single or
 * Counted Entry (and a resolved per-person *container* Entry) outright, and
 * {@link claimFor}'s per-person branch drops any Piece whose
 * {@link pieceOutcomeOf} is no longer `null` — but **only** for a
 * non-container Entry (ruling R11). A per-person **container** Entry's
 * claim reads every included Piece regardless of any per-Piece outcome
 * register: there is no per-Piece residence on a container to make a
 * per-Piece release physically coherent, and {@link unpackItems} never fans
 * a container's outcome out to Pieces in the first place — `whereabouts.ts`
 * treats the identical register the identical way. A non-container
 * Per-person Entry's own {@link outcomeOf} register is read by nobody for
 * claim purposes — see {@link claimsByGear}'s own note on why, the
 * {@link entryResidenceOf} / `trip.entry_moved` shape applied to a second
 * register. Recording an outcome therefore releases the claim
 * **immediately, mid-pass** — the same read that computes `overClaims` sees
 * it gone, before the Trip ever closes (spec §3.3, story 11).
 *
 * **S10's gate goes here**, inside this file and nowhere else. Before this
 * slice, a speculative `isResolved` returning `false` would have been a
 * function no caller could make true — and a fifth thing about outcomes for
 * every caller to keep in agreement, when this file is the one place that
 * agreement needs to be kept at all.
 */

/**
 * One Trip's hold on a piece of Gear.
 *
 * `count` is the unit the kind counts in: `1` for Single, the Bring-count for
 * Counted, the number of Participants for Per-person — {@link pieceCountOf}'s
 * rule for every non-container Entry, read again here rather than imported,
 * because that function answers "how many things is this line" for *any*
 * Entry and this one only ever asks it of a depot Entry whose Kind is already
 * known. **A container Entry is the one place the two rules disagree, on
 * purpose** — see {@link claimFor}'s own note.
 *
 * `personIds` is present only for a Per-person claim, and is the Entry's
 * **included and unresolved Pieces** — the claiming Trip's Participants minus
 * whoever's Piece {@link piecesOf} reads as tombstoned, minus whoever's Piece
 * already carries an unpack outcome ({@link pieceOutcomeOf}, S10) — so
 * removing a Piece and recording its outcome are two independent ways to
 * release exactly that Person's claim.
 */
export interface Claim {
  readonly tripId: string
  readonly entryId: string
  readonly count: number
  readonly personIds?: readonly string[]
}

/**
 * The claims on one piece of Gear, once they exceed its supply.
 *
 * `supply` and `claimed` read in the same unit for Single and Counted — `1`
 * piece and `count` pieces — so `claimed > supply` is the whole test for
 * those two kinds. Per-person has no single "how many exist" number (supply
 * is *per person*, not a depot-wide count), so the two fields there answer a
 * different but parallel question: `supply` is how many distinct People are
 * touched by any claim on this Gear, and `claimed` is the sum of every
 * claim's `count` — which double-counts a Person two Trips both claim. The
 * two numbers agree exactly when nobody is double-counted, so
 * `claimed > supply` is still the right test, and `contestedPersonIds` names
 * who.
 *
 * `contestedPersonIds` is empty for Single and Counted — there is no Person
 * to name, only a Gear.
 *
 * **`supply` and `claimed` are the two numbers of the detection test, not
 * depot quantities in general.** For Single and Counted they happen to
 * coincide with one — the supply really is `1`, or is `ownedCount` **or its
 * `1` default when the register is absent** (fix round F6: `supply` alone
 * cannot tell a genuinely-owned-one Gear from one nobody recorded a count
 * for, which is exactly why a surface must read the register itself before
 * printing `OWNED ×N`) — but for Per-person `supply` is a fact of who
 * happens to be claiming, not of the Gear: it rises the moment a fourth Trip
 * joins, and invariant 6 gives per-person gear no owned-count at all. A
 * surface must not render a Per-person row from these two fields as though
 * they were `OWNED ×N` — that is a number nobody recorded. Render Per-person
 * from {@link contestedPersonIds} and each {@link Claim}'s `personIds`
 * instead.
 */
export interface OverClaim {
  readonly gearId: string
  readonly kind: KindValue
  readonly claims: readonly Claim[]
  readonly supply: number
  readonly claimed: number
  readonly contestedPersonIds: readonly string[]
}

/** The three Kinds this file has a supply rule for. Anything else holds no claim. */
type ClaimableKind = 'single' | 'counted' | 'per_person'

function isClaimableKind(kind: unknown): kind is ClaimableKind {
  return kind === 'single' || kind === 'counted' || kind === 'per_person'
}

/**
 * A total order over plain id strings, by code point rather than
 * `localeCompare` — `selectors/order.ts`'s reason applied to a bare string
 * instead of a named entity: `localeCompare` resolves against the host's
 * default locale and ICU collation data, so two devices could order the same
 * pair of ids differently. Every sort in this file goes through this rather
 * than a second copy of the comparison.
 */
function compareIds(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * The Claim one Entry contributes, given the Kind that already governs it.
 *
 * Single reads no register at all — its supply is a fact of the *kind*, not
 * of the Gear (see {@link supplyAndClaimed}'s note on invariant 6). Counted
 * reads {@link bringCountOf}, which already defaults an absent register to
 * `1`. Per-person reads {@link piecesOf} of the Entry against the *claiming*
 * Trip, then — for a **non-container** Entry only — drops whoever's Piece
 * already carries an unpack outcome ({@link pieceOutcomeOf}, S10): Pieces,
 * not Participants, and *unresolved* Pieces, not merely included ones, so
 * removing a Piece or recording its outcome each release that Person's claim
 * at the granularity domain §5.2's per-person rule is stated in (spec §3.3,
 * §4.4).
 *
 * `perPersonLoose` is `claimsByGear`'s own {@link isContainerEntry} read for
 * this Entry, passed down rather than recomputed — one entry-kind-and-
 * container-ness fact, decided once, the same discipline every other
 * selector in this codebase applies to a fact several call sites would
 * otherwise re-derive. It is meaningless for `'single'` and `'counted'` and
 * ignored by both those branches.
 *
 * **A per-person *container* Entry ignores every Piece's own outcome
 * (ruling R11).** `whereabouts.ts`'s container branch hands every included
 * Piece the *container's own* segment — there is no per-Piece residence on a
 * container to make a per-Piece release physically coherent, since releasing
 * one Person's Piece alone would have the claim (and the whereabouts answer
 * beside it) say their headlamp is home while the sack it rides in is still
 * in the car. {@link unpackItems} agrees: container-ness is checked *before*
 * the per-person fan-out there, so a container Entry's outcome is always
 * Entry-level and never fanned out to Pieces at all. A container Entry's
 * claim is therefore released only by its own Entry-level outcome — this
 * function's `perPersonLoose === false` branch counts every included Piece
 * regardless of any (off-label) per-Piece outcome register that might exist
 * on it.
 *
 * **This is a different question from whether a container Entry's *count*
 * is gated on its container-ness, which stays permanently ungated** — see
 * {@link claimsByGear}'s closing note. `perPersonLoose` here only ever
 * decides which register a per-person Entry's claim is allowed to shrink by;
 * it does not decide whether the Entry holds a claim, and a Single or
 * Counted container Entry still contributes `count: 1` or the whole
 * Bring-count exactly as if it carried no container trait at all, even
 * though {@link pieceCountOf} reads the identical Entry as `0` pieces
 * (ruling A5).
 */
function claimFor(
  kind: ClaimableKind,
  trip: TripState,
  entry: EntryState,
  state: HouseholdState,
  perPersonLoose: boolean,
): Claim {
  if (kind === 'single') {
    return { tripId: trip.id, entryId: entry.id, count: 1 }
  }
  if (kind === 'counted') {
    return {
      tripId: trip.id,
      entryId: entry.id,
      count: bringCountOf(entry, state) ?? 1,
    }
  }
  // Pieces, not Participants. A non-container Entry additionally drops
  // whoever's Piece already carries its own outcome (S10) — removing a
  // Piece or recording its outcome each release that Person's claim, at the
  // granularity domain §5.2's per-person rule is stated in. A **container**
  // Entry (ruling R11) reads every included Piece regardless: there is no
  // per-Piece outcome `unpackItems` ever produces for one, and no per-Piece
  // residence to make a per-Piece release physically coherent.
  const personIds = perPersonLoose
    ? piecesOf(entry, trip).filter(
        (personId) => pieceOutcomeOf(entry.pieces?.[personId]) === null,
      )
    : piecesOf(entry, trip)
  return {
    tripId: trip.id,
    entryId: entry.id,
    count: personIds.length,
    personIds,
  }
}

/**
 * Every Trip whose packing arrangement can hold a claim: every active Trip,
 * plus `extraTripId` even when it is not — {@link overClaimsIfActive}'s
 * hypothetical. A Trip already active by `extraTripId` is not duplicated.
 */
function claimingTrips(
  state: HouseholdState,
  extraTripId?: string,
): readonly TripState[] {
  const visible = visibleTrips(state)
  const active = visible.filter(isActive)
  if (extraTripId === undefined) return active
  if (active.some((trip) => trip.id === extraTripId)) return active
  const extra = visible.find((trip) => trip.id === extraTripId)
  return extra === undefined ? active : [...active, extra]
}

/**
 * The Trips in `trips`' claims, grouped by the Gear they name — a depot
 * Entry only, since a trip-only Entry names no Gear and can clash with
 * nothing (`entryKind` reads it `'trip_only'`, which is not a
 * {@link ClaimableKind} and is skipped below alongside every other
 * non-claiming case).
 *
 * **A resolved Entry holds no claim — except a non-container Per-person
 * Entry, whose Entry-level `outcome` is read by nobody here (ruling R10).**
 * {@link outcomeOf} reads `null` for open and for absent alike, so an Entry
 * this loop has never addressed falls straight through; the moment a
 * recognised **or unrecognised** outcome is on record for a Single Entry, a
 * Counted Entry, or a per-person **container** Entry, it contributes no
 * claim at all (spec §3.3, story 11) — an unrecognised outcome releases the
 * claim exactly like a known one, because a Trip a peer on a later build has
 * resolved must not hold this build's supply hostage. A **non-container**
 * Per-person Entry is the one exception, and {@link isContainerEntry} is what
 * decides it: {@link unpackItems} (`unpack.ts`) puts that Entry's outcome
 * on the Entry itself only when it is a container (container checked before
 * the per-person fan-out there too), fanning out to Pieces otherwise — so
 * this file must answer the identical question the identical way. The
 * Entry-level register is therefore **fold-but-ignore** for a non-container
 * Per-person Entry, exactly as {@link entryResidenceOf} (`packing.ts`)
 * already treats `trip.entry_moved` on the same Kind: folded, because a peer
 * on another build may write one and the tolerant reader is absolute, and
 * read by nobody for claim purposes either. Such an Entry's claim is
 * released only by {@link claimFor}'s per-Piece filter, one Person at a
 * time. This is the whole of "marking an Entry resolved hands its Gear
 * straight back" — the claim is released by the same read that computes it,
 * mid-pass, before the Trip closes.
 *
 * **An Entry whose Gear is not (yet) in the fold holds no claim.**
 * `entryKind` reads `undefined` for a depot Entry whose `gear.recorded` has
 * not arrived — the ordinary cross-aggregate sync race, since
 * `trip.entry_added` and `gear.recorded` are different aggregates with no
 * ordering between them (spec §3.1/entry.ts). Treated exactly like a
 * sourceless Entry (already excluded by {@link entriesOf}) and like an
 * Entry whose Kind this build has never heard of: a claim the reader cannot
 * see is a claim they cannot settle, so none of the three is counted.
 *
 * **This deliberately diverges from `pieceCountOf`**, which counts an
 * unrecognised Kind as `1` piece. Both are right in context: `pieceCountOf`
 * is counting what it can see on a list a reader is already looking at, and
 * asserting a conflict this file has no rule for is a different and stronger
 * claim than counting a line. `isClaimableKind` is this file's own answer to
 * "which Kinds does this build have a supply rule for", and it names only
 * the three the domain states one for.
 *
 * **This also, separately, diverges from `pieceCountOf` for a container
 * Entry — and this one is permanent, not a gap to close.** Ruling A5 makes
 * `pieceCountOf` read `0` for a container, because a container carries a
 * journey instead of a status and a packing arithmetic cannot count what can
 * never be marked packed. A supply rule asks a different question: whether
 * two active Trips can both take the one duffel, and they cannot, whatever
 * the duffel's Kind. So a Single or Counted container Entry still
 * contributes exactly as though it carried no container trait at all —
 * `count: 1`, or the whole Bring-count — and *that* must never be gated on
 * `isContainerEntry`: importing `pieceCountOf`, or making either of those
 * two branches consult container-ness, would let two Trips both claim the
 * one duffel. (See the paragraph below for the one narrow exception,
 * ruling R11: it gates which outcome register a per-person claim consults,
 * and does not weaken this rule.)
 *
 * **Ruling R11 adds a container check to `claimFor` below, for a
 * different purpose than the paragraph above warns against.**
 * `perPersonLoose` — this function's own {@link isContainerEntry} read,
 * computed once here and passed down rather than recomputed — decides only
 * which *register* a **per-person** Entry's claim is allowed to shrink by
 * (its own Entry-level outcome, or a per-Piece one); it never decides
 * *whether* an Entry holds a claim, and it touches no branch of `claimFor`
 * other than the per-person one. The paragraph above is about a container's
 * *count*; this one is about which outcome register a non-container
 * per-person Entry's count may be narrowed by. Conflating the two would
 * reintroduce exactly the bug the paragraph above exists to prevent — a
 * Single or Counted container Entry silently losing its claim because some
 * future edit let container-ness gate whether the Entry counts at all,
 * rather than only which outcome a per-person Entry's Pieces are filtered
 * by.
 */
function claimsByGear(
  state: HouseholdState,
  trips: readonly TripState[],
): ReadonlyMap<string, { kind: ClaimableKind; claims: readonly Claim[] }> {
  const byGear = new Map<string, { kind: ClaimableKind; claims: Claim[] }>()
  for (const trip of trips) {
    for (const entry of entriesOf(trip, state)) {
      const kind = entryKind(entry, state)
      if (!isClaimableKind(kind)) continue
      // `isClaimableKind` already rules out `'trip_only'` and `undefined`,
      // so `entry.source` is a depot source here — read the id straight off
      // it rather than re-deriving `entryKind`'s own test.
      const source = entry.source?.value
      if (source === undefined || source.from !== 'depot') continue

      // S10 (ruling R10): the Entry-level `outcome` gate applies to
      // everything except a non-container Per-person Entry — see this
      // function's own note above for why `isContainerEntry` is what draws
      // the line. `kind` and container-ness must both be known before this
      // decision, which is the one genuine ordering dependency in this
      // function; the checks above it are not.
      const perPersonLoose =
        kind === 'per_person' && !isContainerEntry(entry, state)
      if (!perPersonLoose && outcomeOf(entry) !== null) continue

      const claim = claimFor(kind, trip, entry, state, perPersonLoose)
      // A claim naming nobody is not a claim. Reachable when every Piece of a
      // per-person Entry has been removed: it raises no false conflict either
      // way (it adds 0 to `claimed`), but left in `claims` it would give a
      // settle route pointing at an Entry that is not part of the problem —
      // `entriesOf`'s rule one step on, that a claim the reader cannot see is
      // a claim they cannot settle. Single and Counted claims carry no
      // `personIds` at all, so they are untouched by this check.
      if (claim.personIds !== undefined && claim.personIds.length === 0) {
        continue
      }
      const bucket = byGear.get(source.gearId) ?? { kind, claims: [] }
      bucket.claims.push(claim)
      byGear.set(source.gearId, bucket)
    }
  }
  for (const bucket of byGear.values()) {
    bucket.claims.sort(
      (a, b) =>
        compareIds(a.tripId, b.tripId) || compareIds(a.entryId, b.entryId),
    )
  }
  return byGear
}

/**
 * `supply`, `claimed` and the contested People, for one Gear's claims —
 * domain §5.2's three sentences, one branch each.
 *
 * **Single never reads `ownedCount`.** Invariant 6 confines owned-count to
 * Counted gear, and a Gear whose Kind was edited from `counted` to `single`
 * keeps its `ownedCount` register (Task 2 pinned that it is not cleared).
 * Reading it here would let that stray register silently raise Single's
 * supply above one; the branch below is a literal `1` for exactly that
 * reason.
 */
function supplyAndClaimed(
  state: HouseholdState,
  gearId: string,
  kind: ClaimableKind,
  claims: readonly Claim[],
): { supply: number; claimed: number; contestedPersonIds: readonly string[] } {
  if (kind === 'single') {
    return { supply: 1, claimed: claims.length, contestedPersonIds: [] }
  }
  if (kind === 'counted') {
    const gear = state.gear[gearId]
    // `ownedCountOf` takes a `GearState`, not `GearState | undefined` — and
    // `gear` is `undefined` exactly when this replica holds a claim against
    // a `gearId` whose `gear.recorded` has not arrived yet, the same
    // cross-aggregate race `entryKind` already treats as ordinary rather
    // than an error. `ownedCountOf` itself already resolves "Counted, no
    // register" to `1` (invariant 6); the `?? 1` below now means only *the
    // Gear has not reached this replica*, a different sentence from the one
    // the old `?? 1` here used to mean.
    const supply = (gear === undefined ? null : ownedCountOf(gear)) ?? 1
    const claimed = claims.reduce((sum, claim) => sum + claim.count, 0)
    return { supply, claimed, contestedPersonIds: [] }
  }
  // Per-person: a Person named by **two or more claims** is contested —
  // comparing People, never counts. Two active Trips claiming the same Gear
  // for disjoint People is legitimate and common (story 6), and must report
  // nothing: comparing counts instead — "two claims means an over-claim" —
  // is exactly the bug spec §3.3 warns against.
  //
  // The count is of **claims**, not of distinct Trips: two Entries for the
  // same per-person Gear on the *same* Trip is exactly as reachable as two
  // Trips each holding one — two offline Devices both add the headlamp to
  // Alps, producing two `trip.entry_added` with different entry ids — and
  // one Person cannot bring two of their one headlamp regardless of which
  // Trip(s) the claims sit on.
  const claimsByPerson = new Map<string, number>()
  for (const claim of claims) {
    for (const personId of claim.personIds ?? []) {
      claimsByPerson.set(personId, (claimsByPerson.get(personId) ?? 0) + 1)
    }
  }
  const contestedPersonIds = [...claimsByPerson.entries()]
    .filter(([, count]) => count >= 2)
    .map(([personId]) => personId)
    .sort(compareIds)
  const supply = claimsByPerson.size
  const claimed = claims.reduce((sum, claim) => sum + claim.count, 0)
  return { supply, claimed, contestedPersonIds }
}

function overClaimsAmong(
  state: HouseholdState,
  trips: readonly TripState[],
): readonly OverClaim[] {
  const byGear = claimsByGear(state, trips)
  const result: OverClaim[] = []
  for (const [gearId, { kind, claims }] of byGear) {
    const { supply, claimed, contestedPersonIds } = supplyAndClaimed(
      state,
      gearId,
      kind,
      claims,
    )
    if (claimed <= supply) continue
    result.push({ gearId, kind, claims, supply, claimed, contestedPersonIds })
  }
  return result.sort((a, b) => compareIds(a.gearId, b.gearId))
}

/**
 * Every over-claim in the household, right now.
 *
 * Reads registers only — no Device, no flag, no write (spec §3.5). Every
 * replica holds identical registers, so every replica computes the identical
 * set; it disappears only when a Quartermaster removes an Entry or lowers a
 * Bring-count, both ordinary ops that merge like any other.
 */
export function overClaims(state: HouseholdState): readonly OverClaim[] {
  return overClaimsAmong(state, claimingTrips(state))
}

/** The over-claims that name `tripId` among their claims. */
export function overClaimsFor(
  state: HouseholdState,
  tripId: string,
): readonly OverClaim[] {
  return overClaims(state).filter((overClaim) =>
    overClaim.claims.some((claim) => claim.tripId === tripId),
  )
}

/**
 * What {@link overClaims} would report if `tripId` were active right now —
 * the guarded moments at activating a Draft and reopening a closed Trip
 * (domain §5.2), which ask a hypothetical rather than a fact of the current
 * fold. Folds the named Trip in as though active and otherwise defers to the
 * same computation as {@link overClaims}, so the SET PHASE sheet never
 * re-derives activeness inline.
 */
export function overClaimsIfActive(
  state: HouseholdState,
  tripId: string,
): readonly OverClaim[] {
  return overClaimsAmong(state, claimingTrips(state, tripId))
}
