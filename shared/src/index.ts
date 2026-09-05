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
  EntrySource,
  EntryState,
  GearState,
  KindValue,
  Owner,
  PersonState,
  PhaseValue,
  PieceState,
  PlaceState,
  Residence,
  StageValue,
  StatusValue,
  TripResidence,
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
  readSource,
  readString,
  readTripResidence,
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
  tripContainerStageSet,
  tripCreated,
  tripDatesSet,
  tripEntryAdded,
  tripEntryBringCountSet,
  tripEntryMoved,
  tripEntryRemoved,
  tripEntryStatusSet,
  tripParticipantAdded,
  tripParticipantRemoved,
  tripPhaseMoved,
  tripPieceMoved,
  tripPieceRemoved,
  tripPieceRestored,
  tripPieceStatusSet,
  tripRenamed,
} from './authoring.ts'

export { applyOp, emptyState, fold } from './reduce.ts'

export type {
  ContainmentView,
  HolderRef,
  PathSegment,
} from './selectors/containment.ts'
export {
  containmentView,
  homePath,
  residenceOf,
} from './selectors/containment.ts'

// Beside its twin on purpose: `tripContainment.ts` duplicates the file above
// deliberately, and the two must not drift.
export type {
  TripContainmentView,
  TripHolderRef,
  TripPathSegment,
} from './selectors/tripContainment.ts'
export { tripContainmentView, tripPath } from './selectors/tripContainment.ts'

export {
  depotCounts,
  looseGear,
  ownedCountOf,
  retiredGear,
  tagsOf,
  visibleGear,
  visiblePlaces,
} from './selectors/depot.ts'

export {
  ownerInitial,
  ownerLabel,
  ownerOf,
  personLabel,
  personNameOrUnnamed,
  UNNAMED_PERSON,
  UNNAMED_PERSON_GLYPH,
} from './selectors/owner.ts'

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
  UNGROUPED_LABEL,
} from './selectors/slice.ts'

export type {
  PersonWhereabouts,
  TripContainerRead,
  Whereabouts,
  WhereaboutsDensity,
  WhereaboutsSlice,
} from './selectors/whereabouts.ts'
export {
  containerText,
  LOOSE_TEXT,
  MIXED_TEXT,
  rowWhereabouts,
  sliceCountLabel,
  whereabouts,
  whereaboutsByPerson,
  whereaboutsText,
} from './selectors/whereabouts.ts'

export type { ListTotals } from './selectors/entry.ts'
export {
  bringCountOf,
  entriesOf,
  entryKind,
  entryLabel,
  isContainerEntry,
  listTotals,
  pieceCountOf,
  visibleEntry,
} from './selectors/entry.ts'

export type {
  Disagreement,
  JourneyStage,
  PackingCount,
  PackingItem,
  PackingStatus,
  PersonBucket,
  PersonBucketKey,
  StageKey,
  StatusKey,
} from './selectors/packing.ts'
export {
  containerTotals,
  countOf,
  countsAsDisagreement,
  disagreements,
  entryResidenceOf,
  isKnownStage,
  isKnownStatus,
  isPacked,
  nextStatus,
  packingItems,
  packingTotals,
  personPartition,
  pieceStatusOf,
  sameTripResidence,
  STAGES,
  stageDisagreementLabel,
  stageLabel,
  stageOf,
  stageWord,
  STATUSES,
  statusGlyph,
  statusLabel,
  statusOf,
  subtreeOf,
  TRIP_LOOSE,
} from './selectors/packing.ts'

export type { PieceInclusion } from './selectors/piece.ts'
export { pieceInclusion, piecesOf } from './selectors/piece.ts'

export type { Phase, PhaseKey, TripSections } from './selectors/trip.ts'
export {
  isActive,
  isActivePhase,
  isClosed,
  isKnownPhase,
  participantIds,
  phaseDay,
  phaseLabel,
  phaseName,
  phaseNext,
  phaseOf,
  PHASES,
  tripLabel,
  tripNameOrUnnamed,
  tripSections,
  UNNAMED_TRIP,
  UNNAMED_TRIP_GLYPH,
  visibleTrips,
} from './selectors/trip.ts'

export type { Claim, OverClaim } from './selectors/claim.ts'
export {
  overClaims,
  overClaimsFor,
  overClaimsIfActive,
} from './selectors/claim.ts'

export type { Match } from './selectors/find.ts'
export { findGear } from './selectors/find.ts'

export { guessDeviceLabel } from './deviceLabel.ts'
