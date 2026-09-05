import {
  entryKind,
  entryLabel,
  entryResidenceOf,
  isPacked,
  nextStatus,
  ownerLabel,
  packingItems,
  personNameOrUnnamed,
  pieceCountOf,
  pieceStatusOf,
  sameTripResidence,
  statusGlyph,
  statusLabel,
  statusOf,
  tripEntryStatusSet,
  tripPieceStatusSet,
  TRIP_LOOSE,
  type PackingItem,
  type StatusValue,
  type TripResidence,
} from '@foerier/shared'
import { PersonCluster, StatusPill } from '@foerier/ui'
import { useMemo } from 'react'

import { personInitial } from '../household/people'
import { useHousehold } from '../household/store'
import { tripParticipants } from '../household/trips'
import styles from './PackingRow.module.css'
import {
  pillToneForStatus,
  residenceLabel,
  toneForStatus,
} from './PieceStatusSheet'

/**
 * **One line of work on F4** — ruling A2, `docs/design/README.md` §1's
 * two-targets bullet, spec §4.3.
 *
 * ## The row has exactly two targets, and they are the domain's two tracks
 *
 * **Right edge** = *how far along*: the status pill, tapping through
 * `○ → ◐ → ● → ○`, or — on a per-person row — the 34px circle cluster as
 * **one control**. **Row body** = *where*: the Pack picker, or (per-person)
 * the Piece status sheet, which is the only surface that can say that one
 * Piece rides in the duffel while another is loose.
 *
 * The row body was free *precisely because* the pill already owns the thumb
 * side, and that is also what keeps the two apart: **all three targets are
 * horizontally inset 0**, so ruling O's clamped extensions grow into the
 * row's own vertical padding and never reach across each other. The pill
 * states an explicit ≥44 and paints it; the body and the cluster each carry
 * a clamped `::after`, because `.row` is `align-items: center` and a flex
 * item is sized to its *content* on the cross axis rather than stretched —
 * an earlier draft of this paragraph claimed the body inherited the row's
 * 64px and it does not (review F1; `PackingRow.module.css` carries the
 * arithmetic). Neither this row nor any ancestor of it may carry
 * `overflow: hidden` — a clipped descendant is not hit-testable, and
 * `drawnSizes.test.ts` reads stylesheet text, so it would pass over a hit
 * area that does not exist.
 *
 * ## Circles are never individual tap targets
 *
 * Ruling B, reaffirmed at 34px by ruling A1: a 44px target on a 39px pitch
 * puts a tap meant for Els on Mark — B's own arithmetic one size up, on the
 * screen used with cold hands. So the cluster is one control, wrapped
 * `aria-hidden` inside a button that carries the whole fact as its
 * accessible name (`EntryRow`'s pattern, unchanged), and no circle is ever a
 * `<button>` of its own.
 *
 * **The visible `1/3` sits in the meta line, not inside the cluster button**
 * — a departure from `EntryRow`, which puts its `×N` inside the control —
 * because the board draws it there (`S9 Round` §01: `PER-PERSON · 1/3` on
 * the meta, three bare circles at the right edge). That is harmless **only
 * because on a per-person row the body and the cluster open the same
 * sheet**, so the digit and the circles remain one control's worth of
 * target between them. The cluster's own `aria-label` still states the whole
 * fact, so nothing depends on reading the digit. **If PERSON mode ever gives
 * a per-person row's body a different destination, this becomes a ruling B
 * violation** and the digit has to move inside the cluster button.
 *
 * ## A container Entry has no status pill anywhere
 *
 * Ruling A5, sync §3.7: a container carries a journey *instead of* a status.
 * The row reads that from **{@link statusOf} returning `null`** — never from
 * `entryKind`, never from the register — which is also the narrowing the
 * type demands, so the two cannot come apart. In CONTAINER mode a container
 * is a group header rather than a row, and the header draws a rail where
 * this draws a pill.
 *
 * ## One pill for a whole Bring-count
 *
 * Ruling A13: `status` is one register on the Entry and counted units have
 * no per-unit identity, so `Trekking poles ×2` carries one pill and one tap
 * moves the trip's count by two. Correct, and needing no UI.
 *
 * ## The meta line
 *
 * `SHARED · ×1` · `PERSONAL E · ×2` · `PER-PERSON · 1/3`, and `NOT IN DEPOT`
 * for a trip-only Entry, which also takes the amber `TRIP-ONLY` badge beside
 * its name — `EntryRow`'s badge, same encoding and the same place, a name
 * adjunct rather than trailing-column content.
 *
 * ## `scopedPersonIds` narrows a per-person row to one group's Pieces
 *
 * Ruling C1: in CONTAINER mode a per-person Entry draws **one row per group
 * holding at least one of its Pieces**, and this prop is which Pieces those
 * are. The cluster paints them and them alone — a one-circle cluster is a
 * legal cluster — and the count is scoped with it, because a row's count has
 * to sum into the header above it.
 *
 * What is left over is stated, not drawn: `PER-PERSON · 1/1 · 2 ELSEWHERE`
 * (ruling C2). **Muted, not amber** — a remainder, not a residence; the
 * residence is the header, and a set in two bags is not a fault. It appears
 * **only above zero**, which is what keeps `PER-PERSON · 1/3` standing
 * unchanged on every drawn frame with its meaning narrowed to *packed over
 * Pieces in this group*, and it counts the **whole Entry** even under
 * `○ LEFT`: it says where the rest of the set is, not what the filter shows.
 *
 * **The Pieces that are elsewhere are never drawn as dashed circles.** Dashed
 * and dim is `PersonCluster`'s word for *excluded* on the builder, and a
 * removed Piece is not drawn on F4 at all — so a dashed circle here would
 * read *not bringing one*, the state invariant 11 expresses by removal. One
 * tone may not mean two things across two callers of one primitive.
 *
 * Absent, the row is its whole Entry — every Piece, and no remainder. PERSON
 * and ALL mode pass nothing, and neither does CONTAINER for a Kind that has
 * no Pieces.
 *
 * The ownership segment is {@link ownerLabel}'s `PERSONAL E`, not the
 * board's `PERSONAL · E`: `docs/design/README.md` §2 resolved that spelling
 * to the Depot's when S4 shipped the function, and §1's own note says S9
 * inherits it rather than re-deciding. A depot Entry whose Gear has not
 * reached this replica reads `SHARED` — `personPartition`'s rule 3 for the
 * identical state, read here rather than invented.
 *
 * ## `personId` draws one Piece, and PERSON mode is its caller
 *
 * With `personId` set the row *is* one Piece: the pill reads that Piece's
 * own status and emits `trip.piece_status_set`, the body moves that Piece
 * alone, and the name gains the board's `— ELS'S PIECE` suffix — recorded
 * case in the DOM, capped by CSS, the house rule — over a meta line that is
 * simply where the Piece rides. CONTAINER mode never passes it — a
 * per-person Entry is one row with a cluster there — so PERSON mode is the
 * only caller.
 *
 * **A per-person row's body still opens the sheet in PERSON mode**, and it
 * has to: a Piece row is not a per-person row (it carries a pill, not a
 * cluster), so the "body and cluster open the same sheet" invariant the
 * `1/3` digit leans on is untouched. PERSON mode never draws a clustered row
 * at all — `personPartition` splits a per-person Entry into one item per
 * Piece — so the only clustered rows on this screen are CONTAINER's and
 * ALL's, both of which route body and cluster to the sheet together.
 *
 * ## The residence segment, and `▸ MIXED`
 *
 * {@link PackingRowProps.showResidence} is what PERSON and ALL mode add on
 * top: once no group header states *where*, the meta line has to end in the
 * item's own trip residence (ruling A8). It is drawn **amber in both modes**,
 * one encoding — the boards draw the identical segment amber in the ALL frame
 * and muted in the PERSON frame, which would make one colour mean two things,
 * and amber is the app's standing `▸` trip-world mark (§2's WHEREABOUTS
 * column, gear detail's card).
 *
 * **PERSON mode passes it for every row it draws, Piece rows included**, and
 * a Piece row therefore never renders without it — its residence is the only
 * fact it has that its Entry does not, and it is that row's entire meta line.
 * The flag is one condition and not `showResidence || personId !== undefined`:
 * the second half would only ever be true for a configuration no caller
 * renders, which is a branch pinned by nothing but the shape of a unit test.
 *
 * What the segment says depends on what the row is:
 *
 * - a **Piece** row: that Piece's own residence, which is the only fact a
 *   Piece has that its Entry does not;
 * - a **per-person Entry** row: the residence its Pieces share, or `▸ MIXED`
 *   where they sit in different containers — the sheet is what states each
 *   one, and the row cannot;
 * - anything else: the Entry's own residence.
 *
 * A per-person Entry with **no** Pieces (no Participants, or every Piece
 * tombstoned) falls through to its Entry residence, which is the honest read:
 * `MIXED` needs two answers to disagree and there are none.
 */
export interface PackingRowProps {
  tripId: string
  entryId: string
  /** Set to draw one Piece of a per-person Entry rather than the Entry. */
  personId?: string
  /**
   * The Entry's Pieces **in this group** — CONTAINER mode's scoping, ruling
   * C1. Deliberately not a near-spelling of `personId` above: that one says
   * *this row is one Piece*, this one says *this row is the Entry, narrowed
   * to these Pieces*. See the docstring.
   */
  scopedPersonIds?: readonly string[]
  /** End the meta line in the item's trip residence — PERSON and ALL mode,
   * where no group header states *where*. See the docstring. */
  showResidence?: boolean
  /**
   * The whole Trip's {@link packingItems}, when the caller already holds
   * them. Optional for the reason `containerTotals`' `view` and `items` are:
   * a screen builds one list, not one per row — and omitting it here builds
   * a containment view *and* a list per row, which is the N × O(entries)
   * that docstring asks callers not to pay. The packing screen threads its
   * one memo through; the default is for a caller that draws a single row.
   */
  tripItems?: readonly PackingItem[]
  /** The row body's *where*: the Pack picker, for this Entry or Piece. */
  onOpenPicker: () => void
  /** The per-person cluster's control, and a per-person row's own body. */
  onOpenPieceSheet: () => void
}

/** One circle's worth of a per-person row: who, how far along, and where —
 * the last of the three for `▸ MIXED` alone, which is a fact about the set
 * rather than about any one circle. */
interface RowPiece {
  personId: string
  label: string
  status: StatusValue
  residence: TripResidence
}

/** What a per-person row says when its Pieces disagree about where they
 * ride. `residenceLabel`'s `▸` grammar with no container to name. */
const MIXED = '▸ MIXED'

export function PackingRow({
  tripId,
  entryId,
  personId,
  scopedPersonIds,
  showResidence = false,
  tripItems,
  onOpenPicker,
  onOpenPieceSheet,
}: PackingRowProps) {
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)

  const trip = state.trips[tripId]
  const entry = trip?.entries?.[entryId]

  /**
   * Every Piece of this Entry, in display order — the same read
   * `PieceStatusSheet` makes, and deliberately through {@link packingItems}
   * rather than a second derivation: that selector already decides what an
   * absent Piece status and an absent Piece residence read as, and a row
   * whose circles disagreed with the sheet they open would be exactly the
   * drift `packing.ts` exists to prevent.
   *
   * Gated on the Kind rather than computed and thrown away: `packingItems`
   * is O(entries), and CONTAINER mode draws one of these per row, so the
   * ungated version would pay O(rows × entries) on the list the app is used
   * on most — `containerTotals`' own note, one level down. For the same
   * reason it reads {@link PackingRowProps.tripItems} when the caller holds
   * them: an omitted list is built here *with a containment view of its
   * own*, once per row.
   */
  const pieces = useMemo<readonly RowPiece[]>(() => {
    if (trip === undefined || entry === undefined) return []
    if (entryKind(entry, state) !== 'per_person') return []
    const byPerson = new Map<string, PackingItem>()
    for (const item of tripItems ?? packingItems(trip, state)) {
      if (item.kind !== 'piece' || item.entryId !== entryId) continue
      byPerson.set(item.personId, item)
    }
    return tripParticipants(state, trip).flatMap((person) => {
      const item = byPerson.get(person.id)
      if (item === undefined) return []
      return [
        {
          personId: person.id,
          label: person.label,
          status: item.status,
          residence: item.residence,
        },
      ]
    })
  }, [state, trip, entry, entryId, tripItems])

  // The ids are the caller's, and a row can outlive the Entry it names by a
  // fold — another Device's `trip.entry_removed`, arriving between render
  // and the next. `PieceStatusSheet` takes the same shape for the same
  // reason.
  if (trip === undefined || entry === undefined) return null

  const label = entryLabel(entry, state)
  const kind = entryKind(entry, state)
  const source = entry.source?.value
  const tripOnly = source !== undefined && source.from === 'trip_only'
  const gear =
    source !== undefined && source.from === 'depot'
      ? state.gear[source.gearId]
      : undefined

  const isPiece = personId !== undefined
  const isPerPerson = !isPiece && kind === 'per_person'

  const status = isPiece
    ? pieceStatusOf(entry.pieces?.[personId], entry, state)
    : statusOf(entry, state)

  /**
   * The Pieces this row is *about* — every Piece of the Entry, or the ones
   * `scopedPersonIds` names (ruling C1). The filter keeps `pieces`' order,
   * which is `tripParticipants`', so the cluster's circles stay in People
   * order however the group's items arrived.
   */
  const scoped =
    scopedPersonIds === undefined
      ? pieces
      : pieces.filter((piece) => scopedPersonIds.includes(piece.personId))

  const packedHere = scoped.filter((piece) => isPacked(piece.status)).length
  /** The rest of the set — the **whole** Entry minus what is drawn here, so
   * it is unmoved by `○ LEFT` (ruling C2). */
  const elsewhere = pieces.length - scoped.length

  // The muted half of the meta line: what the item **is**. A Piece has none
  // — its Entry's ownership and units belong to the Entry, and the board
  // draws a Piece row's meta as its residence alone.
  const meta = tripOnly
    ? 'NOT IN DEPOT'
    : isPiece
      ? ''
      : isPerPerson
        ? `PER-PERSON · ${packedHere}/${scoped.length}`
        : // `SHARED` for a depot Entry whose Gear has not reached this
          // replica — `personPartition`'s rule 3 for the identical state.
          `${gear === undefined ? 'SHARED' : ownerLabel(state, gear)} · ×${pieceCountOf(entry, trip, state)}`

  /**
   * The amber half: where it rides on this Trip, drawn only where no group
   * header says so. See the docstring for the three readings and for why
   * `MIXED` needs two Pieces to disagree.
   */
  // An arrow const, not a declaration: a hoisted `function` can in principle
  // be called before the `trip === undefined` guard above, so TypeScript
  // declines to carry the narrowing into one (`Packing.tsx`'s own note).
  const residenceSegment = (): string => {
    if (!showResidence) return ''

    // **One path, not a Piece special case.** The subject of a Piece row is
    // that one Piece; of any other row, every Piece the Entry has — which is
    // none unless it is per-person, so this is also the Kind gate. A single
    // candidate can never disagree with itself, so a Piece row can never read
    // `MIXED`, and it needs no branch saying so.
    //
    // `pieces` is read rather than `packingItems` walked a second time: that
    // memo already holds every Piece of this Entry with its own **effective**
    // residence applied — a Piece naming none reads `loose` (§5e C0), never
    // its Entry's, which is the read C0 overturned S9a's layering for.
    const subject =
      personId === undefined
        ? pieces
        : pieces.filter((piece) => piece.personId === personId)

    let shared: TripResidence | null = null
    for (const piece of subject) {
      if (shared === null) {
        shared = piece.residence
        continue
      }
      if (!sameTripResidence(shared, piece.residence)) return MIXED
    }

    // No Pieces at all — a single or counted Entry, or a per-person one with
    // no Participant left holding a Piece.
    //
    // **Through `entryResidenceOf`, never the register** (ruling C0): for a
    // per-person Entry that register is folded and read by nobody, so the
    // gate answers `null` and this row falls to `▸ LOOSE` — the honest read
    // for a set with no Pieces anywhere, and the one that agrees with the
    // `Loose` group CONTAINER mode draws it under. Every other Kind reads
    // its own register through the same call, absent reading loose.
    return residenceLabel(
      trip,
      state,
      shared ?? entryResidenceOf(entry, state) ?? TRIP_LOOSE,
    )
  }

  const residence = residenceSegment()

  function advance(current: StatusValue) {
    if (personId === undefined) {
      emit(tripEntryStatusSet(tripId, entryId, nextStatus(current)))
      return
    }
    emit(tripPieceStatusSet(tripId, entryId, personId, nextStatus(current)))
  }

  /**
   * Ruling C2's accessible name. Scoped, it reads
   * `Headlamp, 1 of 1 packed here, 2 elsewhere`; with nothing elsewhere it is
   * the S9 string **unchanged**, `Headlamp, 1 of 3 packed` — the same
   * "only above zero" rule the visible line follows, so a row whose Pieces
   * all share a group announces exactly what it always did.
   */
  const clusterName =
    elsewhere > 0
      ? `Packing status — ${label}, ${packedHere} of ${scoped.length} packed here, ${elsewhere} elsewhere`
      : `Packing status — ${label}, ${packedHere} of ${scoped.length} packed`

  return (
    <div className={styles['row']} data-testid="packing-row">
      <button
        type="button"
        className={styles['body']}
        data-testid="packing-row-body"
        onClick={isPerPerson ? onOpenPieceSheet : onOpenPicker}
      >
        <span className={styles['nameLine']}>
          <span className={styles['name']} data-testid="packing-row-name">
            {label}
          </span>
          {/* Recorded case here, drawn in caps by `.piece`'s own
              `text-transform` — `PieceStatusSheet`'s `.residence`
              convention, and the house rule that CAPS is a CSS transform
              rather than a string.

              **The leading `{' '}` is not decoration.** `.nameLine`'s gap
              separates the two spans on screen, but a gap is not a
              character: without it the row's text content — and so the body
              button's accessible name — reads `Headlamp— Els's piece`, one
              word, with the dash glued to the gear. The space is the only
              thing that makes the drawn `Headlamp — ELS'S PIECE` and the
              announced name the same sentence. */}
          {isPiece && (
            <>
              {' '}
              <span className={styles['piece']}>
                {`— ${personNameOrUnnamed(state, personId)}'s piece`}
              </span>
            </>
          )}
          {/* `{' '}` for the same reason the Piece suffix above carries
              one: `.nameLine`'s flex `gap` is not a character, so without it
              the body button announces `PassportsTRIP-ONLY`. */}
          {tripOnly && (
            <>
              {' '}
              <span className={styles['badge']}>TRIP-ONLY</span>
            </>
          )}
        </span>
        {(meta !== '' || residence !== '') && (
          <span className={styles['meta']} data-testid="packing-row-meta">
            {meta}
            {/* Ruling C2's remainder, muted rather than amber and drawn only
                above zero. Its own element for the trip card's ▲ reason: a
                single text node would force the muted class onto the whole
                meta line or onto none of it, and the scoped count beside it
                is the ledger. */}
            {elsewhere > 0 && (
              <>
                {' · '}
                <span className={styles['elsewhere']}>
                  {elsewhere} ELSEWHERE
                </span>
              </>
            )}
            {/* The separator belongs to neither half — it appears only where
                both are drawn, which is why it is not baked into either
                string. */}
            {meta !== '' && residence !== '' && ' · '}
            {residence !== '' && (
              <span className={styles['residence']}>{residence}</span>
            )}
          </span>
        )}
      </button>

      {isPerPerson ? (
        <button
          type="button"
          className={styles['cluster']}
          aria-label={clusterName}
          data-testid="packing-row-cluster"
          onClick={onOpenPieceSheet}
        >
          {/* `aria-hidden` + `display: contents`: this button already carries
              the whole fact as its own label, so `PersonCluster`'s
              `role="img"` would announce the roster a second time
              (`EntryRow`'s pattern, commit `83e2d6f`). */}
          <span aria-hidden="true" className={styles['clusterWrap']}>
            {/* `scoped`, not `pieces`: the cluster paints the Pieces in this
                group and no others (ruling C1), and every one it paints
                takes a status tone. **No entry is ever `dashed`** — that is
                the builder's *excluded*, and a Piece elsewhere is not
                excluded; it is the meta line's `N ELSEWHERE`. */}
            <PersonCluster
              people={scoped.map((piece) => ({
                key: piece.personId,
                label: personInitial(piece.label),
                tone: toneForStatus(piece.status),
              }))}
              size={34}
              label={clusterName}
            />
          </span>
        </button>
      ) : (
        // `null` is a container (ruling A5), and the narrowing the type
        // demands is the same one the ruling states — see the docstring.
        status !== null && (
          <StatusPill
            glyph={statusGlyph(status)}
            label={statusLabel(status)}
            tone={pillToneForStatus(status)}
            onClick={() => advance(status)}
          />
        )
      )}
    </div>
  )
}
