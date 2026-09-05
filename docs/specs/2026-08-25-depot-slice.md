# S2 — The Depot

The implementation design for [architecture §8.3](../architecture-design.md#83-the-slices)'s
**S2**: the slice that delivers stories **1** and **2**, advances **3** (the Home
path) and **7** (the Kind register), and is the first slice to need an op log at
all. It is the architecture's named first usable slice — "auth + add-gear +
find-gear, a searchable household inventory, before Trips exist" — and the point
at which the spreadsheet's inventory tab is replaced.

This is a **feature spec**: it is retired once the slice has shipped. It settles
what the durable docs deliberately left to the implementer and records the four
decisions taken before any code was written. It does **not** revisit anything
above it. The op envelope, the HLC, per-field LWW, the op catalogue, the
evolution rules, and the `/sync` wire format are settled in
[`sync-protocol.md`](../sync-protocol.md), and every ambiguity here is resolved
by reading that document, not this one.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Slice size | **Two commits** — S2a (protocol + write path) then S2b (read path). Cut so that every op type lands in one reviewable commit |
| `person.recorded` | **Promoted into S2a** from S4. `person.renamed` stays in S4 |
| First-sync total | `GET /sync/pull` gains **`household_seq`**, mirroring push. Amends [sync §6.4](../sync-protocol.md) |
| Payload handling | **Strict when authoring, tolerant when reading.** Typed builders out; validating accessors in; never a cast |
| Folded state | Registers held **inline** on each entity, `{value, hlc, deviceId}`, camelCase |
| Local log key | An autoincrement **`lsn`**, not `seq` — a locally-authored op has no seq yet |
| Snapshot | `{sha, lsn, state}`, discarded on a different build SHA ([sync §5.3](../sync-protocol.md)) |
| Seq allocation | Reserve **after** deduplication, under the counter row's lock. Reserving first burns a seq on every re-push and permanently breaks gaplessness |
| Convergence tier | `fast-check`, added as a devDependency |
| Reactive surface | `zustand`, per [architecture §3](../architecture-design.md) |

---

## 1. Why the slice is cut in two, and where

As specified, S2 carries the entire sync engine *and* the Depot domain *and*
four screens: the op log, the HLC, the reducer, per-field LWW, tombstones,
IndexedDB persistence and the snapshot, the outbox, the pull cursor,
`/sync/push`, `/sync/pull`, gapless sequence assignment, ten op types, the
containment tree with its cycle break, and the first convergence properties.
Auth slice 1 was ~5,500 lines across 59 files. This is three to four times that,
in one commit.

### 1.1 The cut that was rejected

The obvious cut is **local Depot first, sync second**: because the app is
offline-first, a local-only Depot already runs, so "op log + reducer + the four
screens" then "the outbox and `/sync`" would leave both halves shippable. It
also splits the size most evenly, roughly 60/40.

It is rejected on **durability**. What that first half ships is a Depot whose
only copy is one browser's IndexedDB — one cache clear from gone, and invisible
to the second Quartermaster that auth slice 1 already admits. Story 2's promise
is that the Depot is "the trusted source of truth we rely on", and the delivery
model in [`CLAUDE.md`](../../CLAUDE.md) says a slice ships **end-to-end, server
and app**. A depot that is not yet the *Household's* meets neither bar. The cut
also strands the obligations that most need protecting — the fixture rule, the
Tier 2s isolation extension, every `/sync` error path — in the second commit,
which is exactly where they are least likely to be scrutinised.

### 1.2 The cut taken

Split along **write path and protocol** first, **read path** second.

| | **S2a** — the op log goes live | **S2b** — find it |
| --- | --- | --- |
| Stories | 1, 2; advances 7 (Kind register) | 3 (Home path) |
| Op types | all 11 | **none** |
| Endpoints | `op` table, `op_seq`, push, pull | **none** |
| `shared/` | HLC, registers, reducer, containment tree + cycle break, home path | find and whereabouts selectors |
| `app/` | IndexedDB log + snapshot, store, outbox, cursor, dead-letter, sync line | F2 Find, the Whereabouts card, the **first-sync fold** |
| UI | Depot list · F1 Add Gear · the Home/Move picker with inline Place create·rename·remove · the gear detail's action bar | Find · the gear detail's Whereabouts card and COUNT group · the Depot filter and count line |

Every op type, the whole wire format, and the backward-compatibility fixtures
land in **one** reviewable commit. The second is purely additive client
read-side code with no protocol risk. Both halves are usable, and both are
durable.

The split is roughly 78/22, not 60/40. That is the honest trade: this cut buys a
**checkpoint**, not two equal halves. It was taken anyway, because the thing
worth protecting is the contract, not the line count.

### 1.3 The seam inside the gear-detail screen

The two halves both touch `GearDetail`, and the line between them is by story,
not by file:

- **S2a** ships its identity and action bar — the title, the meta line
  (`ITEM · SHARED · ×2`), and `MOVE` · `EDIT` · `RETIRE`. Story 2 requires an
  edit surface for rename, re-home, retire, and owned-count; without it the
  slice does not deliver its story.
- **S2b** ships its **Whereabouts card** and **COUNT group**. Those are story
  3's read, and story 3 is S2b's story.

---

## 2. `person.recorded` is promoted into S2a

Auth slice 1 left a marked seam at `app/src/auth/pendingFirstPerson.ts`: the
joiner's name and the Invite's pre-bound `person_id` are captured and persisted,
but no op is emitted, because the op layer did not exist. The slice plan puts
Person ops in S4.

The state that leaves behind is survivable — [auth-design §2.1](../auth-design.md)
already requires a Login whose `person_id` resolves to no folded Person to
render as an unnamed Quartermaster rather than as an error. So the argument for
promoting it is **not** that the seam is broken today.

**The argument is that deferring it puts a permanent falsehood in the log.**
An op's `hlc` is stamped when it is authored. If Person ops wait for S4, the
backfill emits `person.recorded` with an HLC *later* than every depot op that
Person authored, and the household's log then says the Person was created after
the gear they recorded. Story 33 (Later) derives gear history from exactly those
ops and is explicitly never a second record kept alongside them
([domain §10](../domain-model.md#10-seams)). An ordering, once written, is not
correctable by a later op — every fix is itself later still.

The cost of avoiding it is one op type, one reducer branch, one payload field,
and making `flushPendingFirstPerson` real. Nothing in S2 *reads* the name —
ownership is S4, the Account screen is auth slice 3 — so it is pure write-side,
which is precisely why it is cheap now and cannot be made cheap later.

**`person.recorded` only.** `person.renamed` stays in S4: it needs a People list
to live on, and promoting it would add a surface with nowhere to sit.

### 2.1 What emits it, and when

`flushPendingFirstPerson` runs once the op layer is available — on app start,
whenever a `PendingFirstPerson` record is present. It emits with the **Invite's
pre-bound id**, never a fresh one; that is the whole point of the seam, and it
is what makes "a Login is always a Person" true from the Household's first
second.

For a household that already joined under auth slice 1 — the maintainer's own —
the op lands the first time S2a runs. Its HLC is later than the join but earlier
than every depot op, because the depot is empty. The ordering is therefore
correct for exactly the households the promotion exists to protect.

The record is cleared only after the op is durably appended to the local log,
never after a successful push. The op log is the local source of truth; a push
is a later, retryable event.

---

## 3. The first-sync fold needs a total the protocol did not expose

[Architecture §12.2](../architecture-design.md) records this as owed by S2: the
design boards were revised after auth slice 1 so that `Open the depot` is gated
on a **determinate, resumable** fold of the household's op log
([`docs/design/README.md`](../design/README.md) §9). The board is explicit —
"determinate ops fold, **never a spinner**", `OP 4,215 OF 11,562 FOLDED`, the
CTA muted at `Open the depot — folding 36%`, and on a dropped connection
`FIRST SYNC — PAUSED` · `OP 4,215 OF 11,562 · CURSOR KEPT`.

`GET /sync/pull` returns `ops`, `cursor`, and `has_more`
([sync §6.4](../sync-protocol.md)). There is no total, so a bootstrapping client
cannot render the denominator, and the design state is not merely hard to build
— it is unrepresentable.

**`POST /sync/push` already returns `household_seq`**, the household's
high-water mark. Because `seq` is **gapless** by construction
([sync §6.6](../sync-protocol.md)), `household_seq` *is* the op count. So the
fix is to return it from pull as well, making the two endpoints symmetric:

```json
{ "ops": [ … ], "cursor": 4471, "has_more": false, "household_seq": 4471 }
```

This **amends [sync §6.4](../sync-protocol.md)**, the contract document, in the
same commit that first implements it. That is deliberate: §6.4 has never had an
implementation, so this is the moment the field is cheapest to add, and adding
it later would be an additive change to a live wire format for no better reason.

Two consequences follow and are recorded rather than discovered:

- **The denominator arrives with the first page, not before it.** The card reads
  `OP 0 OF —` for exactly one round trip. Acceptable; the alternative is a
  round trip spent on nothing but a number.
- **Gaplessness is now load-bearing for the UI, not only for the cursor.** §6 of
  this spec treats it accordingly.

### 3.1 What the fold gates, and where it is drawn

The bootstrap is a **state of the sync engine**, not a property of the join
screen. It runs whenever a signed-in device holds an empty local log and the
household's `household_seq` is greater than zero — which is the join success
screen, a freshly linked device (auth flow D), and a sign-in after a local wipe.

One `FirstSync` component renders it. The join success screen composes it into
the design's ledger card; elsewhere it renders full-screen ahead of the shell.
Resumability is free: the cursor is persisted per page (§6.4 of the protocol),
so a dropped connection continues rather than restarting. The paused state is
**not an error** — the offline dot is the only amber, and there is no `▲`.

---

## 4. `shared/` — the engine

Pure, framework-free, no I/O. It carries the bulk of the slice's tests, and it
is framework-free precisely so that the reducer *could* one day run on the
server ([architecture §7](../architecture-design.md)) without that being a
capability anyone has to add.

### 4.1 The asymmetry that shapes every module

**Strict when authoring, tolerant when reading.** Ops are constructed only
through typed builders, so the app cannot author a malformed op. Ops are read
only through validating accessors, so a malformed op from anywhere — an older
build, a newer build, a corrupted row — is folded as far as it can be and
retained whole. The two directions never share a type, and neither uses a cast.

This is Postel's rule applied to the one interface that must stay
forward-compatible forever, and it is what makes
[sync §5.3](../sync-protocol.md)'s six obligations structural rather than
remembered.

### 4.2 Modules

| Module | Contents |
| --- | --- |
| `hlc.ts` | `formatHlc` / `parseHlc` against §2.2's fixed-width grammar; `issue(state, clock)` and `receive(state, remoteHlc, clock)` implementing §2.4 / §2.5 verbatim; `DRIFT_BOUND_MS`; counter overflow; `compareStamps` |
| `registers.ts` | `Register<T> = {value, hlc, deviceId}` and one strict-greater `write`. The entire merge |
| `state.ts` | `HouseholdState = {places, gear, people, unfolded}`; entity shapes, registers inline, camelCase |
| `payloads.ts` | Validating accessors: `readString`, `readInt`, `readBool`, `readResidence`, `readOpen` (an enum-like that keeps unknown members verbatim) |
| `authoring.ts` | Typed builders, one per op type, emitting snake_case payloads |
| `reduce.ts` | `emptyState`, `applyOp`, `fold` |
| `selectors/` | `homePath`, `containmentTree`, `looseGear`, `visibleGear`; `findGear` and `whereabouts` in S2b |
| `testUtils/` | `factories.ts` (`aPlace`, `aGear`, `anOp`) and `replica.ts` |

### 4.3 The HLC

Implemented exactly as [sync §2](../sync-protocol.md) writes it, with no
latitude:

- **Issue** — `now > last.ms ? (now, 0) : (last.ms, last.counter + 1)`. A wall
  clock that jumps backwards is harmless.
- **Receive** — the five-branch `max` of §2.5, applied once per received op.
- **Drift** — `DRIFT_BOUND_MS = 5 minutes`. The op is **always applied**; the
  local clock adopts a peer's physical time only within the bound; outside it
  the condition is surfaced and the local clock is untouched. There is no path
  in this implementation where a clock disagreement costs a quartermaster their
  work, and a test asserts it.
- **Overflow** — at `0xffff`, advance the physical component by 1 ms and reset
  the counter. Deterministic, never throws.
- **Comparison** — the tuple `(hlc, device_id)`, lexicographic, most significant
  first. `device_id` is not embedded in the timestamp; it is already an envelope
  field.

The `last` value is persisted in the app's IndexedDB `meta` store alongside the
log. If it is lost, monotonicity re-establishes on the first op received, and op
ids are unique regardless.

### 4.4 Folded state

State is **camelCase**, ops are **snake_case**, and the reducer is the one place
the two meet — [architecture §12](../architecture-design.md)'s rule, honoured by
construction rather than by review.

```ts
interface GearState {
  id: string
  name?: Register<string>
  container?: Register<boolean>   // seeded at gear.recorded; no mutation op exists
  kind?: Register<KindValue>      // 'single' | 'per_person' | 'counted' | (string & {})
  residence?: Register<Residence>
  ownedCount?: Register<number>
  owner?: Register<Owner>         // the register exists; only S4 writes it
  retired?: Register<boolean>
}
```

Every field is **optional and never `undefined`** — `exactOptionalPropertyTypes`
is on, and it is on for exactly this reason
([architecture §12](../architecture-design.md)). An absent register was never
addressed by any op; that is a different fact from a register holding `null`,
and the type system is what keeps the two from collapsing.

`unfolded: {count, types}` counts ops this build could not fold, so
[sync §5.3](../sync-protocol.md)'s obligation 1 is **observable** rather than
silently honoured. It is what the Account screen will eventually read, and what
a test asserts today.

`applyOp` is **pure**, with structural sharing: it copies the touched entity and
its map and nothing else. Purity is not tidiness here — it is the property the
convergence tier asserts, and a mutable fast path would make that tier prove
something weaker than it claims.

### 4.5 Tolerant reading, concretely

The six obligations, and what each one is in this code:

| Obligation | Implementation |
| --- | --- |
| 1. Unknown `type` | No reducer branch matches → `unfolded` is incremented, state is otherwise unchanged, the op stays in the local log verbatim, the cursor advances past it |
| 2. Unknown payload field | Accessors read the fields they know; the rest are never touched |
| 3. Unknown envelope field | `OpEnvelope` is the wire shape; the record stored in IndexedDB is the parsed JSON, unmodified |
| 4. Unknown enum value | `readOpen` returns the raw string. `KindValue` is `…｜(string & {})`, so the type permits it and no cast is needed. Safe only because [sync §3.3](../sync-protocol.md) removed the rank function from the merge |
| 5. Absent ≠ null | Accessors distinguish "key absent" from "key present and null". Absent leaves the register alone; `null` is a write. No field in S2's catalogue is nullable, so this is proved by fixture rather than by feature — deliberately, because S6's `trip.dates_set` will depend on it |
| 6. Never mutate a stored op | The log is append-only; the outbox re-pushes the byte-identical record it holds. Corrections are new ops |

### 4.6 Selectors

- **`homePath(state, gearId)`** — walks residence pointers up to a Place,
  returning the segments the design renders as `ATTIC ▸ SHELF L-TOP ▸ CRATE B`.
- **`looseGear` / holder tombstones** — gear whose holder is retired or removed
  reads **loose**, computed by the selector. The reducer never walks the tree
  and nothing is cascaded ([sync §3.5](../sync-protocol.md), invariant 4).
  Residence pointers keep pointing at the tombstoned holder, so a restore
  restores the arrangement.
- **`containmentTree(state)`** — the emergent tree, plus the set of edges broken
  by cycle detection.

**The cycle break.** Two devices can move crate X into Y and Y into X
concurrently; the ops target *different aggregates*, so per-field LWW cannot
prevent the cycle and invariant 3 forbids the result
([sync §3.6](../sync-protocol.md)). The selector detects each cycle and breaks
it deterministically: **within a cycle, the edge whose residence register
carries the lowest `(hlc, deviceId)` is reported as loose**, and surfaced. Every
replica holds identical registers, so every replica breaks the same edge — the
fold is untouched, convergence is untouched, and every device displays the same
thing. Disjoint cycles are broken independently. The result is memoised per
fold.

---

## 5. `app/` — log, store, sync

### 5.1 The local op log

IndexedDB database `foerier`, bumped to **version 2**. The existing `auth`
object store is untouched; the upgrade adds:

| Store | Key | Notes |
| --- | --- | --- |
| `op` | autoincrement **`lsn`** | Unique index on `op.id` (dedupe); index on `seq` |
| `meta` | string | `cursor`, `hlc`, `snapshot`, `deviceId` |
| `deadLetter` | `opId` | The rejected-op list of [sync §6.5](../sync-protocol.md) |

**Why `lsn` and not `seq`.** A locally-authored op has no `seq` until the server
assigns one, so `seq` cannot key the local log and cannot mark how far a
snapshot has folded. `lsn` is a purely local append counter and serves both.
It is never sent, never compared across devices, and carries no meaning beyond
"this record was written to this device's log before that one".

A record is `{lsn, op, seq: number | null, deadLettered: boolean}`. **The outbox
is a query, not a second structure**: every record with `seq === null` and
`deadLettered === false`, in `lsn` order. A record that has never been pushed
and a record whose push response was lost are indistinguishable, which is
exactly right — re-pushing is idempotent by `op_id`
([sync §8.1](../sync-protocol.md)).

**Ingest updates by `op.id`, it does not insert blindly.** Pull returns the
device's own ops too ([sync §6.4](../sync-protocol.md)), so an op already in the
local log arrives again carrying its server `seq`; ingest writes that `seq` onto
the existing record rather than creating a second one. This is what makes the
lost-push-response case self-heal without any special handling: the op leaves
the outbox the moment it comes back through pull, whether or not its own push
response ever arrived.

**The snapshot** is `{sha, lsn, state}` and is **keyed by the build SHA**. A
different SHA discards it and re-folds from the full local log — cheap
([sync §7.2](../sync-protocol.md)'s arithmetic puts a 38,000-op fold well under
a second) and it is what makes obligation 1 safe rather than merely
well-intentioned: a snapshot taken by a build that could not fold some op is
*wrong* for a build that can. Written debounced, never on the critical path.

### 5.2 The store

Zustand, holding the folded state and the sync surface. There is exactly one
authoring path:

```
emit(spec) → stamp id · household_id · device_id · hlc
           → append to the local log
           → fold into memory
           → nudge the outbox
```

**Append before fold**, per [sync §8.5](../sync-protocol.md): a crash between
them loses a render, not a fact. The UI never awaits any of it — `emit` returns
`void` and the ordering is kept by an internal queue, so appends serialise and
the HLC counter cannot race itself.

### 5.3 The sync client

Behind a `Transport` interface with a real in-memory fake, so every path below
is exercised at Tier 2 with no network.

**Push.** Chunk the outbox to ≤ 500 ops and ≤ 1 MB, in `lsn` order. Apply per-op
results: `accepted` and `duplicate` both write the returned `seq`; `rejected`
moves the record to the dead-letter **and leaves it folded** — it is local truth
that failed to publish, and dropping it would make the device's own state jump
backwards under the user's hands ([sync §6.5](../sync-protocol.md)). If
`household_seq` exceeds the cursor, pull.

**Pull.** Loop pages from `since = cursor`. For each page: ingest, fold, and
durably write — **then** advance the cursor. The reverse loses ops permanently,
because the cursor is the only record of what has been seen.

**Triggers.** `online`, `visibilitychange`, a 30-second interval, and after
every `emit`. Never on a render path.

**Errors**, per [sync §6.3](../sync-protocol.md):

| Class | Behaviour |
| --- | --- |
| 400 `bad_request` | Dead-letter the batch, log, do not retry |
| 401 `unauthorized` | **Freeze sync, keep the outbox intact**, surface `SIGNED OUT · SAVED ON DEVICE`. A 401 never costs queued work |
| 413 | Halve the batch and retry |
| 429 | Honour `Retry-After`, then back off |
| 5xx / network | Exponential backoff with full jitter, base 1 s, cap 5 min, indefinitely |

There is no `409`. Conflicts are resolved by the fold on every device, never at
the transport layer.

### 5.4 Screens

**S2a.**

- **Depot list** — title, count line (`128 GEAR · 214 PIECES`), rows carrying
  name plus mono meta (owner · home path · qty) and a `⌂ HOME` whereabouts chip,
  `›` on containers, the 56 px FAB. The Depot never shows packing status.
- **F1 Add Gear** — name · container toggle · Kind picker
  (`SINGLE｜PER-PERSON｜COUNTED`) · Owned-count, shown only for Counted
  (invariant 6) · Home.
- **The Home / Move picker** — one sheet, used by Add Gear and by `MOVE`. Lists
  Places, containers within them, and loose; creates a Place inline; renames and
  **removes** one. Removing a Place or a Container that still holds gear
  confronts the quartermaster with that gear becoming loose — story 1's last
  acceptance criterion, and the only place in S2a where `place.removed` and
  invariant 4 are visible.
- **Gear detail, part one** — title, meta line, and the action bar: bordered
  `MOVE` and `EDIT`, with `RETIRE` right-aligned as attention-coloured **text,
  never a filled red button**.

**S2b.** F2 Find; the gear detail's Whereabouts card and COUNT group; the
Depot's filter and count line; the `FirstSync` screen.

**`gear.restored` is protocol-present and UI-deferred**, exactly as
[architecture §8.3](../architecture-design.md) says. Story 2's soft-delete is
MVP; managing Retired Gear as a view is story 19, tagged Later. The op ships so
that a restore is expressible and its merge behaviour is pinned by tests from
day one. No Retired screen is built.

---

## 6. `api/` — the thin op store

The server gains no op vocabulary. It validates envelopes and stores opaque
rows, so a new client's new op type is stored by an older server without a
deploy-order dependency ([sync §6.2](../sync-protocol.md)).

### 6.1 Migration `0003_op`

```
op        op_id (uuid, PK) · household_id · seq (bigint) · aggregate (text)
          aggregate_id (uuid) · type (text) · hlc (text) · device_id (uuid)
          payload (jsonb) · received_at (timestamptz)
household + op_seq (bigint, not null, default 0)
```

Unique `(household_id, seq)`; the pull index is `(household_id, seq)`. `type` is
`text` and **never an enum** — an enum would make the server's vocabulary a
deploy-order dependency, which is the thing §6.2 exists to avoid. The `op_id`
primary key is what makes re-push idempotent.

Registered in `db/migrations.ts`'s explicit map, and `db/schema.ts` — which is
hand-maintained — gains `OpTable` and `op_seq`.

### 6.2 Sequence assignment, and the trap in it

[Sync §6.6](../sync-protocol.md) specifies a per-household counter row rather
than a Postgres `SEQUENCE`, and says why: sequences are non-transactional, so a
client can pull past a seq that has not committed yet and never receive it.

There is a second trap one level down, and it is not in the protocol document
because it is an implementation shape rather than a contract:

> **Reserve seqs *after* deduplication, under the counter row's lock.**

The natural implementation reserves `n` seqs for `n` submitted ops and lets
`INSERT … ON CONFLICT (op_id) DO NOTHING` swallow the re-pushes. Every duplicate
then burns a seq that no row ever occupies — a **gap**. Gaps are survivable for
a cursor, which only ever asks for "greater than", which is why the protocol
does not dwell on them. They are *not* survivable for §3's first-sync total,
which reads `household_seq` as the op count and would over-report forever, on
the one screen whose whole promise is a determinate number.

So the push transaction is:

```
SELECT op_seq FROM household WHERE id = $1 FOR UPDATE   -- serialise this household
SELECT op_id, seq FROM op WHERE op_id = ANY($2)          -- who is already here
UPDATE household SET op_seq = op_seq + <count of new>    -- reserve exactly what inserts
INSERT INTO op … (consecutive seqs, request order)
```

Taking the row lock **first** is what makes the dedupe check authoritative: two
concurrent re-pushes of the same op cannot both observe it as absent, because
pushes for one household serialise entirely. The cost is serialising writers per
household only, which at this scale is nothing.

A `duplicate` result carries **the seq the op already had**, never a new one,
and `received_at` is never updated — which is what makes an outbox that retries
on an ambiguous timeout safe by construction.

### 6.3 Endpoints

`POST /api/v1/sync/push` and `GET /api/v1/sync/pull`, both behind the existing
auth middleware. `household_id` comes from the Device token and **never** from
the body, the query string, or a header. An op whose `household_id` differs from
the token's is rejected `household_mismatch` — **rejected outright, never
rewritten**, because silence would hide a client bug that is indistinguishable
from an attack ([auth §9.3](../auth-design.md)).

Per-op rejection uses the closed set of [sync §6.3](../sync-protocol.md):
`envelope_invalid`, `op_id_invalid`, `hlc_invalid`, `household_mismatch`,
`op_too_large`. Nothing else, and no code is invented.

**Both batch caps answer `413 payload_too_large`** — over 500 ops and over 1 MB
alike. [Sync §6.3](../sync-protocol.md) leaves the choice between `400` and
`413` open for the op-count cap; `413` is taken because its documented client
response is "halve the batch and retry", which is self-healing, while `400`'s is
to dead-letter the batch. A client that miscounts its own chunking should not
lose a quartermaster's work over it.

`/sync/*` gets its own rate-limit bucket, much higher than `/auth/*` — a
returning offline client legitimately bursts.

---

## 7. Tests

TDD, at the lowest tier that can catch each failure. Boundaries — clock, crypto,
storage, transport — are **real in-memory fakes, not mocking-framework mocks**.

### 7.1 Tier 1 — unit

The crown jewels, nearly all of it in `shared/`.

- **HLC** — monotonicity under a backwards wall clock; merge on receive;
  tiebreak ordering; behaviour under a skewed peer *inside* and *outside* the
  drift bound, with the op applied in both cases; counter overflow.
- **Registers** — strict-greater wins; equal `hlc` tiebreaks on `deviceId`; a
  late-arriving older op is a no-op.
- **Tombstones** — retire at HLC 100 racing rename at HLC 200 leaves the gear
  **retired and renamed**; only `gear.restored`, strictly later, clears it.
- **Tolerant reading** — one test per obligation in §4.5.
- **Purity and replay** — `applyOp` does not mutate its input; the complete log
  folded onto empty state reproduces the current state exactly
  ([sync §8.4](../sync-protocol.md)), which is what makes the snapshot safely
  discardable.
- **Selectors** — `homePath` through nested containers; gear at a **removed
  Place** reads loose with no cascade; the **cycle break** picks the lowest
  `(hlc, deviceId)` edge; disjoint cycles break independently.

### 7.2 Tier 2 — convergence, the signature tier

Two or more in-memory replicas sharing the real reducer, diverging offline and
exchanging ops through the fake transport.

**Property-based, with `fast-check`.** Generate a random op set and random
interleavings; the invariant is that every replica folds to identical state
regardless of arrival order — the direct consequence of `apply` being
commutative, associative, and idempotent. `fast-check` is added as a
devDependency for its **shrinking**: an unshrunk failing interleaving of forty
ops is not debuggable, and a hand-rolled seeded shuffle gives no shrinking.

Pinned scenarios beside the property:

- a delete racing an edit resolves to deleted-and-edited;
- two concurrent `gear.rehomed` ops resolve by plain LWW;
- `place.removed` racing a `gear.rehomed` **into** that place — the gear reads
  loose on both replicas;
- two devices forming a containment cycle — both replicas break the **same**
  edge.

And the outbox: retry with backoff, idempotent re-push of the same UUIDv7,
per-op outcomes, the dead-letter path, and cursor advancement only after a
durable fold.

**Backward compatibility.** `shared/fixtures/s2-depot.ops.json` — one op of each
of the eleven types with realistic payloads, plus the four tolerant-reader cases
(unknown type, unknown payload field, unknown `kind` value, an explicit `null`)
— replayed through the current reducer and asserted against a folded-state
snapshot. **Captured in S2a's own commit**, per
[testing.md](../testing.md): a fixture written later is captured from a format
that has already drifted and proves nothing.

### 7.3 Tier 2s — server integration

A new class, `api/test/server/sync.test.ts`, claiming **UUID registry slot #4**
in [testing.md](../testing.md). It scopes every query to its own household and
clears no table it does not own.

Coverage: seq assignment in request order; **gaplessness across a re-push**;
`duplicate` returning the original seq with `received_at` unchanged; each
rejection code; `seq`/`received_at` sent on push rejected as `envelope_invalid`;
the 500-op and 1 MB caps; pull's exclusive `since`, `cursor`, `has_more`, and
`household_seq`; an unknown op type stored and returned opaquely.

**`householdIsolation.test.ts` is extended** with the half auth slice 1 could
only assert at the middleware, because `/sync` did not exist
([architecture §8.7](../architecture-design.md)):

- Household A's token pushing an op carrying Household B's `household_id` is
  rejected, and **nothing is stored**;
- A's pull never returns B's ops at any cursor;
- B's pushes never advance A's `op_seq`.

### 7.4 Tiers 3 and 5

Tier 3: F1 Add Gear and the Depot list in S2a; F2 Find and the gear detail in
S2b, against a fake store seeded from the factories.

Tier 5: the golden path extends to sign in → add gear → see it in the Depot,
with the offline leg — go offline, add gear, come back online, assert the outbox
flushes.

---

## 8. Dependencies and doc amendments

**New dependencies.** `zustand` (~2 KB, the reactive surface of
[architecture §3](../architecture-design.md)) and `fast-check` (devDependency,
§7.2).

**Amended by S2a:**

| Document | Change |
| --- | --- |
| [`architecture-design.md`](../architecture-design.md) §8.3 | S2 recorded as two commits; `person.recorded` promoted; the per-slice op tally re-summed |
| [`architecture-design.md`](../architecture-design.md) §12.3 | New — the consequences of this slice, as §12.1 and §12.2 did for theirs |
| [`sync-protocol.md`](../sync-protocol.md) §4.2 | `person.recorded` attributed to S2, `person.renamed` to S4 |
| [`sync-protocol.md`](../sync-protocol.md) §6.4 | `household_seq` on the pull response, with §3's reasoning |
| [`testing.md`](../testing.md) | UUID registry slot #4 |
| [`CLAUDE.md`](../../CLAUDE.md) | Current status |

**Amended by S2b:** `CLAUDE.md`'s status, and architecture §12.2's "S2 owes the
gated variant" marked closed.

---

## 9. What this slice deliberately does not build

Named so they are not built ahead of need.

- **A Retired Gear view** — story 19, Later. `gear.restored` ships without a
  screen (§5.4).
- **Tags, ownership, People management** — S3 and S4. The `owner` register
  exists in the state shape because `gear.recorded` may carry it, and nothing
  writes it here.
- **Trip-side Whereabouts** — the quantity split and trip residence are stories
  9 and 10. `whereabouts` returns the home answer and is shaped so the trip case
  slots in without a rewrite.
- **The `unaccounted for` standing** — story 3's third clause, which needs
  unpack outcomes (S12).
- **Server-side invariant validation** — still deferred
  ([architecture §10](../architecture-design.md)). Acyclicity, Kind exclusivity,
  and supply are client-side and deterministic.
- **A server snapshot or log compaction** — deferred with a recorded revisit
  trigger ([sync §7.3](../sync-protocol.md)). The naive bootstrap is what §3
  builds against.
- **SSE liveness** — an untouched seam.
