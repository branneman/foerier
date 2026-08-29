import type { Register } from './registers.ts'

/**
 * Folded state: the deterministic fold of the op log
 * (`docs/architecture-design.md` §2).
 *
 * **This side is camelCase.** Ops mirror the wire and keep its `snake_case`;
 * folded state, selectors and UI props are ordinary TypeScript. The reducer is
 * the one place the two meet (architecture §12).
 *
 * Every field is a {@link Register} — a value plus the `(hlc, device_id)` of
 * the op that last wrote it — because the merge unit is the field, not the
 * record. Every field is **optional**, and with `exactOptionalPropertyTypes`
 * that means the key is absent rather than holding `undefined`: an absent
 * register was never addressed by any op, which is a different fact from a
 * register holding `null`.
 */

/**
 * Deliberately open past the three known members. An unknown enum value is
 * stored verbatim and never coerced (`sync-protocol.md` §5.3, obligation 4) —
 * safe only because §3.3 removed the rank function from the merge.
 */
export type KindValue = 'single' | 'per_person' | 'counted' | (string & {})

export type Residence =
  { in: 'place'; id: string } | { in: 'gear'; id: string } | { in: 'loose' }

export type Owner = { type: 'shared' } | { type: 'person'; personId: string }

export interface PlaceState {
  id: string
  name?: Register<string | null>
  /** A tombstone is an ordinary LWW field; an edit never writes it (§3.5). */
  removed?: Register<boolean>
}

export interface GearState {
  id: string
  name?: Register<string | null>
  /**
   * The containment trait, seeded at `gear.recorded`. There is deliberately no
   * mutation op for it (`sync-protocol.md` §4.3) — recorded there as an
   * omission, not smuggled in here.
   */
  container?: Register<boolean>
  kind?: Register<KindValue>
  /** The **home** residence. A trip never touches it (invariant 13). */
  residence?: Register<Residence>
  ownedCount?: Register<number>
  /** The register exists because `gear.recorded` may carry it; S4 writes it. */
  owner?: Register<Owner>
  retired?: Register<boolean>
  /**
   * Per-tag registers (`sync-protocol.md` §3.4). **Not one register holding
   * an array** — that would make two quartermasters tagging concurrently
   * clobber each other. Each member is its own register, so
   * `tag_applied{food}` and `tag_applied{kitchen}` union without ever
   * meeting, and an apply racing a remove of the *same* tag is one register
   * resolving by plain LWW.
   *
   * The key is the **literal string that arrived**, never normalised on the
   * way in: §5's tolerant reader outranks §4.3's `TagString` rule, so two
   * spellings of one intent are two registers that both fold. `tags.ts` is
   * where the rule is applied, on the way out.
   *
   * `false` is a real value with a real clock, not an absence — a removal is
   * a write, and dropping the key would let a concurrent re-apply win by
   * arrival order. An absent `tags` key is the different fact that no tag op
   * has ever addressed this gear.
   */
  tags?: Readonly<Record<string, Register<boolean>>>
}

export interface PersonState {
  id: string
  name?: Register<string | null>
}

/**
 * Deliberately open past the five known members, exactly as {@link KindValue}
 * is and for the identical reason: an unknown enum value is stored verbatim
 * and never coerced (`sync-protocol.md` §5.3, obligation 4), and a closed
 * union would make the tolerant reader impossible to write without a cast.
 *
 * A peer on a later build can fold a phase this build has never heard of.
 * What the app then *does* with one is `selectors/trip.ts`'s answer and not
 * this type's: not active, filed under `PLANNED`, drawn verbatim, stating no
 * next step.
 */
export type PhaseValue =
  'draft' | 'pack_out' | 'on_trip' | 'unpack' | 'closed' | (string & {})

/**
 * The **fourth aggregate** (`sync-protocol.md` §3.7). S6 builds the *root*
 * row of that table and the `participants` row, and nothing else: the four
 * nested maps — entries, pieces, tasks, notes — belong to S7 onward, and a
 * slice adds its own row rather than pre-declaring everyone else's.
 */
export interface TripState {
  id: string
  name?: Register<string | null>
  /**
   * Seeded `draft` by `trip.created` itself — the **reducer's** write, not a
   * payload field (spec §1.3) — and moved thereafter by `trip.phase_moved`,
   * in either direction (invariant 16).
   *
   * An **absent** register reads `draft`, and only `selectors/trip.ts`'s
   * `phaseOf` says so. It is reachable two ways: a `trip.phase_moved`
   * delivered before its `trip.created`, and a Trip addressed only by a
   * participant op. The fold conflates nothing — absent and an explicit
   * `"draft"` stay different facts about the log.
   */
  phase?: Register<PhaseValue>
  /**
   * `YYYY-MM-DD` by convention, **verbatim in fact** (spec §1.4): the payload
   * goes through `readString` with no format gate, because a reader reporting
   * anything else `absent` would be rejecting a quartermaster's work to
   * enforce a spelling. The two dates are independent registers with no
   * end-before-start guard either — the domain states no such invariant, and
   * a guard would have to discard one of two legitimate concurrent writes.
   *
   * The payload keys are `start` and `end`; these register names are longer on
   * purpose, the same split `gear.owned_count_set{count}` already has.
   */
  startDate?: Register<string | null>
  endDate?: Register<string | null>
  /**
   * Template provenance, carried by `trip.created`'s optional `from_trip_id`.
   * **Folded at S6 and read by nobody until S14** (spec §1.3): §5.4 freezes
   * the payload shape the moment this slice ships, so a field the reducer
   * silently dropped would be a field no fixture could prove was carried.
   */
  fromTripId?: Register<string>
  /**
   * S14's `trip.deleted` writes this. **Declared here, never written here** —
   * one optional field is the price of keeping `TripState` matching §3.7's
   * row, and the alternative is S14 editing a type that by then eight slices'
   * worth of code already reads.
   */
  deleted?: Register<boolean>
  /**
   * Per-person-id registers (`sync-protocol.md` §3.4), exactly as
   * {@link GearState.tags} is per-tag — **not one register holding an
   * array**, which would make two quartermasters editing the roster
   * concurrently clobber each other. Two devices adding *different* People
   * address different registers and both survive; an add racing a remove of
   * the *same* Person is one register resolving by plain LWW.
   *
   * `false` is a real value carrying a real clock, not a deleted key:
   * dropping the key would let a concurrent re-add win by arrival order. An
   * absent `participants` key is the different fact that no participant op
   * has ever addressed this Trip.
   *
   * It has to be a map for a reason beyond merge safety — S8 derives one
   * Piece per Participant, which is what lets a Participant added late get a
   * Piece with **no backfill op**.
   */
  participants?: Readonly<Record<string, Register<boolean>>>
}

/**
 * Ops this build could not fold, retained in the log and counted here.
 *
 * `sync-protocol.md` §5.3 obligation 1 says an unknown op type is retained,
 * not discarded. Counting it makes that **observable** rather than silently
 * honoured — and it is why the local snapshot is keyed by build SHA.
 */
export interface UnfoldedOps {
  readonly count: number
  readonly types: Readonly<Record<string, number>>
}

/**
 * With `trips`, this is the fold of **everything**, not just the depot. The
 * name stays: renaming it reaches `DepotStoreState`, `DepotProvider`,
 * `useDepot`, `DepotView` and every screen across three workspaces, and S5 is
 * in flight through those same files. Recorded as a misnomer rather than
 * fixed here (spec §2).
 */
export interface DepotState {
  readonly places: Readonly<Record<string, PlaceState>>
  readonly gear: Readonly<Record<string, GearState>>
  readonly people: Readonly<Record<string, PersonState>>
  readonly trips: Readonly<Record<string, TripState>>
  readonly unfolded: UnfoldedOps
}
