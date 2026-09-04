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
  normalizeTag,
  overClaims,
  ownerLabel,
  ownerOf,
  personLabel,
  residenceOf,
  tagsOf,
  whereabouts,
  whereaboutsByPerson,
  whereaboutsText,
  type DepotState,
  type GearState,
  type KindValue,
  type Owner,
  type PathSegment,
  type PersonWhereabouts,
  type WhereaboutsSlice,
} from '@foerier/shared'
import { Chip, Confirm, PersonCircle, Sheet, Stepper } from '@foerier/ui'
import { useMemo, useState } from 'react'
import { useParams } from 'wouter'

import { HomePicker, sameResidence } from '../components/HomePicker'
import { OwnerPicker } from '../components/OwnerPicker'
import { TagPicker } from '../components/TagPicker'
import { WhereaboutsCard } from '../components/WhereaboutsCard'
import { personInitial, sortedPeople } from '../depot/people'
import { useDepot } from '../depot/store'
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

const KIND_OPTIONS: readonly { value: KindValue; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'per_person', label: 'Per-person' },
  { value: 'counted', label: 'Counted' },
]

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
 * (`sync-protocol.md` §5.3) at this line's altitude. */
function metaLine(state: DepotState, gear: GearState): string {
  const parts = [traitLabel(gear), ownerLabel(state, gear)]
  if (gear.kind?.value === 'counted' && gear.ownedCount?.value !== undefined) {
    parts.push(`×${gear.ownedCount.value}`)
  }
  return parts.filter((part) => part !== '').join(' · ')
}

/** The innermost segment's name, or `LOOSE` for a loose slice — the COUNT
 * chip's location word (`docs/design/README.md` §4: `×1 ⌂ CRATE B`).
 * `LOOSE` is the ubiquitous-language term for gear with no residence
 * (`docs/ubiquitous-language.md`) and matches `WhereaboutsCard`'s own
 * `pathText` fallback for the identical condition — fix round 1 caught this
 * chip disagreeing with the card two elements above it on the same screen.
 * CAPS is a CSS transform on `.countChip` (`GearDetail.module.css`), not
 * applied here, matching how the rest of this codebase renders label
 * text. */
function chipLocation(path: readonly PathSegment[]): string {
  const last = path[path.length - 1]
  return last === undefined ? 'LOOSE' : last.name
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
 * string replaces it: `M ▲ 2 TRIPS`. **No route** — D7: *a chip is not a
 * door and never has been*, which is why this returns text and not a link. */
function pieceChipText(person: PersonWhereabouts): string {
  if (person.contestedTripIds.length >= 2) {
    return `▲ ${person.contestedTripIds.length} TRIPS`
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
  state: DepotState,
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
    gear.kind?.value === 'counted' && claim !== undefined
      ? `CLAIMED ×${claim.claimed} · OWNED ×${claim.supply}`
      : `CLAIMED BY ${tripSlices.length} TRIPS`

  return {
    text,
    href: `/trips/${first.tripId}`,
    resolveLabel: `Resolve on ${first.tripName}`,
  }
}

export function GearDetail() {
  const params = useParams<{ id: string }>()
  const gearId = params.id
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)
  // `splitPane`: at Split this screen is the right-hand pane of `DepotView`,
  // with the Depot list drawn in the left one.
  const header = useScreenHeader({ splitPane: true })

  const [moveOpen, setMoveOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [kindDraft, setKindDraft] = useState<KindValue>('single')
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

  function openEdit(current: GearState) {
    setNameDraft(current.name?.value ?? '')
    setKindDraft(current.kind?.value ?? 'single')
    setCountDraft(current.ownedCount?.value ?? 1)
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

    if (kindDraft !== current.kind?.value) {
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
  const counted = gear.kind?.value === 'counted'
  const perPerson = gear.kind?.value === 'per_person'
  const { slices, overClaimed } = whereabouts(state, gearId)
  const overClaim = overClaimed
    ? overClaimFooter(state, gear, gearId, slices)
    : undefined

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
  const anyPieceOut = [...pieceAnswers.values()].some(
    (answer) => answer.slice.kind === 'trip',
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
      />

      {counted && (
        <div className={styles['countGroup']} data-testid="count-group">
          <div className={styles['countHeader']}>
            <span className={styles['groupLabel']}>COUNT</span>
            <span className={styles['countOwned']}>
              ×{gear.ownedCount?.value ?? 0} OWNED
            </span>
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
              return (
                <span
                  key={person.id}
                  className={styles['pieceChip']}
                  data-testid="piece-chip"
                >
                  <PersonCircle label={personInitial(person.label)} size={22} />{' '}
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
          onSelect={(residence) => {
            // The picker reports the `● NOW` row like any other, and
            // suppressing it is this caller's job (`HomePicker`'s `onSelect`
            // contract, `Packing.tsx`'s `sameTripResidence` shape). A
            // `gear.rehomed` naming the home the gear already has is a
            // needless write, and a needless write is never free: it moves
            // the stamp LWW compares and can silently beat a genuine move
            // queued on a Device that was offline.
            if (!sameResidence(residenceOf(gear), residence)) {
              emit(gearRehomed(gearId, residence))
            }
            setMoveOpen(false)
          }}
          excludeGearId={gearId}
          // Always passed: an absent register **is** loose (`residenceOf`),
          // so the Loose row is `● NOW` for gear recorded with no home rather
          // than nothing being marked at all.
          current={residenceOf(gear)}
          // MOVE, so the picker draws the context line and confirms before it
          // moves anything (see `HomePicker`'s header for why story 36 makes
          // that necessary).
          moving={{
            name,
            insideCount: containmentView(state).childrenOf({
              kind: 'gear',
              id: gearId,
            }).length,
          }}
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
              <div className={styles['segmented']}>
                {KIND_OPTIONS.map((option) => (
                  <label key={option.value} className={styles['segment']}>
                    <input
                      type="radio"
                      name="kind"
                      value={option.value}
                      checked={kindDraft === option.value}
                      onChange={() => setKindDraft(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
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
              <Confirm.Cancel>
                <button type="button" className={styles['ghost']}>
                  Cancel
                </button>
              </Confirm.Cancel>
              <Confirm.Action>
                <button
                  type="button"
                  className={styles['confirmRetire']}
                  onClick={() => emit(gearRetired(gearId))}
                >
                  Retire gear
                </button>
              </Confirm.Action>
            </>
          }
        />
      )}
    </div>
  )
}
