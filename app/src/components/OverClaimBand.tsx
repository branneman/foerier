import {
  personLabel,
  tripLabel,
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
 * component returns `null` outright when `overClaims` is empty rather than
 * drawing an empty shell.
 *
 * `overClaims` is a prop, not something this component derives, because two
 * different questions feed the same block: the trip screen asks
 * `overClaimsFor(state, tripId)` (spec §3.5) and the two §02B sheets ask the
 * hypothetical `overClaimsIfActive(state, tripId)` — both computed by the
 * caller, never re-derived here. `tripId` still matters to the component: it
 * is what tells "here" from "there" inside each {@link OverClaim}'s
 * `claims`.
 *
 * Gear and Trip names are read from the store directly (`TripCard`'s own
 * precedent), rather than threaded through as a second data shape — an
 * `OverClaim` names ids, not labels, and a label is a fact of the fold like
 * any other.
 */
export interface OverClaimBandProps {
  readonly tripId: string
  readonly overClaims: readonly OverClaim[]
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
}

export function OverClaimBand({
  tripId,
  overClaims,
  onRemoveHere,
  onRemoveThere,
  onBringFewer,
}: OverClaimBandProps) {
  // Hooks run unconditionally — the empty-band `null` returns after this.
  const state = useDepot((depot) => depot.state)

  if (overClaims.length === 0) return null

  return (
    <section className={styles['band']} data-testid="over-claim-band">
      <p className={styles['attention']} data-testid="over-claim-attention">
        {attentionLine(overClaims, tripId, state)}
      </p>
      <ConflictRows
        tripId={tripId}
        overClaims={overClaims}
        onRemoveHere={onRemoveHere}
        onRemoveThere={onRemoveThere}
        onBringFewer={onBringFewer}
      />
    </section>
  )
}

export interface ConflictRowsProps {
  readonly tripId: string
  readonly overClaims: readonly OverClaim[]
  readonly onRemoveHere: (entryId: string) => void
  readonly onRemoveThere: (tripId: string, entryId: string) => void
  readonly onBringFewer: (entryId: string, count: number) => void
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
 */
export function ConflictRows({
  tripId,
  overClaims,
  onRemoveHere,
  onRemoveThere,
  onBringFewer,
}: ConflictRowsProps) {
  const state = useDepot((depot) => depot.state)
  const [expanded, setExpanded] = useState(false)

  // Whether a row names its own other Trip, or leaves it to the attention
  // line above — spec §4.5's table: one other Trip overall and the line
  // already named it, so the row would only repeat it; two or more and the
  // line counts instead, so each row is the only place its own Trip is said.
  const nameEachRow = globalOtherTripIds(overClaims, tripId).length >= 2

  const visible = expanded ? overClaims : overClaims.slice(0, VISIBLE_CAP)
  const hiddenCount = overClaims.length - VISIBLE_CAP

  return (
    <div className={styles['rows']} data-testid="over-claim-rows">
      {visible.map((overClaim) => (
        <ConflictRow
          key={overClaim.gearId}
          overClaim={overClaim}
          tripId={tripId}
          state={state}
          nameRow={nameEachRow}
          onRemoveHere={onRemoveHere}
          onRemoveThere={onRemoveThere}
          onBringFewer={onBringFewer}
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
  readonly onRemoveHere: (entryId: string) => void
  readonly onRemoveThere: (tripId: string, entryId: string) => void
  readonly onBringFewer: (entryId: string, count: number) => void
}

function ConflictRow({
  overClaim,
  tripId,
  state,
  nameRow,
  onRemoveHere,
  onRemoveThere,
  onBringFewer,
}: ConflictRowProps) {
  // `entry.ts`'s own rule for a Gear name: an absent register reads empty,
  // never invented.
  const name = state.gear[overClaim.gearId]?.name?.value ?? ''
  const here = hereClaims(overClaim, tripId)[0]
  const otherTripIds = distinctOtherTripIds(overClaim, tripId)
  // `claimed > supply` is guaranteed by `claim.ts`'s own detection test, so
  // this is always > 0 for an `OverClaim` this component is ever handed.
  const excess = overClaim.claimed - overClaim.supply

  return (
    <div
      className={styles['row']}
      data-testid={`over-claim-row-${overClaim.gearId}`}
    >
      <div className={styles['rowHead']}>
        <span className={styles['gearName']}>{name}</span>
        <span className={styles['fact']}>
          {rowFact(overClaim, tripId, state, nameRow)}
        </span>
      </div>
      <div className={styles['settleRow']}>
        {here !== undefined && overClaim.kind === 'counted' && (
          <button
            type="button"
            className={styles['settle']}
            onClick={() =>
              onBringFewer(here.entryId, Math.max(here.count - excess, 0))
            }
          >
            BRING ×{Math.max(here.count - excess, 0)} HERE
          </button>
        )}
        {here !== undefined && overClaim.kind !== 'counted' && (
          <button
            type="button"
            className={styles['settle']}
            onClick={() => onRemoveHere(here.entryId)}
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
              onClick={() => onRemoveThere(otherTripId, claim.entryId)}
            >
              REMOVE ON {removeOnTarget(state, otherTripId)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pure helpers — no store read, no op, every one a straight function of the
// `OverClaim`s and `tripId` handed to it.

function hereClaims(overClaim: OverClaim, tripId: string): readonly Claim[] {
  return overClaim.claims.filter((claim) => claim.tripId === tripId)
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

/** The union of every row's other-Trip ids — what the attention line counts. */
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

/**
 * `tripLabel` in a sentence — `—` is right in a list column and wrong mid-
 * sentence, the split `UNNAMED_PERSON` already carries and `UNNAMED_TRIP`
 * repeats (spec §4.5). A Trip not yet in the fold reads the same way: there
 * is no name to state either.
 */
function tripSentenceLabel(state: DepotState, tripId: string): string {
  const trip = state.trips[tripId]
  const label = trip === undefined ? undefined : tripLabel(trip)
  return label === undefined || label === '—' ? 'an unnamed trip' : label
}

/** `tripLabel` in a row: `Unnamed trip`, words, per spec §4.5. */
function tripRowLabel(state: DepotState, tripId: string): string {
  const trip = state.trips[tripId]
  const label = trip === undefined ? undefined : tripLabel(trip)
  return label === undefined || label === '—' ? UNNAMED_TRIP : label
}

/**
 * The settle route's own short form — `Alps 2026` on the row reads `ALPS` on
 * its `REMOVE ON` link, and `Ardennen — Sep` would read `ARDENNEN`: the
 * leading word is the place, and the rest is the date qualifier the link has
 * no room for. `Unnamed trip` is the one name this never shortens (spec
 * §4.5's `REMOVE ON UNNAMED TRIP`, both words) — there is no "rest" to trim
 * off it, and trimming would leave a link reading `REMOVE ON UNNAMED`, which
 * names nothing.
 *
 * Uppercased here, unlike {@link rowFact}'s Trip-name suffix — decision 4's
 * split: `Unnamed trip` is a row's own casing, `REMOVE ON UNNAMED TRIP` is a
 * settle route's, and a settle route carries no other-case content anywhere
 * else (`REMOVE HERE`, `BRING ×1 HERE` are both already-caps constants), so
 * this is the one place a Trip name is baked rather than left to `.settle`'s
 * CSS transform to produce.
 */
function removeOnTarget(state: DepotState, tripId: string): string {
  const label = tripRowLabel(state, tripId)
  if (label === UNNAMED_TRIP) return 'UNNAMED TRIP'
  const firstWord = label.split(/[\s—]+/).find((part) => part.length > 0)
  return (firstWord ?? label).toUpperCase()
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

/**
 * The band's headline — spec §4.5's table, the one part "most easily got
 * wrong". `entries` counts **here**-claims (one per conflicting Entry on
 * `tripId`), never a claim's `count` field — the piece count a Counted claim
 * carries is a different number from how many Entries are in conflict.
 *
 * Three shapes:
 * - **No other Trip at all** — decision recorded in the task report: two
 *   offline Devices can add the same Gear to *this* Trip twice, or one
 *   Entry's own Bring-count can already exceed Owned-count, with no other
 *   Trip in sight. No board draws this line; it is written to match the
 *   voice of the two the boards do.
 * - **One other Trip** — named, `already`.
 * - **Two or more** — counted, never `already` (each row names its own).
 */
function attentionLine(
  overClaims: readonly OverClaim[],
  tripId: string,
  state: DepotState,
): string {
  const entries = overClaims.reduce(
    (sum, overClaim) => sum + hereClaims(overClaim, tripId).length,
    0,
  )
  const noun = pluralize(entries, 'entry', 'entries')
  const otherTripIds = globalOtherTripIds(overClaims, tripId)

  if (otherTripIds.length === 0) {
    const verb = pluralize(entries, 'claims', 'claim')
    return `▲ ${entries} ${noun} ${verb} more of this gear than the depot holds.`
  }

  const verb = pluralize(entries, 'is', 'are')
  if (otherTripIds.length === 1) {
    const label = tripSentenceLabel(state, otherTripIds[0]!)
    return `▲ ${entries} ${noun} ${verb} already claimed by ${label}.`
  }

  return `▲ ${entries} ${noun} ${verb} claimed by ${otherTripIds.length} other trips.`
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
  const suffix = nameRow
    ? distinctOtherTripIds(overClaim, tripId).map((id) =>
        tripRowLabel(state, id),
      )
    : []

  if (overClaim.kind === 'per_person') {
    const names = overClaim.contestedPersonIds.map((personId) =>
      personLabel(state, personId),
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
      otherTotal > 0 ? 'STILL OUT' : `LISTED ×${hereTotal}`,
    ]
    return [...parts, ...suffix].join(' · ')
  }

  // Counted, and defensively any future numeric Kind `claim.ts` grows a rule
  // for — the same generic template, since both count in pieces.
  const parts = [`×${hereTotal} LISTED`]
  if (otherTotal > 0) parts.push(`×${otherTotal} OUT`)
  parts.push(`OWNED ×${overClaim.supply}`)
  return [...parts, ...suffix].join(' · ')
}
