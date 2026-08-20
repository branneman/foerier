# User Stories

**Persona:** _the Quartermaster_ — a household adult who manages the Depot and
outfits Trips. Both of us hold this role with equal powers; there are no other
user roles. People who join Trips (e.g. our kid) appear in stories as
_Participants_, not as users.

**Format:** As a Quartermaster, during _\<activity\>_, I want _\<capability\>_,
so that _\<value\>_.

**Terms.** Capitalised words — Gear, Container, Place, Trip, Gear list, Entry,
Piece, and the rest — are the domain's defined terms; each means exactly one
thing, spelled out in the [ubiquitous language](ubiquitous-language.md), with the
structure behind them in the [domain model](domain-model.md). (Enumerated status
values like `not packed` stay in code font, lowercase.) Stories stay
problem-level: they name needs and behaviour, not screens or storage. Where a
story touches something unresolved, it points to the
[Open questions](#open-questions). Sections tag scope: **MVP**, **Later**,
**Out of scope**.

---

## MVP

The smallest product that lets us retire the spreadsheets for one real Trip.

### 1. Record Places and Containers

As a Quartermaster, during Inventory management, I want to record the Places
where Gear lives — fixed spots (a shelf in the attic, "left top") and movable
Containers (crates, duffels, backpacks, stuff sacks) — including Containers
nested inside other Containers to any depth, so that every piece of Gear has a
known Home and the administration matches reality year-round.

Acceptance criteria:

- I can create, rename, and remove Places and Containers.
- **Containment is one universal relationship:** any Gear — an Item or a
  Container — Resides in a Container, at a Place, or Loose. A Container can hold
  other Containers, arbitrarily deep.
- **Home arrangement and Trip packing are independent.** Every piece of Gear has
  a Home — where it rests, and what it holds, year-round — separate from how it
  is packed on any Trip. A stuff sack can sit empty on a shelf at Home while, on
  a Trip, it holds clothing and rides inside the duffel — and that clothing's own
  Home is the wardrobe. So a Container's residence _and_ its contents can differ
  between Home and a Trip, and from one Trip to the next; a Container being
  "packed" says nothing about what it holds.
- Removing a Container or Place that still holds Gear confronts me with that Gear
  (it becomes Loose); nothing is silently lost.

### 2. Keep the Depot true

As a Quartermaster, during Inventory management, I want to keep the full Depot —
every piece of Gear recorded with its Home — and update it whenever Gear is
bought, moved, or reorganised, so that the Depot stays the trusted source of
truth we rely on.

Acceptance criteria:

- I can create, edit, and remove Gear; every piece of Gear has a Home.
- Recording that Gear moved to a new Home is a single small update, not
  re-typing the record.
- I can record how many of an identical piece of Gear we **own** — its
  Owned-count (three Helinox chairs) — as one record, instead of duplicates.
  (Distinct from how many we _bring_ on a Trip — story 7.)
- **Removing Gear is a soft-delete (it becomes Retired):** past Trips that
  referenced it keep their history intact. (Managing Retired Gear as its own view
  is story 19.)

### 3. Find Gear

As a Quartermaster, during Packing or during a Trip, I want to look up where a
piece of Gear currently is, so that I find things fast instead of searching
through bags.

Acceptance criteria:

- I can look up Gear by name and see its full Home path: which Container, inside
  which Container, at which Place.
- When Gear is packed for a Trip that is underway or being packed, its
  Whereabouts shows where it sits on the Trip — inside a Container, or Loose —
  instead of only its idle Home. (Whereabouts is derived on demand, never
  stored.)

### 4. People and Ownership

As a Quartermaster, during Inventory management, I want to record the household
People and mark Gear as one Person's Personal gear or as Shared, so that a solo
Trip can be outfitted from my Personal gear plus the Shared pool, and Gear of
People staying home stays out of the way.

Acceptance criteria:

- I can record People and mark any Gear as Personal-to-a-Person or Shared.
- I can view the Depot narrowed to one Person's Personal gear, or to Shared gear
  only.

### 5. Create a Trip with its Participants

As a Quartermaster, during Trip planning, I want to create a Trip and record
which People join it, so that planning fits who actually goes.

Acceptance criteria:

- I can create a Trip with at least a name that identifies it ("Camping
  Alps 2026").
- I can record which of the household People participate — its Participants — and
  change that later.

### 6. Build the Trip's Gear list from the Depot

As a Quartermaster, during Trip planning, I want to build the Trip's Gear list by
picking Gear from the Depot, plus adding Trip-only Gear that doesn't belong in
the Depot, so that the Trip shows only what is relevant — without me maintaining
a second copy of Gear details.

Acceptance criteria:

- I can add Depot Gear to a Trip as Entries and remove them again; the Depot
  itself is unaffected either way.
- Gear details live in one place: correcting a piece of Gear in the Depot is
  reflected wherever a Trip's Entry references it.
- I can add a Trip-only Entry (a rented ski helmet, a borrowed book) without it
  entering the Depot.
- Deciding not to bring something means **removing its Entry from the Trip** —
  there is no "not coming" state (story 9). Its absence is recoverable by
  filtering (story 13), and Promoting Trip-only Gear into the Depot is story 21.

### 7. Quantify Gear: Single, Per-person, or Counted

As a Quartermaster, during Inventory management and Trip planning, I want each
piece of Gear to be one of three Kinds — Single, Per-person, or Counted — so that
quantities behave correctly without me tracking duplicates by hand.

Acceptance criteria:

- Every piece of Gear is exactly one Kind, an intrinsic property of the Gear:
  - **Single** — one of it (the tent).
  - **Per-person** — one per Participant (the headlamp); behaviour on a Trip is
    story 8.
  - **Counted** — a quantity (four gas canisters, six energy bars, three
    chairs).
- The Kinds are mutually exclusive: Gear can never be both Counted and
  Per-person.
- For **Counted** Gear I can set a Bring-count — how many we _bring_ per Trip,
  independent of other Trips and of Owned-count (story 2). The Bring-count is
  visible while Packing.

### 8. Per-person Gear on a Trip

As a Quartermaster, during Trip planning and Packing, I want Per-person Gear to
become one Piece per Participant on the Trip, tracked separately, so that one
missing headlamp is obvious — and obvious _whose_ it is.

Acceptance criteria:

- Adding Per-person Gear to a Trip yields one Piece per Participant as a
  **starting default**, not a fixed rule.
- Each Participant's Piece can be removed individually, so a Per-person Entry can
  be brought by some Participants and not others (only one of us needs a
  headlamp; the kid doesn't carry their own yet). Removing a Piece _is_ "that
  Person isn't bringing one", consistent with story 6.
- While Packing I can see, per Person, whether their Piece is packed
  ("headlamp — me: packed; partner: not yet").

### 9. Track Packing status per Entry

As a Quartermaster, during Packing, I want to track each Entry's Packing status,
so that across a multi-day Packing effort I always see what is done and what is
left.

Acceptance criteria:

- Every Entry on the Gear list shows where it stands. The **MVP default statuses**
  are `not packed → staged → packed`; the guaranteed minimum is `not packed` and
  `packed`.
- A packed Entry is optionally inside a Container, or Loose.
- There is **no "not coming" status** — Gear not coming has its Entry removed
  from the Trip (story 6).
- I can see at a glance everything that still needs handling.
- In the MVP the status set is **fixed**; making it editable per Trip is
  story 20. The fixed defaults must migrate to that editable model without a
  rewrite — see [Open questions](#open-questions).

### 10. Move Containers through the Pack-out

As a Quartermaster, during Packing, I want to move a Container through the
Pack-out (attic → living-room staging floor → car) as one action, with
everything inside it moving along, so that multi-day staged Packing stays
trustworthy without re-marking every single piece of Gear.

Acceptance criteria:

- A Container follows its own Journey. The **MVP default stages** are
  `home → staging → car → packed`; the guaranteed minimum is `home` and `packed`.
- Moving a Container updates where everything inside it sits on the Trip — its
  Trip residence, nested Containers included — in one action.
- A Container's Journey stage is separate from what it contains: a "packed"
  Container can still hold nested Containers (story 1), and its contents keep
  their own Packing status (which may lag the Container's stage — that
  disagreement is shown, not forbidden).
- I can see where each of the Trip's Containers currently stands.
- Like Entry statuses, the stages are **fixed** in the MVP and made editable per
  Trip in story 20; the same migration requirement applies.

### 11. Unpack and close a Trip

As a Quartermaster, when a Trip ends, I want to walk the Gear back Home in a
deliberate Unpack pass that reverses the Journey, so that the Depot returns to
being the accurate year-round truth instead of drifting after every Trip.

Acceptance criteria:

- Closing a Trip happens through an **explicit Unpack pass** — a real step I work
  through, not an automatic wipe.
- During the Unpack pass each piece of Gear returns to its Home; anything that now
  lives somewhere new I can Re-home on the spot (the stuff sack came back into a
  different box; the clothing went back to the wardrobe).
- I review the Trip's **Notes** (story 12) as part of the pass — keeping the
  useful ones as reference and discarding the rest.
- Once the Trip is closed, its packed arrangement and Container Journeys are
  cleared, but the Trip is kept as history (story 14).
- Richer outcomes ride on Later features: Promoting a Note into a maintenance
  need (story 17), the wishlist (story 18), or a retirement (story 19); or
  dropping a Counted consumable that ran down (story 7).

### 12. Trip notes

As a Quartermaster, during and after a Trip, I want to jot low-friction Notes —
observations, reminders, half-formed ideas — against the Trip, so that what I
notice in the moment is captured before I forget it, without breaking stride.

Acceptance criteria:

- Adding a Note is low-friction free text; I can do it **mid-trip or after**
  ("ran low on gas", "the chair was useless", "warmer gloves next time").
- A Note can optionally be **about a specific Entry** on the Trip (this stove), or
  stand alone (the weather, the route).
- Notes persist with the Trip and **resurface when I Start a new Trip from it**
  (story 14), so reference Notes ("bring more gas"; "10 kg pack plus 20 km a day
  was too much") inform the next similar Trip.
- At the Unpack pass (story 11) I review the Trip's Notes and either **keep** them
  as reference or **discard** them.
- **Later**, a Note can be **Promoted** into a durable Depot action — onto the
  wishlist (story 18), into a retirement (story 19), or as a maintenance need
  (story 17) — turning a fleeting observation into a tracked outcome. The Trip is
  the low-friction inbox; the Depot is the curated destination. In the MVP Notes
  are captured and kept; promotion arrives with those features.

### 13. Tag the Depot and slice lists from many angles

As a Quartermaster, during Inventory management, Trip planning, and Packing, I
want to Tag Gear and then filter, sort, and group any list from many angles, so
that I can always work one slice at a time — all food, everything `bushcraft`,
all of our kid's Gear that is still unpacked, or everything not in any Trip.

Acceptance criteria:

- I can give a piece of Gear any number of **Tags** (`food`, `bushcraft`,
  `kitchen`). Tags are flat — no hierarchy or nesting. Trip-only Gear is not
  Tagged.
- I can narrow, sort, and group lists by at least: Tag, Person, Ownership
  (Personal/Shared), Kind (story 7), Packing status, Container, and Trip
  membership (e.g. "Gear not in any Trip").
- Criteria can combine ("her Gear that is not yet packed").
- What I see reflects the narrowing immediately and can be undone.

### 14. Trip history and templates

As a Quartermaster, during Trip planning, I want past Trips kept — protected
against casual deletion — and to Start a new Trip from a past one, so that
recurring Trip types (hüttentour, basecamp camping, ski) start from a proven list
instead of a blank page.

Acceptance criteria:

- Past Trips remain browsable with their final decisions.
- Deleting a Trip requires a deliberate, confirmed act; it is discouraged, not
  routine.
- A new Trip Started from a past one takes over its Gear list, Bring-counts,
  Pre-trip tasks, and kept reference Notes (story 12); Packing status and
  Container Journeys start fresh.

### 15. Pre-trip tasks

_(Deliberately the last MVP story; first to move to Later if the MVP grows too
heavy.)_

As a Quartermaster, during Trip planning and Packing, I want a per-Trip checklist
of non-gear Pre-trip tasks — charge the devices, check tire pressure, print the
hut vouchers, buy the vignette — so that getting out the door doesn't depend on
memory and loose notes.

Acceptance criteria:

- I can add Pre-trip tasks to a Trip and tick them off.
- A Trip Started from a past Trip takes over its task list, unticked.

---

## Later

Roughly in the order we expect to want them. The rich Weight analysis is
deliberately last.

### 16. Simple Weight totals

As a Quartermaster, during Trip planning, I want to optionally record Weight in
grams — for Gear _and_ for Containers themselves — and see the total per
Container, so that I know what a packed 60&nbsp;L backpack will weigh before I
lift it.

Acceptance criteria:

- Weight is optional per piece of Gear and per Container; things without a Weight
  show as gaps in a total, not silently counted as zero.
- A Container's total is its contents plus its own (empty) Weight.

### 17. Maintenance

As a Quartermaster, during Inventory management, I want to know which Gear needs
what upkeep and when — re-waterproof the shell jacket, wax the skis, backflush
the water filter — and mark upkeep as done, so that maintenance stops being
invisible and forgotten instead of surfacing as a surprise while Packing. This is
a visible _state of the Depot_, not a notification or to-do engine. The natural
moment to notice upkeep is the Unpack pass (story 11), where a Trip note
(story 12) can be Promoted straight into a maintenance need.

### 18. Wishlist / acquisition planning

As a Quartermaster, during Inventory management — and by Promoting Trip notes
(story 12) — I want a single want-list of Gear we might acquire, whether it
**replaces** an owned piece of Gear or is a **brand-new type** we don't own yet,
so that purchases are deliberate and the Depot doesn't drift or accumulate
doubles.

Acceptance criteria:

- The want-list is one durable, Depot-level list; there is no separate per-Trip
  wishlist.
- Want-list items range in maturity from a raw thought ("lighter stove?") to a
  named product ("BRS-3000T"), optionally marked as replacing a specific owned
  piece of Gear.
- I can add to it directly at any time, or by **Promoting a Trip note**
  (story 12): the Trip is a low-friction inbox, the want-list the curated
  destination. (Lower priority than maintenance.)

### 19. Retirement

As a Quartermaster, during Inventory management, I want to manage Retired Gear as
its own view — see it, and bring it back if needed — building on the soft-delete
that already protects history in the MVP (story 2), so that the active Depot
reflects today while the past stays true. A retirement can also be raised by
Promoting a Trip note (story 12) — "the old stove finally died", noticed at the
Unpack pass, becomes a retirement.

### 20. Configurable per-Trip statuses

As a Quartermaster, during Trip planning, I want to add, rename, and remove the
Packing statuses (story 9) and Container Journey stages (story 10) **per Trip** —
extra states for a big expedition (a ski trip's real "pack on departure day", or
"staged near the bag"), just the basics for a weekend — so that the state machine
fits the Trip instead of the Trip bending to fixed states. This must evolve from
the MVP's fixed defaults without a data migration rewrite.

### 21. Promote Trip-only Gear into the Depot

As a Quartermaster, during or after a Trip, I want to Promote Trip-only Gear into
the permanent Depot and have past occurrences of that same Gear link back to the
new Depot record, so that a thing that earned its place stops being re-typed
every Trip. (In the MVP this is done by hand — story 2 + story 6.)

### 22. Conditional Entries

As a Quartermaster, during Trip planning, I want to mark Entries on a Gear list
as conditional on circumstances ("only if heavy rain is expected: tarp, pegs,
poles") and settle the condition close to departure, so that one planned Trip
covers its weather variants. Judging the conditions themselves stays where it
belongs: weather apps and local knowledge.

### 23. Carry assignment

As a Quartermaster, during Trip planning for load-carrying Trips, I want to
assign who carries what, so that when our kid can't carry all their own Gear on a
hüttentour, its distribution over our packs is decided ahead instead of at the
trailhead.

### 24. Share a Trip as a read-only public link

As a Quartermaster, during or after Trip planning, I want to publish a Trip's
Gear list as a read-only link I can send to outsiders — showing only a safe,
limited subset — so that I can share a packing list the way I used to share a
copied, generically-named Google Doc, without exposing our household, our home,
or the fact that we are away.

Acceptance criteria:

- A Trip is **private by default**; it becomes viewable to outsiders only through
  an explicit action that generates a **unique, unguessable link**. That link
  gives a no-login, read-only view; there is no public listing or search.
- The link is **revocable**: removing it makes the URL dead, and regenerating
  produces a fresh id. The link is treated as **effectively public** — anyone it
  reaches can view it, and it may be forwarded or indexed, so the shared subset
  must be safe under that assumption.
- I set a **separate public title** for the share (e.g. "Ski trip packing list"),
  defaulting to a generic label — never the Trip's real name, and **never a
  date**.
- The share includes only a safe subset:
  - **Included:** Gear names; quantities (Counted Bring-counts; Per-person Gear
    shown generically as one-per-Person, without Participant names); grouping by
    Tag; grouping by Container (Container name only); and Gear Weight if recorded
    (story 25).
  - **Excluded:** Packing status; the Container Journey and where things are
    packed; Home and storage locations (of Gear and of Containers); Participant
    names and Ownership; Pre-trip tasks; Trip notes; and any other free-text.

### 25. Rich Weight analysis

As a Quartermaster, during planning of weight-critical Trips, I want the full
weight discipline our ultralight sheet does by hand — base weight excluding
consumables and worn clothing, per-Person carried totals, and what-if comparisons
of want-list replacements ("this stove saves 213 g") — so that cutting weight is
analysis, not archaeology.

---

## Out of scope

- **Lending Gear to friends.** Decided against; friends won't be pushed into our
  tool, and a loan administration isn't worth it at our scale.
- **Weather data or forecasts.** Judging conditions happens in weather apps and
  with local mountain knowledge; foerier only carries the _consequences_
  (story 22).
- **Route planning.** Different problem, well served elsewhere.
- **Campsite/hut booking.** Same.
- **Friend-facing accounts or collaboration.** No accounts, editing, or
  interactive workflows for people outside the household. The one deliberate
  exception is the read-only public share link (story 24): outsiders can _view_ a
  limited list, never log in, comment, or change anything.

---

## Open questions

Unresolved points from the brainstorm — to settle before or during design, not
now. (Most of the original questions are now resolved and folded into the stories
above.)

1. **Migration path to editable statuses.** The MVP's fixed statuses (stories 9,
   10) must grow into per-Trip CRUD (story 20) without a rewrite. The
   [domain model](domain-model.md) treats the fixed sets as seed values of the
   future mechanism (§7); the forward-compatibility still has to be proven out
   when the model is realised in code.
2. **Conditional Entries vs. custom statuses.** Once statuses are editable
   (story 20), is a Conditional Entry (story 22) just a user-defined status, or a
   distinct mechanism?
3. **Extra/spare Pieces of Per-person Gear.** Per-person Gear yields exactly one
   Piece per Participant (stories 7, 8) and cannot also be Counted. So a backup of
   Per-person Gear — e.g. a solo Trip carrying a second headlamp loaned from a
   partner who isn't coming — has no clean expression. The MVP escape hatch is a
   Trip-only "spare" Entry (story 6), at the cost of it not linking to the real
   Depot Gear. If this ever proves real, the likely home is a Trip-scoped
   "spare/extra" notion on Per-person Entries, not a change to the three Kinds.
   Niche and possibly hypothetical — parked, not built.
