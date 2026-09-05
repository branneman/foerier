import { type KindValue } from '@foerier/shared'
import { PersonCluster, Stepper } from '@foerier/ui'

import { personInitial } from '../household/people'

import styles from './EntryRow.module.css'

/** One Participant's Piece, as `GearListSection` resolves it via
 * `pieceInclusion` — {@link EntryRowProps.pieces}' element shape. */
export interface EntryRowPiece {
  readonly personId: string
  readonly label: string
  readonly included: boolean
}

/**
 * **One line on a Trip's gear list** — the row `GearListSection` groups by
 * Kind (spec §4.2, `docs/design/README.md` §5's S7 round). Presentational,
 * like `ui/`'s `GearRow`: domain data in, callbacks out, no store read of its
 * own — `GearListSection` is the one place that resolves `entryLabel` /
 * `entryKind` / `bringCountOf` / `pieceCountOf` against the fold and hands
 * this component the answers.
 *
 * **Layout order is the board's, not the trailing-column's.** Review round
 * F1: every editable board that draws a trip-only row (the 900/1024 builder
 * panes, the trip-only sheet preview) draws `name → badge → spacer → ✕` —
 * the name is *not* `flex: 1`, the badge sits beside it, and a **separate**
 * flexible spacer pushes `✕` to the row's edge. Every other Kind gives the
 * name itself `flex: 1` and puts its own content in the trailing slot. So
 * the `TRIP-ONLY` badge is a **name adjunct**, not trailing-column content —
 * an earlier draft put it in the trailing slot and then correctly, but
 * wrongly, applied the trailing-column's own read-only rule to it. The badge
 * now renders **in both modes**; `.trailing`'s read-only rule is unchanged
 * by this — see below.
 *
 * **Anatomy is `kind` × `editable`, and the two do not compose the way a
 * single switch would suggest.** Below Split (`editable`) the trailing slot
 * is kind-specific — a dense `Stepper` on `counted`, the cluster + `×N`
 * control on `per_person` (rulings A/B, below), nothing on every other Kind
 * (`single`, `trip_only`, and anything `GearListSection`'s `rowKind` has
 * mapped to `'ungrouped'`) — and a row ends in `✕`. From Split up
 * (`!editable`) most of that does not survive: no `✕`, no stepper, and the
 * trailing slot reads `×N` for `counted` alone and `—` for every other Kind
 * — **except `per_person`**, which draws the identical cluster + `×N` in
 * both modes (`docs/design/README.md` §5d, ruling A). That `—`-for-the-rest
 * rule is the spec's own wording (§4.2: "the trailing column reads `×4` for
 * a Counted Entry and `—` for everything else") and is deliberately **not**
 * "the editable anatomy minus the interactive controls" for `counted`,
 * `single` and `trip_only` — the read-only pane states less about
 * *quantity* than the editable one there, which is a narrower claim than
 * "states nothing about this row's Kind": the `TRIP-ONLY` badge and the
 * group headers both still say so. Ruling A carves `per_person` out of that
 * general rule on purpose: the circles are the fact the read pane exists to
 * show, not an editing affordance, so "display needs no target's air" and
 * **no extra dimming** — dim already means excluded (ruling E's `dashed`
 * tone), and one encoding never carries two meanings.
 *
 * **Ruling B: the circles are never individual targets.** A 44px hit area on
 * 32px circle centres is ruling O's own counter-example — a tap meant for
 * Els lands on Mark and removes the wrong Person's Piece; clamped to the row
 * a target reaches only ~32px; spacing circles far enough apart to clear 44
 * outright costs ~132px of a 393px row. So the cluster and `×N` are **one
 * control**, `onOpenPiecePicker`, which opens `PiecePicker` — that picker,
 * not this row, is where a tap on one Person's Piece happens. Its accessible
 * name states the whole fact (`Who brings one — Headlamp, 2 of 3 bring
 * one`) precisely so nothing needs to read the circles individually; the
 * cluster itself is wrapped `aria-hidden` inside it (`NewTrip.tsx`'s
 * `display: contents` pattern, commit `83e2d6f`) so `PersonCluster`'s own
 * `role="img"` never double-announces the same roster a second time. In
 * `!editable` mode the cluster is **not a control at all** — a plain
 * `<span>`, no button, no hit extension, nothing for ruling O to floor —
 * exactly the distinction this row already draws for the Bring-count
 * (`Stepper` when `editable`, plain `×N` above Split).
 *
 * **Ruling C's empty case: no Participants, no cluster, no control.** A
 * `per_person` row whose `pieces` is empty draws the mono `NO PARTICIPANTS`
 * beside `×0` instead — a domain fact (Pieces derive from Participants, and
 * there is nobody to derive one from), not an ordinary empty state, so
 * `onOpenPiecePicker` never fires and nothing mounts to fire it from.
 *
 * **Ruling D: `×0` stands, silently.** A `per_person` row whose every Piece
 * is removed draws an all-dashed cluster and `×0`, with no quiet line and no
 * offer to remove — an offer would gate a reversible op (the tag-chip rule)
 * and a nag would editorialize a state the Quartermaster chose on purpose.
 * Invariant 11's right expression of "nobody is bringing it" stays where it
 * always was: the `✕` at the row's edge. This is why the two ways to reach
 * `×0` draw *differently* — an all-dashed cluster is three people who each
 * declined; `NO PARTICIPANTS` is nobody to decline in the first place.
 *
 * **`onBringCountChange` never fires for a no-op edit.** `Stepper` reports
 * its well's value as `number | null` and can call back with the value
 * already current — a clamp, or clear-and-retype the same digits (its own
 * docstring). Two guards sit between that report and this row's callback:
 * `null` (the well is blank — nothing chosen, never `0`, invariant 11) is
 * swallowed here rather than forwarded, and a reported value equal to the
 * current `bringCount` is dropped too, so a redundant `trip.entry_bring_-
 * count_set` is never authored (spec §4.9's needless-write rule, S6's).
 * **Neither guard special-cases `0`**: `next === bringCount` is a plain
 * numeric comparison, so decrementing from `1` to `0` compares `0 !== 1` and
 * is forwarded exactly like any other genuine change — `EntryRow.test.tsx`
 * pins this against the specific refactor that would break it
 * (`if (!next) return`, which reads as the same guard and silently is not).
 */
export interface EntryRowProps {
  readonly label: string
  readonly kind: KindValue | 'trip_only'
  /**
   * `null` only ever arrives for a non-`counted` Kind — see `bringCountOf`.
   * **The row's own `×N` for `counted`, in both modes** (fix round, S9a task
   * 4 F3) — `pieceCount` reads `0` for a container regardless of Kind
   * (ruling A5), which is a fact about the totals, not about how many of
   * this thing there are, so this row must not draw its Bring-count from it.
   */
  readonly bringCount: number | null
  /**
   * The `per_person` empty case's `×0` beside `NO PARTICIPANTS` — the one
   * remaining caller, since `pieces` is empty and there is no cluster to
   * derive a count from. A populated `per_person` row derives its own `×N`
   * from `pieces` instead (below), and `counted` now reads `bringCount`
   * rather than this field (fix round, S9a task 4 F3) — a container's
   * `pieceCount` is `0` regardless of Kind (ruling A5), which answers "how
   * many things travel", not "how many of this thing there are".
   */
  readonly pieceCount: number
  /**
   * Every Participant on this Entry's Trip and whether their Piece is
   * included — read only for `per_person` rows, ignored by every other
   * Kind. Ordered by `GearListSection` through `tripPieces`
   * (`app/src/household/trips.ts`), the one join `PiecePicker` also calls, in
   * display order — **not** `pieceInclusion`'s own id order
   * (`shared/src/selectors/piece.ts`'s own docstring says why the two
   * differ). An empty array is ruling C's domain fact — no Participants, so
   * no Pieces to picture — and draws `NO PARTICIPANTS` rather than an empty
   * cluster; see this file's docstring.
   */
  readonly pieces: readonly EntryRowPiece[]
  readonly editable: boolean
  /** Emits `trip.entry_bring_count_set`. Never called with the current value. */
  readonly onBringCountChange: (next: number) => void
  /** Emits `trip.entry_removed`. Does not confirm — the tag-chip rule. */
  readonly onRemove: () => void
  /**
   * Opens `PiecePicker` for this Entry. Fires from ruling B's one control —
   * the cluster + `×N` together — never from an individual circle. Unused
   * when `!editable` (the cluster there is a plain, uncontrolled `<span>`)
   * and unused when `pieces` is empty (ruling C: no control mounts to fire
   * it from).
   */
  readonly onOpenPiecePicker: () => void
}

export function EntryRow({
  label,
  kind,
  bringCount,
  pieceCount,
  pieces,
  editable,
  onBringCountChange,
  onRemove,
  onOpenPiecePicker,
}: EntryRowProps) {
  const isTripOnly = kind === 'trip_only'

  function handleStepperChange(next: number | null) {
    if (next === null) return
    if (next === bringCount) return
    onBringCountChange(next)
  }

  const trailingContent = trailing(
    kind,
    bringCount,
    pieceCount,
    pieces,
    editable,
    label,
    handleStepperChange,
    onOpenPiecePicker,
  )

  const rowClassName = editable
    ? styles['row']
    : `${styles['row']} ${styles['readOnly']}`

  return (
    <div className={rowClassName} data-testid="entry-row">
      <span
        className={
          isTripOnly
            ? styles['label']
            : `${styles['label']} ${styles['labelGrow']}`
        }
      >
        {label}
      </span>
      {/* The leading `{' '}` is not decoration, and `PackingRow` carries the
          identical note beside its own badge: `.row`'s flex `gap` separates
          the two spans on screen, but a gap is not a character. Without it
          the row's text content — everything a screen reader reads crossing
          the row — announces `PassportsTRIP-ONLY`, one word, the badge glued
          to the gear's name. */}
      {isTripOnly && (
        <>
          {' '}
          <span className={styles['badge']} data-testid="entry-row-badge">
            TRIP-ONLY
          </span>
        </>
      )}
      {isTripOnly && <span className={styles['spacer']} aria-hidden="true" />}
      {trailingContent !== null && (
        <span className={styles['trailing']}>{trailingContent}</span>
      )}
      {editable && (
        <button
          type="button"
          className={styles['remove']}
          aria-label={`Remove ${label}`}
          data-testid="entry-row-remove"
          onClick={onRemove}
        >
          ✕
        </button>
      )}
    </div>
  )
}

function trailing(
  kind: KindValue | 'trip_only',
  bringCount: number | null,
  pieceCount: number,
  pieces: readonly EntryRowPiece[],
  editable: boolean,
  label: string,
  handleStepperChange: (next: number | null) => void,
  onOpenPiecePicker: () => void,
) {
  // Ruling A carves `per_person` out ahead of the `editable` split below:
  // it is the one Kind that draws the identical anatomy in both modes, so
  // there is exactly one place that decides its content rather than two.
  if (kind === 'per_person') {
    return perPersonTrailing(
      pieces,
      pieceCount,
      label,
      editable,
      onOpenPiecePicker,
    )
  }

  if (!editable) {
    // The spec's own rule for everything but `per_person`: `×N` for Counted
    // alone, `—` for everything else. Not "the editable anatomy minus the
    // controls"; see this file's docstring.
    //
    // **Reads `bringCount`, not `pieceCount` (fix round, S9a task 4 F3).**
    // `container` and `kind` are orthogonal registers — a Counted Entry can
    // be a container — and ruling A5 makes `pieceCount` (`pieceCountOf`) read
    // `0` for one, because A5 is the outer gate: a container carries no
    // status, so it contributes nothing to the packing arithmetic whatever
    // its Kind. `×N` on this row is a different question — "how many of this
    // thing are there" — which is `bringCountOf`'s question (ruling A13), not
    // the totals'. The editable branch below already draws that number
    // through `Stepper`'s `bringCount` prop; this is the same fact in
    // read-only form, and the two must not diverge by mode again. Never
    // `null` here: `bringCountOf` only reads `null` for a non-`counted` Kind,
    // and this branch is guarded on `kind === 'counted'` — the `?? 1` is
    // `bringCountOf`'s own documented default for an absent register, read
    // again rather than trusted blindly.
    return (
      <span data-testid="entry-row-count">
        {kind === 'counted' ? `×${bringCount ?? 1}` : '—'}
      </span>
    )
  }

  switch (kind) {
    case 'counted':
      return (
        <Stepper
          size="dense"
          value={bringCount}
          min={0}
          onChange={handleStepperChange}
          label={`Bring-count for ${label}`}
        />
      )
    default:
      // `single`, `trip_only` (whose badge is a name adjunct, not trailing
      // content — see this file's docstring), and any Kind `GearListSection`
      // has already mapped to `'ungrouped'` — nothing to draw here.
      return null
  }
}

/**
 * The `per_person` trailing slot, both modes — rulings A, B, C's empty case
 * and D, all four in one place because they are one anatomy: see this
 * file's docstring for the reasoning each ruling number argues.
 */
function perPersonTrailing(
  pieces: readonly EntryRowPiece[],
  pieceCount: number,
  label: string,
  editable: boolean,
  onOpenPiecePicker: () => void,
) {
  if (pieces.length === 0) {
    // Ruling C's empty case: a domain fact, not an empty state — Pieces
    // derive from Participants, so with none there is nothing to picture
    // and nothing to open a picker onto. `.pieceDisplay` supplies the row's
    // own gap — review finding F1: two bare sibling spans in `.trailing`
    // (which declares none, since every other branch has a single child)
    // render as one run-on token, `NO PARTICIPANTS×0`, with nothing between
    // them.
    return (
      <span className={styles['pieceDisplay']} data-testid="entry-row-pieces">
        <span className={styles['noParticipants']}>NO PARTICIPANTS</span>
        <span data-testid="entry-row-count">×{pieceCount}</span>
      </span>
    )
  }

  const includedCount = pieces.filter((piece) => piece.included).length
  // Ruling B's exact accessible name — states the whole fact once so
  // nothing needs to read the circles individually. `includedCount` is also
  // what the visible `×N` below reads, in both modes: review finding F3 —
  // deriving the digit and the visible count from the same local rather
  // than from the separate `pieceCount` prop is what makes them agree *by
  // construction*, not by the coincidence that `pieceCountOf` for
  // `per_person` happens to equal `piecesOf().length` today. `pieceCount`
  // still serves the empty branch above, where there is no `pieces` array
  // to derive a count from.
  const accessibleName = `Who brings one — ${label}, ${includedCount} of ${pieces.length} bring one`

  const cluster = (
    <PersonCluster
      people={pieces.map((piece) => ({
        key: piece.personId,
        label: personInitial(piece.label),
        // Dashed (excluded) sorts to the front — `PersonCluster`'s own
        // ruling-E job, not this row's. `tone` is only ever set when
        // excluded (`exactOptionalPropertyTypes`: an omitted key and a key
        // present as `undefined` are different types under it).
        ...(piece.included ? {} : { tone: 'dashed' as const }),
      }))}
      size={24}
      label={accessibleName}
    />
  )

  if (!editable) {
    // Ruling B's other half: display only, above Split — a plain `<span>`,
    // no button, no hit extension, nothing for ruling O to floor.
    return (
      <span className={styles['pieceDisplay']} data-testid="entry-row-pieces">
        {cluster}
        <span data-testid="entry-row-count">×{includedCount}</span>
      </span>
    )
  }

  return (
    <button
      type="button"
      className={styles['pieceControl']}
      aria-label={accessibleName}
      data-testid="entry-row-piece-control"
      onClick={onOpenPiecePicker}
    >
      {/* `aria-hidden` + `display: contents` (`.clusterWrap`): this button
          already carries `accessibleName` as its own label, so an unhidden
          `PersonCluster` nested inside would double-announce the same
          roster via its own `role="img"` — `NewTrip.tsx`'s pattern (commit
          `83e2d6f`), applied here rather than reinvented. */}
      <span aria-hidden="true" className={styles['clusterWrap']}>
        {cluster}
      </span>
      <span data-testid="entry-row-count">×{includedCount}</span>
    </button>
  )
}
