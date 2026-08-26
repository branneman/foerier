import {
  gearKindSet,
  gearOwnedCountSet,
  gearRehomed,
  gearRenamed,
  gearRetired,
  whereabouts,
  type DepotState,
  type GearState,
  type KindValue,
  type PathSegment,
  type WhereaboutsSlice,
} from '@foerier/shared'
import { useState } from 'react'
import { Link, useParams } from 'wouter'

import { HomePicker } from '../components/HomePicker'
import { WhereaboutsCard } from '../components/WhereaboutsCard'
import { useDepot } from '../depot/store'
import { syncLabel } from '../depot/syncLabel'
import styles from './GearDetail.module.css'

/**
 * Gear detail — identity, whereabouts, count and the action bar
 * (`docs/design/README.md` §4). The previous task built the top (header,
 * name, MVP meta line) and the bottom (the action bar); this task builds the
 * middle — the Whereabouts card and the COUNT group (story 3's read) — from
 * the `whereabouts` selector. Tag chips (story 13) and the LEDGER group
 * (story 33, LATER) are later slices again — neither is built or
 * placeholder'd here.
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

/** The innermost segment's name, or `HOME` for a loose slice — the COUNT
 * chip's location word (`docs/design/README.md` §4: `×1 ⌂ CRATE B`). CAPS is
 * a CSS transform on `.countChip` (`GearDetail.module.css`), not applied
 * here, matching how the rest of this codebase renders label text. */
function chipLocation(path: readonly PathSegment[]): string {
  const last = path[path.length - 1]
  return last === undefined ? 'HOME' : last.name
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

      {/* Mounted unconditionally, not gated by `!retired`: `HomePicker`
          itself renders nothing while `open` is false, and `moveOpen` can
          only ever become true from the MOVE button above, which exists
          solely inside that `!retired` branch. Retired gear's action bar
          still offers nothing — this just leans on that instead of a second
          `!retired` check, so a later refactor of the button doesn't leave
          this picker reachable without also touching this comment. */}
      <HomePicker
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        onSelect={(residence) => {
          emit(gearRehomed(gearId, residence))
          setMoveOpen(false)
        }}
        excludeGearId={gearId}
      />

      {editOpen && (
        <div
          className={styles['scrim']}
          onClick={(event) => {
            if (event.target === event.currentTarget) setEditOpen(false)
          }}
        >
          <div
            className={styles['sheet']}
            role="dialog"
            aria-modal="true"
            aria-label="Edit gear"
          >
            <h2 className={styles['sheetTitle']}>Edit gear</h2>

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
              <button
                type="button"
                className={styles['ghost']}
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles['primary']}
                onClick={() => submitEdit(gearId, gear)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {retireOpen && (
        <div className={styles['confirmScrim']}>
          <div
            className={styles['confirmSheet']}
            role="alertdialog"
            aria-modal="true"
            aria-label={`Retire ${name}?`}
          >
            <h3 className={styles['confirmTitle']}>Retire {name}?</h3>
            <p className={styles['confirmBody']}>
              Kept in the ledger. Not offered as a home, not listed on a trip.
            </p>
            <div className={styles['confirmActions']}>
              <button
                type="button"
                className={styles['ghost']}
                onClick={() => setRetireOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles['confirmRetire']}
                onClick={() => {
                  emit(gearRetired(gearId))
                  setRetireOpen(false)
                }}
              >
                Retire gear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
