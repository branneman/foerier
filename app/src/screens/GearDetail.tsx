import {
  containmentView,
  dimensionValues,
  gearKindSet,
  gearOwnedCountSet,
  gearRehomed,
  gearRenamed,
  gearRetired,
  gearTagApplied,
  gearTagRemoved,
  normalizeTag,
  tagsOf,
  whereabouts,
  type DepotState,
  type GearState,
  type KindValue,
  type PathSegment,
  type WhereaboutsSlice,
} from '@foerier/shared'
import { Chip, Confirm, Sheet } from '@foerier/ui'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'wouter'

import { HomePicker } from '../components/HomePicker'
import { TagPicker } from '../components/TagPicker'
import { WhereaboutsCard } from '../components/WhereaboutsCard'
import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
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

/** `SHARED`, or the owning person's name — an intrinsic attribute
 * (`docs/ubiquitous-language.md`, Ownership), but nothing in this slice
 * authors a personal owner yet (that is story 4/S4's work), so every piece
 * of gear a Quartermaster can create here reads as shared. */
function ownerLabel(state: DepotState, gear: GearState): string {
  const owner = gear.owner?.value
  if (owner === undefined || owner.type === 'shared') return 'SHARED'
  const person = state.people[owner.personId]
  return (person?.name?.value ?? '').toUpperCase()
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

/** `×1 ⌂ CRATE B` — one chip per {@link WhereaboutsSlice}, never per unit
 * (Vocabulary guards: depot units of counted gear carry no identity). */
function chipLabel(slice: WhereaboutsSlice): string {
  return `×${slice.count} ⌂ ${chipLocation(slice.path)}`
}

export function GearDetail() {
  const params = useParams<{ id: string }>()
  const gearId = params.id
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)

  const [moveOpen, setMoveOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [kindDraft, setKindDraft] = useState<KindValue>('single')
  const [countDraft, setCountDraft] = useState('1')
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
    setCountDraft(String(current.ownedCount?.value ?? 1))
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

    if (kindDraft === 'counted') {
      const parsedCount = Number.parseInt(countDraft, 10)
      const validCount = Number.isSafeInteger(parsedCount) && parsedCount >= 0
      if (validCount && parsedCount !== current.ownedCount?.value) {
        emit(gearOwnedCountSet(id, parsedCount))
      }
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
  const { slices } = whereabouts(state, gearId)

  return (
    <div className={styles['screen']}>
      <header className={styles['header']}>
        <Link href="/" className={styles['back']}>
          ‹ DEPOT
        </Link>
        <span className={styles['sync']}>
          <span className={styles['syncDot']} aria-hidden="true" />
          {syncLabel(sync)}
        </span>
      </header>

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

      <WhereaboutsCard slices={slices} />

      {counted && (
        <div className={styles['countGroup']} data-testid="count-group">
          <div className={styles['countHeader']}>
            <span className={styles['groupLabel']}>COUNT</span>
            <span className={styles['countOwned']}>
              ×{gear.ownedCount?.value ?? 0} OWNED
            </span>
          </div>
          <div className={styles['countChips']}>
            {slices.map((slice) => (
              <span
                key={slice.kind}
                className={styles['countChip']}
                data-testid="count-chip"
              >
                {chipLabel(slice)}
              </span>
            ))}
          </div>
          <p className={styles['countHint']}>
            {
              'COUNTED GEAR HAS NO PER-UNIT IDENTITY — UNITS THAT DIFFER ARE SEPARATE SINGLE GEAR.'
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
            emit(gearRehomed(gearId, residence))
            setMoveOpen(false)
          }}
          excludeGearId={gearId}
          {...(gear.residence?.value === undefined
            ? {}
            : { current: gear.residence.value })}
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

            {kindDraft === 'counted' && (
              <label className={styles['field']}>
                <span className={styles['label']}>Owned count</span>
                <input
                  type="number"
                  className={styles['input']}
                  value={countDraft}
                  min={0}
                  onChange={(event) => setCountDraft(event.target.value)}
                />
              </label>
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
