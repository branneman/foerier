import { compareStamps, type Stamp } from './hlc.ts'

/**
 * The unit of last-writer-wins is neither the aggregate nor the record: it is
 * a **register**, keyed by `(aggregate_id, entity_path, field)`
 * (`docs/sync-protocol.md` §3.1). Editing a piece of gear's home and its tags
 * concurrently is not a conflict. The aggregate is the *sync* unit; the
 * register is the *merge* unit.
 */
export interface Register<T> {
  readonly value: T
  readonly hlc: string
  readonly deviceId: string
}

export function stampOf(register: Register<unknown>): Stamp {
  return { hlc: register.hlc, deviceId: register.deviceId }
}

/**
 * §3.2, in full. There is no second rule for any field.
 *
 * The strict-greater guard is what makes `apply` commutative, associative and
 * idempotent — precisely the property the convergence tier asserts. An older
 * op arriving late loses at O(1) and no re-fold is ever needed.
 *
 * Returns `current` — the same object — when the write loses, so an unchanged
 * register never invalidates a memo downstream.
 */
export function writeRegister<T>(
  current: Register<T> | undefined,
  value: T,
  stamp: Stamp,
): Register<T> {
  if (current !== undefined && compareStamps(stamp, stampOf(current)) <= 0) {
    return current
  }
  return { value, hlc: stamp.hlc, deviceId: stamp.deviceId }
}
