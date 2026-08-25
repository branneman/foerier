export type { Aggregate, AggregateTag, OpEnvelope, StoredOp } from './ops.ts'
export { MAX_BATCH_BYTES, MAX_BATCH_OPS, MAX_OP_BYTES } from './ops.ts'

export type { Clock, IdSource } from './boundaries.ts'
export { systemClock, systemIdSource } from './boundaries.ts'

export type { HlcClock, HlcParts, Stamp } from './hlc.ts'
export {
  compareStamps,
  createHlcClock,
  DRIFT_BOUND_MS,
  formatHlc,
  HLC_COUNTER_MAX,
  HLC_PATTERN,
  issueAt,
  parseHlc,
  receiveAt,
} from './hlc.ts'

export type { Register } from './registers.ts'
export { stampOf, writeRegister } from './registers.ts'

export type {
  DepotState,
  GearState,
  KindValue,
  Owner,
  PersonState,
  PlaceState,
  Residence,
  UnfoldedOps,
} from './state.ts'

export type { Read } from './payloads.ts'
export {
  readBoolean,
  readCount,
  readOpen,
  readOwner,
  readResidence,
  readString,
} from './payloads.ts'
