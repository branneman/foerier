# Domain Model

How foerier's concepts are structured: the aggregates, the relationships between
them, the invariants they must uphold, and the operations that change them. The
words used here are defined once in [ubiquitous-language.md](ubiquitous-language.md)
and are not redefined.

This model is **conceptual and persistence-ignorant**. It names aggregates,
entities, value objects, references, and invariants — not tables, columns, or
any framework. No storage or stack choice is implied or required by anything
below.

**Horizon.** The model covers the [MVP](user-stories.md#mvp) fully. Where a
[Later](user-stories.md#later) feature will attach, the join is named as a
**seam** and the future concept is _not_ modelled. The flagged forward-
compatibility constraints (editable statuses, promotion, per-person spares) are
honoured as seams, not built.

---

## 1. Subdomains

foerier is one domain — _the depot and the trips outfitted from it_ — with two
subdomains the stories already separate cleanly, plus one future context.

- **Inventory** — the year-round truth: what is owned, where it rests, whose it
  is. Stable and curated. Changes here are deliberate acts of inventory
  management.
- **Trip** — outfitting and packing a subset of the depot. Has its own parallel
  packing world that must not leak back into Inventory until the explicit unpack
  pass.
- **Sharing** _(Later, named only)_ — a published, read-only projection of a
  trip with a deliberately narrow language of its own (no locations, no people,
  no status). A separate context precisely so it cannot accidentally expose the
  private model.

The boundary that matters most: **Trip references Inventory by identity and
never mutates it.** Building, packing, and closing a trip reads depot gear and
records trip-scoped state _about_ it, but only the unpack pass writes back to the
home arrangement — and then only what the quartermaster re-homes by hand.

---

## 2. The core building blocks

### Gear, and the containment trait

A **piece of gear** is the atom of the depot: one owned thing, with a home, an
owner, a **kind**, tags, and (later) a weight. Container-ness is **a trait a
piece of gear has, not a separate type** — a container is gear that can hold
other gear. This composition (chosen over a Container/Item type split) means the
shared attributes — home, owner, kind, tags, weight — are defined once, and a
duffel is unambiguously a thing you own, home, and can attribute to a person.

Modelled as: a **Gear** entity, identified by a stable identity, carrying its
attributes and a boolean-like **containment trait**. Gear with the trait is a
container; gear without it is an item. The trait governs two things and only two:
whether other gear may reside in it, and whether, on a trip, it travels a
**journey** rather than carrying a plain packing status.

### Place

A **Place** is a fixed, un-owned location — an entity with an identity and a
name, and nothing else structural. Places are not gear: no owner, no kind, no
tags, no weight, and they never travel. They are the fixed roots the home
arrangement hangs from.

---

## 3. Containment: one relationship, held as a pointer

Containment is modelled as a **"resides in" reference held by the located
thing**, not as a collection owned by the holder. Each piece of gear names the
one location it resides in: a place, a container, or nothing (loose). The
containment tree is **emergent** from these pointers — it is a computed view, not
a stored structure anyone owns.

This representation is a deliberate choice, and it earns three story
requirements directly:

- **A move is one small update** (story 2): re-homing gear changes a single
  reference, never a re-entry.
- **Moving a container moves its contents for free** (story 10): the contents
  keep pointing at the container; when the container's own residence changes,
  their whereabouts change with it. No per-item edits.
- **Nothing is silently lost** (story 1): removing a place or a container leaves
  everything that resided in it **loose**, and surfaces it, rather than deleting
  by cascade.

Constraints on the relationship (see [Invariants](#8-invariants)): a piece of
gear resides in exactly one location; only container-gear and places may be
resided in; and the graph is **acyclic** — a container can never come to reside
in itself or in its own descendants.

---

## 4. Two worlds of residence

The same "resides in" relationship is instantiated in **two independent scopes**:

- The **home arrangement** — one per depot. Every piece of gear has exactly one
  home residence. This is Inventory's structure.
- A **trip's packing arrangement** — one per trip. Within a trip, an entry or a
  trip container may reside in a trip container or be loose on the trip.

They are fully independent (story 1). A stuff sack rests empty on its shelf at
home while, on a trip, it holds clothing and rides in the duffel — and that
clothing's _home_ is still the wardrobe, untouched. A container's residence _and_
its contents can therefore differ between home and any trip, and between one trip
and the next.

**Whereabouts** (story 3) reconciles the two on read, always from the most recent
fact known about the gear. If an entry for it on an **active trip** is still
unresolved, its whereabouts is its trip residence; if its most recent **unpack
outcome** was `lost` and nothing later supersedes that, it is **unaccounted for**,
naming the trip it was last seen on; otherwise its home. An unpack outcome
supersedes trip residence, so gear marked `back` reads as home from that moment,
mid-pass, without waiting for the close. Nothing stores a "current location" — it
is always derived.

For counted and per-person gear the answer is a **quantity split** rather than a
single location (§6): some units at home, some out, both true at once. The home
residence is never vacated by a trip, so "×2 in Crate B, ×2 on the Alps trip"
composes from facts that already exist.

**Only an active trip's packing arrangement has effect.** A draft trip's
arrangement is not yet real and a closed trip's is no longer real, so neither is
consulted. This is what lets closing a trip be non-destructive: the arrangement is
**retained and simply ceases to have effect** (invariant 14), and reopening the
trip restores it without anything having been recovered or rebuilt.

---

## 5. Aggregates

### Inventory side — small aggregates, referenced by identity

- **Gear** is its own aggregate. Its home residence is a _reference_ to a place
  or a container, held by the gear itself (§3). Gear does not own a collection of
  contents; the tree is emergent. Keeping gear small means moves, re-homes,
  retagging, and retirement each touch one aggregate.
- **Place** is its own small aggregate (identity + name).
- **Person** is its own small aggregate (identity + name).

There is deliberately **no "home tree" aggregate**. The arrangement is a query
over gear's residence references, not a stored structure with its own consistency
boundary — which is what lets a move be a single-aggregate change.

### Trip — the coarse aggregate

A **Trip** is one aggregate root that owns its entire packing world. This is a
deliberately coarse boundary: it keeps every packing invariant inside one
consistency unit, and it lets an offline-first, two-quartermaster app sync a trip
as a whole without cross-aggregate coordination.

The Trip root holds, as its **internal** entities and value objects:

- **Phase** — where the trip stands in its own life (§5.1), and optional **dates**
  (a start and an end) that identify and order it without driving anything.
- **Participants** — references to depot people who join this trip.
- **Gear list** — its **entries**. Each entry either references a piece of depot
  gear _by identity_, or _is_ a trip-only piece of gear held inside the trip.
  Each entry carries its trip state: packing status, trip residence, its **unpack
  outcome** once recorded, and — for a counted entry — its bring-count and, if
  resolved as `consumed`, its **consumed-count**.
- **Pieces** — for each per-person entry, the individual per-participant copies,
  each with its own packing status, trip residence, and unpack outcome.
- **Trip containers** — the containers this trip packs into. A trip container
  likewise either references a depot container by identity or is a trip-only one;
  it carries a **journey stage** and a trip residence. (A container brought on a
  trip is both an entry on the gear list _and_ a holder in the packing
  arrangement — the same piece of gear seen in its two roles.)
- **Pre-trip tasks** — non-gear checklist items with a ticked/unticked state.
- **Trip notes** — free text, each optionally referencing one entry, each
  kept-or-discarded at unpack.

What the Trip **references but never contains**: depot gear, people, and places.
Their details are single-sourced in Inventory. The trip stores only what is true
_about them on this trip_. Correcting a piece of gear in the depot is reflected
in every trip that references it (story 6); adding or removing entries never
touches the depot.

### 5.1 Trip lifecycle

A trip's **phase** — `draft` → `pack-out` → `on trip` → `unpack` → `closed`
(story 32) — is a value a quartermaster sets, not a machine that advances itself.
Three properties define it:

- **It describes; it does not lock.** Every editing capability stays available in
  every phase. You add a forgotten entry mid-pack-out, re-home during the trip,
  mark something packed while unpacking. A phase that forbade editing would force
  the administration to lie about what is happening — the same failure §7 avoids
  by letting residence and status disagree.
- **It moves in both directions.** Marking a trip `on trip` and then finding the
  duffel still in the hall means going back to `pack-out`; that must be
  expressible. Only two transitions are special: entering `closed` is **gated**
  (invariant 18), and leaving it — **reopening** — is a **deliberate, confirmed
  act** (invariant 19), being the one backward move that makes settled history
  live again.
- **Only `pack-out`, `on trip`, and `unpack` are _active_.** Active-ness is what
  gives a trip's packing arrangement effect (§4) and what makes its unresolved
  entries hold **claims** (§5.2). Draft and closed trips are inert — which is why
  drafts may overlap freely, and why closing needs to destroy nothing.

Dates never drive the phase. A trip does not become `on trip` because its start
date arrived; it becomes `on trip` because a quartermaster says the household
left.

### 5.2 Claims on depot supply

The depot has a finite supply, and active trips draw against it. A **claim** is
held by an **unresolved** entry on an active trip; recording an unpack outcome
releases it, so gear flows back into free supply across the unpack pass rather
than all at once at the close.

The supply rule reads once per kind (§6):

- **Single** — supply is one, so at most one active trip may claim it.
- **Counted** — bring-counts across active trips may not sum past the owned-count.
- **Per-person** — supply is one per person, so a given participant's piece of
  that gear may be claimed by at most one active trip. Two active trips may
  legitimately claim the same per-person gear for _different_ people.

Exceeding supply is an **over-claim**, and it is never legitimate: two trips
cannot both have the one tent, because reality cannot be in that state. Unlike the
residence-versus-status disagreement of §7 — which is durable and honest — an
over-claim is always transient and must be resolved.

**It is guarded, not prevented.** Quartermasters work offline, so a cross-trip
uniqueness rule cannot be enforced at the moment of writing without coordination
the offline-first design forbids. The model therefore guards at the three moments
an over-claim is visible — adding gear to an active trip, activating a draft, and
reopening a closed trip — and treats one that arrives through sync as a conflict
to **surface and have a quartermaster resolve**, never as grounds to discard a
write.

---

## 6. Kinds, quantities, and pieces

**Kind** is intrinsic to a piece of gear and is exactly one of single,
per-person, or counted (mutually exclusive — never both counted and per-person).
It governs how the gear behaves once it becomes an entry on a trip:

- **Single** → one entry, one piece of gear.
- **Counted** → one entry carrying a **bring-count** for this trip, alongside the
  depot's **owned-count**. Two different numbers, deliberately named apart: how
  many we _own_ versus how many we _bring_.
- **Per-person** → one entry that fans out into **pieces**, one per participant
  as a _starting default_ (story 8), not a fixed rule. Each piece is tracked and
  packed on its own; each can be removed individually. A per-person entry can
  thus be brought by some participants and not others, and a removed piece simply
  means that person isn't bringing one.

There is **no "not coming" state** anywhere. Deciding not to bring something is
_removing_ it (the entry, or the single piece) from the trip; its absence is
recoverable by filtering and, for gear, by re-adding.

### Quantities split across worlds, without per-unit identity

A piece of gear can be partly at home and partly away, and both facts are true at
once: two of the four chairs in Crate B, two on the Alps trip. This **split** is
what whereabouts reports for counted and per-person gear (§4), and it is pure
arithmetic over facts already recorded — `owned-count` less the bring-counts
claimed by active trips, or, for per-person gear, which participants' pieces are
out. The home residence is never vacated while units are away.

Crucially this needs **no identity for individual units**, and the model
deliberately refuses to give them one. Giving a counted gear's units their own
identities, conditions, or purchase dates _is_ recording them as separate gear —
at which point the counted kind has no reason to exist. The model already serves
that need better: gear whose individual units genuinely differ is recorded as
separate **single** gear. **Counted** is the deliberate simplification for gear
whose units are interchangeable, and interchangeability is exactly what makes the
arithmetic legitimate.

### Unpack outcome — the third piece of trip state

Alongside residence and status (§7), an entry or piece carries an **unpack
outcome** once the trip is being unpacked: `back`, `consumed`, or `lost`, with no
outcome meaning **open**. It is not a fourth packing status — it is the entry's
_resolution_, the record of how it left the trip, and it is what the close is
gated on (invariant 18).

Two of the three touch Inventory, and they touch it very differently:

- **`consumed`** genuinely writes: the owned-count falls by the consumed-count,
  because the household really does own fewer. This is the second and only other
  place a trip writes back to the depot (invariant 8). It applies once, at the
  close; a later change to the outcome on a reopened trip **offers** the
  correction for confirmation rather than silently re-applying it, because the
  depot may have moved on since.
- **`lost` writes nothing at all.** The gear's recorded home is left untouched —
  destroying it would throw away the very fact needed when the thing turns up — and
  the outcome is read instead by whereabouts, which reports the gear as
  **unaccounted for**, naming where it was last seen. The standing ends on the
  next fact about that gear: a re-home, or a later trip bringing it `back`. Lost is
  therefore fully reversible and is never a form of retirement.

Trip-only gear takes no outcome: it never entered the depot, so it is simply
cleared at the close and is excluded from the open count.

---

## 7. Two tracks: where vs. how-far

A trip's state moves along **two independent tracks**, and this is a modelled
choice, not an oversight:

- **Residence** answers _where_ a thing is — its home or trip residence (§4).
- **Packing status** (entries and pieces) and **journey stage** (containers)
  answer _how far along_ it is.

The tracks are allowed to **disagree**, and disagreement is **surfaced as a
signal, not forbidden**. The model can therefore express "the duffel is staged in
the car, but the stove inside it is still marked not-packed" — which is real: you
threw the bag in the car but haven't confirmed every item made it in. Enforcing
agreement would force the administration to lie. Moving a container along its
journey moves its contents' _residence_ (§3); it does **not** silently overwrite
their _status_.

Both the packing-status set and the journey-stage set are **fixed** in the MVP
(with a guaranteed minimum of two states each). They are shaped so that story
20's per-trip editable states grow from them without a data rewrite — the fixed
sets are the seed values of a mechanism, not hard-coded branches. _(Seam:
[Configurable status](#9-seams).)_

---

## 8. Invariants

The rules the model must never violate.

**Gear and containment**

1. Every piece of gear resides in exactly one location: a place, a container, or
   loose. Never two; "loose" is a valid state, not a missing one.
2. Only container-gear and places may be resided in. An item (gear without the
   containment trait) can hold nothing.
3. The containment graph is acyclic and unbounded in depth. No piece of gear may
   reside in itself or in any of its own descendants.
4. Removing a place or a container re-homes everything that resided in it to
   loose and surfaces it. Nothing is deleted by cascade.

**Kind and quantity**

5. Every piece of gear is exactly one kind; per-person and counted are mutually
   exclusive.
6. Owned-count exists only for counted gear; bring-count exists only for counted
   entries. Single gear is one; per-person gear is one-per-participant by
   default.

**Depot integrity**

7. Removing a piece of gear is a soft-delete (retire). References from past trips
   remain valid, and their history is unchanged.
8. A trip references depot gear, people, and places by identity and never mutates
   their depot details. The unpack pass is the only exception, and it writes back
   exactly twice: what the quartermaster **re-homes**, and the owned-count
   reduction of a **consumed** counted entry. An outcome of `lost` writes nothing.

**Trip and packing**

9. Trip-only gear exists within exactly one trip, is never tagged, and is never
   referenced by another trip.
10. A per-person entry's pieces are at most one per participant; each piece
    belongs to exactly one participant. Removing a piece is the only way to
    express "not bringing one."
11. There is no "not coming" / "not packed-because-absent" state. Absence from a
    trip is removal from the gear list, not a status.
12. Residence and status/stage are independent. Moving a container changes the
    residence of its contents but never their packing status; the two may
    disagree, and disagreement is reported rather than prevented.
13. A trip's packing arrangement never alters the home arrangement. Home and trip
    residence diverge freely until the unpack pass.

**History**

14. Closing a trip destroys nothing. Its packing arrangement and container
    journeys are **retained without effect** — inert because the trip is no longer
    active (§4), not erased — and its final decisions, unpack outcomes,
    consumed-counts, and kept notes are preserved as history. Reopening restores
    the arrangement rather than rebuilding it.
15. Deleting a trip requires a deliberate, confirmed act.

**Trip lifecycle and supply**

16. A trip's phase is set by a quartermaster and may move in either direction
    along `draft → pack-out → on trip → unpack → closed`. No phase locks any
    editing capability; the phase describes the trip, it does not govern it.
17. Only a trip in `pack-out`, `on trip`, or `unpack` is **active**. Only an
    active trip's packing arrangement is reported by whereabouts, and only its
    unresolved entries hold claims.
18. Closing requires every entry and every per-person piece to be resolved — open
    must be zero. Trip-only entries are excluded, taking no outcome. There is no
    override: `lost` is always an available and truthful answer, so the gate can
    never force a false one.
19. Leaving `closed` — reopening — is a deliberate, confirmed act, the same weight
    as deleting a trip.
20. Claims across active trips may not exceed the depot's supply of a piece of
    gear (§5.2). An over-claim is never a legitimate state; it is guarded against
    when adding, activating, and reopening, and — because it cannot be prevented
    across offline devices — is surfaced for a quartermaster to resolve when it
    arrives through sync. It is never resolved by discarding a write.

---

## 9. Operations and domain events

The meaningful things that happen, named in the ubiquitous language. (Events are
listed to fix the vocabulary of change, not to mandate an event-sourced or any
other implementation.)

**Inventory**

- _Place recorded / renamed / removed._
- _Gear recorded_ (as item or container), _renamed_, _retired_ (soft-delete),
  _restored_.
- _Gear re-homed_ — its home residence reference changes (§3).
- _Ownership set_ (personal-to-a-person / shared); _tag applied / removed_;
  _owned-count set_ (counted); _kind set_.
- _Person recorded / renamed._

**Trip planning**

- _Trip created_ (with a name); _participant added / removed._
- _Trip dates set / cleared._
- _Trip phase moved_ — forward or back, along `draft → pack-out → on trip →
  unpack → closed`; _trip reopened_ is the confirmed backward move out of
  `closed`.
- _Over-claim surfaced / resolved_ — the latter by removing the contested entry
  from one of the claiming trips.
- _Entry added to gear list_ — from depot gear, or as trip-only.
- _Entry removed_; _per-person piece removed / restored._
- _Bring-count set_ (counted entry).
- _Pre-trip task added / ticked / unticked._

**Packing**

- _Entry (or piece) packing-status changed._
- _Entry / trip container moved_ — trip residence changes.
- _Container journey moved_ — its stage advances and its contents' residence
  rides along, in one action.

**Notes, closing, templating**

- _Trip note posted_ (optionally about an entry); _note kept / discarded_ at
  unpack.
- _Unpack outcome recorded / changed / cleared_ — `back`, `consumed`, or `lost`,
  on an entry or a per-person piece.
- _Consumed-count set_ (counted entry resolved as consumed); _owned-count
  reduction applied_ at the close, and _offered_ if the outcome later changes.
- _Trip unpacked and closed_ — the unpack pass: gear re-homed, outcomes recorded,
  notes reviewed, trip retained as history with its arrangement and journeys made
  inert rather than cleared.
- _Trip started from_ a past trip — new trip takes over gear list, bring-counts,
  tasks (unticked), and kept notes; packing, journeys, unpack outcomes,
  consumed-counts, and dates all start fresh.
- _Trip deleted_ — deliberate, confirmed.

---

## 10. Seams

Where Later features will attach, named so the MVP model leaves clean joins and
builds nothing ahead of need. The recurring shape: **the trip is a low-friction
inbox; the depot is the curated destination** — several seams are _promotions_
from the former to the latter.

- **Configurable status** (story 20) — the fixed packing-status and
  journey-stage sets become per-trip editable. The MVP's fixed sets are the seed
  values of that mechanism, not hard-coded branches, so no rewrite is owed. _(Open
  question 1.)_
- **Promote a note** (stories 12, 17–19) — a trip note becomes a durable depot
  record: a maintenance need, a wishlist entry, or a retirement. The entry
  reference on a note is the join.
- **Promote trip-only gear** (story 21) — a trip-only piece becomes depot gear,
  and past occurrences of the same piece link back to the new entry. Trip-only
  entries are the join.
- **Gear history** (story 33) — an append-only account of one piece of gear's
  life, **derived** from the changes already recorded rather than kept as a second
  record. The join is that every change is attributable and timed; the model owes
  no new state, only the discipline of never squashing that away.
- **Saved slices** (story 34) — the filter combinations of story 13 made durable
  and named. The join is story 13's criteria; making them storable is what turns
  the filter language into data that must tolerate its own referents disappearing.
- **Bulk operations** (story 35) — acting on many pieces of gear at once needs
  **no seam at all**: move, tag, set owner, and retire already exist as
  single-gear operations (§9), and containment (§3) already makes the commonest
  bulk case — re-homing a whole crate — a single move. Noted here only so nobody
  models it twice.
- **Maintenance / Wishlist / Retirement views** (stories 17–19) — depot-level
  lists and states that build on the soft-delete and the promotion joins already
  present.
- **Weight** (stories 16, 25) — an optional attribute on gear and on containers'
  own selves; container totals compose from contents plus own weight. A pure
  addition to gear, unrecorded until used.
- **Conditional entry** (story 22) — an entry marked as depending on
  circumstances, settled near departure. Whether this is a distinct mechanism or
  merely a user-defined status once statuses are editable is deliberately left
  open. _(Open question 2.)_
- **Carry assignment** (story 23) — who carries which gear; an attribution over
  entries and participants.
- **Sharing** (story 24) — a separate published-projection context exposing only
  a safe subset of a trip under a generic public title. Modelled apart precisely
  so the private model cannot leak.

---

## 11. Carried-forward open questions

Flagged in the stories, to settle when their feature is designed — not now.

1. **Migration to editable statuses.** §7's fixed sets must grow into story 20's
   per-trip CRUD without a data rewrite. Honoured here by treating the fixed sets
   as seed values of a mechanism; the mechanism itself is unbuilt.
2. **Conditional entry vs. custom status.** Once statuses are editable, is a
   conditional entry (story 22) just a user-defined status, or a distinct
   mechanism? Undecided.
3. **Per-person spares.** A per-person entry yields at most one piece per
   participant (invariant 10) and cannot also be counted, so a _backup_ of a
   per-person item (a second headlamp on a solo trip) has no clean expression.
   The MVP escape hatch is a trip-only "spare" entry, at the cost of not linking
   to the real depot gear. If it proves real, the likely home is a trip-scoped
   spare notion on per-person entries — not a change to the three kinds. Parked,
   not built.
