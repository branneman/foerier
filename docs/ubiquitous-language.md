# Ubiquitous Language

The shared vocabulary of foerier. Every term here means exactly one thing, in
code, in conversation, and in the [user stories](user-stories.md). When a word
in this list is used, it carries the definition below and no other; when a
concept in this list is meant, this word is used and no synonym.

This is a glossary, not a model. How these concepts are structured — what is an
aggregate, what references what, which invariants hold — lives in
[domain-model.md](domain-model.md).

**Two conventions:**

- **Refinement of the README.** The README uses _gear_ loosely as a synonym for
  _items_. Here **gear** is promoted to the umbrella for anything owned — an
  item _or_ a container. (A small README touch-up will follow.)
- **Informal glosses are marked.** A few everyday words (_item_, _trip item_)
  are looser than the precise terms and are kept only as colloquial synonyms,
  noted as such. Prefer the precise term in code and docs.

---

## Roles

- **Quartermaster** — a household adult who manages the depot and outfits trips.
  Both household adults hold this role with equal powers; it is the only user
  role. The name is the app's namesake (_foerier_, Dutch for the quartermaster
  who runs a gear depot and issues equipment for a mission).

- **Person** — a member of the household who may join trips. People are recorded
  so gear can be attributed and trips can be staffed. A person is not
  necessarily a quartermaster (e.g. a child joins trips but manages nothing).

- **Participant** — a person taking part in one specific trip. "Person" is the
  household-level identity; "participant" is that person's role on a given trip.

---

## The depot

- **Depot** — the household's entire owned inventory of gear, together with where
  it all lives: the year-round source of truth. What foerier keeps accurate the
  whole year round, not just while a trip is being packed.

- **Inventory management** — the year-round activity of keeping the depot true:
  recording, moving, re-homing, tagging, and retiring gear. Distinct from trip
  planning and packing, which draw _from_ the depot without changing it.

---

## Gear

- **Gear** — any single owned thing in the depot; the umbrella term. A piece of
  gear has a home, an owner, a kind, tags, and (later) a weight. Every piece of
  gear is either an item or a container — the difference is only whether it can
  hold other gear.

- **Item** _(informal gloss)_ — a plain piece of gear that does not hold other
  gear: a leaf. Everyday speech (and older stories) say "item" for gear in
  general; precisely, an item is gear _without_ the containment trait. Use
  **gear** when you mean anything owned, **item** only when you mean specifically
  a non-container.

- **Container** — a piece of gear that can hold other gear: a crate, duffel,
  backpack, or stuff sack. A container is still gear — owned, homed, ownable by a
  person — it simply also has the **containment trait**. On a trip a container
  travels a **journey** (below) instead of carrying a plain packing status.

- **Containment trait** — the capacity of a piece of gear to hold other gear.
  What makes a piece of gear a container rather than an item. The one thing that
  distinguishes the two.

---

## Places and where things are

- **Place** — a fixed, un-owned storage location: a shelf in the attic, "left
  top." A place is not gear — you do not own it, pack it, or take it on a trip.
  Places are the fixed roots that the home arrangement hangs from.

- **Resides in** — the relationship "this piece of gear sits in _that_ location."
  A piece of gear resides in exactly one location: a place, a container, or
  nowhere. This single relationship is universal — it holds over items and
  containers alike, and containers can reside in containers to any depth.

- **Loose** — residing in no place and in no container: a root with no home set.
  A legitimate resting state, not an error.

- **Home arrangement** — where every piece of gear rests and what every container
  holds, year-round: the depot's physical layout. Also called a piece of gear's
  **home**. It is separate from, and unaffected by, how anything is packed on a
  trip.

- **Whereabouts** — where a piece of gear _currently_ is, computed on demand: its
  trip residence on an active trip if it is packed for one, otherwise its home.
  Nothing stores "current location"; whereabouts is always derived.

---

## Ownership

- **Owner / ownership** — whose gear a piece is: **personal** to one person, or
  **shared**. An intrinsic attribute of the gear, recorded in the depot.

- **Personal gear** — gear belonging to one specific person (boots, a sleeping
  bag). Relevant to a trip only when that person participates.

- **Shared pool** — the gear owned jointly by the household, belonging to no one
  person (the tent, the stove). Available to any trip.

---

## The shape of a piece of gear

- **Kind** — the intrinsic classification of a piece of gear as exactly one of
  **single**, **per-person**, or **counted**. Mutually exclusive; a property of
  the gear itself, not of any trip.

  - **Single** — there is one of it (the tent).
  - **Per-person** — conceptually one per participant (the headlamp). On a trip
    it fans out into **pieces** (below).
  - **Counted** — tracked as a quantity (gas canisters, energy bars, chairs),
    rather than as duplicate entries.

- **Owned-count** — for counted gear, how many identical units the household
  owns (three Helinox chairs as one entry). A depot fact. Distinct from
  bring-count.

- **Tag** — a flat, free-form label on a piece of gear used to slice lists
  (`food`, `bushcraft`, `kitchen`). Tags have no hierarchy or nesting. A piece of
  gear may carry any number of them. Trip-only gear (below) is not tagged.

- **Weight** _(Later)_ — an optional mass in grams, recordable per piece of gear
  and, for a container, for its own empty self. Never the point of the tool; a
  supporting attribute only.

- **Retired** — gear removed from the active depot but preserved, so past trips
  that referenced it keep their history intact. Removing gear is always a
  **soft-delete**, never a hard erase. (Managing retired gear as its own view is
  a Later concern.)

---

## Trips

- **Trip** — a named undertaking outfitted from the depot: its participants, its
  gear list, its packing progress, its tasks, and its notes. A trip is kept after
  it ends, both as history and as a template for the next similar one.

- **Trip planning** — the activity of setting up a trip: choosing participants,
  building its gear list, setting quantities and tasks. Precedes packing.

- **Gear list** — everything a trip takes: the trip's selection drawn from the
  depot, plus any trip-only pieces. The trip's own view of relevant gear, held
  without copying gear details out of the depot.

- **Entry** — one line on a gear list. An entry references a piece of depot gear
  (or is a trip-only piece) and carries that gear's **trip state** — packing
  status, trip residence, and, for a counted entry, its bring-count. An entry
  may reference an item or a container.

  - **Trip item** _(informal gloss)_ — everyday name for the common case, an
    entry that references an item. Not the primary term: an entry can equally
    reference a container, which is not an item.

- **Trip-only gear** — a piece of gear that exists solely within one trip and
  never enters the depot: a rented ski helmet, a borrowed book. It appears as an
  entry, is not tagged, and cannot be referenced by any other trip. (Promoting
  one into the depot is a Later concern.)

- **Piece** — for a per-person entry, one participant's individual copy, tracked
  on its own (with its own packing status). Adding per-person gear to a trip
  yields one Piece per participant as a starting default; each Piece can be
  removed individually. A removed Piece _is_ "that person isn't bringing one."

  Note the narrow sense: **Piece** (capitalised) is only this per-participant
  copy. The lowercase phrase "a piece of gear" is ordinary English for a single
  owned thing — a unit of **Gear** — and is not this term.

- **Bring-count** — for a counted entry, how many of it _this trip_ takes,
  independent of other trips and of owned-count. A trip fact, visible while
  packing. Distinct from owned-count.

---

## Packing

- **Packing** — the multi-day activity of readying a trip's gear: filling
  containers, moving them toward the car, and tracking what is done.

- **Trip residence** — where an entry or a container sits _within a trip's own
  packing world_: in a trip container, or loose on the trip. The trip-scoped
  instance of **resides in**, independent of the gear's home arrangement and of
  any other trip's packing. (What **Whereabouts** reports while a trip is
  active.)

- **Packing status** — how far along an entry (or a per-person piece) is in
  packing. The MVP set is `not packed → staged → packed`; the guaranteed minimum
  is `not packed` and `packed`. Fixed in the MVP. Says _how far along_, not
  _where_ — those are separate tracks.

- **Journey / journey stage** — how far along a _container_ is in the pack-out.
  The MVP set is `home → staging → car → packed`; the guaranteed minimum is
  `home` and `packed`. A container has a journey where a plain entry has a
  packing status. Fixed in the MVP.

- **Pack-out** — the container's physical passage from attic to living-room
  staging floor to car. Moving a container along its journey moves everything
  inside it in one action, nested containers included.

---

## Closing a trip

- **Unpack pass** — the deliberate, worked-through step that closes a trip:
  walking each piece of gear back to its home, re-homing on the spot anything
  that now lives somewhere new, and reviewing the trip's notes. A real pass, not
  an automatic wipe. Returns the depot to being the accurate year-round truth.

- **Re-home** — during the unpack pass, to record that a piece of gear's home has
  changed (the stuff sack came back into a different box). A single small update
  to the home arrangement.

- **Trip note** — a low-friction free-text jotting against a trip — an
  observation, reminder, or half-formed idea — added mid-trip or after. A note
  may optionally be _about_ a specific entry, or stand alone. Notes are reviewed
  at the unpack pass and either **kept** as reference or **discarded**; kept notes
  resurface when a new trip starts from this one.

- **Pre-trip task** — a non-gear checklist item on a trip: charge the devices,
  check tire pressure, buy the vignette. Ticked off as done.

---

## History and templates

- **Trip history** — past trips, kept and browsable with their final decisions,
  protected against casual deletion. Deleting a trip is a deliberate, confirmed
  act, not routine.

- **Start from** _(template)_ — creating a new trip from a past one. The new trip
  takes over the past trip's gear list, bring-counts, pre-trip tasks (unticked),
  and kept reference notes; its packing progress and container journeys start
  fresh.

---

## Named seams (Later — not modelled yet)

These name the future without building it. They exist here so the model can
leave clean joins for them; the depot is the low-friction inbox, the curated
lists are their destinations.

- **Promote** — to turn a fleeting capture into a durable record: a trip note
  into a maintenance need, a wishlist entry, or a retirement; or a trip-only
  piece of gear into a depot entry that past occurrences link back to.
- **Maintenance need** — a known item of upkeep owed on a piece of gear
  (re-waterproof the shell, wax the skis). A visible state of the depot.
- **Wishlist** — one durable, depot-level want-list of gear that might be
  acquired, whether replacing an owned piece or a brand-new type.
- **Configurable status** — the packing statuses and journey stages made
  editable per trip, grown from the MVP's fixed sets without a rewrite.
- **Conditional entry** — a part of a gear list marked as depending on
  circumstances ("only if heavy rain: tarp"), settled close to departure.
- **Carry assignment** — who carries which gear on a load-carrying trip.
- **Share link** — a read-only, unguessable public link exposing only a safe,
  limited subset of a trip, under a generic **public title** (never the real trip
  name, never a date). A separate published-projection world with its own,
  deliberately narrow language.
