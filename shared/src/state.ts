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

export interface DepotState {
  readonly places: Readonly<Record<string, PlaceState>>
  readonly gear: Readonly<Record<string, GearState>>
  readonly people: Readonly<Record<string, PersonState>>
  readonly unfolded: UnfoldedOps
}
