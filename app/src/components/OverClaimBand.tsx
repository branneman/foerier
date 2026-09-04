import {
  personNameOrUnnamed,
  tripNameOrUnnamed,
  UNNAMED_TRIP,
  type Claim,
  type DepotState,
  type OverClaim,
} from '@foerier/shared'
import { useState } from 'react'

import { useDepot } from '../depot/store'
import styles from './OverClaimBand.module.css'

/**
 * **The over-claim band** — spec §4.5, story 6's fourth condition made
 * visible. Two Active Trips cannot both take the one tent, but two
 * Quartermasters apart cannot be stopped from doing exactly that — so the
 * fold reaches the state, `shared/`'s {@link OverClaim} names it, and this
 * component surfaces it for a human to settle. **It warns and allows. It
 * never blocks, and nothing recorded is ever discarded to resolve it.**
 *
 * It renders **wherever `/trips/:id` renders, at every width**, sits between
 * the trip header and the `GEAR LIST` band, and is **never dismissible** —
 * there is nothing to dismiss, and the fold would render it again the moment
 * it is. Rendering nothing is the only way it goes away, which is why this
 * component returns `null` outright when {@link overClaimGroups} finds
 * nothing to say rather than drawing an empty shell.
 *
 * `overClaims` is a prop, not something this component derives, because two
 * different questions feed the same block: the trip screen asks
 * `overClaimsFor(state, tripId)` (spec §3.5) and the two §02B sheets ask the
 * hypothetical `overClaimsIfActive(state, tripId)` — both computed by the
 * caller, never re-derived here. `tripId` still matters to the component: it
 * is what tells "here" from "there" inside each {@link OverClaim}'s
 * `claims`.
 *
 * **`overClaimsIfActive` is not filtered by `tripId`** (unlike
 * `overClaimsFor`) — it answers "what if `tripId` were active", not "what
 * does `tripId` appear in", so its result can include an `OverClaim` between
 * two *other* Trips entirely. `overClaimGroups` drops any such `OverClaim`
 * before it reaches a line or a row, so a caller that hands this component
 * either selector's output gets a correct band either way — fix round F8:
 * the obligation is met here, not left to a docstring a future caller could
 * miss.
 *
 * Gear and Trip names are read from the store directly (`TripCard`'s own
 * precedent), rather than threaded through as a second data shape — an
 * `OverClaim` names ids, not labels, and a label is a fact of the fold like
 * any other.
 */
/**
 * The five writes a conflict row can offer. **Optional wherever it appears**,
 * and its absence is the read-only mode, not a degraded one.
 *
 * Amendment ruling I: a control that emits inside a cancellable confirm makes
 * `Cancel` state something false — tapping `REMOVE HERE` inside the activation
 * sheet and then cancelling left the Entry gone while the phase never moved.
 * So the two preview sheets render the block facts-only and **the standing
 * band is the only surface that settles**.
 *
 * Grouped into one prop rather than five so the type system enforces
 * all-or-nothing: there is no such thing as a row that can remove but not
 * bring fewer, and a caller cannot accidentally supply some but not all of
 * them.
 *
 * **S8 grew this from three callbacks to five, and `ActivationConfirm` /
 * `ReopenConfirm` needed no change at all.** Both pass no `settle` — ruling
 * I's facts-only mode, unaffected by how many routes the grouped type
 * carries — so the two new callbacks below are routes those two sheets gain
 * and never render. If touching either of them turned out to be necessary
 * for this task, something upstream had gone wrong.
 */
export interface SettleRoutes {
  /** Emits `trip.entry_removed` against **this** Trip. */
  readonly onRemoveHere: (entryId: string) => void
  /**
   * Emits `trip.entry_removed` against a Trip this screen is not showing —
   * spec §4.7's confirm sits between a click here and that op landing; this
   * callback is invoked once the Quartermaster has confirmed.
   */
  readonly onRemoveThere: (tripId: string, entryId: string) => void
  /** Emits `trip.entry_bring_count_set` against **this** Trip's Entry. */
  readonly onBringFewer: (entryId: string, count: number) => void
  /**
   * Emits `trip.piece_removed` against **this** Trip — the per-person
   * counterpart to `onRemoveHere`, ruling F. Reached only when the
   * contested Person is *one of several* included Pieces on the Entry;
   * when they are its only Piece, `ConflictRow`'s F9 fallback renders
   * `onRemoveHere` instead, because removing the one Piece and removing
   * the Entry are then the same act — the honest label is the Entry one.
   */
  readonly onRemovePieceHere: (entryId: string, personId: string) => void
  /**
   * Emits `trip.piece_removed` against a Trip this screen is not showing —
   * the per-person counterpart to `onRemoveThere`, and the same
   * confirm-first rule: `RemoveElsewhereConfirm`'s Piece variant (ruling G)
   * sits between this route and the op landing. F9's fallback applies here
   * too, symmetrically — the Entry on the *other* Trip can just as well
   * hold only this one Piece, and the honest label is then `onRemoveThere`.
   */
  readonly onRemovePieceThere: (
    tripId: string,
    entryId: string,
    personId: string,
  ) => void
}

export interface OverClaimBandProps {
  readonly tripId: string
  readonly overClaims: readonly OverClaim[]
  /** The band always settles — it is the only surface that does (ruling I). */
  readonly settle: SettleRoutes
}

export function OverClaimBand({
  tripId,
  overClaims,
  settle,
}: OverClaimBandProps) {
  // Hooks run unconditionally — the empty-band `null` returns after this.
  const state = useDepot((depot) => depot.state)
  const groups = overClaimGroups(overClaims, tripId, state)

  if (groups.length === 0) return null

  return (
    <section className={styles['band']} data-testid="over-claim-band">
      <OverClaimGroups tripId={tripId} groups={groups} settle={settle} />
    </section>
  )
}

export interface OverClaimGroupsProps {
  readonly tripId: string
  /**
   * Pre-filtered by the caller, always via {@link overClaimGroups} — never
   * raw `overClaim`s. `OverClaimBand` computes them to decide whether to
   * render its own `<section>` at all; `ActivationConfirm` and
   * `ReopenConfirm` (Task 14) compute them to decide whether to open a sheet
   * at all, which is exactly why the **filtered** result has to be the one
   * both questions are asked of — Task 14 review F1's finding, that gating on
   * the unfiltered `overClaimsIfActive`/`overClaimsFor` renders a warning
   * about a conflict naming a different Trip entirely.
   */
  readonly groups: readonly OverClaimGroup[]
  /** Absent renders the block facts-only — ruling I. */
  readonly settle?: SettleRoutes | undefined
}

/**
 * **The line-plus-rows loop**, pulled out from {@link OverClaimBand} in
 * Task 14's fix round (review F7): the standing band and both §02B previews
 * pair each {@link OverClaimGroup}'s attention line with its
 * {@link ConflictRows}, and a third copy of that pairing is what a fourth
 * caller would otherwise write. `.segment`/`.attention` stay owned by
 * `OverClaimBand.module.css` — every caller of this component imports the
 * styling from here rather than duplicating the two rules into its own
 * module, which is what the first fix round had done twice.
 */
export function OverClaimGroups({
  tripId,
  groups,
  settle,
}: OverClaimGroupsProps) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.kind} className={styles['segment']}>
          <p className={styles['attention']} data-testid="over-claim-attention">
            {group.line}
          </p>
          <ConflictRows
            tripId={tripId}
            overClaims={group.overClaims}
            settle={settle}
          />
        </div>
      ))}
    </>
  )
}

export interface ConflictRowsProps {
  readonly tripId: string
  readonly overClaims: readonly OverClaim[]
  /** Absent renders the block facts-only — ruling I. */
  readonly settle?: SettleRoutes | undefined
}

/** Rows cap at three, then one row. Spec §4.5, verbatim. */
const VISIBLE_CAP = 3

/**
 * **The rows themselves** — extracted so Task 14's two §02B sheets (the
 * `Start pack-out` preview and `ReopenConfirm`) mount the identical block
 * rather than a second copy of the copy rules. `OverClaimBand` is one of its
 * three callers, not a wrapper it depends on.
 *
 * Caps at {@link VISIBLE_CAP}, then a quiet `+ N MORE` row that **expands in
 * place** — a plain `useState` toggle, never an inner scroll. There is no way
 * back once expanded; no board draws a collapse control.
 *
 * Filters out any `OverClaim` naming no claim of `tripId` (fix round F8),
 * the same defence `overClaimGroups` applies — redundant when this is fed
 * one of that function's groups, but this component is exported on its own
 * for Task 14 to mount directly, and a caller that skips `overClaimGroups`
 * should not be able to reach `hereClaims(...)[0]` being `undefined` and
 * silently drawing a row with no `REMOVE HERE`/`BRING FEWER` route at all.
 */
export function ConflictRows({
  tripId,
  overClaims,
  settle,
}: ConflictRowsProps) {
  const state = useDepot((depot) => depot.state)
  const [expanded, setExpanded] = useState(false)

  const relevant = overClaims.filter(
    (overClaim) => hereClaims(overClaim, tripId).length > 0,
  )

  // Whether a row names its own other Trip, or leaves it to the attention
  // line above — spec §4.5's table: one other Trip overall and the line
  // already named it, so the row would only repeat it; two or more and the
  // line counts instead, so each row is the only place its own Trip is said.
  const nameEachRow = globalOtherTripIds(relevant, tripId).length >= 2

  const visible = expanded ? relevant : relevant.slice(0, VISIBLE_CAP)
  const hiddenCount = relevant.length - VISIBLE_CAP

  return (
    <div className={styles['rows']} data-testid="over-claim-rows">
      {visible.map((overClaim) => (
        <ConflictRow
          key={overClaim.gearId}
          overClaim={overClaim}
          tripId={tripId}
          state={state}
          nameRow={nameEachRow}
          settle={settle}
        />
      ))}
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          className={styles['more']}
          data-testid="over-claim-more"
          onClick={() => setExpanded(true)}
        >
          + {hiddenCount} MORE
        </button>
      )}
    </div>
  )
}

interface ConflictRowProps {
  readonly overClaim: OverClaim
  readonly tripId: string
  readonly state: DepotState
  /** See {@link ConflictRows}'s `nameEachRow`. */
  readonly nameRow: boolean
  /** Absent renders the block facts-only — ruling I. */
  readonly settle?: SettleRoutes | undefined
}

function ConflictRow({
  overClaim,
  tripId,
  state,
  nameRow,
  settle,
}: ConflictRowProps) {
  // `entry.ts`'s own rule for a Gear name: an absent register reads empty,
  // never invented.
  const name = state.gear[overClaim.gearId]?.name?.value ?? ''
  const here = hereClaims(overClaim, tripId)[0]
  const otherTripIds = distinctOtherTripIds(overClaim, tripId)
  // `claimed > supply` is guaranteed by `claim.ts`'s own detection test, so
  // this is always > 0 for an `OverClaim` this component is ever handed.
  const excess = overClaim.claimed - overClaim.supply
  // Whether bringing fewer here would actually settle this OverClaim on its
  // own (fix round F9): `here.count - excess` must not be negative — a
  // negative value means this claim alone isn't the whole excess, and
  // clamping it to zero would draw `BRING ×0 HERE` as though it resolved
  // things when the conflict would still stand afterward. `REMOVE HERE`
  // carries that case instead: a full removal, honestly labelled.
  const bringFewerCount = here === undefined ? null : here.count - excess
  const canBringFewer =
    overClaim.kind === 'counted' &&
    bringFewerCount !== null &&
    bringFewerCount >= 0

  return (
    <div
      className={styles['row']}
      data-testid={`over-claim-row-${overClaim.gearId}`}
    >
      <div className={styles['rowHead']}>
        <span className={styles['gearName']}>{name}</span>
        <span className={styles['fact']} data-testid="over-claim-fact">
          {rowFact(overClaim, tripId, state, nameRow)}
        </span>
      </div>
      {/*
        No `settle` is the facts-only mode the two preview sheets render
        (ruling I) — the whole row of routes is absent, not disabled. A
        disabled control still states that the action belongs here, and it
        does not: it belongs on the trip screen's standing band.

        Per-person splits into its own branch (ruling F) rather than joining
        the generic one below: a per-person `OverClaim` can name several
        contested People, each needing its own `HERE`/`ON <trip>` pair, where
        Single and Counted only ever have the one `here` claim and the one
        route per other Trip the generic branch already draws.
      */}
      {settle !== undefined && overClaim.kind === 'per_person' && (
        <PersonSettleRoutes
          overClaim={overClaim}
          here={here}
          otherTripIds={otherTripIds}
          state={state}
          settle={settle}
        />
      )}
      {settle !== undefined && overClaim.kind !== 'per_person' && (
        <div className={styles['settleRow']}>
          {here !== undefined && canBringFewer && (
            <button
              type="button"
              className={styles['settle']}
              onClick={() => settle.onBringFewer(here.entryId, bringFewerCount)}
            >
              BRING ×{bringFewerCount} HERE
            </button>
          )}
          {here !== undefined && !canBringFewer && (
            <button
              type="button"
              className={styles['settle']}
              onClick={() => settle.onRemoveHere(here.entryId)}
            >
              REMOVE HERE
            </button>
          )}
          {otherTripIds.map((otherTripId) => {
            const claim = firstClaimOfTrip(overClaim, otherTripId)
            if (claim === undefined) return null
            return (
              <button
                key={otherTripId}
                type="button"
                className={styles['settle']}
                onClick={() => settle.onRemoveThere(otherTripId, claim.entryId)}
              >
                REMOVE ON {tripRowLabel(state, otherTripId)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * **The per-person settle routes** — ruling F, split out of `ConflictRow`
 * because a per-person `OverClaim`'s `contestedPersonIds` can name more than
 * one Person (two Trips each doubling a *different* one is exactly the case
 * this task exists to fix — the worked example in the S8 spec's §4.6, Mark
 * contested between Alps and Vosges while Els's and Kim's own claims stay
 * legitimate and untouched). Each contested Person gets **their own** row of
 * routes, stacked with a 6px gap so one Person's `HERE`/`ON <trip>` pair
 * stays visually adjacent rather than interleaved with another Person's —
 * ruling F, drawn: "the routes stack one wrapped row per person, gap 6".
 *
 * **F9's fallback applies on both sides, not only `HERE`.** The spec names
 * it for `HERE` because that is the shape the Counted branch's own F9
 * (`bringFewerCount`, above) already carries, but the underlying rule is
 * side-agnostic: whichever Entry — this Trip's or the other Trip's — holds
 * the contested Person as its **only** included Piece, removing that one
 * Piece and removing the whole Entry are the same act, so the honest label
 * is the plain Entry route (`REMOVE HERE` / `REMOVE ON <trip>`) through the
 * pre-existing `onRemoveHere`/`onRemoveThere` callbacks, not the new Piece
 * ones. Symmetry is what "read that code and follow its shape" means here —
 * a fallback that only fired on one side of an otherwise-identical write
 * would be an arbitrary asymmetry the domain gives no reason for.
 *
 * `here` is at most one claim (`ConflictRow`'s own `hereClaims(...)[0]`) and
 * each other Trip contributes at most one (`firstClaimOfTrip`) — the same
 * simplification the generic branch already makes, carried over rather than
 * widened by this task.
 */
function PersonSettleRoutes({
  overClaim,
  here,
  otherTripIds,
  state,
  settle,
}: {
  readonly overClaim: OverClaim
  readonly here: Claim | undefined
  readonly otherTripIds: readonly string[]
  readonly state: DepotState
  readonly settle: SettleRoutes
}) {
  return (
    <div className={styles['personSettle']}>
      {overClaim.contestedPersonIds.map((personId) => {
        const name = personNameOrUnnamed(state, personId)
        const herePersonIds = here?.personIds
        const hereIncludesPerson = herePersonIds?.includes(personId) ?? false
        // F9: this Entry's only included Piece, so `REMOVE HERE` (the
        // Entry route) is the honest label rather than a Piece one.
        const hereIsOnlyPiece =
          hereIncludesPerson && herePersonIds!.length === 1

        return (
          <div key={personId} className={styles['settleRow']}>
            {hereIncludesPerson &&
              (hereIsOnlyPiece ? (
                <button
                  type="button"
                  className={styles['settle']}
                  onClick={() => settle.onRemoveHere(here!.entryId)}
                >
                  REMOVE HERE
                </button>
              ) : (
                <button
                  type="button"
                  className={styles['settle']}
                  onClick={() =>
                    settle.onRemovePieceHere(here!.entryId, personId)
                  }
                >
                  REMOVE {name}’s PIECE HERE
                </button>
              ))}
            {otherTripIds.map((otherTripId) => {
              const claim = firstClaimOfTrip(overClaim, otherTripId)
              const claimPersonIds = claim?.personIds
              if (!(claimPersonIds?.includes(personId) ?? false)) return null
              // F9, the other side: the same fallback, this time against the
              // other Trip's own Entry.
              if (claimPersonIds!.length === 1) {
                return (
                  <button
                    key={otherTripId}
                    type="button"
                    className={styles['settle']}
                    onClick={() =>
                      settle.onRemoveThere(otherTripId, claim!.entryId)
                    }
                  >
                    REMOVE ON {tripRowLabel(state, otherTripId)}
                  </button>
                )
              }
              return (
                <button
                  key={otherTripId}
                  type="button"
                  className={styles['settle']}
                  onClick={() =>
                    settle.onRemovePieceThere(
                      otherTripId,
                      claim!.entryId,
                      personId,
                    )
                  }
                >
                  REMOVE {name}’s PIECE ON {tripRowLabel(state, otherTripId)}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pure helpers — no store read, no op, every one a straight function of the
// `OverClaim`s and `tripId` handed to it (`tripSentenceLabel`/`tripRowLabel`/
// the line-builders take `state` only to resolve a label, never to read a
// second time what the `OverClaim`s already say).

function hereClaims(overClaim: OverClaim, tripId: string): readonly Claim[] {
  return overClaim.claims.filter((claim) => claim.tripId === tripId)
}

function entriesIn(overClaims: readonly OverClaim[], tripId: string): number {
  return overClaims.reduce(
    (sum, overClaim) => sum + hereClaims(overClaim, tripId).length,
    0,
  )
}

/** Distinct other-Trip ids, in the order `claim.ts`'s own sort produced. */
function distinctOtherTripIds(
  overClaim: OverClaim,
  tripId: string,
): readonly string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const claim of overClaim.claims) {
    if (claim.tripId === tripId || seen.has(claim.tripId)) continue
    seen.add(claim.tripId)
    ids.push(claim.tripId)
  }
  return ids
}

function firstClaimOfTrip(
  overClaim: OverClaim,
  otherTripId: string,
): Claim | undefined {
  return overClaim.claims.find((claim) => claim.tripId === otherTripId)
}

/** The union of every row's other-Trip ids — what a cross-Trip line counts. */
function globalOtherTripIds(
  overClaims: readonly OverClaim[],
  tripId: string,
): readonly string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const overClaim of overClaims) {
    for (const id of distinctOtherTripIds(overClaim, tripId)) {
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

/** The union of every row's contested People, in first-seen order. */
function unionContestedPersonIds(
  overClaims: readonly OverClaim[],
): readonly string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const overClaim of overClaims) {
    for (const personId of overClaim.contestedPersonIds) {
      if (seen.has(personId)) continue
      seen.add(personId)
      ids.push(personId)
    }
  }
  return ids
}

/**
 * `tripLabel` in a row **and in a settle route** — `Unnamed trip`, words,
 * per spec §4.5, always in its recorded case. Fix round F1 retired the
 * settle route's separate short-name/uppercase treatment: `REMOVE ON` has
 * exactly one Trip-name rule now, this one, and `.settle`'s
 * `text-transform: uppercase` is what turns it into `REMOVE ON ALPS 2026` /
 * `REMOVE ON UNNAMED TRIP` on screen — the same split `.fact` already drew
 * between recorded case in source and all-caps on screen.
 *
 * The substitution itself is `tripNameOrUnnamed`'s (`shared/`, beside
 * `UNNAMED_TRIP`) — this only adds the "not yet in the fold at all" case that
 * function's `TripState` argument can't express, so `RemoveElsewhereConfirm`
 * (which always holds a resolved Trip) and this row-and-settle-route rule
 * share one substitution instead of two copies drifting apart.
 */
function tripRowLabel(state: DepotState, tripId: string): string {
  const trip = state.trips[tripId]
  return trip === undefined ? UNNAMED_TRIP : tripNameOrUnnamed(trip)
}

/**
 * {@link tripRowLabel} **mid-sentence** — `claimed by an unnamed trip.` A
 * name is its own noun phrase and takes no article; the substitute is a
 * common noun and needs one, so the words come from `UNNAMED_TRIP` with the
 * article prepended and the sentence's own case applied, rather than from a
 * second literal that could drift from the row fact beneath the line. A Trip
 * not yet in the fold reads the same way: there is no name to state either.
 *
 * The price, and it is the one `personNameOrUnnamed` already pays: a Trip
 * genuinely named `Unnamed trip` reads with the article too. The article is
 * `an` because the substitute begins with a vowel — change the words and
 * change the article with them.
 */
function tripSentenceLabel(state: DepotState, tripId: string): string {
  const label = tripRowLabel(state, tripId)
  return label === UNNAMED_TRIP ? `an ${UNNAMED_TRIP.toLowerCase()}` : label
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

/**
 * Verb agreement for a count noun — the mirror of {@link pluralize}, not a
 * copy of it with the arguments swapped. A noun takes its **plural** spelling
 * when the count isn't one (`2 entries`), but the verb beside it takes the
 * **singular**-looking form exactly then (`1 entry claims`, `2 entries
 * claim`) — `claims` is the singular-count output, `claim` the plural-count
 * one, and that is correct English, not a mistake in argument order. Named
 * separately so a call like `verbAgreement(1, 'claims', 'claim')` reads as
 * intentional instead of inviting a future edit to "fix" it back to
 * `pluralize`'s order.
 */
function verbAgreement(
  count: number,
  singular: string,
  plural: string,
): string {
  return count === 1 ? singular : plural
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

export interface OverClaimGroup {
  /**
   * Which of the three shapes below produced this group — fix round F7's
   * React key. The three line-builders below are copy, and copy is exactly
   * what an editorial pass changes; `line` itself is not structural (two of
   * the three shapes could plausibly read alike after such a pass), where
   * `kind` names the partition {@link overClaimGroups} actually computed
   * and cannot collide by construction — the function pushes at most one
   * group per kind.
   */
  readonly kind: 'cross-trip' | 'here-only-depot' | 'here-only-person'
  /** The attention line, true of exactly the `overClaims` beside it. */
  readonly line: string
  readonly overClaims: readonly OverClaim[]
}

/**
 * Partitions `overClaims` into the lines that are actually true of the rows
 * beneath them — fix round F2's ruling: **a line counts only what it
 * names.** Three shapes, each its own group, omitted when empty:
 *
 * - **Cross-Trip** — at least one other Trip holds a claim. Named or
 *   counted exactly as spec §4.5's table (`already claimed by X` /
 *   `claimed by N other trips`); kind-agnostic, since neither sentence
 *   states a depot quantity.
 * - **Here-only, Single/Counted** — no other Trip at all; states the
 *   depot's supply, a real number for these two Kinds.
 * - **Here-only, Per-person** — no other Trip at all; **never** states a
 *   depot quantity (fix round F3 — `claim.ts`'s own docstring: per-person
 *   has none), so it names the People actually doubled instead.
 *
 * A Gear can only ever land in one group (an `OverClaim`'s claims either
 * include another Trip or they don't, and its `kind` is fixed), so the
 * groups partition `overClaims` rather than overlap.
 *
 * Also the one place that defends against fix round F8: any `OverClaim`
 * naming no claim of `tripId` at all is dropped before it can reach a line
 * or a row.
 */
export function overClaimGroups(
  overClaims: readonly OverClaim[],
  tripId: string,
  state: DepotState,
): readonly OverClaimGroup[] {
  const relevant = overClaims.filter(
    (overClaim) => hereClaims(overClaim, tripId).length > 0,
  )

  const crossTrip = relevant.filter(
    (overClaim) => distinctOtherTripIds(overClaim, tripId).length > 0,
  )
  const hereOnly = relevant.filter(
    (overClaim) => distinctOtherTripIds(overClaim, tripId).length === 0,
  )
  const hereOnlyPerson = hereOnly.filter(
    (overClaim) => overClaim.kind === 'per_person',
  )
  const hereOnlyDepot = hereOnly.filter(
    (overClaim) => overClaim.kind !== 'per_person',
  )

  const groups: OverClaimGroup[] = []
  if (crossTrip.length > 0) {
    groups.push({
      kind: 'cross-trip',
      line: crossTripLine(crossTrip, tripId, state),
      overClaims: crossTrip,
    })
  }
  if (hereOnlyDepot.length > 0) {
    groups.push({
      kind: 'here-only-depot',
      line: hereOnlyDepotLine(hereOnlyDepot, tripId),
      overClaims: hereOnlyDepot,
    })
  }
  if (hereOnlyPerson.length > 0) {
    groups.push({
      kind: 'here-only-person',
      line: hereOnlyPersonLine(hereOnlyPerson, tripId, state),
      overClaims: hereOnlyPerson,
    })
  }
  return groups
}

/**
 * Spec §4.5's table: `1 entry is already claimed by Alps 2026.` /
 * `5 entries are claimed by 2 other trips.` — one other Trip overall is
 * named with `already`; two or more are counted instead, never `already`,
 * since each row then names its own.
 */
function crossTripLine(
  overClaims: readonly OverClaim[],
  tripId: string,
  state: DepotState,
): string {
  const entries = entriesIn(overClaims, tripId)
  const noun = pluralize(entries, 'entry', 'entries')
  const verb = pluralize(entries, 'is', 'are')
  const otherTripIds = globalOtherTripIds(overClaims, tripId)

  if (otherTripIds.length === 1) {
    const label = tripSentenceLabel(state, otherTripIds[0]!)
    return `▲ ${entries} ${noun} ${verb} already claimed by ${label}.`
  }
  return `▲ ${entries} ${noun} ${verb} claimed by ${otherTripIds.length} other trips.`
}

/**
 * No board draws this line — decision recorded in the task report. Reachable
 * two ways with no other Trip in sight: two offline Devices add the same
 * Gear to *this* Trip twice, or one Counted Entry's own Bring-count already
 * exceeds Owned-count. States the depot's supply, which is a real number for
 * Single and Counted (never for per-person — see {@link hereOnlyPersonLine}).
 */
function hereOnlyDepotLine(
  overClaims: readonly OverClaim[],
  tripId: string,
): string {
  const entries = entriesIn(overClaims, tripId)
  const noun = pluralize(entries, 'entry', 'entries')
  const verb = verbAgreement(entries, 'claims', 'claim')
  return `▲ ${entries} ${noun} ${verb} more of this gear than the depot holds.`
}

/**
 * Fix round F3's line. `claim.ts`'s own docstring on {@link OverClaim}:
 * per-person's `supply`/`claimed` are a fact of who happens to be claiming,
 * not of the depot, and invariant 6 gives per-person gear no owned-count at
 * all — so this never says "the depot holds" anything. It names the People
 * actually doubled instead, which for this shape (no other Trip, so every
 * claim is here) is always reachable: an over-claim needs a Person named by
 * two or more claims, so `contestedPersonIds` is never empty for a group
 * this function is called on.
 */
function hereOnlyPersonLine(
  overClaims: readonly OverClaim[],
  tripId: string,
  state: DepotState,
): string {
  const entries = entriesIn(overClaims, tripId)
  const noun = pluralize(entries, 'entry', 'entries')
  const verb = verbAgreement(entries, 'claims', 'claim')
  const names = unionContestedPersonIds(overClaims).map((personId) =>
    personNameOrUnnamed(state, personId),
  )
  return `▲ ${entries} ${noun} ${verb} ${joinNames(names)} more than once.`
}

/**
 * One row's mono fact — spec §4.5: `SINGLE · STILL OUT` /
 * `×2 LISTED · ×1 OUT · OWNED ×2`, each optionally trailing its own Trip's
 * name when `nameRow` is set. The kind/status words are baked caps
 * constants; the trailing Trip name (and, for per-person, the People named)
 * stay in their **recorded case** — `Unnamed trip`, not `UNNAMED TRIP` — the
 * same split decision 4 draws between a row's casing and a settle route's.
 * `.fact`'s CSS still uppercases the whole line for the boards' all-caps
 * look; this is the source text underneath it.
 *
 * **Per-person never reads this branch's numbers.** `claim.ts`'s own
 * docstring on {@link OverClaim}: `supply`/`claimed` are a fact of who
 * happens to be claiming for that Kind, not of the depot, and rendering them
 * as `OWNED ×N` would state a number nobody recorded (invariant 6 gives
 * per-person gear no owned-count at all). No board draws a per-person row, so
 * this reads {@link OverClaim.contestedPersonIds} and names the People
 * instead — the one thing the domain actually recorded.
 */
function rowFact(
  overClaim: OverClaim,
  tripId: string,
  state: DepotState,
  nameRow: boolean,
): string {
  // Ruling F's correction: `nameRow` is the caller's multi-Trip heuristic
  // (`ConflictRows`' `nameEachRow`), right for Single/Counted because their
  // *line* already names the one other Trip when there is only one — but
  // the per-person line (`hereOnlyPersonLine`) counts claims and can never
  // name a Trip, and the cross-Trip line's plural branch counts too. Either
  // way the per-person **row** is the only place its Trip is ever said, so
  // it forces the suffix on rather than inheriting the heuristic built for
  // a different line class.
  const effectiveNameRow = overClaim.kind === 'per_person' ? true : nameRow
  const suffix = effectiveNameRow
    ? distinctOtherTripIds(overClaim, tripId).map((id) =>
        tripRowLabel(state, id),
      )
    : []

  if (overClaim.kind === 'per_person') {
    const names = overClaim.contestedPersonIds.map((personId) =>
      personNameOrUnnamed(state, personId),
    )
    return ['PER-PERSON', `CONTESTED ${names.join(', ')}`, ...suffix].join(
      ' · ',
    )
  }

  const here = hereClaims(overClaim, tripId)
  const hereTotal = here.reduce((sum, claim) => sum + claim.count, 0)
  const otherTotal = overClaim.claimed - hereTotal

  if (overClaim.kind === 'single') {
    const parts = [
      'SINGLE',
      otherTotal > 0 ? 'STILL OUT' : `×${hereTotal} LISTED`,
    ]
    return [...parts, ...suffix].join(' · ')
  }

  // Counted, and defensively any future numeric Kind `claim.ts` grows a rule
  // for — the same generic template, since both count in pieces.
  const parts = [`×${hereTotal} LISTED`]
  if (otherTotal > 0) parts.push(`×${otherTotal} OUT`)
  // Fix round F6: `overClaim.supply` is `ownedCount?.value ?? 1`
  // (`claim.ts`'s own `supplyAndClaimed`), so an absent register already
  // reads as the same `1` a genuinely-owned-one Gear would — printing
  // `OWNED ×1` either way would state a number nobody recorded for the
  // absent case, the exact failure the per-person branch above exists to
  // avoid. Reading the register directly, rather than trusting `supply`
  // alone, is what tells the two apart; unreachable from this app's own
  // authoring (Add gear always writes `ownedCount` for a Counted Kind), but
  // reachable from a peer on a different build.
  if (state.gear[overClaim.gearId]?.ownedCount !== undefined) {
    parts.push(`OWNED ×${overClaim.supply}`)
  }
  return [...parts, ...suffix].join(' · ')
}
