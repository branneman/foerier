# User Stories

**Persona:** _the quartermaster_ — a household adult who manages the gear depot
and outfits trips. Both of us hold this role with equal powers; there are no
other user roles. People who join trips (e.g. our kid) appear in stories
as _participants_, not as users.

**Format:** As a quartermaster, during _\<activity\>_, I want _\<capability\>_,
so that _\<value\>_.

Stories are deliberately problem-level: no data model, no schema, no UI
decisions. Where a story touches something unresolved, it points to the
[Open questions](#open-questions). Sections tag scope: **MVP**, **Later**,
**Out of scope**.

---

## MVP

The smallest product that lets us retire the spreadsheets for one real trip.

### 1. Record storage places and containers

As a quartermaster, during inventory management, I want to record the places
where gear lives — fixed storage spots (a shelf in the attic, "left top") and
movable containers (crates, duffels, backpacks, stuff sacks) — including
containers nested inside other containers to any depth, so that every item has
a known home and the administration matches reality year-round.

Acceptance criteria:

- I can create, rename, and remove storage spots and containers.
- **Containment is one universal relationship:** anything — an item or a
  container — is either inside a container, at a storage spot, or loose. A
  container can hold other containers, arbitrarily deep.
- **Home arrangement and trip packing are independent.** Every item and
  container has a home arrangement — where it rests, and what it holds,
  year-round — that is separate from how it is packed on any given trip. A stuff
  sack can sit empty on a shelf at home while, on a trip, it holds clothing and
  rides inside the duffel — and that clothing's own home is the wardrobe. So a
  container's location _and_ its contents can differ between home and a trip, and
  can differ from one trip to the next; a container being "packed" says nothing
  about what it holds.
- Removing a container or spot that still holds gear confronts me with that
  gear; nothing is silently lost.

### 2. Keep the item inventory

As a quartermaster, during inventory management, I want to keep the full gear
inventory — every item recorded with its home location — and update it whenever
gear is bought, moved, or reorganized, so that the inventory stays the trusted
source of truth we rely on.

Acceptance criteria:

- I can create, edit, and remove items; every item has a home location.
- Recording that an item moved to a new home is a single small update, not a
  re-entry of the item.
- I can record how many of an identical item we **own** as one entry (three
  Helinox chairs), instead of duplicate entries. (Distinct from how many we
  _bring_ on a trip — story 7.)
- **Removing an item is a soft-delete:** past trips that referenced it keep
  their history intact. (Managing retired gear as its own view is story 19.)

### 3. Find an item

As a quartermaster, during packing or during a trip, I want to look up where an
item currently is, so that I find things fast instead of searching through
bags.

Acceptance criteria:

- I can look up an item by name and see its full home path: which container,
  inside which container, at which spot.
- When an item is packed for a trip that is underway or being packed, I see
  where it is packed — inside a container, or loose — instead of only its idle
  home.

### 4. People and ownership

As a quartermaster, during inventory management, I want to record the household
people and mark gear as one person's personal gear or as shared, so that a solo
trip can be outfitted from my personal gear plus the shared pool, and gear of
people staying home stays out of the way.

Acceptance criteria:

- I can record people and mark any item as personal-to-a-person or shared.
- I can view the inventory narrowed to one person's personal gear, or to
  shared gear only.

### 5. Create a trip with its participants

As a quartermaster, during trip planning, I want to create a trip and record
which people join it, so that planning fits who actually goes.

Acceptance criteria:

- I can create a trip with at least a name that identifies it ("Camping
  Alps 2026").
- I can record which of the household people participate, and change that
  later.

### 6. Build the trip gear list from the inventory

As a quartermaster, during trip planning, I want to build the trip's gear list
by picking items from the inventory, plus adding trip-only items that don't
belong in the inventory, so that the trip shows only what is relevant — without
me maintaining a second copy of item details.

Acceptance criteria:

- I can add inventory items to a trip and remove them again; the inventory
  itself is unaffected either way.
- An item's details live in one place: correcting an item in the inventory is
  reflected wherever a trip uses it.
- I can add an item to a trip only (a rented ski helmet, a borrowed book)
  without it entering the inventory.
- Deciding not to bring something means **removing it from the trip** — there
  is no "not coming" state (story 9). Its absence is recoverable by filtering
  (story 12), and promoting a trip-only item to the inventory is story 21.

### 7. Quantify an item: single, per-person, or counted

As a quartermaster, during inventory management and trip planning, I want each
item to be one of three kinds — a single thing, a per-person thing, or a
counted thing — so that quantities behave correctly without me tracking
duplicates by hand.

Acceptance criteria:

- Every item is exactly one kind, an intrinsic property of the item:
  - **Single** — one of it (the tent).
  - **Per-person** — one per participant (the headlamp); behaviour on a trip is
    story 8.
  - **Counted** — a quantity (four gas canisters, six energy bars, three
    chairs).
- The kinds are mutually exclusive: an item can never be both counted and
  per-person.
- For a **counted** item I can set how many we _bring_ per trip, independent of
  other trips and of how many we own (story 2). The bring-count is visible
  while packing.

### 8. Per-person items on a trip

As a quartermaster, during trip planning and packing, I want a per-person item
to become one piece per participant on the trip, tracked separately, so that
one missing headlamp is obvious — and obvious _whose_ it is.

Acceptance criteria:

- Adding a per-person item to a trip yields one piece per participant.
- While packing I can see, per person, whether their piece is packed
  ("headlamp — me: packed; partner: not yet").

### 9. Track packing status per item

As a quartermaster, during packing, I want to track each trip item's packing
progress, so that across a multi-day packing effort I always see what is done
and what is left.

Acceptance criteria:

- Every item on the trip list shows where it stands. The **MVP default
  statuses** are `not packed → staged → packed`; the guaranteed minimum is
  `not packed` and `packed`.
- A packed item is optionally inside a container, or loose.
- There is **no "not coming" status** — an item not coming is removed from the
  trip (story 6).
- I can see at a glance everything that still needs handling.
- In the MVP the status set is **fixed**; making it editable per trip is
  story 20. The fixed defaults must be able to migrate to that editable model
  without a rewrite — see [Open questions](#open-questions).

### 10. Move containers through the pack-out journey

As a quartermaster, during packing, I want to move a container through the
pack-out journey (attic → living-room staging floor → car) as one action, with
everything inside it moving along, so that multi-day staged packing stays
trustworthy without re-marking every single item.

Acceptance criteria:

- A container follows its own journey. The **MVP default stages** are
  `home → staging → car → packed`; the guaranteed minimum is `home` and
  `packed`.
- Moving a container updates the whereabouts of everything inside it — nested
  containers included — in one action.
- A container's journey stage is separate from what it contains: a "packed"
  container can still hold nested containers (story 1).
- I can see where each of the trip's containers currently stands.
- Like item statuses, the stages are **fixed** in the MVP and made editable per
  trip in story 20; the same migration requirement applies.

### 11. Unpack and close a trip

As a quartermaster, when a trip ends, I want to walk the gear back home in a
deliberate unpack pass that reverses the journey, so that the inventory returns
to being the accurate year-round truth instead of drifting after every trip.

Acceptance criteria:

- Closing a trip happens through an **explicit unpack pass** — a real step I
  work through, not an automatic wipe.
- During unpack each item returns to its home location; anything that now lives
  somewhere new I can re-home on the spot (the stuff sack came back into a
  different box; the clothing went back to the wardrobe).
- Once the trip is closed, its packed arrangement and container journeys are
  cleared, but the trip is kept as history (story 13).
- Richer unpack observations ride on Later features and are out of the minimal
  pass: flagging that an item needs upkeep (story 17), or that a counted
  consumable ran down (story 7).

### 12. Tag inventory and slice lists from many angles

As a quartermaster, during inventory management, trip planning, and packing, I
want to tag inventory items and then filter, sort, and group any list from many
angles, so that I can always work one slice at a time — all food, everything
`bushcraft`, all of our kid's gear that is still unpacked, or everything not in
any trip.

Acceptance criteria:

- I can give an inventory item any number of **tags** (`food`, `bushcraft`,
  `kitchen`). Trip-only items are not tagged.
- I can narrow, sort, and group lists by at least: tag, person, ownership
  (personal/shared), item kind (story 7), packing status, container, and
  trip membership (e.g. "items not in any trip").
- Criteria can combine ("her gear that is not yet packed").
- What I see reflects the narrowing immediately and can be undone.

### 13. Trip history and templates

As a quartermaster, during trip planning, I want past trips kept — protected
against casual deletion — and to start a new trip from a past one, so that
recurring trip types (hüttentour, basecamp camping, ski) start from a proven
list instead of a blank page.

Acceptance criteria:

- Past trips remain browsable with their final decisions.
- Deleting a trip requires a deliberate, confirmed act; it is discouraged, not
  routine.
- A new trip started from a past one takes over its gear list, bring-counts,
  and pre-trip tasks; packing progress and container journeys start fresh.

### 14. Pre-trip tasks

_(Deliberately the last MVP story; first to move to Later if the MVP grows too
heavy.)_

As a quartermaster, during trip planning and packing, I want a per-trip
checklist of non-gear tasks — charge the devices, check tire pressure, print
the hut vouchers, buy the vignette — so that getting out the door doesn't
depend on memory and loose notes.

Acceptance criteria:

- I can add tasks to a trip and tick them off.
- A trip started from a past trip takes over its task list, unticked.

---

## Later

Roughly in the order we expect to want them. The rich weight analysis is
deliberately last.

### 15. Simple weight totals

As a quartermaster, during trip planning, I want to optionally record weight in
grams — for items _and_ for containers themselves — and see the total per
container, so that I know what a packed 60&nbsp;L backpack will weigh before I
lift it.

Acceptance criteria:

- Weight is optional per item and per container; things without a weight show
  as gaps in a total, not silently counted as zero.
- A container's total is its contents plus its own (empty) weight.

### 16. Post-trip learnings

As a quartermaster, after a trip, I want to record what we learned ("10 kg pack
plus 20 km a day is too much"; "if rain is likely: bring the tarp and a chair")
attached to that trip, so that the lesson resurfaces when I start a similar
trip from it.

### 17. Maintenance

As a quartermaster, during inventory management, I want to know which items need
what upkeep and when — re-waterproof the shell jacket, wax the skis, backflush
the water filter — and mark upkeep as done, so that maintenance stops being
invisible and forgotten instead of surfacing as a surprise while packing. This
is a visible _state of the depot_, not a notification or to-do engine. The
natural moment to notice upkeep is the unpack pass (story 11).

### 18. Wishlist / acquisition planning

As a quartermaster, during inventory management, I want a want-list of gear I
might acquire — whether it **replaces** an owned item or is a **brand-new type**
we don't own yet — so that purchases are deliberate and the depot doesn't drift
or accumulate doubles. (Lower priority than maintenance.)

### 19. Retirement

As a quartermaster, during inventory management, I want to manage retired gear
as its own view — see it, and bring it back if needed — building on the
soft-delete that already protects history in the MVP (story 2), so that the
active depot reflects today while the past stays true.

### 20. Configurable per-trip statuses

As a quartermaster, during trip planning, I want to add, rename, and remove the
packing statuses (story 9) and container journey stages (story 10) **per trip**
— extra states for a big expedition, just the basics for a weekend — so that the
state machine fits the trip instead of the trip bending to fixed states. This
must evolve from the MVP's fixed defaults without a data migration rewrite.

### 21. Promote a trip-only item into inventory

As a quartermaster, during or after a trip, I want to promote a trip-only item
into the permanent inventory and have past occurrences of that same item link
back to the new inventory entry, so that a thing that earned its place stops
being re-typed every trip. (In the MVP this is done by hand — story 2 + story 6.)

### 22. Conditional load-outs

As a quartermaster, during trip planning, I want to mark parts of a trip list
as conditional on circumstances ("only if heavy rain is expected: tarp, pegs,
poles") and settle the condition close to departure, so that one planned trip
covers its weather variants. Judging the conditions themselves stays where it
belongs: weather apps and local knowledge.

### 23. Carry assignment

As a quartermaster, during trip planning for load-carrying trips, I want to
assign who carries what, so that when our kid can't carry all their own gear
on a hüttentour, its distribution over our packs is decided ahead instead of at
the trailhead.

### 24. Rich weight analysis

As a quartermaster, during planning of weight-critical trips, I want the full
weight discipline our ultralight sheet does by hand — base weight excluding
consumables and worn clothing, per-person carried totals, and what-if
comparisons of want-list replacements ("this stove saves 213 g") — so that
cutting weight is analysis, not archaeology.

---

## Out of scope

- **Lending gear to friends.** Decided against; friends won't be pushed into
  our tool, and a loan administration isn't worth it at our scale.
- **Weather data or forecasts.** Judging conditions happens in weather apps and
  with local mountain knowledge; foerier only carries the _consequences_
  (story 22).
- **Route planning.** Different problem, well served elsewhere.
- **Campsite/hut booking.** Same.
- **Friend-facing features.** No accounts, sharing, or workflows for people
  outside the household.

---

## Open questions

Unresolved points from the brainstorm — to settle before or during design, not
now. (Most of the original questions are now resolved and folded into the
stories above.)

1. **Exact MVP status labels.** Story 9 proposes items `not packed → staged →
   packed` and story 10 proposes containers `home → staging → car → packed`.
   Are those the right defaults? And is "pack on departure day" (from the ski
   sheet) a status, or really a pre-trip task (story 14)?
2. **Migration path to editable statuses.** The MVP's fixed statuses (stories 9,
   10) must grow into per-trip CRUD (story 20) without a rewrite. This is a
   forward-compatibility constraint to honor whenever the data model is
   designed — flagged here so it isn't forgotten.
3. **Conditional items vs. custom statuses.** Once statuses are editable
   (story 20), is a conditional/"maybe" item (story 22) just a user-defined
   status, or a distinct mechanism?
4. **Tag shape.** Flat tags only, or is any grouping/hierarchy wanted (e.g. a
   `food` family, or tag namespaces)? Flat is assumed until proven insufficient.
