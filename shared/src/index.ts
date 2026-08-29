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
  PhaseValue,
  PlaceState,
  Residence,
  TripState,
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

export type { TagString } from './tags.ts'
export {
  normalizeTag,
  normalizeTagInput,
  TAG_MAX_LENGTH,
  TAG_PATTERN,
} from './tags.ts'

export type { OpAuthor, OpSpec } from './authoring.ts'
export {
  authorOp,
  gearKindSet,
  gearOwnedCountSet,
  gearOwnershipSet,
  gearRecorded,
  gearRehomed,
  gearRenamed,
  gearRestored,
  gearRetired,
  gearTagApplied,
  gearTagRemoved,
  personRecorded,
  personRenamed,
  placeRecorded,
  placeRemoved,
  placeRenamed,
  tripCreated,
  tripDatesSet,
  tripParticipantAdded,
  tripParticipantRemoved,
  tripPhaseMoved,
  tripRenamed,
} from './authoring.ts'

export { applyOp, emptyState, fold } from './reduce.ts'

export type {
  ContainmentView,
  HolderRef,
  PathSegment,
} from './selectors/containment.ts'
export { containmentView, homePath } from './selectors/containment.ts'

export {
  depotCounts,
  looseGear,
  retiredGear,
  tagsOf,
  visibleGear,
  visiblePlaces,
} from './selectors/depot.ts'

export { ownerLabel, ownerOf, personLabel } from './selectors/owner.ts'

export type {
  Dimension,
  DimensionId,
  DimensionValue,
  GroupKey,
  SliceGroup,
  SliceResult,
  SliceSpec,
  SortKey,
} from './selectors/slice.ts'
export {
  DIMENSIONS,
  dimension,
  dimensionValues,
  EMPTY_SLICE,
  GROUP_KEYS,
  groupLabel,
  recordedAt,
  sliceDepot,
} from './selectors/slice.ts'

export type { Whereabouts, WhereaboutsSlice } from './selectors/whereabouts.ts'
export { whereabouts } from './selectors/whereabouts.ts'

export type { Phase, PhaseKey, TripSections } from './selectors/trip.ts'
export {
  isActive,
  isKnownPhase,
  participantIds,
  phaseDay,
  phaseLabel,
  phaseName,
  phaseNext,
  phaseOf,
  PHASES,
  tripLabel,
  tripSections,
  visibleTrips,
} from './selectors/trip.ts'

export type { Match } from './selectors/find.ts'
export { findGear } from './selectors/find.ts'

export { guessDeviceLabel } from './deviceLabel.ts'
