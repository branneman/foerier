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
 * One sheet: Places, the containers within them, and Loose — **redrawn round
 * 2** (`docs/design/README.md` §3c, Screens A §07).
 *
 * ## Two jobs, one sheet, two modes
 *
 * **Picking is the whole fast path**: every row is a bare tap target, and one
 * tap selects and closes. Round 1 put RENAME and REMOVE on every pick row
 * because the build had them, and a twelve-place household's picker became a
 * wall of controls around a one-tap task. They now live behind an **EDIT**
 * mode, which suspends selection while it is on.
 *
 * **Creation stays in the pick path**, because that is when a new shelf
 * enters mid-sitting — and a place created while picking is **selected
 * immediately**, rather than making the Quartermaster find it and tap again.
 *
 * ## Rules that hold
 *
 * - Plain gear is never offered (invariant 2), and a container excludes
 *   itself **and every one of its descendants, at any depth** (invariant 3).
 * - REMOVE always confronts the loose count first (invariant 4), in a
 *   bordered attention button — never a filled red one.
 * - Rename is on Places only: containers are gear, renamed from their own
 *   EDIT.
 * - Row names are sentence case; mono caps stays the path/label register.
 * - The current home is marked `● NOW` — the SET PHASE anatomy, reused. Round
 *   1 did not mark it, and MOVE without it cannot show where the gear stands.
 *
 * ## MOVE, and the one departure from the board
 *
 * The caller supplies only `excludeGearId` and `moving`. The board ends MOVE
 * with "selection moves and closes; UNDO per the global rule" — but there is
 * no global Undo rule in force: **story 36 is Later and opens with a design
 * phase**, and the MVP does not lean on it. A mis-tapped destination in a
 * nested picker is otherwise unrecoverable without re-navigating, so **MOVE
 * confirms**. Picking a home for gear that does not exist yet (Add Gear) does
 * not, because there is no prior state to lose.
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
  /** The gear's home right now, marked `● NOW`. */
  current?: Residence
  /** MOVE's context line, and the reason this picker confirms. */
  moving?: { name: string; insideCount: number }
}

interface ContainerRow {
  id: string
  name: string
  /** Levels below the Place. Indent is capped; this is not. */
  depth: number
  /** The ancestry the cap hid, `SHELF L-TOP ▸ CRATE B`, or `''`. */
  skipped: string
}

/** Indent 16px per level, capped at **two** levels below the Place (round 1
 * allowed three, and a deep shelf ran out of row). */
const INDENT_CAP = 2

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
  ancestry: readonly string[],
): ContainerRow[] {
  const here = view
    .childrenOf(holder)
    .filter((id) => !excluded.has(id))
    .map((id) => state.gear[id])
    .filter((gear): gear is NonNullable<typeof gear> => gear !== undefined)
    .filter((gear) => gear.container?.value === true)
    .filter((gear) => gear.retired?.value !== true)
    .map((gear) => ({ id: gear.id, name: nameOf(gear) }))
    .sort(byName)

  const rows: ContainerRow[] = []
  for (const row of here) {
    rows.push({
      ...row,
      depth,
      // Past the cap the indent stops saying where the row sits, so the row
      // says it itself — the GearRow name+meta anatomy, replacing round 1's
      // inline parent prefix, which fought the name scan.
      skipped: depth > INDENT_CAP ? ancestry.join(' ▸ ') : '',
    })
    rows.push(
      ...containerRowsUnder(
        state,
        view,
        { kind: 'gear', id: row.id },
        excluded,
        depth + 1,
        [...ancestry, row.name],
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

function sameResidence(a: Residence | undefined, b: Residence): boolean {
  if (a === undefined) return false
  if (a.in !== b.in) return false
  return a.in === 'loose' || b.in === 'loose' ? true : a.id === b.id
}

export function HomePicker({
  open,
  onClose,
  onSelect,
  excludeGearId,
  current,
  moving,
}: HomePickerProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)

  const [editing, setEditing] = useState(false)
  const [addingPlace, setAddingPlace] = useState(false)
  const [newPlaceName, setNewPlaceName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [pending, setPending] = useState<{
    residence: Residence
    label: string
  } | null>(null)

  const view = useMemo(() => containmentView(state), [state])
  const excluded = useMemo(
    () => excludedSubtree(view, excludeGearId),
    [view, excludeGearId],
  )
  const places = useMemo(() => visiblePlaces(state), [state])

  if (!open) return null

  const removingPlace: PlaceState | null =
    removingId === null ? null : (state.places[removingId] ?? null)
  // `childrenOf` includes retired gear — it still sits where it sits
  // (`selectors/containment.ts`'s own doc). But retirement is a soft-delete
  // (invariant 7): a retired piece is not waiting to be re-homed, it lives
  // in `retiredGear`, so it does not belong in this count — `looseGear`
  // excludes it for the identical reason.
  const removingCount =
    removingId === null
      ? 0
      : view
          .childrenOf({ kind: 'place', id: removingId })
          .map((id) => state.gear[id])
          .filter((gear) => gear?.retired?.value !== true).length

  /** Selection, gated on MOVE's confirmation. */
  function choose(residence: Residence, label: string) {
    // Edit suspends selection: rows stop closing the sheet.
    if (editing) return
    if (moving === undefined) {
      onSelect(residence)
      return
    }
    setPending({ residence, label })
  }

  function startRename(id: string, currentName: string) {
    setRenamingId(id)
    setRenameValue(currentName)
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
    const id = systemIdSource.next()
    emit(placeRecorded(id, trimmed))
    setNewPlaceName('')
    setAddingPlace(false)
    // Created while picking = selected immediately. A new shelf enters
    // mid-sitting, and making the Quartermaster find it and tap again is the
    // round-1 behaviour this replaces.
    choose({ in: 'place', id }, trimmed)
  }

  function confirmRemove() {
    if (removingId === null) return
    emit(placeRemoved(removingId))
    setRemovingId(null)
  }

  const nowMark = <span className={styles['now']}>● NOW</span>

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

        <div className={styles['titleRow']}>
          <h2 className={styles['title']}>Home</h2>
          <button
            type="button"
            className={styles['modeToggle']}
            onClick={() => {
              setEditing((on) => !on)
              setRenamingId(null)
            }}
          >
            {editing ? 'DONE' : 'EDIT'}
          </button>
        </div>

        {moving !== undefined && (
          <p className={styles['context']} data-testid="moving-context">
            MOVING {moving.name} · {moving.insideCount} INSIDE RIDE ALONG
          </p>
        )}

        {/* The first thing a new Quartermaster meets: one body line that
            teaches the model at the moment it matters. */}
        {places.length === 0 && (
          <p className={styles['teach']}>
            {
              'No places yet. Gear can stay loose, or live in a place — usually a room.'
            }
          </p>
        )}

        <ul className={styles['list']}>
          <li>
            <button
              type="button"
              className={`${styles['looseRow']} ${editing ? styles['dim'] : ''}`}
              onClick={() => choose({ in: 'loose' }, 'Loose')}
            >
              <span className={styles['rowMain']}>
                <span className={styles['rowName']}>Loose</span>
                {/* The picker is where the glossary word LOOSE is taught. */}
                <span className={styles['rowMeta']}>
                  NO RESIDENCE — THE DEFAULT
                </span>
              </span>
              {sameResidence(current, { in: 'loose' }) && nowMark}
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
              [],
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
                      onClick={() =>
                        choose({ in: 'place', id: place.id }, name)
                      }
                    >
                      <span className={styles['rowName']}>
                        {/* The glyph is the *world*, drawn — a screen reader
                            saying "house Attic" gains nothing, so the row is
                            announced by its name alone. */}
                        <span aria-hidden="true">⌂ </span>
                        {name}
                      </span>
                      {sameResidence(current, { in: 'place', id: place.id }) &&
                        nowMark}
                    </button>
                    {editing && (
                      <>
                        <button
                          type="button"
                          className={styles['minor']}
                          aria-label={`Rename ${name}`}
                          onClick={() => startRename(place.id, name)}
                        >
                          RENAME
                        </button>
                        <button
                          type="button"
                          className={styles['remove']}
                          aria-label={`Remove ${name}`}
                          onClick={() => setRemovingId(place.id)}
                        >
                          REMOVE
                        </button>
                      </>
                    )}
                  </div>
                )}

                {containers.length > 0 && (
                  <ul className={styles['containers']}>
                    {containers.map((row) => (
                      <li
                        key={row.id}
                        style={{
                          paddingLeft: `${Math.min(row.depth, INDENT_CAP)}rem`,
                        }}
                      >
                        <button
                          type="button"
                          className={`${styles['containerSelect']} ${
                            editing ? styles['dim'] : ''
                          }`}
                          onClick={() =>
                            choose({ in: 'gear', id: row.id }, row.name)
                          }
                        >
                          <span className={styles['rowMain']}>
                            <span className={styles['rowName']}>
                              {row.name}
                            </span>
                            {row.skipped !== '' && (
                              <span className={styles['rowMeta']}>
                                {row.skipped}
                              </span>
                            )}
                          </span>
                          {sameResidence(current, {
                            in: 'gear',
                            id: row.id,
                          }) && nowMark}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Containers are gear; their own EDIT renames them. Said
                    once per Place rather than per row. */}
                {editing && containers.length > 0 && (
                  <p className={styles['gearNote']}>
                    GEAR — EDIT FROM ITS DETAIL
                  </p>
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

        {moving !== undefined && (
          <p className={styles['fact']} data-testid="moving-footer">
            {moving.name} AND EVERYTHING INSIDE IT ARE NOT OFFERED.
          </p>
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

        {/* MOVE's confirmation. Not on the board — see this module's header
            for why story 36 makes it necessary. The primary stays accent:
            nothing is being destroyed. */}
        {pending !== null && moving !== undefined && (
          <div className={styles['confirmScrim']}>
            <div
              className={styles['confirmSheet']}
              role="alertdialog"
              aria-modal="true"
              aria-label={`Move ${moving.name} to ${pending.label}?`}
            >
              <h3 className={styles['confirmTitle']}>
                Move {moving.name} to {pending.label}?
              </h3>
              <p className={styles['confirmBody']}>
                {moving.insideCount === 1
                  ? '1 piece of gear inside it moves too.'
                  : `${moving.insideCount} pieces of gear inside it move too.`}
              </p>
              <div className={styles['confirmActions']}>
                <button
                  type="button"
                  className={styles['ghost']}
                  onClick={() => setPending(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles['confirmMove']}
                  onClick={() => {
                    onSelect(pending.residence)
                    setPending(null)
                  }}
                >
                  Move gear
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
