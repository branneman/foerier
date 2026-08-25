import {
  containmentView,
  placeRecorded,
  placeRemoved,
  placeRenamed,
  systemIdSource,
  visiblePlaces,
  type ContainmentView,
  type DepotState,
  type HolderRef,
  type PlaceState,
  type Residence,
} from '@foerier/shared'
import { useMemo, useState } from 'react'

import { useDepot } from '../depot/store'
import styles from './HomePicker.module.css'

/**
 * One sheet: Places, the containers within them, and Loose
 * (`docs/design/README.md` §3, invariants 1–4 in `docs/domain-model.md`).
 * Used by Add Gear (Task 21) and, unchanged, by `MOVE` (Task 22) — the only
 * thing a caller supplies beyond selection is `excludeGearId`, when the gear
 * being homed already exists.
 *
 * Two guards the reducer deliberately does not enforce (it is tolerant by
 * design, `containmentView`'s job is to break what arrives through sync):
 * only Places and container-gear are ever listed (invariant 2 — plain gear
 * is never offered as a home), and a container excludes itself and every one
 * of its own descendants, at any depth (invariant 3).
 */
export interface HomePickerProps {
  open: boolean
  onClose: () => void
  onSelect: (residence: Residence) => void
  /**
   * The gear being homed, when it already exists (`MOVE`). Omit for Add
   * Gear — the gear has no id yet, so no cycle can be authored through this
   * sheet.
   */
  excludeGearId?: string
}

interface ContainerRow {
  id: string
  name: string
  depth: number
}

function nameOf(
  entity: { name?: { value: string | null } } | undefined,
): string {
  return entity?.name?.value ?? ''
}

function byName(
  a: { id: string; name: string },
  b: { id: string; name: string },
): number {
  const al = a.name.toLowerCase()
  const bl = b.name.toLowerCase()
  if (al !== bl) return al < bl ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/** `excludeGearId` and every gear reachable underneath it, at any depth —
 * the descendant half of invariant 3. Empty when `excludeGearId` is unset. */
function excludedSubtree(
  view: ContainmentView,
  excludeGearId: string | undefined,
): ReadonlySet<string> {
  const result = new Set<string>()
  if (excludeGearId === undefined) return result
  result.add(excludeGearId)
  const stack = [excludeGearId]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) continue
    for (const childId of view.childrenOf({ kind: 'gear', id: current })) {
      if (result.has(childId)) continue
      result.add(childId)
      stack.push(childId)
    }
  }
  return result
}

/** Every container reachable under `holder`, at any depth — depth-first, so
 * a container's own children sit immediately beneath it in the list. Only
 * container-gear is ever returned (invariant 2); a plain item under the same
 * holder is simply never a row here. */
function containerRowsUnder(
  state: DepotState,
  view: ContainmentView,
  holder: HolderRef,
  excluded: ReadonlySet<string>,
  depth: number,
): ContainerRow[] {
  const here = view
    .childrenOf(holder)
    .filter((id) => !excluded.has(id))
    .map((id) => state.gear[id])
    .filter((gear): gear is NonNullable<typeof gear> => gear !== undefined)
    .filter((gear) => gear.container?.value === true)
    .filter((gear) => gear.retired?.value !== true)
    .map((gear) => ({ id: gear.id, name: nameOf(gear), depth }))
    .sort(byName)

  const rows: ContainerRow[] = []
  for (const row of here) {
    rows.push(row)
    rows.push(
      ...containerRowsUnder(
        state,
        view,
        { kind: 'gear', id: row.id },
        excluded,
        depth + 1,
      ),
    )
  }
  return rows
}

/** `4 pieces of gear become loose.` / `1 piece of gear becomes loose.` —
 * the confrontation invariant 4 requires before a Place is removed. */
function looseLine(count: number): string {
  return count === 1
    ? '1 piece of gear becomes loose.'
    : `${count} pieces of gear become loose.`
}

export function HomePicker({
  open,
  onClose,
  onSelect,
  excludeGearId,
}: HomePickerProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)

  const [addingPlace, setAddingPlace] = useState(false)
  const [newPlaceName, setNewPlaceName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)

  const view = useMemo(() => containmentView(state), [state])
  const excluded = useMemo(
    () => excludedSubtree(view, excludeGearId),
    [view, excludeGearId],
  )
  const places = useMemo(() => visiblePlaces(state), [state])

  if (!open) return null

  const removingPlace: PlaceState | null =
    removingId === null ? null : (state.places[removingId] ?? null)
  const removingCount =
    removingId === null
      ? 0
      : view.childrenOf({ kind: 'place', id: removingId }).length

  function startRename(id: string, current: string) {
    setRenamingId(id)
    setRenameValue(current)
  }

  function submitRename() {
    if (renamingId === null) return
    const trimmed = renameValue.trim()
    if (trimmed !== '') emit(placeRenamed(renamingId, trimmed))
    setRenamingId(null)
    setRenameValue('')
  }

  function submitNewPlace() {
    const trimmed = newPlaceName.trim()
    if (trimmed === '') return
    emit(placeRecorded(systemIdSource.next(), trimmed))
    setNewPlaceName('')
    setAddingPlace(false)
  }

  function confirmRemove() {
    if (removingId === null) return
    emit(placeRemoved(removingId))
    setRemovingId(null)
  }

  return (
    <div
      className={styles['scrim']}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={styles['sheet']}
        role="dialog"
        aria-modal="true"
        aria-label="Home"
      >
        <span className={styles['grabber']} aria-hidden="true" />
        <h2 className={styles['title']}>Home</h2>

        <ul className={styles['list']}>
          <li>
            <button
              type="button"
              className={styles['looseRow']}
              onClick={() => onSelect({ in: 'loose' })}
            >
              Loose
            </button>
          </li>

          {places.map((place) => {
            const name = nameOf(place)
            const containers = containerRowsUnder(
              state,
              view,
              { kind: 'place', id: place.id },
              excluded,
              1,
            )

            return (
              <li key={place.id}>
                {renamingId === place.id ? (
                  <div className={styles['renameRow']}>
                    <input
                      className={styles['renameInput']}
                      aria-label={`Rename ${name}`}
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                    />
                    <button
                      type="button"
                      className={styles['inlineSave']}
                      onClick={submitRename}
                      disabled={renameValue.trim() === ''}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className={styles['inlineCancel']}
                      onClick={() => setRenamingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className={styles['placeRow']}>
                    <button
                      type="button"
                      className={styles['placeSelect']}
                      onClick={() => onSelect({ in: 'place', id: place.id })}
                    >
                      {name}
                    </button>
                    <button
                      type="button"
                      className={styles['minor']}
                      aria-label={`Rename ${name}`}
                      onClick={() => startRename(place.id, name)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className={styles['remove']}
                      aria-label={`Remove ${name}`}
                      onClick={() => setRemovingId(place.id)}
                    >
                      Remove
                    </button>
                  </div>
                )}

                {containers.length > 0 && (
                  <ul className={styles['containers']}>
                    {containers.map((row) => (
                      <li
                        key={row.id}
                        style={{ paddingLeft: `${row.depth}rem` }}
                      >
                        <button
                          type="button"
                          className={styles['containerSelect']}
                          onClick={() => onSelect({ in: 'gear', id: row.id })}
                        >
                          {row.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>

        {addingPlace ? (
          <div className={styles['renameRow']}>
            <input
              className={styles['renameInput']}
              aria-label="New place name"
              value={newPlaceName}
              onChange={(event) => setNewPlaceName(event.target.value)}
            />
            <button
              type="button"
              className={styles['inlineSave']}
              onClick={submitNewPlace}
              disabled={newPlaceName.trim() === ''}
            >
              Add
            </button>
            <button
              type="button"
              className={styles['inlineCancel']}
              onClick={() => setAddingPlace(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles['addPlace']}
            onClick={() => setAddingPlace(true)}
          >
            + New place
          </button>
        )}

        <button type="button" className={styles['close']} onClick={onClose}>
          Close
        </button>

        {removingPlace !== null && (
          <div className={styles['confirmScrim']}>
            <div
              className={styles['confirmSheet']}
              role="alertdialog"
              aria-modal="true"
              aria-label={`Remove ${nameOf(removingPlace)}?`}
            >
              <h3 className={styles['confirmTitle']}>
                Remove {nameOf(removingPlace)}?
              </h3>
              <p className={styles['confirmBody']}>
                {looseLine(removingCount)}
              </p>
              <div className={styles['confirmActions']}>
                <button
                  type="button"
                  className={styles['ghost']}
                  onClick={() => setRemovingId(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles['confirmRemove']}
                  onClick={confirmRemove}
                >
                  Remove place
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
