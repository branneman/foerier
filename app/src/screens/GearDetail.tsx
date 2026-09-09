import {
  containmentView,
  dimensionValues,
  gearKindSet,
  gearOwnedCountSet,
  gearOwnershipSet,
  gearRehomed,
  gearRenamed,
  gearRetired,
  gearTagApplied,
  gearTagRemoved,
  homeRidesAlongCount,
  isCounted,
  isPerPerson,
  kindOf,
  LOOSE_TEXT,
  normalizeTag,
  overClaims,
  ownedCountOf,
  ownerLabel,
  ownerOf,
  personLabel,
  residenceOf,
  sameResidence,
  type Residence,
  tagsOf,
  type GearState,
  type HouseholdState,
  type KindValue,
  type Owner,
  type PathSegment,
  type PersonWhereabouts,
  type Unaccounted,
  type WhereaboutsSlice,
  whereabouts,
  whereaboutsByPerson,
  whereaboutsText,
} from '@foerier/shared'
import {
  Chip,
  Confirm,
  PersonCircle,
  SegmentedControl,
  Sheet,
  Stepper,
} from '@foerier/ui'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'wouter'

import { HomeMoveConfirm } from '../components/HomeMoveConfirm'
import { HomePicker } from '../components/HomePicker'
import { OwnerPicker } from '../components/OwnerPicker'
import { TagPicker } from '../components/TagPicker'
import {
  WhereaboutsCard,
  type WhereaboutsCardUnaccounted,
} from '../components/WhereaboutsCard'
import { homeLabel, KIND_OPTIONS } from '../household/gear'
import { personInitial, sortedPeople } from '../household/people'
import { useHousehold } from '../household/store'
import { ScreenBand } from '../shell/ScreenBand'
import { useScreenHeader } from '../shell/useMediaQuery'
import styles from './GearDetail.module.css'

/**
 * Gear detail — identity, tags, whereabouts, count and the action bar
 * (`docs/design/README.md` §4).
 *
 * S2 built the top (header, name, MVP meta line), the middle (the Whereabouts
 * card and the COUNT group, from the `whereabouts` selector) and the bottom
 * (the action bar). **S3 adds the tag chips** — the settled chip of
 * Components §06, and the trailing `+ tag` ghost that is the one edit
 * affordance on an otherwise read-only screen.
 *
 * **S9b makes the card and COUNT state the trip world too, and adds
 * PIECES** (§5f D1/D2/D6/D7/D8, spec §4.2): the card draws one row per
 * {@link WhereaboutsSlice} (home first, then trip slices A→Z) with a footer
 * that turns ▲ + `RESOLVE` the moment claims exceed supply; `COUNT` gains one
 * chip per claiming Trip, home chips first; and the new `PIECES` group lists
 * a per-person Gear's claiming Trip(s)' Participants, each at chip density,
 * only while a Piece is actually out. `overClaimFooter` is the one place
 * §6.1's Counted-only rule is decided — `WhereaboutsCard` itself stays
 * presentational and reads no selector for domain logic.
 *
 * Still not built, and still not placeholder'd: the **LEDGER** group (story
 * 33) and every **weight** segment (story 16), both drawn final on the board
 * and both tagged LATER.
 */

/**
 * `ITEM` or `CONTAINER` — the meta line's first segment names the
 * **containment trait** (`gear.container`), not the Kind (`docs/design/
 * README.md` §4; `docs/domain-model.md` §2). Kind has no token of its own
 * here; its only visible consequence on this line is the `×N` glyph below.
 * See the fix-round-1 commit and task report for why.
 */
function traitLabel(gear: GearState): string {
  return gear.container?.value === true ? 'CONTAINER' : 'ITEM'
}

/** `ITEM · SHARED · ×2` — the MVP meta line (no weight segment; that is
 * story 16, tagged LATER). `×N` appears only for counted gear
 * (invariant 6: owned-count exists only for counted gear); an unrecognised
 * `kind` simply never matches `'counted'`, so it neither crashes nor is
 * coerced into showing a count it does not own — obligation 4
 * (`sync-protocol.md` §5.3) at this line's altitude.
 *
 * **`ownedCountOf` decides both halves of that**, the Kind gate and what an
 * absent register reads as. The old `ownedCount !== undefined` test beside
 * it was a second, quieter reading of the same register — `nothing` where
 * the selector says `×1` — and it disagreed with the COUNT header six
 * elements down this same screen. */
function metaLine(state: HouseholdState, gear: GearState): string {
  const owned = ownedCountOf(gear)
  const parts = [traitLabel(gear), ownerLabel(state, gear)]
  if (owned !== null) parts.push(`×${owned}`)
  return parts.filter((part) => part !== '').join(' · ')
}

/** The innermost segment's name, or `LOOSE` for a loose slice — the COUNT
 * chip's location word (`docs/design/README.md` §4: `×1 ⌂ CRATE B`).
 * `LOOSE_TEXT` is `whereabouts.ts`'s own export (S9b review finding 3), the
 * one spelling `WhereaboutsCard`'s `pathText` fallback and the Depot column
 * also read — fix round 1 caught this chip disagreeing with the card two
 * elements above it on the same screen; a third private literal here would
 * have been the same fault a third time.
 * CAPS is a CSS transform on `.countChip` (`GearDetail.module.css`), not
 * applied here, matching how the rest of this codebase renders label
 * text. */
function chipLocation(path: readonly PathSegment[]): string {
  const last = path[path.length - 1]
  return last === undefined ? LOOSE_TEXT : last.name
}

/** `home` or `trip:<tripId>` — the same composite key
 * `WhereaboutsCard`'s own collision fix uses, needed here for the identical
 * reason: two active Trips both claiming this Gear draw two chips. */
function chipKey(slice: WhereaboutsSlice): string {
  return slice.kind === 'home' ? 'home' : `trip:${slice.tripId}`
}

/** `×1 ⌂ CRATE B` for the home slice, `×1 ▸ ALPS 2026` per trip slice — one
 * chip per {@link WhereaboutsSlice}, never per unit (Vocabulary guards: depot
 * units of counted gear carry no identity). Home chips first — `whereabouts`'s
 * own order, unchanged here.
 *
 * `null` when the slice carries no quantity, and the caller skips it rather
 * than this function inventing one. That replaces the old `×${slice.count ??
 * 1}`, which re-spelled `ownedCountOf`'s own absent-register default at this
 * call site — unreachable today (the COUNT group renders only for Counted
 * gear, whose slices are never null-count), but a defaulting call site reads
 * as a rule regardless of whether it is ever exercised. */
function chipLabel(slice: WhereaboutsSlice): string | null {
  if (slice.count === null) return null
  return slice.kind === 'home'
    ? `×${slice.count} ⌂ ${chipLocation(slice.path)}`
    : `×${slice.count} ▸ ${slice.tripName}`
}

/** A Participant's own `PIECES` chip text (`docs/design/README.md` §4):
 * `whereaboutsText` at chip density — `M ▸ ALPS 2026`, `K ⌂ HAL ▸ LADE 2` —
 * unless two Trips both claim their Piece, in which case D7's Piece-row
 * string replaces it: `M ▲ 2 TRIPS`, or unless their own Piece is
 * unaccounted for, which reads `K ▲ TESSIN 2025` (§5i G10). **No route** —
 * D7: *a chip is not a door and never has been*, which is why this returns
 * text and not a link.
 *
 * The two `▲` cases cannot both hold: `unaccountedTripName` is set only
 * where the slice is the home answer, and a contested Piece is on two
 * active Trips. Contested is checked first anyway, so the precedence is
 * stated rather than left to that fact. */
function pieceChipText(person: PersonWhereabouts): string {
  if (person.contestedTripIds.length >= 2) {
    return `▲ ${person.contestedTripIds.length} TRIPS`
  }
  if (person.unaccountedTripName !== null) {
    return `▲ ${person.unaccountedTripName}`
  }
  return whereaboutsText(person.slice, 'chip')
}

/**
 * §6.1's Counted-only rule, composed here rather than inside
 * `WhereaboutsCard`: the presentational card must not decide a domain rule
 * (decision 1), so this is the one place that reads `claim.ts`'s numbers.
 *
 * Counted gear states the two numbers `claim.ts` already computed —
 * `▲ CLAIMED ×4 · OWNED ×2` — because `supply`/`claimed` really are depot
 * quantities for that Kind. Every other Kind, Single included (D1's own
 * reason: no quantity to state), falls back to D7's Piece-row string,
 * `▲ CLAIMED BY N TRIPS`, reused rather than invented.
 *
 * `N` is read off `slices` — already one per **claiming Trip**, merged
 * inside `whereabouts` — rather than `OverClaim.claims.length`, which
 * counts Entries and would over-count a Trip holding this Gear twice.
 *
 * `RESOLVE` routes to the first claiming Trip by name A→Z (D7), which is
 * `slices`' own order beyond the leading home slice — no second sort.
 */
function overClaimFooter(
  state: HouseholdState,
  gear: GearState,
  gearId: string,
  slices: readonly WhereaboutsSlice[],
): { text: string; href: string; resolveLabel: string } | undefined {
  const tripSlices = slices.filter(
    (slice): slice is Extract<WhereaboutsSlice, { kind: 'trip' }> =>
      slice.kind === 'trip',
  )
  const first = tripSlices[0]
  if (first === undefined) return undefined

  const claim = overClaims(state).find((entry) => entry.gearId === gearId)
  const text =
    isCounted(gear) && claim !== undefined
      ? `CLAIMED ×${claim.claimed} · OWNED ×${claim.supply}`
      : `CLAIMED BY ${tripSlices.length} TRIPS`

  return {
    text,
    href: `/trips/${first.tripId}`,
    resolveLabel: `Resolve on ${first.tripName}`,
  }
}

/**
 * S10, F16(3): the unaccounted footer's own composition, the identical shape
 * `overClaimFooter` already takes — the presentational card must not decide
 * which unit states a count, so this is the one place that reads
 * `ownedCountOf`'s answer for the standing. `owned` is the **same** call
 * `metaLine` and the COUNT group already made (line above `whereabouts` in
 * this component) — never a second `ownedCountOf` for the identical Gear.
 * `units` travels with it: `null` for anything that is not Counted, exactly
 * the gate `whereabouts.ts`'s own private `unaccountedPrefix` reads for the
 * Depot column.
 */
function unaccountedFooter(
  unaccounted: Unaccounted,
  owned: number | null,
  onResolve: () => void,
): WhereaboutsCardUnaccounted {
  return {
    tripName: unaccounted.tripName,
    // Both Counted and per-person state a count now, so this travels
    // unconditionally and the card's own two gates pick the form. A Single
    // states no quantity at all and never reads it.
    units: unaccounted.units,
    ownedCount: owned,
    // §5i G10: per-person's own form, `▲ 2 OF 3 PIECES · LAST SEEN: …`,
    // and **never** `OWNED` — per-person gear has no owned-count at all
    // (invariant 6), so the count it does have is the one that travels.
    // Non-empty exactly for per-person, `unaccountedOf`'s own gate, which
    // is the same one the Depot column reads.
    pieceTotal: unaccounted.pieceIds.length,
    onResolve,
  }
}

/** `RESOLVING HEADLAMP · LAST SEEN: TESSIN 2025` (`docs/design/README.md`
 *  §06) — the recorded name kept in its **recorded case**, exactly as
 *  `Unpack.tsx`'s own `reHomeContext` leaves `moving.name`: `.context`'s own
 *  `text-transform: uppercase` (`HomePicker.module.css`) is what paints it
 *  in caps. */
function resolveContext(
  name: string,
  tripName: string,
): { act: string; consequence: string } {
  return { act: `RESOLVING ${name}`, consequence: `LAST SEEN: ${tripName}` }
}

export function GearDetail() {
  const params = useParams<{ id: string }>()
  const gearId = params.id
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)
  const sync = useHousehold((depot) => depot.sync)
  // `splitPane`: at Split this screen is the right-hand pane of `DepotView`,
  // with the Depot list drawn in the left one.
  const header = useScreenHeader({ splitPane: true, back: '/' })

  const [moveOpen, setMoveOpen] = useState(false)
  /**
   * The home MOVE has picked, waiting on its confirm — this screen's, not the
   * picker's (`patterns.md` §4.3). The sheet stays open behind it, so Cancel
   * returns to the list the pick was made from, which is what the confirm
   * drawn *inside* the sheet used to give for free.
   */
  const [pendingMove, setPendingMove] = useState<Residence | null>(null)
  const [resolveOpen, setResolveOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  // `KindValue | undefined`, because `kindOf` reads an absent register as
  // *no Kind* and the sheet is not allowed to invent one. The segmented
  // control simply draws nothing checked, and Save writes nothing until a
  // Quartermaster picks.
  const [kindDraft, setKindDraft] = useState<KindValue | undefined>(undefined)
  const [countDraft, setCountDraft] = useState<number | null>(1)
  const [ownerDraft, setOwnerDraft] = useState<Owner>({ type: 'shared' })
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
  const [retireOpen, setRetireOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)

  // The vocabulary both the counts and the near-duplicate defence come from.
  // Derived from the whole depot, not from this gear: the point of the counts
  // is to show a spelling that already exists *elsewhere*.
  const vocabulary = useMemo(() => dimensionValues(state, 'tag'), [state])

  const gear: GearState | undefined =
    gearId === undefined ? undefined : state.gear[gearId]

  // **One containment view for the whole screen** (finding M4). `whereabouts`
  // and `HomePicker`'s `moving.ridesAlong` both need one. It is a plain
  // call rather than a `useMemo` because `containment.ts` now holds the
  // memo itself, keyed on the fold — the hoist here was a screen defending
  // against a per-call O(depot) build that no longer happens.
  const view = containmentView(state)

  // F16(3)'s standing, read here — ahead of the `gear === undefined` return
  // below — only so the `useEffect` beside it can be called unconditionally
  // (the rules of hooks refuse one placed after a conditional return).
  // `whereabouts` is called again, after the return, for `slices` and
  // `overClaimed`; its own `tripSlicesOf` memo (keyed on this `state`) makes
  // the trip half of that second call free, and `view` above is what keeps
  // the home half from being a second walk.
  const unaccounted =
    gearId === undefined ? null : whereabouts(state, gearId, view).unaccounted

  // S10 minor: a peer's `gear.rehomed` settling the standing through sync
  // clears `unaccounted` and unmounts the RESOLVE picker below (its own JSX
  // gate), but would otherwise leave `resolveOpen` sitting `true` — so a
  // standing that later reappears (a fresh `lost` outcome on the same Gear)
  // would pop the picker open with no tap at all. Reset the flag the moment
  // the standing itself clears.
  useEffect(() => {
    if (unaccounted === null) setResolveOpen(false)
  }, [unaccounted])

  function openEdit(current: GearState) {
    setNameDraft(current.name?.value ?? '')
    // The Kind through `kindOf`, exactly as `ownerDraft` goes through
    // `ownerOf` below and for the identical reason: `kindOf` refuses to
    // default, so an absent register seeds `undefined` rather than a `Single`
    // the Save would then author.
    //
    // The count seeds from the **raw register** and `null` when there is
    // none, which is `Stepper`'s report that the well is blank — the well
    // **opens empty** on gear nobody has counted, exactly as Add gear's does
    // (`design/README.md` §3b). Seeding it with `ownedCountOf`'s defaulted
    // `1` would draw a number Save then discarded as unchanged, making
    // `owned_count = 1` the one value this sheet could never record.
    setKindDraft(kindOf(current))
    setCountDraft(current.ownedCount?.value ?? null)
    // Through `ownerOf`, not `current.owner?.value`: an absent register has
    // to seed the draft as `{type:'shared'}` so that an untouched Save
    // compares equal and writes nothing. Reading the raw register here would
    // make every Save on pre-S4 gear author an ownership op.
    setOwnerDraft(ownerOf(current))
    setEditOpen(true)
  }

  function submitEdit(id: string, current: GearState) {
    const trimmedName = nameDraft.trim()
    if (trimmedName !== '' && trimmedName !== (current.name?.value ?? '')) {
      emit(gearRenamed(id, trimmedName))
    }

    if (kindDraft !== undefined && kindDraft !== kindOf(current)) {
      emit(gearKindSet(id, kindDraft))
    }

    // `null` is `Stepper`'s report that its well is currently blank. A
    // silent `×1` is a wrong ledger line whether Add gear writes it or gear
    // detail does: an emptied well must write nothing, never fall back to
    // whatever `countDraft` last held.
    if (
      kindDraft === 'counted' &&
      countDraft !== null &&
      countDraft !== current.ownedCount?.value
    ) {
      emit(gearOwnedCountSet(id, countDraft))
    }

    // Only when it changed, the discipline every field above follows. Both
    // sides go through `ownerOf`, so gear with no register compares equal to
    // the `Shared` the sheet drew and a no-op Save stays a no-op — which
    // matters more here than elsewhere, because a needless write would move
    // the gear's `recordedAt` and reorder `NEWEST FIRST`.
    const currentOwner = ownerOf(current)
    const ownerChanged =
      ownerDraft.type !== currentOwner.type ||
      (ownerDraft.type === 'person' &&
        currentOwner.type === 'person' &&
        ownerDraft.personId !== currentOwner.personId)
    if (ownerChanged) {
      emit(gearOwnershipSet(id, ownerDraft))
    }

    setEditOpen(false)
  }

  if (gearId === undefined || gear === undefined) {
    return (
      <div className={styles['screen']}>
        <p className={styles['empty']}>No such gear.</p>
      </div>
    )
  }

  const name = gear.name?.value ?? ''
  const retired = gear.retired?.value === true
  // **The gate and the number are one call.** `ownedCountOf` is `null` for
  // exactly the Kinds that draw no COUNT group, so a second `isCounted`
  // beside it would be two tests that have to agree — and the `?? 0` that
  // used to stand between them was the third answer this screen gave to
  // "how many does the household own".
  const owned = ownedCountOf(gear)
  const perPerson = isPerPerson(gear)
  const { slices, overClaimed } = whereabouts(state, gearId, view)
  const overClaim = overClaimed
    ? overClaimFooter(state, gear, gearId, slices)
    : undefined
  const unaccountedCard =
    unaccounted === null
      ? undefined
      : unaccountedFooter(unaccounted, owned, () => setResolveOpen(true))

  // D6: `whereaboutsByPerson`'s keys are the claiming Trip(s)' Participants,
  // whatever this Gear's Kind — the `PIECES` group renders only for
  // per-person gear (`perPerson` above). **The map being non-empty is not
  // the same fact as "a Piece is on an active Trip"**: a Participant whose
  // Piece was tombstoned stays in the map and reads home (B5), so an Entry
  // whose every Piece has been removed still populates it, every answer
  // reading home — the identical-circles fault §4/D6/B3 exist to prevent.
  // The group therefore gates on at least one answer actually being a trip
  // slice, never on the map's size.
  const pieceAnswers = whereaboutsByPerson(state, gearId)
  const piecePeople = sortedPeople(state).filter((person) =>
    pieceAnswers.has(person.id),
  )
  // §5i G10 widens the gate: the group's own rule is *the answers can
  // differ*, and an unaccounted Piece differs from a Piece on the shelf as
  // plainly as one in a duffel does. Its Trip is usually closed, so it is
  // never a trip slice — which is why this is a second disjunct and not a
  // wider reading of the first.
  const anyPieceOut = [...pieceAnswers.values()].some(
    (answer) =>
      answer.slice.kind === 'trip' || answer.unaccountedTripName !== null,
  )

  return (
    <div className={styles['screen']}>
      {/* From Split up the Depot is already on the page — the list pane at
          Split, the labeled sidebar's `DEPOT` row at Desktop — so `‹ DEPOT`
          points at something the reader can see and goes. The sync line runs
          the other way: `AppShell` draws words in the phone header and in the
          sidebar, but only a bare dot on the Split rail, so this band is where
          the state is legible at exactly that width. Both are
          `useScreenHeader`'s and nowhere else's; `Depot split` (900) is the
          frame that draws this pane. */}
      <ScreenBand
        header={header}
        back={{ href: '/', label: 'DEPOT' }}
        sync={sync}
      />

      <div className={styles['identity']}>
        <h1
          className={`${styles['title']} ${retired ? styles['titleRetired'] : ''}`}
        >
          {retired ? <s>{name}</s> : name}
        </h1>

        <div className={styles['metaRow']}>
          <span className={styles['meta']}>{metaLine(state, gear)}</span>
          {retired && <span className={styles['retiredBadge']}>RETIRED</span>}
        </div>
      </div>

      {/*
        The settled tag chip (Components §06): lowercase, mono, 32px,
        bordered, the `#` drawn and never stored. The trailing dashed ghost is
        **the one edit affordance on this read screen**, and ✕ lives in the
        picker rather than on the chips — a read screen should not destroy
        anything by mis-tap. A gear with no tags shows the lone ghost.
      */}
      <div className={styles['tagChips']} data-testid="tag-chips">
        {/* `ui`'s settled chip at its 32px size — the same component the
            slice bar uses at 36px, so the two cannot drift apart again. */}
        {tagsOf(gear).map((tag) => (
          <Chip key={tag} label={`#${tag}`} size="tag" />
        ))}
        {!retired && (
          <Chip
            label="+ tag"
            size="tag"
            ghost
            onClick={() => setTagsOpen(true)}
          />
        )}
      </div>

      <WhereaboutsCard
        slices={slices}
        {...(overClaim === undefined ? {} : { overClaim })}
        {...(unaccountedCard === undefined
          ? {}
          : { unaccounted: unaccountedCard })}
      />

      {owned !== null && (
        <div className={styles['countGroup']} data-testid="count-group">
          <div className={styles['countHeader']}>
            <span className={styles['groupLabel']}>COUNT</span>
            <span className={styles['countOwned']}>×{owned} OWNED</span>
          </div>
          <div className={styles['countChips']}>
            {slices.map((slice) => {
              const label = chipLabel(slice)
              if (label === null) return null
              return (
                <span
                  key={chipKey(slice)}
                  className={styles['countChip']}
                  data-testid="count-chip"
                >
                  {label}
                </span>
              )
            })}
          </div>
          <p className={styles['countHint']}>
            {
              'COUNTED GEAR HAS NO PER-UNIT IDENTITY — UNITS THAT DIFFER ARE SEPARATE SINGLE GEAR.'
            }
          </p>
        </div>
      )}

      {/* PIECES (`docs/design/README.md` §4, §5f D6): a second group, not a
          second variant of COUNT — per-person gear has no owned-count at all
          (invariant 6), and its split is over People, not units. Two gates,
          neither of which `piecePeople.length` alone can stand in for:
          `perPerson` — `whereaboutsByPerson`'s keys are a claiming Trip's
          Participants regardless of what Kind of Gear it claims, so a
          Counted or Single gear on an active Trip with Participants would
          otherwise populate this exact map too — and `anyPieceOut` — a
          Participant whose Piece was tombstoned stays in the map reading
          home (B5), so an Entry with every Piece removed populates the map
          as well, with every answer reading home. Both are the identical
          fault this group exists to refuse: a per-Person breakdown where
          every answer is the same home path. */}
      {perPerson && anyPieceOut && (
        <div className={styles['piecesGroup']} data-testid="pieces-group">
          <div className={styles['piecesHeader']}>
            <span className={styles['groupLabel']}>PIECES</span>
            <span className={styles['piecesMeta']}>1 PER PERSON</span>
          </div>
          <div className={styles['piecesChips']}>
            {piecePeople.map((person) => {
              const answer = pieceAnswers.get(person.id)
              if (answer === undefined) return null
              const contested = answer.contestedTripIds.length >= 2
              return (
                <span
                  key={person.id}
                  className={`${styles['pieceChip']} ${
                    contested ? styles['attention'] : ''
                  }`}
                  data-testid="piece-chip"
                >
                  <PersonCircle
                    label={personInitial(person.label)}
                    size={22}
                    tone={contested ? 'attention' : 'control'}
                  />{' '}
                  <span>{pieceChipText(answer)}</span>
                </span>
              )
            })}
          </div>
          <p className={styles['piecesHint']}>
            {
              'PER-PERSON GEAR HAS NO OWNED-COUNT — ITS SUPPLY IS ONE PER PERSON.'
            }
          </p>
        </div>
      )}

      {!retired && (
        <div className={styles['actionBar']}>
          <button
            type="button"
            className={styles['bordered']}
            onClick={() => setMoveOpen(true)}
          >
            MOVE
          </button>
          <button
            type="button"
            className={styles['bordered']}
            onClick={() => openEdit(gear)}
          >
            EDIT
          </button>
          <button
            type="button"
            className={styles['retire']}
            onClick={() => setRetireOpen(true)}
          >
            RETIRE
          </button>
        </div>
      )}

      {/* Not gated by `!retired`: `moveOpen` can only ever become true from
          the MOVE button above, which exists solely inside that `!retired`
          branch. Retired gear's action bar still offers nothing — this leans
          on that rather than repeating the check. */}
      {moveOpen && (
        <HomePicker
          onClose={() => setMoveOpen(false)}
          // MOVE confirms — story 36 (Undo) being Later is what makes it
          // necessary — and the confirm is **this screen's** rather than the
          // sheet's (`patterns.md` §4.3). The picker stays open behind it, so
          // Cancel returns to the list the pick was made from.
          //
          // Every pick raises it, the `● NOW` row included, which is what the
          // sheet's own confirm did: the suppression is a rule about the
          // *write*, not about the dialog, and moving it earlier would be a
          // behaviour change this lift has no business making.
          onSelect={setPendingMove}
          excludeGearId={gearId}
          // Always passed: an absent register **is** loose (`residenceOf`),
          // so the Loose row is `● NOW` for gear recorded with no home rather
          // than nothing being marked at all.
          current={residenceOf(gear)}
          // MOVE, so the picker draws the context line and the ride-along.
          moving={{
            name,
            // §5i G2: what moves, at any depth — never the lid-open count.
            ridesAlong: homeRidesAlongCount(gearId, state, view),
          }}
        />
      )}

      {pendingMove !== null && (
        <HomeMoveConfirm
          variant="move"
          movingName={name}
          // Derived from the residence rather than reported back by the
          // picker: `homeLabel` draws the same words the row did, which is
          // what let the sheet lose its own copy of this confirm.
          destinationName={homeLabel(state.places, state.gear, pendingMove)}
          ridesAlong={homeRidesAlongCount(gearId, state, view)}
          onCancel={() => setPendingMove(null)}
          onConfirm={() => {
            // Suppressing the `● NOW` pick is this caller's job (`HomePicker`
            // reports every row; `Packing.tsx`'s `sameTripResidence` shape).
            // A `gear.rehomed` naming the home the gear already has is a
            // needless write, and a needless write is never free: it moves
            // the stamp LWW compares and can silently beat a genuine move
            // queued on a Device that was offline.
            if (!sameResidence(residenceOf(gear), pendingMove)) {
              emit(gearRehomed(gearId, pendingMove))
            }
            setPendingMove(null)
            setMoveOpen(false)
          }}
        />
      )}

      {/* F16's settle route (`docs/design/README.md` §06, §5h), R30's own
          fix round: `onSelect` emits **`gear.rehomed` alone**. The standing
          is a selector reading an Entry's `outcome` register
          (`unaccountedOf`, `unpack.ts`) — `lost` writes nothing against the
          depot, and ending the standing by editing the very outcome the
          selector reads is fixing the thermometer, not the temperature
          (sync §4.5). Editing that register from here would also touch a
          **closed** Trip's history with no reopen and no confirm
          (invariant 19), make ruling F18's *muted-but-still-`N LOST`* state
          unreachable from the one route F16 names as the settler, and pick
          the wrong Entry outright whenever two Entries share this Gear (one
          `consumed`, one `lost` — R31): there is no reliable way from here
          to name *which* Entry's outcome should move, so this call does not
          try. The stamp comparison `outcomeStands` already reads is the
          whole of the truthful record: lost on the Trip, home written
          later.

          **No confirm, and `moving.confirm: false` is what says so.** Plain
          pick mode's own tap-then-write (`patterns.md` §4.3, R26) is what
          F16(3) draws — the row visibly settles the standing, no dialog
          stands between the tap and the write — but a **container** being
          resolved still needs `moving`'s exclusion and its
          `N RIDE ALONG` disclosure (R32, blessed at §5i G5(b)): re-homing
          a lost container
          silently relocates everything inside it otherwise, exactly the
          fact F8's own re-home row and gear detail's own MOVE both state
          before writing. `confirm: false` keeps the write undialogued while
          still stating that fact.

          Deliberately **not** guarded by `sameResidence` the way MOVE's own
          `onSelect` above is: a same-value `gear.rehomed` is `patterns.md`
          §2.3's one stated exception, because writing the *same* home on a
          later clock is precisely the fact that ends the standing
          (`outcomeStands`, `unpack.ts`). Inheriting MOVE's guard here would
          draw a settle route that taps and writes nothing. */}
      {resolveOpen && unaccounted !== null && (
        <HomePicker
          onClose={() => setResolveOpen(false)}
          onSelect={(residence) => {
            emit(gearRehomed(gearId, residence))
            setResolveOpen(false)
          }}
          excludeGearId={gearId}
          current={residenceOf(gear)}
          context={resolveContext(name, unaccounted.tripName)}
          nowLabel="● NOW — FOUND HERE"
          // R32: only a container needs MOVE's own exclusion, footer and
          // ride-along disclosure — an ordinary gear has no subtree to
          // state, and `Unpack.tsx`'s own re-home row takes the identical
          // shape for the identical reason. **This route stays
          // undialogued**, which F16(3) draws: it renders no
          // `HomeMoveConfirm`, where MOVE above does. It used to say so
          // through a `confirm: false` flag on the sheet; now the absence of
          // a confirm at the call site *is* the statement, and the
          // ride-along line still discloses that re-homing a lost container
          // relocates everything inside it.
          {...(gear.container?.value === true
            ? {
                moving: {
                  name,
                  // §5i G2: what moves, at any depth.
                  ridesAlong: homeRidesAlongCount(gearId, state, view),
                },
              }
            : {})}
        />
      )}

      {tagsOpen && (
        <TagPicker
          mode="gear"
          vocabulary={vocabulary}
          applied={tagsOf(gear)}
          onApply={(tag) => {
            // Already normalised by the picker — `normalizeTag` here is what
            // turns that string back into the `TagString` the builder
            // demands, and it is the one place that conversion happens.
            const value = normalizeTag(tag)
            if (value !== null) emit(gearTagApplied(gearId, value))
          }}
          onRemove={(tag) => {
            const value = normalizeTag(tag)
            if (value !== null) emit(gearTagRemoved(gearId, value))
          }}
          onClose={() => setTagsOpen(false)}
        />
      )}

      {editOpen && (
        <Sheet title="Edit gear" onClose={() => setEditOpen(false)}>
          {/* The sheet's own rhythm is 12; this form was drawn at 16 and
              stays there, in a column of its own rather than by bending the
              primitive every other sheet shares. */}
          <div className={styles['sheetBody']}>
            <label className={styles['field']}>
              <span className={styles['label']}>Name</span>
              <input
                className={styles['input']}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                autoComplete="off"
              />
            </label>

            <fieldset className={styles['kindField']}>
              <legend className={styles['label']}>Kind</legend>
              {/* `ui/SegmentedControl`, dense. This screen's hand-rolled copy is the
                  one the primitive exists for: it drew no focus ring at all,
                  so a keyboard user moving through Kind saw nothing, and its
                  `overflow: hidden` container meant it could never grow the
                  hit extension ruling O owes a 40px control. Both arrive with
                  the move; `kindDraft` stays `undefined` for a Gear nobody
                  gave a Kind, which the primitive draws as nothing checked. */}
              <SegmentedControl
                name="kind"
                options={KIND_OPTIONS}
                value={kindDraft}
                onChange={setKindDraft}
                size="dense"
              />
            </fieldset>

            {/* The 48px bordered row Add gear's HOME and OWNER both use.
                The picker stacks on this sheet, the way the Home picker
                already stacks on Add gear. */}
            <button
              type="button"
              className={styles['ownerRow']}
              aria-label="Owner"
              onClick={() => setOwnerPickerOpen(true)}
            >
              <span className={styles['label']}>Owner</span>
              <span className={styles['ownerValue']}>
                {ownerDraft.type === 'shared'
                  ? 'Shared'
                  : personLabel(state, ownerDraft.personId)}{' '}
                <span aria-hidden="true">›</span>
              </span>
            </button>

            {kindDraft === 'counted' && (
              <div className={styles['field']}>
                <span className={styles['label']}>Owned count</span>
                <Stepper
                  size="default"
                  value={countDraft}
                  min={0}
                  onChange={setCountDraft}
                  label="Owned count"
                />
              </div>
            )}

            <div className={styles['sheetActions']}>
              <Sheet.Close>
                <button type="button" className={styles['ghost']}>
                  Cancel
                </button>
              </Sheet.Close>
              <button
                type="button"
                className={styles['primary']}
                onClick={() => submitEdit(gearId, gear)}
              >
                Save
              </button>
            </div>
          </div>

          {ownerPickerOpen && (
            <OwnerPicker
              value={ownerDraft}
              onSelect={(next) => {
                setOwnerDraft(next)
                setOwnerPickerOpen(false)
              }}
              onClose={() => setOwnerPickerOpen(false)}
            />
          )}
        </Sheet>
      )}

      {retireOpen && (
        <Confirm
          title={`Retire ${name}?`}
          description="Kept in the ledger. Not offered as a home, not listed on a trip."
          onClose={() => setRetireOpen(false)}
          actions={
            <>
              {/* Action before Cancel, in the card register too (§5n K13):
                  §5d G settled the order for sheets and the S3-era cards drew
                  the reverse, so the code followed whichever board it was built
                  against. **Leading with Cancel was never the caution** —
                  `Confirm` gives it initial focus wherever it sits (§4.2), so
                  position and focus are two mechanisms and only one has to carry
                  it. */}
              <Confirm.Action>
                <button
                  type="button"
                  className={styles['confirmRetire']}
                  onClick={() => emit(gearRetired(gearId))}
                >
                  Retire gear
                </button>
              </Confirm.Action>
              <Confirm.Cancel>
                <button type="button" className={styles['ghost']}>
                  Cancel
                </button>
              </Confirm.Cancel>
            </>
          }
        />
      )}
    </div>
  )
}
