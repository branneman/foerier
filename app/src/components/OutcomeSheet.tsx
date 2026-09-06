import {
  bringCountOf,
  consumedCountOf,
  countOfUnpack,
  entryKind,
  entryLabel,
  isClosed,
  isContainerEntry,
  outcomeGlyph,
  outcomeLabel,
  outcomeOf,
  ownedCountOf,
  OUTCOMES,
  pieceOutcomeOf,
  piecesOf,
  rehomedSincePieceOutcome,
  returnPathOf,
  tripConsumedCountSet,
  tripOutcomeSet,
  unpackItems,
  UNNAMED_PERSON_GLYPH,
  type ContainmentView,
  type EntryState,
  type HouseholdState,
  type OutcomeValue,
  type TripState,
  type UnpackItem,
} from '@foerier/shared'
import { PersonCircle, Sheet, Stepper } from '@foerier/ui'
import { useMemo, useState } from 'react'

import { useHousehold } from '../household/store'
import { tripParticipants } from '../household/trips'
import styles from './OutcomeSheet.module.css'

/**
 * **F5's outcome sheet** (`docs/design/README.md` §7, rulings F5/F9; spec
 * §4.4) — the control the row's pill opens. `PhaseSheet`'s shape one register
 * over: `trip`/`entry`/`view` arrive as props (the caller already has them,
 * exactly as `PhaseSheet` is handed its `trip`, and `Unpack.tsx` already
 * builds one `ContainmentView` for the whole screen — `containerTotals`'s own
 * rule against a second build per caller), and `state`/`emit` come from the
 * store directly.
 *
 * ## A picker, and it says so
 *
 * Unlike `PhaseSheet`, which closes itself after every write, this sheet
 * **stays open after a tap** — spec §4.4's "a tap writes one op and the sheet
 * stays open until dismissed on the scrim". `PhaseSheet` calling `onClose()`
 * after `move()` is not a precedent to copy here: a Quartermaster resolving a
 * gear list works through many rows in one sitting, and a sheet that closed
 * on every tap would force a re-open per Entry.
 *
 * ## Tapping the current outcome writes nothing
 *
 * `JourneyRail`'s rule, restated for this register: a redundant
 * `trip.outcome_set` still carries a *later* HLC than whatever sits in the
 * register, so it can beat — and silently discard — a genuine concurrent
 * write from a Device that was offline. The guard lives on {@link choose},
 * not in the caller, so nothing upstream has to remember it.
 *
 * ## Four chips, not `ui/StatusPill`
 *
 * `JourneyRail`'s own precedent, not `PieceStatusSheet`'s: `StatusPill`'s
 * tones say *what happened* (packed/staged/dashed/attention), but this row
 * has to say something `StatusPill` has no tone for — *which chip is the
 * Entry's current outcome*, drawn dashed, filled and ring-lit
 * (`docs/design/README.md` §7's own words: "raised and focus-ringed"). A
 * fifth `StatusPill` tone would teach `ui/` a fact about *selection* rather
 * than about *paint*, which is precisely the line `ui/StatusPill.tsx`'s own
 * docstring draws — so this file hand-rolls the chip, in the pill's grammar
 * (44px, `--radius-pill`, mono caps) rather than a fifth tone.
 *
 * ## The stepper's gate is `consumedCountOf`, not a re-derived Kind check
 *
 * {@link consumedCountOf} already answers `null` for a container (checked
 * first) and for anything that is not a Counted depot Entry — which is
 * exactly "container, per-person and Single grow no stepper" (spec §4.4),
 * stated once in `shared/` rather than re-typed here as `kind === 'counted'
 * && !container`.
 *
 * ## The ceiling is `ui/Stepper`'s `max`, not a caller-side clamp
 *
 * A caller-side clamp (`Math.min(next, bringCount)` before deciding whether
 * to emit) leaves `Stepper`'s own text buffer canonicalised against a bound
 * it never learns — commit a value past the Bring-count and the well is left
 * showing the untruncated digits forever, because the caller's guard skips
 * the `onChange` that would otherwise change `value` and re-fire `Stepper`'s
 * `[value]` resync. Passing {@link ownedCountOf}'s sibling fact,
 * `bringCount`, in as `max` lets `Stepper` canonicalise its own buffer at the
 * one place that already canonicalises `min` (`ui/Stepper.tsx`'s docstring,
 * ruling R21).
 *
 * ## The fact line never shows the split
 *
 * The board's own drawn example (`S10 Round…dc.html` §02) keeps
 * `OUTCOME · ×4 BROUGHT · → BAK 3` on screen while `CONSUMED` is the raised
 * chip and the stepper reads `×2`: the header fact states what was
 * **brought**, unconditionally, and the split/consequence are the stepper
 * block's own fact, stated once there (F9) rather than duplicated here.
 *
 * ## The container's fact adds one clause, and states no inside-count
 *
 * `docs/design/README.md` §7 and ruling F1 (the decisive readings, over
 * board §02's own annotation card — see the review round that settled this):
 * *"the container row is ordinary — no rail, meta `→ SHELF L-TOP · 12
 * INSIDE` — and **its sheet states** `ITS CONTENTS KEEP THEIR OWN
 * OUTCOMES.`"* The inside-count is the **row**'s meta (`Unpack.tsx`'s
 * `returnPathMeta`, already drawing it), not the sheet's — this sheet states
 * no quantity at all for a container, and adds only the reassurance clause
 * after the path.
 *
 * ## The fact line is a ladder that drops from the right (§5i G4)
 *
 * `register · what · where`. The middle names the Kind — `CONTAINER`,
 * `×N BROUGHT`, `SINGLE`, or per-person's `N OF M RESOLVED` from the roster
 * arm — and drops for a Kind this build cannot name; the arrow drops with no
 * home; the bare word `OUTCOME` is the floor, which an unsynced Gear alone
 * reaches. Round 2 ruled the forms after S10 shipped the collapse
 * code-authored — see {@link fact}'s own comment for which segment answers
 * to what.
 *
 * ## The roster variant (Task 13, F7) — one component, not a second sheet
 *
 * `roster: true` is the cluster's own target (DESTINATION and ALL mode) and
 * PERSON mode's own per-Piece pill's — both route into the identical sheet,
 * `Unpack.tsx`'s own `openOutcome` resolving a PERSON-mode Piece row's
 * composite key down to the real Entry before mounting this component. F7's
 * own argument: *the chips are the verbs, the roster is who*, so `SET
 * EVERYONE` needs no second control and a single Piece needs no second
 * sheet — the four chips below are the identical `CHIP_IDS`, applied to a
 * **selection** instead of to the Entry's own register.
 *
 * The selection is local `useState`, seeded to every included Piece
 * (`piecesOf`) at mount **unless {@link OutcomeSheetProps.personId} names
 * one** — `ui/`'s overlay primitives have no `open` prop, so mount is the
 * reset, exactly as `PiecePicker`'s draft state resets on every open.
 * `EVERYONE` restores the full selection; a row toggles its own membership,
 * the Participants picker's `✓` grammar transplanted onto a Piece roster.
 * The chips **apply to the selection**, one op per Piece whose own outcome
 * differs from the tap — `PieceStatusSheet`'s `SET EVERYONE` rule (§5g E10),
 * an N-register write where a redundant one matters more than anywhere
 * else in the app, because a single tap can author it N times at once.
 *
 * ## `personId` narrows the seed — ruling R23
 *
 * Spec §4.5 and board §03: *"a Piece row carries its own pill — **one
 * Piece, one outcome**"*. The cluster (DESTINATION/ALL) opens with
 * `EVERYONE` selected; a PERSON-mode Piece row's own pill opens the
 * identical sheet but seeds the selection to that one Piece alone — the
 * caller (`Unpack.tsx`) is what tells the two apart, by handing this prop
 * only when the tap came from a Piece row. Getting this wrong is not
 * cosmetic: without it, tapping one Piece's pill and a chip would author an
 * op for every Piece on the Entry, including one a peer had set from an
 * offline Device, on a stamp that would silently win.
 *
 * No stepper ever grows here, at any Kind: per-person gear has no count
 * (invariant 6), and `showStepper`'s own gate below is entry-level and
 * never consulted in this branch.
 */
export interface OutcomeSheetProps {
  trip: TripState
  entry: EntryState
  /** The home world's containment, built once per fold by the caller
   * (`Unpack.tsx`'s own `view`) — never rebuilt here. */
  view: ContainmentView
  onClose: () => void
  /**
   * Draws the roster above the verbs (F7) instead of the plain entry-level
   * controls. The caller's own fact to decide — `entryKind(entry, state)
   * === 'per_person' && !isContainerEntry(entry, state)` — never re-derived
   * here: this component trusts the flag rather than asking `state` a
   * question its caller already answered to build the props it is holding.
   */
  roster?: boolean
  /**
   * The Piece whose own pill opened this sheet (R23) — meaningful only
   * while {@link roster} is true, and read once, at mount, to seed the
   * selection to `{personId}` instead of every included Piece. Absent for
   * the cluster's own tap, which opens with `EVERYONE` selected.
   */
  personId?: string
}

/**
 * `PersonCircle`'s tone for a Piece's own unpack outcome (F7) — presentational,
 * not domain, exactly as `PieceStatusSheet.toneForStatus` is for a packing
 * status. **Three values, not four**: `consumed` is not drawable as a fourth
 * tone at 30/34px and paints identically to `back` — the sheet's own row
 * states the word, which is what lets the circle collapse the two without
 * losing the fact. Exported so the cluster that opens this sheet
 * (`UnpackRow.tsx`, via `Unpack.tsx`'s own cluster-building) paints the
 * identical three fills for the identical three outcomes — a second,
 * hand-rolled copy is exactly the `ownerOf`/`phaseOf` drift this codebase
 * keeps warning against, and the symptom would be a circle drawn bordered on
 * the row and filled inside the sheet it opens, for the same Piece.
 */
export function circleToneForOutcome(
  outcome: OutcomeValue | null,
): 'control' | 'filled' | 'attention' {
  if (outcome === null) return 'control'
  if (outcome === 'lost') return 'attention'
  // `back`, `consumed`, or an unrecognised value — this file's own header:
  // an unrecognised outcome counts as resolved, into none of the three named
  // buckets, the identical rule `countOfUnpack` states for the arithmetic.
  return 'filled'
}

const FOOTER = 'ONE OP PER TAP. LOST KEEPS THE HOME SLOT AND STAYS SEARCHABLE.'

/** F7's own footer — the roster variant's, verbatim off the board. */
const ROSTER_FOOTER =
  'EVERYONE IS SELECTED ON OPEN. TAP A ROW TO NARROW. ONE OP PER PIECE THAT CHANGES.'

/**
 * BACK · OPEN · CONSUMED · LOST — the board's own drawn order
 * (`S10 Round…dc.html` §02: both sheets it draws chips for put `OPEN`
 * second, between `BACK` and `CONSUMED`). `OPEN` has no row in `OUTCOMES` —
 * it is the absence of one — so its insertion point is this file's own, but
 * the other three's **relative** order is derived from `OUTCOMES` itself
 * rather than restated: `OUTCOMES`' own docstring claims "the outcome
 * sheet's chip order," so a second, hand-typed `['back', 'consumed',
 * 'lost']` here is exactly the drift `ownerOf`/`phaseOf`'s family of rules
 * warns against — Task 13's roster sheet draws the identical four chips, and
 * two independently-typed orders for one table is how they end up drawing
 * different ones.
 */
const CHIP_IDS: readonly (OutcomeValue | null)[] = OUTCOMES.flatMap(
  (row, index) => (index === 0 ? [row.id, null] : [row.id]),
)

/** The depot Gear a depot Entry names, or `undefined` — `Unpack.tsx`'s
 * `depotGearOf`, restated here rather than exported from a screen file. */
function depotGearOf(entry: EntryState, state: HouseholdState) {
  const source = entry.source?.value
  if (source === undefined || source.from !== 'depot') return undefined
  return state.gear[source.gearId]
}

/**
 * F9's stepper block — split into its own component so every value it draws
 * is a plain `number`, never the outer scope's `number | null`: the caller
 * only mounts this once `bringCount`/`consumedCount` are both known, and a
 * second `!== null` re-check here would just restate that gate.
 */
function ConsumedStepperBlock({
  title,
  bringCount,
  consumedCount,
  owned,
  onChange,
}: {
  title: string
  bringCount: number
  consumedCount: number
  owned: number
  onChange: (next: number | null) => void
}) {
  // **G3: a zero segment draws nothing, and the fact line swaps one word.**
  // At the ceiling every unit was consumed, so there is no rest — the
  // beside-slot is empty rather than reading `×0 BACK`, and the consequence
  // reads `NONE CAME BACK.` in F9's own sentence shape. Below the ceiling
  // F9 stands verbatim. The two lines are one shape with one word swapped,
  // which is why they are composed here rather than spelled twice.
  const back = bringCount - consumedCount
  const rest = back === 0 ? 'NONE CAME BACK.' : 'THE REST CAME BACK.'
  return (
    <div className={styles['stepperBlock']}>
      <div className={styles['stepperRow']}>
        <span className={styles['stepperLabel']}>CONSUMED</span>
        <Stepper
          value={consumedCount}
          min={1}
          max={bringCount}
          onChange={onChange}
          label={`Consumed count for ${title}`}
        />
        {back > 0 && <span className={styles['back']}>×{back} BACK</span>}
      </div>
      <p className={styles['consequence']}>
        {`${rest} OWNED ×${owned} → ×${Math.max(owned - consumedCount, 0)} AT CLOSE.`}
      </p>
    </div>
  )
}

export function OutcomeSheet({
  trip,
  entry,
  view,
  onClose,
  roster = false,
  personId,
}: OutcomeSheetProps) {
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)

  const outcome = outcomeOf(entry)
  const container = isContainerEntry(entry, state)
  const bringCount = bringCountOf(entry, state)
  const consumedCount = consumedCountOf(entry, state)
  const title = entryLabel(entry, state)
  const gear = depotGearOf(entry, state)

  // The roster's own items — `unpackItems`' own piece fan-out, filtered to
  // this Entry, never a second hand-rolled walk over `piecesOf`. Computed
  // unconditionally (a `useMemo` dependency array must not change shape
  // across renders) but cheap to ignore when `roster` is false: `unpackItems`
  // is O(this Trip's entries), not O(depot), and this sheet mounts once per
  // open rather than once per row.
  const pieceItems = useMemo(
    () =>
      roster
        ? unpackItems(trip, state).filter(
            (item): item is Extract<UnpackItem, { kind: 'piece' }> =>
              item.kind === 'piece' && item.entryId === entry.id,
          )
        : [],
    [roster, trip, state, entry],
  )
  const rosterCount = countOfUnpack(pieceItems)

  // Display order is `tripParticipants`' — `PieceStatusSheet`'s own rule,
  // restated: a roster is a thing a Quartermaster scans by name, and
  // `piecesOf`'s id order is only for the fold to agree on, never to read.
  const rosterRows = useMemo(() => {
    const byPerson = new Map(
      pieceItems.map((item) => [item.personId, item.outcome]),
    )
    return tripParticipants(state, trip)
      .filter((person) => byPerson.has(person.id))
      .map((person) => ({
        personId: person.id,
        label: person.label,
        outcome: byPerson.get(person.id) ?? null,
        // §5i G12: the settling fact, per Piece, from the one function that
        // answers it — a per-person Entry carries its outcomes on the
        // Pieces, so the Entry-level predicate answers `false` here and
        // would silently withhold the clause.
        rehomed: rehomedSincePieceOutcome(entry, person.id, gear),
      }))
  }, [pieceItems, state, trip, entry, gear])

  // Mount is the reset (`ui/`'s overlay primitives have no `open` prop) —
  // `PiecePicker`'s draft-state precedent — so a lazy initializer reading
  // `piecesOf` directly is safe: this runs once, at mount, and never again
  // for the life of this component instance.
  //
  // R23: `personId` narrows the seed to that one Piece, but only when it
  // actually names one of this Entry's own included Pieces — a defensive
  // check, not a case any caller is known to hit, guarding against a stale
  // `personId` (a Piece removed between the tap and this mount) silently
  // seeding an empty selection instead of falling back to `EVERYONE`.
  const [selection, setSelection] = useState<Set<string>>(() => {
    const everyone = piecesOf(entry, trip)
    if (personId !== undefined && everyone.includes(personId)) {
      return new Set([personId])
    }
    return new Set(everyone)
  })

  function toggleRow(personId: string): void {
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(personId)) next.delete(personId)
      else next.add(personId)
      return next
    })
  }

  function restoreEveryone(): void {
    setSelection(new Set(piecesOf(entry, trip)))
  }

  const fact = useMemo(() => {
    const path = returnPathOf(entry, state, view)
    const pathText = path.map((segment) => segment.name).join(' ▸ ')

    if (roster) {
      // F7's own drawn fact, `OUTCOME · 2 OF 3 RESOLVED · → LADE 2` — the
      // whole Entry's own arithmetic, unconditionally, regardless of
      // whatever selection happens to be narrowed at the moment.
      const parts = [
        'OUTCOME',
        `${rosterCount.resolved} OF ${rosterCount.total} RESOLVED`,
      ]
      if (pathText !== '') parts.push(`→ ${pathText}`)
      return parts.join(' · ')
    }

    // **G4: the line is B1's ladder — `register · what · where` — and an
    // absent segment drops, because a coarse true line beats a precise
    // truncated one.** The middle names what this Entry *is*: `CONTAINER`
    // first (F1's own reading, settled over board §02's annotation card —
    // the inside-count is the **row**'s meta, never this sheet's), then a
    // Counted Entry's `×N BROUGHT`, then `SINGLE`. The roster arm above
    // supplies per-person's own `N OF M RESOLVED`.
    //
    // **The middle drops for a Kind this build cannot name** (§4: the sheet
    // may not assert a Kind nobody stated), and the arrow drops with no
    // home, as the Loose row's own meta already does. The bare word is the
    // floor, reached by an unsynced Gear — no Kind to name and no residence
    // to point at — and the screen reader hears the title first regardless,
    // since this string is also `Sheet`'s own `description`.
    //
    // The Counted arm stays gated on `bringCount`, never on
    // `entryKind(…) === 'counted'` — `bringCountOf` is the one place that
    // gate is spelled, and re-deriving it here is what this codebase's
    // convention forbids. `entryKind` enters only to name the two Kinds
    // that carry no quantity.
    const parts: string[] = ['OUTCOME']
    if (container) {
      parts.push('CONTAINER')
    } else if (bringCount !== null) {
      parts.push(`×${bringCount} BROUGHT`)
    } else if (entryKind(entry, state) === 'single') {
      parts.push('SINGLE')
    }
    if (pathText !== '') parts.push(`→ ${pathText}`)

    let text = parts.join(' · ')
    if (container) {
      text = `${text} · ITS CONTENTS KEEP THEIR OWN OUTCOMES.`
    }
    return text
  }, [roster, rosterCount, entry, state, view, container, bringCount])

  function choose(next: OutcomeValue | null) {
    // A redundant write moves the stamp LWW compares — see this file's own
    // docstring — so tapping the outcome the Entry already carries writes
    // nothing.
    if (next === outcome) return
    emit(tripOutcomeSet(trip.id, entry.id, next))
  }

  function applyToSelection(next: OutcomeValue | null): void {
    // §5g E10: one op per Piece **that changes** — a Piece already at the
    // tapped outcome is skipped, the redundant-write guard applied to N
    // registers at once. `SET EVERYONE`'s own rule, restated for this
    // sheet's identical shape.
    for (const personId of selection) {
      const current = pieceOutcomeOf(entry.pieces?.[personId])
      if (current === next) continue
      emit(tripOutcomeSet(trip.id, entry.id, next, personId))
    }
  }

  function handleConsumedChange(next: number | null) {
    // `Stepper`'s own `min`/`max` already clamped `next` into
    // `[1, bringCount]` and canonicalised its buffer before calling this —
    // ruling R21. Nothing here re-derives that ceiling.
    if (next === null || consumedCount === null) return
    if (next === consumedCount) return
    emit(tripConsumedCountSet(trip.id, entry.id, next))
  }

  // consumedCountOf already answers `null` for a container (checked first)
  // and for anything that is not a Counted depot Entry — never re-derived
  // as `kind === 'counted' && !container` here. `!roster` besides: per-person
  // gear has no count at all (invariant 6), and this gate is entry-level.
  //
  // **`!isClosed(trip)` is finding I3, and it withholds rather than greys**
  // (`patterns.md` §3.7). On a closed Trip this block was live and lying in
  // three ways at once: its consequence line reads `OWNED ×4 → ×2 AT CLOSE.`
  // where the `×4` is the count the close *already* reduced, `AT CLOSE`
  // names an event that has happened and will not happen again, and raising
  // the stepper emits a `trip.consumed_count_set` that changes the Depot by
  // nothing, ever — because `closeTrip` returns `[]` on a closed Trip (R27
  // Layer B). Worse, the line is a *prediction of the double-reduction*:
  // reopen and re-close and the app looks correct while the owned count is
  // corrupted. The Entry's own split stays legible on the F5 row's meta
  // (`×N CONSUMED · ×M BACK`), so nothing true is lost by withholding it.
  //
  // **§5i G6 has since made this unreachable from F5, and G7 declines to
  // give it a route back.** A closed Trip's rows draw the outcome as text,
  // so no tap opens this sheet there at all — the number is what the
  // household stated when it closed, and a ledger keeps what was stated.
  // The gate stays as the belt to that: this component takes `trip` as a
  // prop and a second caller must not inherit a lying line. The two
  // corrections that matter have their own routes — the Depot count in gear
  // detail's EDIT, the history through reopen, invariant 19's route by
  // name.
  const showStepper =
    !roster &&
    !isClosed(trip) &&
    outcome === 'consumed' &&
    consumedCount !== null &&
    bringCount !== null

  return (
    <Sheet
      title={title}
      onClose={onClose}
      desktopCard
      description={<p className={styles['fact']}>{fact}</p>}
    >
      {roster && (
        <div className={styles['applyRow']}>
          <span className={styles['applyLabel']}>APPLY TO</span>
          <button
            type="button"
            className={styles['everyoneChip']}
            data-testid="roster-everyone"
            onClick={restoreEveryone}
          >
            EVERYONE
          </button>
        </div>
      )}

      {roster && (
        <ul className={styles['rosterList']}>
          {rosterRows.map((row) => {
            const selected = selection.has(row.personId)
            return (
              <li key={row.personId}>
                <button
                  type="button"
                  className={styles['rosterRow']}
                  data-testid="roster-row"
                  aria-pressed={selected}
                  onClick={() => toggleRow(row.personId)}
                >
                  <span
                    className={styles['rosterCircleWrap']}
                    aria-hidden="true"
                  >
                    <PersonCircle
                      label={
                        row.label === UNNAMED_PERSON_GLYPH
                          ? undefined
                          : row.label.charAt(0).toUpperCase()
                      }
                      size={30}
                      tone={circleToneForOutcome(row.outcome)}
                    />
                  </span>
                  <span className={styles['rosterNameStack']}>
                    <span className={styles['rosterName']}>{row.label}</span>
                    {/* R24 — the board's own drawn colour: packed green for
                        a resolved Piece, attention for a lost one, muted
                        for open. `data-tone` reuses `circleToneForOutcome`
                        rather than a second, hand-typed mapping — the same
                        three values the circle beside it paints. */}
                    <span
                      className={styles['rosterStatus']}
                      data-tone={circleToneForOutcome(row.outcome)}
                    >
                      {outcomeGlyph(row.outcome)} {outcomeLabel(row.outcome)}
                      {/* §5i G12: the pair in words. The row keeps the
                          attention tone the circle beside it paints —
                          `PersonCircle`'s three tones are F7's ceiling and
                          the round leaves them — and states the settling
                          fact as a second clause instead. */}
                      {row.outcome === 'lost' && row.rehomed && ' · RE-HOMED'}
                    </span>
                  </span>
                  <span className={styles['rosterMarker']}>
                    {selected ? 'SELECTED ✓' : '○'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div
        className={styles['chips']}
        role="group"
        aria-label={`Outcome — ${title}`}
      >
        {CHIP_IDS.map((id) => {
          // Roster mode has no single "current" outcome to raise — a
          // selection can hold Pieces at different outcomes at once, and the
          // Entry's own register (what `outcomeOf` reads) is never written
          // by a per-Piece op in the first place.
          const current = !roster && id === outcome
          return (
            <button
              key={id ?? 'open'}
              type="button"
              className={styles['chip']}
              data-current={current ? 'true' : undefined}
              // Minor 5: `aria-pressed` is a toggle-button's own state, and
              // roster mode's chips are actions applied to a selection, not
              // toggles that merely never become pressed — omitting the
              // attribute there (rather than stating `false` forever) is
              // what keeps a screen reader from announcing four toggle
              // buttons none of which can ever be "on."
              {...(roster ? {} : { 'aria-pressed': current })}
              data-testid="outcome-chip"
              onClick={() => (roster ? applyToSelection(id) : choose(id))}
            >
              {outcomeGlyph(id)} {outcomeLabel(id)}
            </button>
          )
        })}
      </div>

      {showStepper && bringCount !== null && consumedCount !== null && (
        <ConsumedStepperBlock
          title={title}
          bringCount={bringCount}
          consumedCount={consumedCount}
          owned={
            gear === undefined ? bringCount : (ownedCountOf(gear) ?? bringCount)
          }
          onChange={handleConsumedChange}
        />
      )}

      <p className={styles['footer']}>{roster ? ROSTER_FOOTER : FOOTER}</p>

      <Sheet.Close>
        <button type="button" className={styles['close']}>
          Close
        </button>
      </Sheet.Close>
    </Sheet>
  )
}
