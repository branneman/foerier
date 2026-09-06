import {
  containmentView,
  placeRecorded,
  placeRemoved,
  placeRenamed,
  systemIdSource,
  visiblePlaces,
  type ContainmentView,
  type HouseholdState,
  type HolderRef,
  type PlaceState,
  type Residence,
} from '@foerier/shared'
import { Confirm, Sheet } from '@foerier/ui'
import { useMemo, useState } from 'react'

import { useHousehold } from '../household/store'
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
 *
 * **`moving.confirm` names which confirm the caller's act owes**, and §5i
 * G15 finishes §1's rule for the two S10 routes. F8 stays blessed for a
 * **plain** row — it jumps to its new room and a second re-home is the
 * reversal — and F5 passes no `moving` at all there, so nothing is raised.
 * A **container** row passes `confirm: 're-home'`: the row jumps, but every
 * home path beneath it is rewritten too, and those rows are elsewhere on
 * the screen and may be filtered out. `false` remains for a caller that
 * wants `moving`'s exclusion, `● NOW` mark and ride-along line with no
 * dialog — gear detail's `RESOLVE`, whose settle route F16(3) draws
 * undialogued.
 *
 * `confirm` lives **inside** `moving` rather than beside it (`patterns.md`
 * §4.4's grouped-optional precedent, `SettleRoutes`) precisely so `confirm`
 * without `moving` is unrepresentable — a caller cannot silently opt out of
 * a confirm it never asked to have. `GearDetail`'s own MOVE never sets it,
 * so it defaults to `'move'` and stays confirmed exactly as before.
 *
 * ## `context`
 *
 * A generic line above the list, not shaped to any one caller — shown
 * whenever it or `moving` is given (a caller may want the line with no move
 * at all). It carries **only the caller's own sentence**: when `moving` is
 * also given, `HomePicker` itself places `moving`'s own ride-along clause
 * (`{N} RIDE ALONG` — §5i G2 retired the `INSIDE` in it, since the two
 * words answer two questions) **between** the caller's act and its
 * consequence, §5i G5's grammar: *act · what moves · consequence*. One
 * place computes that fact and one place orders it, not two spellings of
 * either.
 *
 * ## `nowLabel`
 *
 * `● NOW`'s own text, overridable per caller — unset everywhere but S10's
 * settle route (F16(3)), which draws `● NOW — FOUND HERE` because picking
 * the current home there is the settling fact, not a restatement of one.
 * This is a label change only: the row's own tap behaviour is already
 * whatever `moving`'s presence (or its own `confirm`) decides, unaffected by
 * this prop.
 *
 * ## Mounted is open
 *
 * There is no `open` prop, and losing it was a fix rather than a tidy. This
 * picker used to be mounted permanently by gear detail and early-return
 * `null`, so every piece of state below — EDIT mode, the rename and new-place
 * drafts, the pending remove and the pending move — **survived a close** and
 * came back on the next open. Tap EDIT, close, reopen, and selection was
 * still suspended with nothing on screen saying why. Mount is the reset.
 */
export interface HomePickerProps {
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
  /**
   * MOVE's own facts, grouped rather than sibling props — `patterns.md`
   * §4.4's precedent (`SettleRoutes`): grouping makes `confirm` without
   * `moving` unrepresentable, which a lone boolean would not.
   */
  moving?: {
    name: string
    /**
     * **What moves** — {@link homeRidesAlongCount}, the whole home subtree
     * at any depth. Never `childrenOf(...).length`.
     *
     * It undercounted until §5i G2, because every caller passed the
     * **direct** children while a re-home relocates the subtree: a crate
     * holding a stuff sack holding two items disclosed `1 INSIDE RIDE
     * ALONG` and moved three, understating the write at exactly the moment
     * this line exists to disclose it. G2 fixes it **by the word's own
     * definition** rather than as a separate patch — `RIDE ALONG` is what
     * moves and `INSIDE` is the lid-open count, and the two had been
     * sharing one phrase and one number.
     */
    ridesAlong: number
    /**
     * **Which confirm this caller's act owes**, §1's one rule: *the confirm
     * is owed where the act cannot be seen on the screen that made it.*
     *
     * - `'move'` (the default) — gear detail's MOVE, which shows no jump.
     * - `'re-home'` — F5's **container** row (§5i G15). The row itself
     *   jumps, but a container's re-home also rewrites every home path
     *   beneath it, and those rows are elsewhere on F5 and may be filtered
     *   out under `○ OPEN`. F4's container move confirms for exactly this.
     * - `false` — F5's **plain** row (F8, blessed at G15): one op, and the
     *   row visibly jumps to its new room.
     *
     * The picker owns both copy blocks rather than taking them as props,
     * because each needs the destination and the ride-along count, which
     * are this component's to know — the caller names its act and nothing
     * more, exactly as {@link HomePickerProps.context} works.
     */
    confirm?: 'move' | 're-home' | false
  }
  /**
   * The line above the list, in §5i G5's own grammar: **act · what moves ·
   * consequence**. Shown whenever this or `moving` is given.
   *
   * A pair rather than one string, because the ride-along clause goes
   * **between** the two halves — the ride-along is part of the act's
   * *subject* (the crate and what is in it) and the outcome clause is its
   * side effect. A single string could only be appended to, which is what
   * shipped first and put the ride-along last, after the consequence. The
   * pair puts the order in the type, where a caller cannot lose it.
   *
   * `act` alone is legitimate; `MOVING {name}` is the default when the
   * caller supplies nothing. The ride-along clause is never the caller's to
   * restate — {@link HomePickerProps.moving} carries the number and this
   * component composes it, one place computing the fact.
   */
  context?: { act: string; consequence?: string }
  /**
   * Overrides `● NOW`'s own text — default unset, drawing the plain mark
   * every caller but one has always drawn. **S10's settle route (F16(3),
   * `docs/design/README.md` §06) is the one exception**: it draws
   * `● NOW — FOUND HERE`, because picking the current home there is not a
   * restatement, it is the settling fact itself, and the row needs its own
   * word for that. `allowCurrent` was tried and removed for a *different*
   * reason (R26: it made the row a gate) — this prop changes only the mark's
   * text, never whether the row responds to a tap, which every caller's
   * `moving` (or its absence) already decides on its own.
   */
  nowLabel?: string
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
  state: HouseholdState,
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

/**
 * Are two home residences the same place? Loose equals loose; a Place or a
 * container equals itself by id; `undefined` — no `current` at all — equals
 * nothing, so nothing is marked.
 *
 * **Exported because the suppression it serves is the caller's job**, the
 * precedent `PackPicker`'s `sameTripResidence` set. This sheet is pure
 * selection: it marks the `● NOW` row with this and still reports a tap on
 * it through `onSelect`, because it cannot know whether the caller means to
 * author an op from it. `GearDetail`'s MOVE does, so it is the one that has
 * to drop a selection equal to the current residence — a redundant
 * `gear.rehomed` moves the stamp LWW compares and can silently beat a
 * genuine move from an offline Device. Add gear never needs it: there is no
 * prior residence to be equal to.
 */
export function sameResidence(a: Residence | undefined, b: Residence): boolean {
  if (a === undefined) return false
  if (a.in !== b.in) return false
  return a.in === 'loose' || b.in === 'loose' ? true : a.id === b.id
}

export function HomePicker({
  onClose,
  onSelect,
  excludeGearId,
  current,
  moving,
  context,
  nowLabel,
}: HomePickerProps) {
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)

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

  /**
   * Which confirm the pending pick raises — `moving.confirm`'s own value,
   * read once so the gate below and the dialog's own copy can never
   * disagree about which act is being confirmed.
   */
  const reHomeConfirm = moving?.confirm === 're-home'

  /**
   * Selection — reports every pick, the current one included
   * (`patterns.md` §4.3: a picker holds no business rule, and the `● NOW`
   * mark is a mark, not a gate), gated only on the caller's own confirm.
   */
  function choose(residence: Residence, label: string) {
    // Edit suspends selection: rows stop closing the sheet.
    if (editing) return
    if (moving === undefined || moving.confirm === false) {
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
    // Only when it changed — gear detail's `submitEdit` discipline. `startRename`
    // seeds the field with the current name, so Save-without-editing is the
    // ordinary way to author a redundant `place.renamed`, and a needless
    // write is never free: it moves the LWW stamp and can silently beat a
    // genuine rename queued on a Device that was offline.
    const current = nameOf(state.places[renamingId])
    if (trimmed !== '' && trimmed !== current) {
      emit(placeRenamed(renamingId, trimmed))
    }
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

  const nowMark = <span className={styles['now']}>{nowLabel ?? '● NOW'}</span>

  /**
   * §5i G5's grammar, composed once: **act · what moves · consequence**.
   * The act is `context.act` or `MOVING {name}`; the middle is `moving`'s
   * own ride-along clause and draws only when there is a move; the
   * consequence is the caller's own closing clause, and trails whatever
   * sits before it.
   *
   * `undefined` when neither `context` nor `moving` is given — the
   * paragraph below then renders nothing at all, plain pick mode's own
   * behaviour.
   */
  const contextText =
    context === undefined && moving === undefined
      ? undefined
      : [
          context?.act ?? (moving === undefined ? '' : `MOVING ${moving.name}`),
          moving === undefined ? '' : `${moving.ridesAlong} RIDE ALONG`,
          context?.consequence ?? '',
        ]
          .filter((part) => part !== '')
          .join(' · ')

  return (
    <Sheet
      title="Home"
      onClose={onClose}
      titleAction={
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
      }
    >
      {contextText !== undefined && (
        <p className={styles['context']} data-testid="moving-context">
          {contextText}
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
                    onClick={() => choose({ in: 'place', id: place.id }, name)}
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
                          <span className={styles['rowName']}>{row.name}</span>
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

      <Sheet.Close>
        <button type="button" className={styles['close']}>
          Close
        </button>
      </Sheet.Close>

      {removingPlace !== null && (
        <Confirm
          title={`Remove ${nameOf(removingPlace)}?`}
          description={looseLine(removingCount)}
          onClose={() => setRemovingId(null)}
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
                  className={styles['confirmRemove']}
                  onClick={confirmRemove}
                >
                  Remove place
                </button>
              </Confirm.Action>
            </>
          }
        />
      )}

      {/* The move confirmations — MOVE's, not on any board (see this
            module's header for why story 36 makes it necessary), and the
            re-home's, which §5i G15 draws. The primary stays accent in
            both: nothing is being destroyed. */}
      {pending !== null && moving !== undefined && (
        <Confirm
          title={
            reHomeConfirm
              ? `Re-home ${moving.name} to ${pending.label}?`
              : `Move ${moving.name} to ${pending.label}?`
          }
          description={
            reHomeConfirm ? (
              <>
                <span className={styles['confirmBody']}>
                  {moving.name} and everything inside it move at home. It is
                  marked back; its contents keep their own outcomes.
                </span>
                {/* Both writes as numbers — what moves, and the outcome the
                    pick implies (F8). `ContainerMoveConfirm`'s own shape one
                    screen over, whose mono line states the trip-world pair. */}
                <span className={styles['confirmFact']}>
                  {moving.ridesAlong} RIDE ALONG · OUTCOME → BACK
                </span>
              </>
            ) : moving.ridesAlong === 1 ? (
              '1 piece of gear inside it moves too.'
            ) : (
              `${moving.ridesAlong} pieces of gear inside it move too.`
            )
          }
          onClose={() => setPending(null)}
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
                  className={styles['confirmMove']}
                  onClick={() => {
                    onSelect(pending.residence)
                    setPending(null)
                  }}
                >
                  {reHomeConfirm ? 'Re-home' : 'Move gear'}
                </button>
              </Confirm.Action>
            </>
          }
        />
      )}
    </Sheet>
  )
}
