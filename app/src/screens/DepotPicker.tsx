import {
  containmentView,
  dimension,
  dimensionValues,
  DIMENSIONS,
  EMPTY_SLICE,
  entriesOf,
  homePath,
  kindOf,
  ownerInitial,
  sliceDepot,
  systemIdSource,
  tripEntryAdded,
  tripLabel,
  visibleGear,
  type ContainmentView,
  type DepotState,
  type DimensionId,
  type GearState,
  type SliceSpec,
} from '@foerier/shared'
import { Chip } from '@foerier/ui'
import { useMemo, useState } from 'react'
import { Link } from 'wouter'

import { TagPicker } from '../components/TagPicker'
import { ValueMenu } from '../components/ValueMenu'
import { useDepot } from '../depot/store'
import { ScreenBand } from '../shell/ScreenBand'
import { useScreenHeader } from '../shell/useMediaQuery'
import { qtyFor } from './Depot'
import styles from './DepotPicker.module.css'

/**
 * **`Add from the depot`** — the picker a Quartermaster adds gear to a Trip
 * from, in two variants of the same component
 * (`docs/specs/2026-08-29-the-gear-list.md` §4.3):
 *
 * - `'screen'` — `/trips/:id/add`, below Split only. A screen, not a sheet, on
 *   `docs/design/README.md` §3b's argument, every clause of which transfers:
 *   the OS keyboard owns the lower half for a whole sitting, and `IN LIST ✓`
 *   keeps the row visible after the add, so the sitting is a **batch loop**.
 *   The Home picker — the counter-precedent — closes on selection, exactly
 *   what this must not do.
 * - `'pane'` — the builder's left pane at Split and up (`/trips/:id/list`,
 *   Task 11), eyebrow `FROM THE DEPOT` in place of the screen's own header and
 *   title. Task 11 mounts this component as-is; nothing here is written for
 *   one variant and patched for the other.
 *
 * ## Narrowing is scoped, not the Depot's own `SliceBar`
 *
 * The board draws three ghost chips at 393 (`+ TAG` `+ KIND` `+ TRIP`) and two
 * at 900 (`+ TAG` `+ KIND`), with no rule stated either way — spec §4.3 rules
 * to follow each board at its own width, which is `+ TRIP` renders in the
 * `'screen'` variant only. `SliceBar` hard-codes the Depot's full
 * `DIMENSIONS` table and has no prop to narrow it to a subset, so this
 * component narrows through `sliceDepot` directly with its own small `spec`
 * — the picking mechanics (`ValueMenu`, `TagPicker`, `Chip`) are shared, the
 * chip row is not. `dimensionsFor` still **derives** its list from
 * `DIMENSIONS` rather than enumerating one of its own (S7 review F7): a
 * later slice's dimension (S8/S9/S10, per `slice.ts`'s own table) reaches
 * this picker automatically, the same way it reaches the Depot's bar,
 * unless it is named in `EXCLUDED_DIMENSIONS`.
 *
 * `spec.group` is always `'none'`: `sliceDepot`'s grouping is the Depot
 * list's own feature (Kind/Owner bands), and this picker draws a flat list,
 * so `result.groups` is always exactly zero or one group.
 *
 * `sliceDepot` filters through `visibleGear` internally, so **Retired Gear is
 * never offered** with no extra guard needed here.
 *
 * ## No claim read, and no flash on add
 *
 * A claim is a relationship between two Trips; this picker speaks for one,
 * and the over-claim band on `/trips/:id` is the signal a cross-Trip clash
 * exists. A second signal here — a read on this row, a flash on add — would
 * say it twice. `tripEntryAdded` lands as a local op with no confirmation of
 * any kind; the row's own `IN LIST ✓` is the only feedback, and it is
 * permanent for the sitting rather than transient.
 *
 * ## The meta slot: the home path, then at most one suffix
 *
 * Corrected against the boards after review (S7 review F1) — my own first
 * pass read the brief's "the name, the home path and a trailing `+ ADD` or
 * `IN LIST ✓`" as "home path alone", which every row *without* a suffix
 * supports and every row *with* one contradicts. The boards draw a suffix in
 * four rows out of five, and the suffix is never the same kind of fact twice:
 * `×<ownedCount>` for Counted (`Depot.tsx`'s own `qtyFor`, reused rather than
 * copied — it is the **owned** count, which is why `Gas canister 450` still
 * carries `×4` while reading `+ ADD`, not on the list, since a Bring-count
 * only exists once an Entry does), the Kind's own label for per-person
 * (`Per-person`, which `.meta`'s CSS transform draws as `PER-PERSON`), and
 * the owner's bare initial (`ownerInitial`, `shared/src/selectors/owner.ts`)
 * for everything else — Single, an absent Kind, an unrecognised one.
 *
 * **Undrawn on the boards, ruled here:** no row is both Counted-and-personal
 * or per-person-and-personal. Where they would collide, Kind wins and the
 * owner is suppressed — Kind changes what `+ ADD` will actually list (a
 * per-person add fans out per Participant, a Counted add carries a
 * Bring-count), where the owner changes nothing about the add.
 *
 * `Components` §03's "no whereabouts" still holds narrowly: no world chip, no
 * status, ever — only the meta slot's own contents changed. `LOOSE` is
 * spelled in literal caps rather than left to `.meta`'s CSS transform,
 * matching `Find.tsx`'s `'⌂ LOOSE'` and `GearDetail.tsx`'s `chipLocation`
 * fallback for the identical question — a third, CSS-dependent spelling here
 * would have been the drift `owner.ts`'s own docstring warns about, one
 * screen over.
 *
 * ## An unknown `tripId` draws `No such trip.` rather than the picker
 *
 * `Trip.tsx` and `GearDetail.tsx` both guard this; this component did not
 * until S7 review F2 named the consequence. `reduce.ts`'s `writeTrip`
 * creates the Trip entity for **any** Trip op, so a `+ ADD` against an
 * unknown id would author a `trip.entry_added` that materialises a
 * nameless, phaseless Trip no delete op can ever remove before S14 — reads
 * `draft` (`trip.ts`'s own "an absent phase register reads draft" rule) and
 * so surfaces under `PLANNED` on `/trips`, forever, on every Device in the
 * household. Reachable ordinarily, not just by a mistyped URL: a shared or
 * bookmarked link opened on a replica that has not yet folded that Trip's
 * own `trip.created` — a different aggregate, no ordering between the two.
 */
export interface DepotPickerProps {
  tripId: string
  variant: 'screen' | 'pane'
}

/**
 * The two dimensions this picker never narrows by, on either variant —
 * "who owns it" is a different question from "does the Trip already list
 * it", and the row itself currently answers *that* one, at most, through the
 * owner's initial in the meta slot rather than through a filter. An
 * allowlist naming `tag`/`kind`/`trip` would silently miss a later slice's
 * row (S7 review F7); this exclusion list means a new one defaults to
 * *included*, matching `SliceBar`'s own behaviour, and only these two are a
 * deliberate, named departure from it.
 */
const EXCLUDED_DIMENSIONS: readonly DimensionId[] = ['ownership', 'person']

/** The dimensions this picker can narrow by, and at which width — spec
 * §4.3's one board inconsistency, followed rather than silently resolved.
 * Derived from `DIMENSIONS` (`shared/src/selectors/slice.ts`), never
 * enumerated fresh here. */
function dimensionsFor(variant: 'screen' | 'pane'): readonly DimensionId[] {
  return DIMENSIONS.map((of) => of.id)
    .filter((id) => !EXCLUDED_DIMENSIONS.includes(id))
    .filter((id) => variant === 'screen' || id !== 'trip')
}

/**
 * `Search the depot…` — one literal, both variants. An earlier draft (S7
 * review F6) split this into a per-variant branch in anticipation of a `/`
 * focus-search hint the pane variant's board frame draws, with a comment
 * pointing at "Task 11's own keybinding" as the thing that would fill the
 * second branch in. Task 11 is the slice's last task and built no
 * keybinding, because none was ever assigned one: spec §9 records that the
 * whole keyboard surface — `↑↓ ROW · ENTER ADD/REMOVE · T TRIP-ONLY`, `/` in
 * both pane searches, `P` (S8) — ships unbuilt at S7, coherently, rather than
 * shipping one hint ahead of a control it names. So this is one constant, not
 * a conditional waiting on a caller that will never arrive; a future slice
 * that builds the keyboard surface reintroduces the branch then, not before.
 */
const SEARCH_PLACEHOLDER = 'Search the depot…'

/** `1 FILTER ACTIVE` / `2 FILTERS ACTIVE` — `result.active`'s own noun,
 * singularised at exactly one, the same rule `entryCountLabel`/`pieceLabel`
 * (`Trip.tsx`, `GearListSection.tsx`) already use for this slice's other
 * counted nouns. No board draws the `N = 1` case literally; review confirmed
 * the same inference Task 9 made for `1 ENTRY`. */
function filtersActiveLabel(count: number): string {
  return `${count} ${count === 1 ? 'FILTER' : 'FILTERS'} ACTIVE`
}

/**
 * The meta slot's one optional suffix (see the class docstring's "meta slot"
 * section for the full rule): `×<ownedCount>` for Counted, the Kind's own
 * label for per-person, the owner's bare initial for everything else —
 * `undefined` when there is nothing to draw.
 */
function rowSuffix(gear: GearState, state: DepotState): string | undefined {
  const kind = kindOf(gear)
  if (kind === 'counted') return qtyFor(gear)
  if (kind === 'per_person') return dimension('kind').format(kind, state)
  return ownerInitial(state, gear)
}

/** `GARAGE ▸ SHELF 1`, `ATTIC ▸ CRATE B · ×2`, `SLAAPKAMER ▸ KAST · E`,
 * `ATTIC ▸ CRATE D · PER-PERSON`, or `LOOSE` alone for gear with no
 * residence — the full meta slot, path first and {@link rowSuffix} joined on
 * with ` · ` only when there is one. `view` is threaded in rather than left
 * to `homePath`'s own default, per S7 review F3 — see the call site. */
function rowMeta(
  gear: GearState,
  state: DepotState,
  view: ContainmentView,
): string {
  const segments = homePath(state, gear.id, view).map((segment) => segment.name)
  const location = segments.length === 0 ? 'LOOSE' : segments.join(' ▸ ')
  const suffix = rowSuffix(gear, state)
  return suffix === undefined ? location : `${location} · ${suffix}`
}

export function DepotPicker({ tripId, variant }: DepotPickerProps) {
  const state = useDepot((depot) => depot.state)
  const emit = useDepot((depot) => depot.emit)
  const sync = useDepot((depot) => depot.sync)
  // `splitPane: false` — this is not the detail pane of a list also on
  // screen. Only the `'screen'` variant renders what it answers: the `'pane'`
  // variant's own band (back link + sync) belongs to Task 11's builder page,
  // which draws one band for both panes together, per spec §4.4.
  const header = useScreenHeader({ splitPane: false })

  const [spec, setSpec] = useState<SliceSpec>(EMPTY_SLICE)
  const [picking, setPicking] = useState<DimensionId | null>(null)

  const trip = state.trips[tripId]
  const dimensions = dimensionsFor(variant)

  const totalGear = useMemo(() => visibleGear(state).length, [state])
  const result = useMemo(() => sliceDepot(state, spec), [state, spec])
  const rows = result.groups[0]?.gear ?? []

  // Built once per fold and threaded to every row (S7 review F3) —
  // `homePath`'s own docstring: "pass `view` when you already have one;
  // building it is O(depot) and a list screen wants one view, not one per
  // row." Left as its own default parameter, every keystroke through
  // `setSpec` would rebuild it once per row shown, on the one screen whose
  // whole design argument is a batch loop on a phone.
  const view = useMemo(() => containmentView(state), [state])

  /**
   * Gear added by a tap on *this* mount, ahead of the fold.
   *
   * Amendment ruling K: `IN LIST ✓` renders from the local op **at the tap,
   * in front of the work queue**. `emit` is deliberately durable-first —
   * append to the log, then fold, then nudge the outbox (`depot/store.ts`) —
   * and that ordering is not up for renegotiation, because reversing it turns
   * a lost render into a lost fact. But it does mean the folded answer to
   * "is this in the list" arrives a queue-turn after the tap that put it
   * there, and this row's `✓` is the only feedback the tap gets at all.
   *
   * So the read is optimistic and the write is not. This set only ever *adds*
   * to what the fold says; it never subtracts, so it cannot hide a removal
   * that arrived from anywhere else, and a refused append surfaces through
   * `refusal` exactly as before.
   */
  const [addedHere, setAddedHere] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  // Every Gear this Trip already lists from the depot — `IN LIST ✓`'s whole
  // question. Scoped to entries whose source is a depot reference: a
  // trip-only Entry names no Gear and never reaches this picker either way.
  const listedIds = useMemo(() => {
    const ids = new Set<string>(addedHere)
    if (trip === undefined) return ids
    for (const entry of entriesOf(trip, state)) {
      const source = entry.source?.value
      if (source !== undefined && source.from === 'depot') {
        ids.add(source.gearId)
      }
    }
    return ids
  }, [trip, state, addedHere])

  // S7 review F2: every hook above runs regardless, so this early return —
  // the one place the whole render short-circuits — costs nothing except the
  // work below it, exactly `Trip.tsx`'s own `No such trip.` guard. Without
  // it, a `+ ADD` against an unknown `tripId` would author a
  // `trip.entry_added` that materialises a Trip no delete op can remove
  // before S14 — see the class docstring.
  if (trip === undefined) {
    return (
      <div
        className={variant === 'screen' ? styles['screen'] : styles['pane']}
        data-testid="depot-picker"
      >
        <p className={styles['notFound']}>No such trip.</p>
      </div>
    )
  }

  function selectedOf(id: DimensionId): readonly string[] {
    return spec.filters[id] ?? []
  }

  function withFilters(id: DimensionId, values: readonly string[]): SliceSpec {
    const filters = { ...spec.filters }
    if (values.length === 0) delete filters[id]
    else filters[id] = values
    return { ...spec, filters }
  }

  // `SliceBar`'s own `apply`/`remove`, scoped to this picker's own state
  // rather than a caller-owned `spec` — narrowing here is this sitting's,
  // not a preference `useSliceSpec` would persist across visits.
  function apply(id: DimensionId, value: string) {
    const of = dimension(id)
    const current = selectedOf(id)
    const next =
      of.arity === 'single'
        ? [value]
        : current.includes(value)
          ? current
          : [...current, value]
    setSpec(withFilters(id, next))
    setPicking(null)
  }

  function remove(id: DimensionId, value: string) {
    setSpec(
      withFilters(
        id,
        selectedOf(id).filter((held) => held !== value),
      ),
    )
  }

  function addToTrip(gearId: string) {
    // Ruling K: the row says so now, not a queue-turn from now.
    setAddedHere((current) => new Set(current).add(gearId))
    emit(
      tripEntryAdded(tripId, systemIdSource.next(), {
        from: 'depot',
        gearId,
      }),
    )
  }

  // `trip` is narrowed past the guard above, so this is `tripLabel` directly
  // rather than the ternary an earlier draft needed.
  const backLabel = tripLabel(trip)

  return (
    <div
      className={variant === 'screen' ? styles['screen'] : styles['pane']}
      data-testid="depot-picker"
    >
      {variant === 'screen' && (
        // The same band every pushed screen carries, under the same rule
        // (`frontend-design.md` §3.3): `useScreenHeader` decides both halves
        // and `ScreenBand` draws them.
        <ScreenBand
          header={header}
          back={{ href: `/trips/${tripId}`, label: backLabel }}
          sync={sync}
        />
      )}

      {variant === 'screen' ? (
        <h1 className={styles['title']}>Add from the depot</h1>
      ) : (
        <p className={styles['eyebrow']}>FROM THE DEPOT</p>
      )}

      <input
        type="search"
        className={styles['search']}
        aria-label="Search the depot"
        placeholder={SEARCH_PLACEHOLDER}
        // Screen variant only (S7 review F6) — neither pane board frame
        // draws this field focused, and stealing focus into the builder's
        // left pane on mount would move a keyboard reader away from the
        // list they came to edit.
        autoFocus={variant === 'screen'}
        value={spec.search}
        onChange={(event) => setSpec({ ...spec, search: event.target.value })}
      />

      <div className={styles['chips']}>
        {dimensions.flatMap((id) =>
          selectedOf(id).map((value) => (
            <Chip
              key={`${id}:${value}`}
              label={`${dimension(id).label}: ${dimension(id).format(value, state)}`}
              selected
              onClick={() => setPicking(id)}
              onRemove={() => remove(id, value)}
            />
          )),
        )}

        {dimensions
          .filter(
            (id) =>
              dimension(id).arity === 'multi' || selectedOf(id).length === 0,
          )
          .map((id) => (
            <Chip
              key={`ghost-${id}`}
              label={`+ ${dimension(id).label}`}
              ghost
              onClick={() => setPicking(id)}
            />
          ))}
      </div>

      {totalGear === 0 ? (
        // `Components` §07 verbatim — the same voice `Depot.tsx` would draw
        // for a genuinely empty household, restated here because this screen
        // never mounts `Depot.tsx` itself.
        <div className={styles['empty']} data-testid="depot-picker-empty">
          <p className={styles['emptyTitle']}>Empty depot.</p>
          <p className={styles['emptyLine']}>Add the first item.</p>
          <Link href="/add" className={styles['emptyAction']}>
            + Add gear
          </Link>
        </div>
      ) : result.shown === 0 ? (
        // `Components` §07 verbatim, the unmatched twin. `result.active`
        // counts search and filters together, exactly `SliceBar`'s
        // `CLEAR (n)` does — the same one narrowing question, asked here in
        // words instead of a parenthesised number.
        <div className={styles['empty']} data-testid="depot-picker-unmatched">
          <p className={styles['emptyTitle']}>No matches.</p>
          <p className={styles['emptyLine']}>
            {filtersActiveLabel(result.active)}
          </p>
          <button
            type="button"
            className={styles['clearFilters']}
            onClick={() => setSpec(EMPTY_SLICE)}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul className={styles['rows']}>
          {rows.map((gear) => {
            const listed = listedIds.has(gear.id)
            const name = gear.name?.value ?? ''
            return (
              <li
                key={gear.id}
                className={`${styles['row']} ${listed ? styles['muted'] : ''}`}
                data-testid="depot-picker-row"
              >
                <div className={styles['main']}>
                  <span className={styles['name']}>{name}</span>
                  <span className={styles['meta']}>
                    {rowMeta(gear, state, view)}
                  </span>
                </div>
                {listed ? (
                  <span className={styles['listed']}>IN LIST ✓</span>
                ) : (
                  <button
                    type="button"
                    className={styles['add']}
                    aria-label={`Add ${name}`}
                    onClick={() => addToTrip(gear.id)}
                  >
                    + ADD
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className={styles['hint']}>
        ADDING LISTS IT — GEAR DOES NOT MOVE UNTIL PACK-OUT
      </p>

      {picking === 'tag' && (
        <TagPicker
          mode="slice"
          vocabulary={dimensionValues(state, 'tag')}
          applied={selectedOf('tag')}
          onApply={(tag) => apply('tag', tag)}
          onRemove={(tag) => remove('tag', tag)}
          onClose={() => setPicking(null)}
        />
      )}

      {picking !== null && picking !== 'tag' && (
        <ValueMenu
          title={dimension(picking).label}
          values={dimensionValues(state, picking)}
          format={(value) => dimension(picking).format(value, state)}
          selected={selectedOf(picking)}
          onPick={(value) => apply(picking, value)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
