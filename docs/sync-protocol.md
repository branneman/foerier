# foerier — Sync Protocol

The concrete contract for foerier's operation log: what an op is on the wire,
how ops are ordered and merged, every op type the MVP defines, and how the two
`/sync` endpoints behave.

This sits **one level below** the
[architecture & delivery design](architecture-design.md) and fills in what its
§2 (the op log and LWW) and §4 (the sync protocol) named but left open. It does
not revisit the decisions above it: the op log, per-field LWW, HLC ordering,
`household_id` tenancy, and the thin server are all settled there.

It is also **the one interface that must stay forward-compatible forever.**
Installed PWAs run older code and may hold ops queued offline against a previous
version ([architecture §7](architecture-design.md)), so §5's evolution rules are
the load-bearing part of this document, not boilerplate.

**It stays out of the conceptual docs' territory.** The
[domain model](domain-model.md) and [ubiquitous language](ubiquitous-language.md)
remain persistence-ignorant; nothing here belongs in them. Every op in §4 traces
back to a domain operation in [domain-model §9](domain-model.md#9-operations-and-domain-events)
and to the story that introduced it — the trace runs *from* the conceptual docs
*to* here, never the other way.

**One amendment upward.** Architecture §2 listed *packing status =
furthest-stage wins* as a smart-rule override. §3 drops it in favour of plain
per-field LWW, with the reasoning recorded there; architecture §2 has been
edited to match rather than left to disagree.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op identity | Client-generated **UUIDv7**, globally unique, the dedupe key everywhere |
| Ordering | **Hybrid Logical Clock** as a fixed-width sortable string; tiebreak on `device_id` |
| Clock drift | Op always applied; local clock adopts a peer's time only within **5 minutes** |
| Merge | **Per-field LWW** by `(hlc, device_id)`, one rule, no stage overrides |
| Deletion | Tombstones are ordinary LWW fields; only an explicit restore clears one |
| Op catalogue | **38 op types**: 3 Place · 2 Person · 10 Gear · 23 Trip |
| Naming | `<aggregate>.<past_tense_verb>`, snake_case, two segments |
| Evolution | Additive only. New optional fields, new op types. Never a version field |
| Push | Atomic commit, **per-op outcomes** (`accepted` / `duplicate` / `rejected`) |
| Sequence | Per-household counter row, allocated in the push transaction. **Not** a Postgres `SEQUENCE` |
| Batch caps | ≤ 500 ops per push · ≤ 1000 per pull page · ≤ 1 MB body · ≤ 16 KB per op |
| Rejected ops | Local **dead-letter** list: visible, exportable, never retried, never silently dropped |
| Bootstrap | Naive paged pull from sequence 0. No server snapshot, no compaction |
| Compaction | **Deferred**, with a recorded revisit trigger (§7) |

---

## 1. The op envelope

An op is a JSON object, UTF-8, with a flat envelope and a `type`-specific
payload. UUIDs are lowercase canonical hyphenated form.

```json
{
  "id":           "0198f2a1-c4ea-7c31-9b02-6f1a4d3e88b0",
  "household_id": "3f2b0c1a-9d44-4f5e-8b7a-1c2d3e4f5061",
  "aggregate":    "trip",
  "aggregate_id": "0198e0b7-2a11-7f4c-93de-5a6b7c8d9e0f",
  "type":         "trip.entry_status_set",
  "hlc":          "2026-08-24T10:03:11.442Z-0007",
  "device_id":    "0198c33d-77aa-7e10-a4bb-0c9d8e7f6a5b",
  "payload":      { "entry_id": "0198e0b8-1c02-7a55-b1d4-2e3f4a5b6c7d", "status": "packed" }
}
```

### 1.1 Fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | UUIDv7 | yes | The op's identity, generated on the authoring device. The idempotency key at every layer. Time-ordered, so it sorts sensibly in a log dump. |
| `household_id` | UUID | yes | Tenant scope. Must equal the household the bearer token resolves to; a mismatch is **rejected**, never rewritten ([auth §9.3](auth-design.md)). |
| `aggregate` | enum | yes | `gear` · `place` · `person` · `trip`. Lets the server route and the client shard the fold without parsing `type`. |
| `aggregate_id` | UUID | yes | The aggregate **root**'s id. For Trip ops this is always the trip; entities inside it are addressed by ids in the payload. |
| `type` | string | yes | `<aggregate>.<verb>` (§5.1). Opaque to the server. |
| `hlc` | string | yes | The Hybrid Logical Clock at authoring time (§2). |
| `device_id` | UUID | yes | The authoring Device ([auth-design](auth-design.md) `device.id`). Provenance, and the LWW tiebreak. |
| `payload` | object | yes | `type`-specific. May be `{}` — present but empty — never absent, never `null`. |

The server adds two fields on storage, visible on pull and never accepted on
push:

| Field | Type | Meaning |
| --- | --- | --- |
| `seq` | integer | Server-assigned, monotonic **per household**, gapless (§6.6). The pull cursor's unit. |
| `received_at` | RFC 3339 UTC | When the server stored it. **Diagnostic only** — never used for ordering, never used for merge. |

### 1.2 What a reader must ignore

The tolerant-reader obligations are spelled out concretely in §5.3. The envelope
rule in short: **an unknown envelope field, an unknown payload field, and an
unknown `type` are all ignored for the fold and retained verbatim in the log.**
Ignored never means discarded.

### 1.3 Absent is not null

A payload field that is **absent** was not addressed by this op — the register
keeps whatever it had. A field explicitly set to **`null`** was *cleared* by this
op, and that is a write like any other. `trip.dates_set` relies on the
distinction: `{"start": null, "end": null}` clears both dates, `{"start": "2026-07-04"}`
sets the start and leaves the end alone.

### 1.4 Size

An op is at most **16 KB** serialised. The only field that can grow is a trip
note's text, and 16 KB is far past any jotting while still bounding a runaway
client. A batch is at most **1 MB** and **500 ops** (§6.1).

---

## 2. The Hybrid Logical Clock

### 2.1 Why a clock at all, and why this one

Every op needs a sortable timestamp regardless of skew, for two reasons that
have nothing to do with wrong clocks: a "start from" trip creation emits ~100
ops in the same millisecond and they must fold in a stable order, and ops arrive
out of authoring order so re-folding must be deterministic. So a
`timestamp + counter` field exists either way.

**An HLC is that field plus a ten-line update rule** — `max(lastIssued, now,
remoteSeen)` instead of `now`. What the ten lines buy is that a device with a
wrong clock does not win, or lose, every conflict forever, silently and
unrecoverably. Not exotic: a machine with a dead CMOS battery, a phone restored
from backup, a timezone bug in our own code.

The considered alternative was **using the server's sequence as the order** — no
clocks anywhere, one authoritative ordering, skew impossible. It fails on the
core offline case: an edit made offline on Monday reaches the server *after* a
peer's Tuesday edit and would win. It also means a client cannot resolve a
conflict until the server answers, which breaks
"[reads are pure in-memory](architecture-design.md)". **Server sequence is right
for the cursor and wrong for the merge.**

### 2.2 Encoding

A fixed-width, lexicographically sortable string:

```
2026-08-24T10:03:11.442Z-0007
└──── ISO-8601 UTC, ms ────┘ └┬─┘
                        16-bit counter, 4 lowercase hex
```

```
^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z-[0-9a-f]{4}$
```

Always UTC, always `Z`, always exactly three fractional digits, always four hex
digits. Fixed width is what makes plain string comparison correct — in
JavaScript, in Postgres, and in a `sort` over a log dump. It is 29 bytes against
a ~400-byte op, and it is readable in an incident.

The classic HLC embeds the node id inside the timestamp. Ours does not:
`device_id` is already a required envelope field, so the comparator is the tuple
**`(hlc, device_id)`**, compared lexicographically, most significant first. Same
total order, no duplication, and the HLC stays a pure clock.

### 2.3 State

Each device persists one value alongside its op log: `last`, the last HLC it
issued, as `{ms, counter}`. It survives restarts. If it is lost (a local wipe,
a restore from backup) monotonicity re-establishes on the first op received, by
the merge rule below; op ids stay unique regardless, so nothing is corrupted.

### 2.4 Issuing an op

```
now = wallClock()                      // ms since epoch, UTC

if now > last.ms:   l = now,      c = 0
else:               l = last.ms,  c = last.counter + 1

last = {ms: l, counter: c}
```

A wall clock that jumps backwards is therefore harmless: the device keeps its
own HLC and increments the counter.

### 2.5 Merging on receive

Applied once per received op, before or while folding it:

```
now    = wallClock()
remote = parse(op.hlc)

if remote.ms - now > DRIFT_BOUND:      // §2.6 — apply, but do not adopt
    l = max(last.ms, now)
    c = (l == last.ms) ? last.counter + 1 : 0
else:
    l = max(last.ms, remote.ms, now)
    if   l == last.ms and l == remote.ms:  c = max(last.counter, remote.counter) + 1
    elif l == last.ms:                     c = last.counter + 1
    elif l == remote.ms:                   c = remote.counter + 1
    else:                                  c = 0

last = {ms: l, counter: c}
```

### 2.6 Drift, and what happens outside the bound

`DRIFT_BOUND = 5 minutes.` Generous enough for a phone that has not NTP-synced
recently, tight enough to catch a wrong year, a wrong century, or an offset
applied as if it were UTC.

The standard move (CockroachDB and kin) is to *panic* outside the bound. **We
never can**: rejecting an op discards work a quartermaster did, which the whole
offline-first design forbids. So:

- The op is **always applied**. Always. There is no path in this protocol where
  a clock disagreement costs a user their work.
- The local clock **adopts** the peer's physical time only within the bound.
  Outside it, the op folds normally but the device's own clock is untouched —
  otherwise one phone with a mistyped year poisons the household's clock
  permanently, and every op every device authors afterwards inherits the
  inflated time.
- The condition is **surfaced** ("this device's clock looks wrong") and logged.
  The server, comparing `hlc` against its own `received_at`, logs far-off ops as
  a diagnostic. It never gates on them and never rewrites an op.

### 2.7 Edge cases the spec must name

- **Counter overflow.** At `0xffff` — 65,536 ops in one millisecond, unreachable
  here but a spec has to say — advance the physical component by 1 ms and reset
  the counter to 0. Deterministic; never throws.
- **Ties.** Two ops from the *same* device can never tie: the counter is
  strictly monotonic within a millisecond. Two ops from *different* devices tie
  only on an identical `hlc`, and are then ordered by `device_id`.
- **The server never modifies an op.** Not the HLC, not anything. A re-pushed op
  must be byte-identical to the stored one (§8.1).

---

## 3. Conflict resolution

### 3.1 The register

The unit of last-writer-wins is not the aggregate and not the record. It is a
**register**, identified by:

```
(aggregate_id, entity_path, field)
```

The aggregate is the **sync** unit; the register is the **merge** unit. Editing
a piece of gear's home and its tags concurrently is not a conflict. Nor is
editing two different entries on one trip — which is what makes the deliberately
coarse Trip aggregate ([domain §5](domain-model.md#5-aggregates)) cheap to sync
without making it a merge bottleneck.

### 3.2 The rule

Every register holds a value and the `(hlc, device_id)` of the op that last
wrote it. Applying an op to a register:

```
apply(register, op):
    if (op.hlc, op.device_id) > register.clock:
        register.value = op.value
        register.clock = (op.hlc, op.device_id)
    // otherwise: a no-op
```

That is the whole of it. There is no second rule for any field.

Because the comparison is a total order and the update is a strict-greater
guard, `apply` is **commutative, associative, and idempotent** — which is
precisely the property [testing.md](testing.md)'s convergence tier asserts:
divergent logs exchanged in any order fold to identical state. A late-arriving
older op is correctly ignored at O(1); no re-fold is needed.

### 3.3 Why there is no furthest-stage rule

[Architecture §2](architecture-design.md) named *packing status = furthest-stage
wins* (`packed` beats `staged` beats `not packed`) as an override, on the
reasoning that marking something packed is a real-world observation rather than
a keystroke. It has been dropped, and architecture §2 amended.

**It is in direct conflict with story 9 and story 32**, which say a phase never
locks anything and the record can always be corrected. If `packed` always wins,
a mistaken `packed` can never be un-marked: the correction is a *later* op with
a *lower* stage, and the rule discards it.

The fixes do not converge. Carrying "the value I saw" in the op, or "the clock I
saw", both diverge when two ops reach two replicas in different orders. A
lattice join and a rewritable register cannot share one field and stay
convergent. What does work is an epoch-qualified pair — `(epoch, stage)`, where
a backward move increments the epoch — but that is a permanent extra payload
field and a second merge rule, bought for a household of two who pack in the
same room on the same wifi.

The plain rule is also arguably **more correct here**: furthest-stage-wins is
only better in the offline-divergence case, and it pays for that with the
inability to correct. When both devices are online — the normal case — the later
keystroke genuinely *is* the more recent observation.

What it costs: if a stale device sets `staged` five minutes after you set
`packed`, the entry reads `staged` and you re-tap it. Visible, on a screen whose
whole job is showing packing status, and self-correcting — not silent.

**It stays reversible.** An `epoch` field can be added to those payloads later
without breaking anything, because unknown payload fields are ignored (§5.3). The
door is not closed; it is just not built.

A quiet bonus: with no lattice on the status fields, **widening a status enum
later** (story 20's per-trip editable statuses) needs no rank function and no
migration. An unrecognised status value is simply a value (§5.3, obligation 4).

### 3.4 Set-valued fields

Tags and participants are **not** single registers holding an array — that would
make two quartermasters tagging concurrently clobber each other. Each member is
its own register:

| Set | Register key | Value |
| --- | --- | --- |
| Gear tags | `(gear_id, "tags", <tag string>)` | present / absent |
| Trip participants | `(trip_id, "participants", <person_id>)` | present / absent |

Concurrent `gear.tag_applied{food}` and `gear.tag_applied{kitchen}` therefore
union. Concurrent apply and remove of the *same* tag is one register and resolves
by plain LWW.

### 3.5 Tombstones — what "delete wins" actually means

Architecture §2's *delete / retire wins* is not an override and does not need to
be one. **A tombstone is an ordinary LWW field**, and an edit never touches it:

- Device A retires a piece of gear at HLC 100. Device B renames it at HLC 200.
  The rename writes `name`; the retirement writes `retired`. Both apply. The gear
  is retired **and** renamed, and the retirement survives the later op — without
  a special rule.
- Only an **explicit restore op** clears a tombstone, and only if it is strictly
  later. `gear.retired` / `gear.restored` and `trip.piece_removed` /
  `trip.piece_restored` are ordinary LWW pairs on one register.

Hard removals that have no restore in the MVP (`place.removed`,
`trip.entry_removed`, `trip.deleted`) are the same mechanism with only one op
defined. Adding the restore later is additive.

**A tombstone never cascades.** Domain invariant 4 is explicit: removing a place
or container re-homes its contents to loose and surfaces them. The reducer does
not walk the tree; residence pointers keep pointing at the tombstoned holder, and
the containment **selector** reports anything whose holder is tombstoned as
loose. Nothing is deleted by cascade, and nothing is silently lost.

### 3.6 Two conditions the reducer must not resolve

Both are states the fold can legitimately produce and the domain forbids. Neither
is fixed by discarding a write — the domain is emphatic about that
([§5.2](domain-model.md), stories 6 and 32). Both are computed by **selectors**
and surfaced.

**Over-claim.** Two active trips claiming past the depot's supply. Purely
derived from the fold: unresolved entries on active trips versus owned-count.
There is **no op** for surfacing or resolving it — a quartermaster resolves it by
removing the entry from one trip, which is `trip.entry_removed`.

**Containment cycles.** Device A moves crate X into Y; device B moves Y into X.
The two ops target *different aggregates*, so per-field LWW cannot prevent it and
the fold produces a cycle that invariant 3 forbids. The containment selector
detects cycles and breaks each one deterministically: **within a cycle, the edge
whose residence register carries the lowest `(hlc, device_id)` is reported as
loose**, and surfaced. Deterministic because every replica holds identical
registers, so every replica breaks the same edge — the fold stays untouched and
convergent, and the display agrees everywhere.

### 3.7 The Trip's register map

Where the field-granularity boundary sits inside the coarse Trip aggregate, in
full:

| Entity path | Registers |
| --- | --- |
| *(root)* | `name`, `phase`, `start_date`, `end_date`, `from_trip_id`, `deleted` |
| `participants.<person_id>` | present / absent |
| `entries.<entry_id>` | `source`, `bring_count`, `status`, `residence`, `stage`, `outcome`, `consumed_count`, `removed` |
| `entries.<entry_id>.pieces.<person_id>` | `status`, `residence`, `outcome`, `removed` |
| `tasks.<task_id>` | `text`, `ticked` |
| `notes.<note_id>` | `text`, `entry_id`, `kept` |

`stage` is the container journey and exists only on entries whose gear carries
the containment trait; `status` is the packing status and exists on everything
else. They are the same track — *how far along* — for the two shapes of thing,
and never both on one entry ([domain §7](domain-model.md#7-two-tracks-where-vs-how-far)).

`residence` (*where*) and `status`/`stage` (*how far along*) are separate
registers by construction, so the merge cannot silently make them agree — which
is domain invariant 12, honoured for free.

---

## 4. The op catalogue

Every op type the MVP defines: **38** across four aggregates. Each traces to a
domain operation in [§9](domain-model.md#9-operations-and-domain-events) and to
the story that introduced it. This is the table the slice plan and the
implementation both work from — a vertical slice is one or more rows here plus
its reducer, selector, endpoint use, and UI.

Two shared payload shapes:

```
Residence      = {"in": "place",     "id": <uuid>}
               | {"in": "gear",      "id": <uuid>}
               | {"in": "loose"}

TripResidence  = {"in": "container", "entry_id": <uuid>}
               | {"in": "loose"}
```

`aggregate_id` is the aggregate root in every row and is not repeated in
payloads.

### 4.1 Place — 3 ops

| Type | Payload | Effect on folded state | Domain §9 | Story |
| --- | --- | --- | --- | --- |
| `place.recorded` | `{name: string｜null}` | Creates the Place; seeds `name`. `null` clears; absent ≠ null (§1.3) | Place recorded | 1 |
| `place.renamed` | `{name: string｜null}` | Sets `name`. `null` clears; absent ≠ null (§1.3) | Place renamed | 1 |
| `place.removed` | `{}` | Sets the tombstone. Gear residing there reads **loose** via the selector, never cascaded (§3.5, invariant 4) | Place removed | 1 |

### 4.2 Person — 2 ops

| Type | Payload | Effect on folded state | Domain §9 | Story |
| --- | --- | --- | --- | --- |
| `person.recorded` | `{name: string｜null}` | Creates the Person; seeds `name`. `null` clears; absent ≠ null (§1.3) | Person recorded | 4 |
| `person.renamed` | `{name: string｜null}` | Sets `name`. `null` clears; absent ≠ null (§1.3) | Person renamed | 4 |

A Person is never removed: gear ownership and past trips reference them, and the
model gives no removal operation. `login`/`device` disabling is
[auth-design](auth-design.md)'s concern and is not an op.

**The two rows shipped in different slices: `person.recorded` in S2,
`person.renamed` in S4.** Both trace to story 4, and the `Story` column above
says so — but the story that *introduces* an op is not always the slice that
*builds* it. S1's join screen already asks the joiner their name and pre-binds
their Person id ([auth-design §3.4](auth-design.md)), so until something
authors `person.recorded` the Household's own Login points at a Person nobody
ever created. It therefore lands with the first slice that has an op log to
append to, which is S2; `person.renamed` and the People UI landed with S4
([architecture §8.3](architecture-design.md),
[its spec](specs/2026-08-29-people-and-ownership.md)).

### 4.3 Gear — 10 ops

| Type | Payload | Effect on folded state | Domain §9 | Story |
| --- | --- | --- | --- | --- |
| `gear.recorded` | `{name: string｜null, container: bool, kind, residence?, owner?, owned_count?}` | Creates the Gear and seeds each **present** field as its own register, all stamped with this op's clock. `name`'s `null` clears; absent ≠ null (§1.3) | Gear recorded (as item or container) | 1, 2, 7 |
| `gear.renamed` | `{name: string｜null}` | Sets `name`. `null` clears; absent ≠ null (§1.3) | Gear renamed | 2 |
| `gear.rehomed` | `{residence: Residence}` | Sets the **home** residence. The single small update of story 2, and what the unpack pass emits when re-homing on the spot | Gear re-homed | 2, 11 |
| `gear.kind_set` | `{kind: "single"｜"per_person"｜"counted"}` | Sets `kind`. Exclusivity is structural — one register, one value (invariant 5) | Kind set | 7 |
| `gear.owned_count_set` | `{count: int ≥ 0}` | Sets `owned_count`, **absolutely**. Also how the close applies a `consumed` reduction (§4.5) | Owned-count set · reduction applied | 2, 7, 11 |
| `gear.ownership_set` | `{owner: {"type":"shared"} ｜ {"type":"person","person_id":<uuid>}}` | Sets `owner` | Ownership set | 4 |
| `gear.tag_applied` | `{tag: TagString}` | Sets the per-tag register to present (§3.4) | Tag applied | 13 |
| `gear.tag_removed` | `{tag: TagString}` | Sets the per-tag register to absent | Tag removed | 13 |
| `gear.retired` | `{}` | Sets the tombstone. Soft-delete; past trips keep their history (invariant 7) | Gear retired | 2 |
| `gear.restored` | `{}` | Clears the tombstone if strictly later | Gear restored | 2 |

**`TagString` — an authoring rule, not a validation gate.** A conforming tag is
**lowercase `[a-z0-9-]`, 1–40 characters**, stored **without** the leading `#`
that every screen draws. Authoring clients normalise before emitting: case
folded down, runs of whitespace collapsed to a single hyphen, a typed `#`
stripped. The constraint comes from the design boards (`docs/design/README.md`
§4a), which own it because the tag pickers are the only place a spelling is
ever chosen — there is **no Tag entity, and no rename op, by design**, so a
misspelling is corrected only by removing it and applying the right one.

**Readers do not enforce it.** §5's tolerant-reader discipline is absolute and
outranks this rule: a `tag` that does not conform is folded exactly as
received, never rejected, never rewritten, and never dropped — an installed PWA
running an older build may hold ops queued offline against an earlier
normalisation, and rejecting them would discard a Quartermaster's work to
enforce a cosmetic rule. The register key is the literal string that arrived
(§3.4). Two spellings of one intent are therefore two registers that both
fold, which is precisely why the defence is the picker at authoring time and
not a check at the boundary.

Tightening the rule later is additive and needs no migration: old ops keep
folding, and only newly authored tags take the new shape. **Trip-only gear is
never tagged** (domain invariant 9); no op enforces this either, because
trip-only entries are not Gear aggregates and so have no tag register to write.

**The containment trait is set once, at `gear.recorded`, and has no mutation op.**
Domain §9 records gear as an item *or* a container and never as changing between
them; no story asks to convert one into the other. Recorded here as a deliberate
omission rather than smuggled in — if it turns out to be real, it is a new,
additive op type.

**Owned-count is absolute, never a delta.** A `reduce_by` op would be a counter,
and counters are hazardous under replay and under two devices closing the same
trip. An absolute set is idempotent, LWW-safe, and matches story 11's requirement
that changing away from `consumed` **offers** the correction rather than silently
re-applying it — the offer computes the new absolute value and waits for a human.

**`name` is nullable; this was settled during the S2 slice, extended at S4, and
completed at S6.**
`place.recorded`/`place.renamed`, `gear.recorded`/`gear.renamed` and
`person.recorded` all type their `name` field `string｜null`: an explicit
`null` clears the field, a write like any other, while an absent field
leaves it untouched. **§1.3 is the authority for this** — it states the
absent-versus-null distinction generally, with no per-field carve-out.
**§5.3 obligation 5 is *not* the authority**: its text runs one way only
(treating an *absent* field as an explicit clear), so it says nothing about
what a `null` payload should do, and citing it to justify collapsing `null`
into absent — the reverse direction — was an error made and corrected during
this slice, not a second, independent rule.

**`person.renamed` was the one row left open, and S4 closed it.** It was typed
`{name}` here until the slice that folded it settled the same question — and
the answer was that there was never a second question: `PersonState.name` is
`Register<string | null>` and has been since S2, so the reducer's existing rule
applied unchanged. It folds through the same `writeNullableIfPresent` path as
the other four name registers, under the same handler as `person.recorded`,
and its row above is typed accordingly.

**The seventh and eighth rows are the Trip's, and S6 closed them the same way.**
`trip.created` and `trip.renamed` were typed `{name}` in §4.4 until the slice
that folded them. There was again no second question: `TripState.name` is
`Register<string | null>` like every other name register, so the reducer's
existing rule applied unchanged and both rows are typed `{name: string｜null}`
above. Eight rows, one rule stated once in §1.3, three slices to reach all of
them — and the catalogue's `name` fields are now settled entire.

### 4.4 Trip — 23 ops

`aggregate_id` is the Trip in every row; entities inside it are addressed by ids
in the payload.

**Trip root**

| Type | Payload | Effect on folded state | Domain §9 | Story |
| --- | --- | --- | --- | --- |
| `trip.created` | `{name: string｜null, from_trip_id?}` | Creates the Trip; seeds `name`, `phase = "draft"` — the **reducer's** write, not a payload field (see below) — and the template provenance. `name`'s `null` clears; absent ≠ null (§1.3) | Trip created · Trip started from | 5, 14 |
| `trip.renamed` | `{name: string｜null}` | Sets `name`. `null` clears; absent ≠ null (§1.3) | *(implied by Trip created)* | 5 |
| `trip.dates_set` | `{start?: date｜null, end?: date｜null}` | Sets either date **independently**; `null` clears. `YYYY-MM-DD` by convention, not by enforcement. Absent ≠ null (§1.3) | Trip dates set / cleared | 5 |
| `trip.phase_moved` | `{phase: "draft"｜"pack_out"｜"on_trip"｜"unpack"｜"closed"}` | Sets `phase`. Moves **in both directions**; reopening is this op with `phase = "unpack"` from `closed`. The close gate and the reopen confirmation are UI, not protocol | Trip phase moved · Trip reopened | 32 |
| `trip.deleted` | `{}` | Sets the tombstone. The confirmation is UI (invariant 15) | Trip deleted | 14 |
| `trip.participant_added` | `{person_id}` | Per-person-id register → present (§3.4) | Participant added | 5 |
| `trip.participant_removed` | `{person_id}` | → absent | Participant removed | 5 |

**`phase = "draft"` is the reducer's write, not a payload field.**
`trip.created` seeds it, stamped with that op's own clock, and nothing on the
wire can carry a phase. Three properties follow from the ordinary LWW rule with
no special case, and all three are wanted: a `trip.phase_moved` delivered
*before* its creation wins on its strictly later stamp (§8.2's out-of-order
case, resolved by §3.2 alone); a re-delivered `trip.created` writes an identical
value on an identical stamp and loses on `<= 0`, so replay is idempotent; and no
client can create a Trip that arrives already `closed` — an absence rather than
a guard. Settled at S6, which folded the Trip root.

**`trip.dates_set`'s payload keys are `start` and `end`; the registers they set
are `start_date` and `end_date`.** The catalogue names a payload for the field
it sets without repeating the register's own name — the same split
`gear.owned_count_set{count}` already has over `owned_count`. Recorded so that
nobody later "fixes" one end to match the other. The two dates are independent
registers under §1.3, so `{start: …}` moves the start and leaves the end alone
and `{end: null}` clears the end and leaves the start alone; an authoring screen
therefore emits only what changed. And **a reader does not check the shape** —
§5.3 outranks the `YYYY-MM-DD` convention exactly as it outranks §4.3's
`TagString` rule, so a date that does not conform is folded, stored and drawn
verbatim rather than reported absent.

**Gear list**

| Type | Payload | Effect on folded state | Domain §9 | Story |
| --- | --- | --- | --- | --- |
| `trip.entry_added` | `{entry_id, source: {"from":"depot","gear_id":<uuid>} ｜ {"from":"trip_only","name","container":bool}}` | Creates the Entry. A depot entry **references** gear by identity and copies nothing (invariant 8); a trip-only entry carries its own name and containment trait | Entry added to gear list | 6 |
| `trip.entry_removed` | `{entry_id}` | Tombstone. This is also how an over-claim is resolved (§3.6) and how "not bringing it" is expressed — there is no such status (invariant 11) | Entry removed | 6 |
| `trip.entry_bring_count_set` | `{entry_id, count: int ≥ 0}` | Sets `bring_count`. Counted entries only (invariant 6) | Bring-count set | 7 |

**"Counted entries only" is an authoring rule, not a reader gate (S7).** The
Entry's Kind lives on the Gear aggregate — a different aggregate, with no
ordering against this one — so a reducer that resolved the Kind before writing
`bring_count` would make the fold order-dependent: the same op would land or
not depending on whether `gear.kind_set` had already arrived. `bring_count`
therefore folds unconditionally for any Entry, and the authoring screen is the
whole of the defence, exactly the split `TagString` (§4.3) already draws
between an authoring rule and a reader obligation. **`source` is one register**
(§3.7), so a trip-only Entry's `name` and `container` are written and compared
as a unit and there is no way to change one without rewriting the other — which
is also why the catalogue defines no rename for a trip-only Entry: the three
ops above are the whole of the gear list, and none of them is one. And the
payload key is `gear_id`; the register it sets is `gearId` — the same split
`gear.owned_count_set{count}` → `owned_count` already has, restated for a
nested field.

**Per-person Pieces**

| Type | Payload | Effect on folded state | Domain §9 | Story |
| --- | --- | --- | --- | --- |
| `trip.piece_removed` | `{entry_id, person_id}` | Tombstone on that participant's Piece. *This is* "that Person isn't bringing one" (invariant 10) | Per-person piece removed | 8 |
| `trip.piece_restored` | `{entry_id, person_id}` | Clears it if strictly later | Per-person piece restored | 8 |

Adding per-person gear yields one Piece per Participant as a **starting
default**, so `trip.entry_added` does not enumerate them — Pieces are derived
from the trip's participants, minus those explicitly tombstoned. That keeps
"add a participant later and they get a Piece" true without a backfill op.

**Packing**

| Type | Payload | Effect on folded state | Domain §9 | Story |
| --- | --- | --- | --- | --- |
| `trip.entry_status_set` | `{entry_id, status: "not_packed"｜"staged"｜"packed"}` | Sets the Entry's packing status. Plain LWW (§3.3) | Entry packing-status changed | 9 |
| `trip.piece_status_set` | `{entry_id, person_id, status}` | Same, for one Piece | Entry (or piece) packing-status changed | 8, 9 |
| `trip.entry_moved` | `{entry_id, residence: TripResidence}` | Sets the Entry's **trip** residence. Never touches its home (invariant 13) or its status (invariant 12) | Entry / trip container moved | 9, 10 |
| `trip.piece_moved` | `{entry_id, person_id, residence: TripResidence}` | Same, for one Piece | Entry / trip container moved | 8, 10 |
| `trip.container_stage_set` | `{entry_id, stage: "home"｜"staging"｜"car"｜"packed"}` | Sets the container's journey stage. **One op moves everything inside it** — see below | Container journey moved | 10 |

**Moving a container is one op, not N.** Story 10 asks that moving a container
move everything inside it in one action, nested containers included. It costs
nothing here, because containment is a **pointer held by the contained thing**
([domain §3](domain-model.md#3-containment-one-relationship-held-as-a-pointer)):
the contents already point at the container, so their whereabouts follows when
the container moves. Nothing to update, nothing to fan out, and no cross-entity
write that could partially merge. The domain's pointer choice pays off directly
at the protocol layer.

Their **packing statuses are deliberately not touched** — the container may be in
the car while the stove inside it is still marked not-packed, and that
disagreement is surfaced, not forbidden (invariant 12).

**`status` and `stage` are open enums, and *never both on one Entry* is an
authoring rule, not a reader gate (S9a).** The two rows above list the values
this build knows, and both sets stay **open** past them exactly as `kind` and
`phase` do (§3.3) — which is the whole reason story 20's per-trip editable
statuses need no rank function and no migration. An unrecognised value is
simply a value: folded as received, drawn verbatim, never coerced, and never
counted as packed.

The exclusivity §3.7 states — `stage` on Entries whose gear carries the
containment trait, `status` on everything else, and never both — is then the
`TagString` split (§4.3) and "Counted entries only" (above) for a third time.
The trait lives on the **Gear** aggregate for a depot Entry, so a reducer that
resolved it before writing would make the fold order-dependent on whether
`gear.recorded` had already arrived. Both registers therefore fold
unconditionally for any Entry, the authoring screen is the whole of the
defence, and the gate lives on the way out: a container answers nothing when
asked for a status, and a non-container nothing when asked for a stage. A peer
on another build that wrote both leaves both folded, and this reader takes the
one that applies.

**`trip.entry_moved` on a per-person Entry is that same split a fourth time (S9
round 2):** for per-person gear _where it is_ is only ever a per-Piece fact
([domain §5](domain-model.md#5-aggregates)), so no authoring screen emits the op
for that Kind and no reader of *where the gear is* consults the register —
folded as received, and `entryResidenceOf` is the gate that ignores it, exactly
the shape a `bring_count` on non-Counted gear already has. This also means a
Piece with no `residence` of its own reads **loose** rather than its Entry's.
One reader does still see the register: the trip's containment view
(`tripContainment.ts`) builds its tree from every visible Entry's raw
residence, per-person ones included, which is right about the container tree
and wrong about where per-person gear is — so a count of "what rides along
inside this container" must come from the items' resolved residences, never
from that tree.

**Tasks and notes**

| Type | Payload | Effect on folded state | Domain §9 | Story |
| --- | --- | --- | --- | --- |
| `trip.task_added` | `{task_id, text}` | Creates the Pre-trip task, unticked | Pre-trip task added | 15 |
| `trip.task_ticked` | `{task_id, ticked: bool}` | Sets `ticked`. One op for both directions | Task ticked / unticked | 15 |
| `trip.note_posted` | `{note_id, text, entry_id?}` | Creates the Trip note, optionally *about* one Entry | Trip note posted | 12 |
| `trip.note_kept` | `{note_id, kept: bool}` | `true` = kept as reference, `false` = discarded. Reviewed at the unpack pass | Note kept / discarded | 12 |

**Closing**

| Type | Payload | Effect on folded state | Domain §9 | Story |
| --- | --- | --- | --- | --- |
| `trip.outcome_set` | `{entry_id, person_id?, outcome: "back"｜"consumed"｜"lost"｜null}` | Sets the unpack outcome on an Entry, or on one Piece when `person_id` is present. `null` clears it back to **open**. Recording an outcome **releases the claim** immediately, mid-pass (§5.2) | Unpack outcome recorded / changed / cleared | 11 |
| `trip.consumed_count_set` | `{entry_id, count: int ≥ 0}` | Sets the Consumed-count on a counted Entry resolved as `consumed`. Kept with the trip as history | Consumed-count set | 11 |

### 4.5 Gestures that emit more than one op

Three user actions cross an aggregate boundary or expand into many ops. All of
them are ordinary ops in one push batch — there is no cross-aggregate
transaction, because every op merges independently.

**Re-homing during the unpack pass** emits `trip.outcome_set` (Trip) and
`gear.rehomed` (Gear). The two writes invariant 8 permits are exactly these,
plus the third below.

**Resolving a `consumed` counted entry at the close** emits
`trip.consumed_count_set` (Trip) and `gear.owned_count_set` (Gear) with the new
absolute owned-count. `lost` emits nothing against the depot at all — the gear
keeps its recorded home, and *unaccounted for* is a selector reading the outcome
(story 3, story 11).

**Starting a trip from a past one** expands **at creation time** into ordinary
ops in one batch: `trip.created{from_trip_id}`, then a
`trip.entry_added` per entry, `trip.entry_bring_count_set`, `trip.task_added`,
and `trip.note_posted` for each kept note. Packing statuses, journeys, outcomes,
consumed-counts and dates start fresh by simply not being written.

It would be tempting to make the copy **derived** — store only `from_trip_id`
and read the source trip's list. That is wrong here: the new trip's contents
would depend on the source trip's *current* fold, so they would keep mutating as
old ops for the source arrived, and two replicas mid-sync would disagree.
Materialising at creation is deterministic. A template batch runs ~100 ops,
comfortably inside the 500-op cap.

---

## 5. Naming and evolution

The rules that keep an installed PWA from a previous version syncing forever.

### 5.1 Naming

```
<aggregate>.<past_tense_verb_phrase>
```

Two segments, `snake_case`, lowercase. `gear.rehomed`, `trip.entry_status_set`,
`trip.container_stage_set`.

- The aggregate prefix matches the `aggregate` envelope field exactly.
- The verb is **past tense**: an op is a fact already true on the authoring
  device, not a command to a server that may refuse it. `recorded`, not `record`.
- Two segments only. Entities inside the Trip are addressed by payload ids, so
  `trip.entry_status_set` — never `trip.entry.status_set`.
- The vocabulary comes from
  [domain §9](domain-model.md#9-operations-and-domain-events) and the
  [ubiquitous language](ubiquitous-language.md). A word that means one thing in
  the glossary means that same thing in an op type.

### 5.2 How payloads may grow

Additively, and only additively:

- **New optional payload field** — allowed, always. Older readers ignore it
  (§5.3, obligation 2) and fold the rest correctly.
- **New op type** — allowed, always. Older readers retain it unfolded (§5.3, obligation 1).
- **New enum member** — allowed, subject to §5.3's obligation 4. This is how story 20's
  per-trip editable statuses land without a rewrite.
- **New optional *envelope* field** — allowed by the same rule, but it needs a
  reason no payload could serve. There is currently none.

**There is no version field on an op, and there never will be.** Additive-only
evolution makes one unnecessary, and a version field is an invitation to make a
breaking change and negotiate around it. The `/api/v1` major in the path
(§6) versions the **transport**, not the op format.

### 5.3 What "tolerant reader" concretely obliges

Six obligations. A reducer that violates any of them breaks an installed client
in the field.

1. **Unknown `type`** — do not fold it, do not reject it, **retain it verbatim in
   the local log**, advance the cursor past it, and count it in diagnostics. A
   later build folds it correctly from the retained log. *Ignore is not discard.*
2. **Unknown payload field** — ignore it for the fold; retain the op verbatim.
3. **Unknown envelope field** — the same.
4. **Unknown enum value** — store it verbatim in the register. Never coerce it to
   a known member, never crash, never drop the op. An older build shows an
   unfamiliar status as its raw string; a newer build renders it properly. (This
   is only safe because §3.3 removed the rank function from the merge.)
5. **Absent ≠ null** (§1.3). Treating an absent field as an explicit clear
   silently destroys data.
6. **Never mutate a stored op.** The log is append-only, and a re-push must be
   byte-identical to what the server holds (§8.1). Corrections are new ops.

**The local snapshot is keyed by build SHA.** Because obligation 1 retains ops a
build could not fold, a snapshot taken by that build is *wrong* for a build that
can fold them. So: a snapshot records the build SHA that produced it, and a
different SHA discards it and re-folds from the full local log. Cheap (§7's
arithmetic makes a full re-fold sub-second) and it makes the whole tolerant-reader
scheme safe rather than merely well-intentioned.

### 5.4 What may never change about an existing op type

Frozen for the life of the op type:

- its **name**;
- the **aggregate** it targets and the meaning of its `aggregate_id`;
- the **type or meaning of any existing payload field**;
- an **optional field becoming required**;
- a **required field being removed or renamed**;
- its **effect on folded state** for the registers it already writes;
- the **removal of any member** from an enum it writes.

If one of these must change, it is a **new op type**, and the old one keeps
working forever. That is expand-contract at the protocol layer: add the new
shape, teach readers both, migrate authorship, and drop the old only much later —
if ever, since an op type costs a reducer branch and nothing else.

The [backward-compatibility test group](testing.md) is what keeps this honest:
op fixtures captured from previous app versions are replayed through the current
reducer every push to `main`. **Capture a fixture in the same commit as the slice
that introduces an op type** — the fixture is worthless if it is written after
the format has already drifted.

---

## 6. Wire format

Base `https://api.foerier.app/api/v1`. Every request carries
`Authorization: Bearer <device token>` ([auth-design §9.3](auth-design.md)) and
`Content-Type: application/json`. `household_id` is taken from the token and
never from the body, the query string, or a header.

### 6.1 POST /sync/push

```json
{ "ops": [ { …envelope… }, { …envelope… } ] }
```

Limits: **≤ 500 ops**, **≤ 1 MB** body, **≤ 16 KB** per op. The client chunks
its outbox and flushes in authoring order.

Ops are pushed with `seq` and `received_at` **absent**; sending them is an
`envelope_invalid` rejection, since they are the server's to assign.

**Response — `200 OK`:**

```json
{
  "results": [
    { "op_id": "0198f2a1-c4ea-7c31-9b02-6f1a4d3e88b0", "status": "accepted",  "seq": 4471 },
    { "op_id": "0198f2a1-d011-7a02-8c33-1b2c3d4e5f60", "status": "duplicate", "seq": 4102 },
    { "op_id": "0198f2a1-d5c8-7b44-9e21-7a8b9c0d1e2f", "status": "rejected",
      "code": "household_mismatch" }
  ],
  "household_seq": 4471
}
```

- `results` has exactly one entry per submitted op, **in request order**, always.
- `accepted` carries the assigned `seq`. `duplicate` carries the seq the op
  **already had** — never a new one (§8.1). `rejected` carries a code from the
  closed set in §6.3.
- `household_seq` is the household's high-water mark after the push. The client
  pulls when it exceeds its cursor.

New ops are deliberately **not** piggybacked onto this response. An extra `GET`
on reconnect costs nothing, and one delivery path is worth more than one saved
round trip.

**Atomicity.** The whole push runs in one transaction: accepted ops commit
together, so a client never sees half a batch. But **a rejection does not roll
back its neighbours** — the batch is atomic in the database and per-op in the
response. A batch-level failure (§6.3) stores nothing at all.

This is the design that keeps a single bad op from wedging the outbox forever.
All-or-nothing acceptance would mean one malformed op blocks every op behind it
permanently, unless the client can identify and quarantine it from the error
body — which is the per-op response by another name.

### 6.2 What the server may reject, and what it may not

**The server validates the envelope and nothing else.** It never inspects
`type` beyond storing it, and never inspects `payload` beyond "is a JSON
object". It has no op vocabulary, so it can never be out of date about one — a
new client's new op type is stored opaquely by an older server without a
deploy-order dependency.

Nor does it enforce domain invariants: acyclicity, kind exclusivity, the close
gate, and supply are all client-side and deterministic
([architecture §5](architecture-design.md), deferred in §10 there).

### 6.3 Errors

**Per-op rejection codes** — the complete closed set:

| Code | Cause |
| --- | --- |
| `envelope_invalid` | A required envelope field is missing, malformed, or of the wrong type; or `seq`/`received_at` was sent |
| `op_id_invalid` | `id` is not a valid UUIDv7 |
| `hlc_invalid` | `hlc` does not match the §2.2 grammar |
| `household_mismatch` | `household_id` ≠ the token's household. Rejected outright, never rewritten — silence would hide a client bug that is indistinguishable from an attack ([auth §9.3](auth-design.md)) |
| `op_too_large` | Over 16 KB serialised |

**Batch-level errors** use one shape:

```json
{ "error": { "code": "payload_too_large", "message": "…", "detail": { } } }
```

| Status | Code | What the client does |
| --- | --- | --- |
| 400 | `bad_request` | The batch itself is malformed — a client bug. **Dead-letter the batch** (§6.5), log it, do not retry. |
| 401 | `unauthorized` | Token missing, revoked, expired, or its Login disabled. **Freeze sync, keep the outbox intact**, prompt sign-in. A 401 must never cost a user queued offline work. |
| 413 | `payload_too_large` | Halve the batch and retry. A batch of **one** that is still too large is **dead-lettered** (§6.5) rather than retried: it cannot be halved again, and retrying it forever would wedge every op behind it in `lsn` order permanently. |
| 429 | `rate_limited` | Honour `Retry-After`, then back off. `/sync/*` has a much higher limit than the auth endpoints, because a returning offline client legitimately bursts ([auth §9.4](auth-design.md)). |
| 5xx | `server_error` | Retry with exponential backoff + full jitter, base 1 s, cap 5 min, **indefinitely**. |
| — | *(network / timeout)* | The same as 5xx. |

Note there is no `409`. Conflicts are resolved by the fold on every device
(§3), never at the transport layer.

### 6.4 GET /sync/pull

```
GET /sync/pull?since=<seq>&limit=<n>
```

Returns ops with `seq > since`, ordered by `seq` ascending. `since` is an
**exclusive** lower bound; `since=0` is the bootstrap (§7). `limit` defaults to
500, maximum 1000.

```json
{
  "ops": [ { …envelope…, "seq": 4102, "received_at": "2026-08-24T10:03:12.881Z" } ],
  "cursor": 4471,
  "has_more": false,
  "household_seq": 4471
}
```

- `cursor` is the highest `seq` in this page — what the client passes as the next
  `since`. When `ops` is empty it echoes the request's `since`.
- `has_more` says whether the page was truncated by `limit`. The client keeps
  paging while it is true.
- `household_seq` is the household's high-water mark, the same field push
  returns (§6.1). Because `seq` is gapless it **is** the household's op count,
  which is what lets the first sync show a determinate `folded / total` instead
  of a spinner (§7.6).

**The client persists its cursor only after the whole page is durably folded and
written to its local log** — never on receipt. A crash between the two loses ops
permanently, because the cursor is the only record of what has been seen.

**`has_more` is the paging condition; `household_seq` is not.** The server reads
the high-water mark *after* it has read the page, so a client can legitimately
receive `has_more: false` alongside `household_seq > cursor` — it simply means
ops arrived while the page was being read. The reverse ordering would be worse:
it could report a mark *below* a `seq` the same response just handed out.

So, precisely:

- **Page while `has_more` is true, stop when it is false.** It means "this page
  was truncated by `limit`", nothing more.
- **Never loop on `cursor < household_seq`.** On a household being written to
  while a device bootstraps, that condition need never come true, and a client
  that waits for it never finishes.
- **Treat `household_seq` as a denominator, and a moving one.** A bootstrap
  displays `folded / household_seq`, tolerates the denominator growing
  mid-flight, and treats `has_more: false` as completion even when
  `cursor < household_seq`. The remainder arrives on the next ordinary pull.

The consequence of getting this wrong lands on the one screen that cannot
absorb it: a first sync that gates its CTA on reaching `household_seq` would
show a progress bar stuck below 100% and a button that never enables (§7.6).

**Pull returns the client's own ops too.** It has already applied them
optimistically, and re-applying is an idempotent no-op (§3.2). Filtering by
device would save a little bandwidth and cost a device the ability to recover its
own work after a local wipe.

### 6.5 The dead-letter list

Rejected ops and `400` batches move to a local dead-letter store. It is
**visible** (in Account, alongside Devices), **exportable**, **never retried**,
and **never cleared without the user**. This is the other half of the promise
that a rejected op never silently vanishes.

**A dead-lettered op stays in the local log and stays folded.** It is local
truth that failed to *publish*; dropping it from the fold would make the device's
own state jump backwards under the user's hands, which is worse than the
inconsistency it would fix. What the UI must say is that this device holds a
change the household never received.

### 6.6 Sequence assignment

`seq` is allocated inside the push transaction from a per-household counter:

```sql
UPDATE household SET op_seq = op_seq + $n RETURNING op_seq;
```

The returned value is the top of a reserved contiguous range; ops take
consecutive seqs in request order.

**It is deliberately not a Postgres `SEQUENCE`, and that matters.** Sequences are
non-transactional: transaction A can take seq 5 and commit *after* B took 6 and
committed. A client pulling in that window sees 6, advances its cursor past 5,
and **never receives op 5** — silent, permanent, undiagnosable data loss. The
counter row's lock removes the failure mode entirely by serialising writers *per
household only*, at a cost of nothing at this scale.

### 6.7 Storage

The minimum shape the above requires:

| Table | Columns |
| --- | --- |
| `op` | `op_id` (uuid, **PK**), `household_id`, `seq` (bigint), `aggregate`, `aggregate_id`, `type` (text), `hlc` (text), `device_id`, `payload` (jsonb), `received_at` (timestamptz) |
| `household` | *(existing, [auth §9.2](auth-design.md))* + `op_seq` (bigint, not null, default 0) |

Unique `(household_id, seq)`; the pull index is `(household_id, seq)`. The
`op_id` primary key is what makes re-push idempotent (§8.1). `type` is `text`,
never an enum — an enum would make the server's vocabulary a deploy-order
dependency, which §6.2 exists to avoid.

### 6.8 GET /version

Unchanged and unauthenticated: the deployed commit SHA, matching the sibling
`health` project's convention. It is what Tier 4 polls before running.

---

## 7. First sync and log growth

### 7.1 The decision

**A brand-new device pulls the household's entire log, paged, from `since=0`.
There is no server snapshot and no compaction in the MVP.**

Recorded with its arithmetic, because "is that acceptable?" is exactly the
question that gets rediscovered in two years.

### 7.2 The arithmetic

| | Ops |
| --- | --- |
| Initial depot load — ~400 pieces of gear × ~4 ops | ~1,600 one-time |
| Per trip — 60 entries: adds, ~180 status changes, ~60 moves, ~60 outcomes, tasks, notes | ~400 |
| 8 trips per year | ~3,200 / year |
| Depot upkeep | ~400 / year |

An op is ~400 bytes of JSON, and op JSON is highly repetitive so it gzips well.

| Horizon | Ops | Raw | Gzipped |
| --- | --- | --- | --- |
| Year 1 | ~5,000 | ~2 MB | ~0.3 MB |
| Year 10 | ~38,000 | ~15 MB | ~3 MB |

Folding 38,000 ops through a pure reducer is well under a second. **A naive
bootstrap is acceptable at household scale by a wide margin**, and the
simplicity — one code path, the same `GET /sync/pull` a returning client uses —
is worth more than the transfer it would save.

### 7.3 The revisit trigger

Not "when it feels slow". **Revisit when a household's log passes ~250,000 ops or
~25 MB uncompressed** — roughly a sixty-year household, or one behaving very
differently from the model above. The server can answer this cheaply
(`max(op_seq)` per household), so it is a metric, not a guess.

### 7.4 The escape hatch, and its real cost

If the trigger is ever hit, in order of preference:

1. **`GET /sync/snapshot`** — folded state plus the `seq` it is valid at; the
   client pulls the tail from there. The right answer, and the reason it is not
   built now is not effort: it **promotes the server from a thin op store to
   domain-aware**, which [architecture §5](architecture-design.md) declined
   deliberately. The seam exists — `shared/` is framework-free precisely so the
   reducer *can* run on the server ([architecture §7](architecture-design.md)) —
   so this is a decision that is deferred, not a capability that is missing.
2. **Log compaction** — fold ops older than some horizon into a per-aggregate
   base and drop them.

**Compaction has a coupling worth recording now.** Story 33 (gear history) is
Later and explicitly **derived** from the changes already recorded, never a
second record kept alongside them
([domain §10](domain-model.md#10-seams)). Truncating old ops destroys its raw
material. So any future compaction must either preserve the ops story 33 reads,
or story 33 dies with it. Whoever reaches for compaction owes that decision
explicitly.

### 7.5 Locally

The client keeps the **full log** in IndexedDB. The materialised snapshot
([architecture §3](architecture-design.md)) is an optimisation over it, keyed by
build SHA (§5.3), never a replacement for it. The log is also what makes
obligation 1 work, and it is where backward-compatibility fixtures come from.

### 7.6 The UI consequence

A first sign-in on a new device folds the whole log before it can show anything.
Even at year-one size that is a visible moment on a poor connection, and it grows
with the household. So:

- the bootstrap needs a **determinate** progress state, not a spinner — pages
  received, ops folded;
- it must be **resumable**: the cursor is persisted per page (§6.4), so a dropped
  connection continues rather than restarting;
- the copy should be honest that this is a **one-time** cost, not how the app
  normally starts.

This is the app's only unavoidable loading screen, and it is queued for the
design boards.

---

## 8. Idempotency and replay

### 8.1 Re-pushing the same op

`INSERT … ON CONFLICT (op_id) DO NOTHING`. The response is `duplicate` carrying
the seq the op **already had**. The seq is never reassigned and `received_at` is
never updated, so a re-push is invisible to every other client — which is what
makes an outbox that retries on an ambiguous timeout (the response was lost, the
write landed) safe by construction.

The op is stored exactly once and never mutated (§5.3, obligation 6), so a
re-push must be byte-identical. A client that "improves" a queued op before
retrying breaks this; it must not.

### 8.2 Ops arriving out of order

`seq` is **arrival order at the server**, not authoring order. An op authored
Monday offline arrives after one authored Tuesday online. This is normal and
requires no handling, because the reducer is order-independent by construction
(§3.2): each register keeps its own `(hlc, device_id)`, and an op that loses the
comparison is a no-op.

**Pull ordering by `seq` is for cursor correctness only, never for merge
correctness.** No part of the merge may depend on it. The convergence tier
([testing.md](testing.md)) asserts exactly this by generating random
interleavings.

### 8.3 The same op arriving twice

- **Relayed twice** — dedupe by `op_id`, at both ends. The client checks its
  local log before folding; the server's primary key does it.
- **From two devices** — impossible for the *same* op: `id` is generated on the
  authoring device and never travels as an intent to be re-issued.
- **The same intent from two devices** — two quartermasters both adding the tent
  to the trip produce two *different* ops with two different `entry_id`s, and the
  fold shows two entries. That is a domain-level duplicate for the UI to surface,
  not a protocol concern; the protocol did its job by losing nothing.

### 8.4 Local replay

Applying the complete local log to empty state must produce the current state
exactly. That is a Tier 1 property, and it is what makes the snapshot safely
discardable (§5.3) and a corrupted snapshot recoverable.

### 8.5 Crash safety

Two orderings the client must not get wrong:

- **Author:** append to the local log **before** updating in-memory state. A
  crash between them loses a render, not a fact.
- **Pull:** fold and durably write the page **before** advancing the cursor
  (§6.4). The reverse loses ops permanently.

### 8.6 A device restored from backup

Its `last` HLC may be behind. Monotonicity re-establishes on the first op it
receives (§2.5's `max`), and its op ids are unique regardless, so nothing
corrupts. Its own queued ops re-push idempotently against ops the server may
already hold (§8.1).

---

## 9. What this doc does not settle

Named so they are not built ahead of need.

- **Server snapshot and log compaction** — deferred, with the revisit trigger and
  the story-33 coupling recorded in §7.
- **Server-side invariant validation** — still deferred, as
  [architecture §10](architecture-design.md) has it. §6.2 states the current
  boundary precisely; it does not move it.
- **SSE liveness** — the seam in [architecture §4](architecture-design.md) is
  unaffected. It would deliver the same envelopes through a different pipe; the
  cursor stays the recovery mechanism.
- **Op types for the Later seams** — weight, promotion (of notes and of trip-only
  gear), configurable per-trip statuses, saved slices, carry assignment, sharing.
  Named in [domain §10](domain-model.md#10-seams), unspecified here. All of them
  are additive under §5.
- **Two requirements gaps the catalogue surfaced.** Neither story 15 nor domain
  §9 provides for **removing a Pre-trip task**, and neither story 12 nor §9
  provides for **editing or removing a Trip note**. Both are plausible holes and
  both are cheap, additive ops — but they are new requirements, so they go
  through the [requirements process](../CLAUDE.md) and land in
  [user-stories.md](user-stories.md) before they get op types. Not smuggled in
  here.
- **Whether the containment trait becomes mutable** after `gear.recorded` (§4.3).
- **Whether reopening earns its own op type** distinct from
  `trip.phase_moved{phase:"unpack"}`. It is a distinguishable fact in the fold
  either way; a separate type would only matter if story 33 wants to name it.
- **Retention and erasure.** An append-only log has no delete story. Out of
  scope while foerier is one household on the maintainer's own box; a real
  concern the day it is sold.
- **The `/api/v2` procedure** — running two majors side by side, and retiring
  one. [Architecture §7](architecture-design.md) sets the policy; the mechanics
  are unwritten because nothing has needed them.
- **The local IndexedDB schema** — the app's business, not the contract. This doc
  binds what crosses the wire and what the reducer must do with it.
- **Concrete `/sync/*` rate limits** beyond
  [auth §9.4](auth-design.md)'s "separate, much higher" — sized when there is
  traffic to size them against.
