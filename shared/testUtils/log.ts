import type { OpSpec } from '../src/authoring.ts'
import type { OpEnvelope } from '../src/ops.ts'
import { emptyState, fold } from '../src/reduce.ts'
import type { HouseholdState } from '../src/state.ts'
import { anOp, DEFAULT_HLC_MS, hlcAt } from './factories.ts'

/**
 * Turning factory specs into a log, and a log into folded state — the step
 * every selector suite takes between {@link aTrip} and its assertion, and the
 * one they had each written for themselves.
 *
 * **Why it is one function and not five copies.** The contract is stated in
 * `aTrip`'s own docstring — *"they come back in authoring order, so a caller
 * stamping increasing clocks over the flattened list gets exactly the log a
 * screen would have written"* — and a contract stated in a docstring is
 * pinned by nothing. S5 found the cost: a helper that stamped **one** HLC
 * across a multi-op factory produced Draft Trips where the author had written
 * `phase: 'pack_out'`, because a `trip.phase_moved` sharing `trip.created`'s
 * exact stamp loses the tie on {@link writeRegister}'s `<= 0` rule rather
 * than moving the register. The five copies were all correct; nothing would
 * have said so if the sixth had not been.
 *
 * Fixtures go through the **real reducer**, never a hand-shaped
 * {@link HouseholdState}, so a selector can never pass against a state the
 * reducer could not produce.
 */

/** The device every stamped op is authored by, unless a test names another. */
export const DEV_A = 'aaaaaaaa-0000-7000-8000-000000000001'

export { DEFAULT_HLC_MS }

interface StampOptions {
  /** The first counter. Increases by one per spec thereafter. */
  start?: number
  /** The millisecond every op is stamped at — only the counter orders them. */
  ms?: number
  deviceId?: string
}

/**
 * Stamps each spec with its **own**, increasing counter.
 *
 * Giving every spec the *same* counter is wrong the moment a factory returns
 * more than one op on the same aggregate: `aTrip({ phase })` returns
 * `[trip.created, trip.phase_moved]`, and a `trip.phase_moved` sharing
 * `trip.created`'s exact stamp loses on the tie rather than moving the
 * register. It is a no-op difference for a single-op factory (`aGear`,
 * `aPerson`), so one stamper serves both shapes.
 */
export function stamp(
  specs: readonly OpSpec[],
  { start = 1, ms = DEFAULT_HLC_MS, deviceId = DEV_A }: StampOptions = {},
): OpEnvelope[] {
  return specs.map((spec, i) =>
    anOp(spec, { hlc: hlcAt(start + i, ms), deviceId }),
  )
}

/**
 * The fold of every given spec, stamped at `ms`. Two folds at different
 * milliseconds are orderable in time, which is what a test of anything
 * clock-sensitive needs and what {@link depot} deliberately does not offer.
 */
export function foldAt(
  ms: number,
  specs: readonly (readonly OpSpec[])[],
): HouseholdState {
  return fold(stamp(specs.flat(), { ms }), emptyState())
}

/** {@link foldAt} at the factories' own default millisecond — the common case. */
export function depot(
  ...specs: readonly (readonly OpSpec[])[]
): HouseholdState {
  return foldAt(DEFAULT_HLC_MS, specs)
}
