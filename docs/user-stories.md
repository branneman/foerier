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

**Numbers are names, not an order.** A story's number is a stable identifier
assigned once and never reused or reshuffled. A new story takes the next unused
number and is placed where it belongs by topic and scope — so the backlog reads
`26, 27, …, 31, 1, 2, 3, …` where the auth slice comes first. Reading order is
the document's order; the numbers only have to stay unique, so that every
reference to "story 9" keeps pointing at the same story forever.

---

## MVP

The smallest product that lets us retire the spreadsheets for one real Trip.

### 26. Sign in to my Household

As a Quartermaster, whenever I open foerier, I want to sign in without a
password — and then stay signed in on that Device — so that reaching our Gear is
one tap and never a hurdle in a cold garage or a hut with no signal.

Acceptance criteria:

- Signing in on a Device that holds a Passkey takes one deliberate action and no
  typed name or password. Whether the Passkey lives in the device itself or in
  my password manager makes no difference to me.
- Once signed in, that Device stays signed in indefinitely; ordinary use — days
  offline included — never asks me to sign in again.
- Being offline never blocks anything I do with my Household's records; only
  syncing waits for a connection.
- If my Device's access is ever withdrawn (story 30), the app says so plainly and
  asks me to sign in again. **Nothing I recorded is lost:** work done offline and
  not yet synced survives, and is synced once I am back in.
- Nothing about my Household is readable on a signed-out Device.

### 27. Join a Household from an Invite

As a Person invited into a Household, during setup, I want to turn a link
someone sent me into my own Login, so that I can start keeping the Depot without
anyone handing round a shared account.

Acceptance criteria:

- An Invite is a link I open once, on the Device I want to use. It names the
  Household I am joining and which Person I will be.
- Redeeming is a deliberate act on my part: merely opening or previewing the link
  — as a chat app might — must not consume it.
- Redeeming creates my Login, bound to the Person the Invite names, and signs
  this Device in. My Login is mine alone; there is no shared household account.
- An Invite is single-use and expires. A used, expired, or unrecognised Invite
  says so plainly and tells me to ask for a new one.
- If this Device cannot hold a Passkey — or can only offer to keep one somewhere
  I am not willing to keep it — I can still complete the join and use the app on
  it (story 29). Choosing not to make a Passkey here is a plain choice offered
  alongside making one, not a failure I have to provoke. The app tells me I will
  need a Household member's help to sign in on any further Device until I add a
  Passkey somewhere.

### 28. Bring another Person in

As a Quartermaster, during Inventory management, I want to give any Person in
our Household a Login of their own — issuing the Invite myself, from inside the
app — so that a second Quartermaster is something we arrange between us, not a
request to whoever runs the server.

Acceptance criteria:

- I can issue a join Invite for any Person recorded in our Household (story 4),
  including one I have just recorded, and hand the link over however we normally
  talk to each other.
- A Person may hold at most one Login. People who need no access — our kid —
  simply never get one, and remain full Participants on Trips.
- Every Quartermaster has the same powers, mine included: there is no owner, no
  administrator, and no hierarchy between us.
- I can see which People hold a Login, and revoke one — after which that
  Person's Devices lose access at their next contact with the server, while
  everything they recorded stays.
- Only the very first Login of a brand-new Household is arranged out of band, by
  whoever runs the server. There is no public sign-up.

### 29. Sign in on another Device

As a Quartermaster, when I pick up a second Device — a laptop, a spare phone, a
replacement after losing mine — I want to sign it in without re-creating my
identity, so that all my Devices are the same me and no Device is a
second-class one.

Acceptance criteria:

- From a Device I am already signed in on, I can produce a Device link for
  myself and open it on the new Device to sign that one in.
- The new Device offers to remember me with its own Passkey, so that the next
  sign-in there is local and immediate.
- **A Device that cannot hold a Passkey is still fully supported.** Older phones,
  browsers, and locked-down machines exist; so do Devices that can only keep a
  Passkey somewhere I have deliberately chosen not to keep my credentials, which
  for me is the same problem. On any of them the Device link signs me in and the
  Device then stays signed in like any other (story 26). Nothing about the app is
  degraded there, and nothing about that Device is marked as lesser.
- If I have lost access to all of my own Devices, another Quartermaster in the
  Household can issue me a Device link, and I am back — no reset mail, no
  support request. In a Household with no other Login, this is the one case that
  needs whoever runs the server.
- Device links are single-use and short-lived, and consumed only by a deliberate
  act, as with any Invite (story 27).

### 30. See and manage my Devices

As a Quartermaster, whenever a Device is lost, sold, borrowed, or simply retired,
I want to see everything currently signed in as me and cut any of it off, so that
a phone left in a hut cannot keep showing our Gear — or the fact that we are
away.

Acceptance criteria:

- I can see every Device signed in as me: what it is, roughly, and when it last
  reached the server.
- I can sign out any Device from any other, without touching the lost one. The
  cut-off Device loses access at its next contact with the server and shows
  nothing of our Household afterwards.
- I can sign out the Device I am holding, which also clears our Household's
  records from it. If it still holds work that has not reached the server, the
  app warns me before anything is cleared.
- Signing in as a different Household on a Device clears whatever the previous
  Household left on it first.
- Losing a Device is never data loss: everything it synced is already ours, and
  cutting it off costs me nothing but that Device.

### 31. Our Household's records stay ours

As a Quartermaster, at all times, I want certainty that nobody outside our
Household can read or change our records, so that a tool which quietly documents
what we own and when our house is empty is safe to keep using.

Acceptance criteria:

- Every record belongs to exactly one Household; nothing is ever visible or
  reachable across that boundary, by any route.
- There is no public sign-up and no way in without an Invite issued for a
  specific Person (stories 27, 28).
- A stolen sign-in link is bounded: Invites are single-use and short-lived, and
  once used cannot be used again.
- Signing in cannot be phished: proving who I am is bound to the real foerier
  site, so a look-alike page gets nothing usable.
- The only deliberate exception is the read-only public Trip share (story 24,
  Later), which exposes a narrow, explicitly safe subset and never our Household,
  our Home, or our dates.

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
- When Gear is listed on an **Active Trip** — one in Pack-out, On trip, or
  Unpack (story 32) — its Whereabouts shows where it sits on the Trip — inside a
  Container, or Loose — instead of only its idle Home. (Whereabouts is derived on
  demand, never stored.)
- For **Counted** and **Per-person** Gear, Whereabouts is a **quantity split**,
  not one answer: "×2 in Crate B, ×2 on Alps 2026" are both true at once, and the
  Home slot is kept while units are out.
- Gear whose last Unpack outcome was `lost` (story 11) reads as **unaccounted
  for**, naming the Trip it was last seen on, until a later fact settles it — I
  Re-home it, or a later Trip brings it back. Its recorded Home is never
  destroyed, so when it turns up I still know where it belongs.

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
- I can optionally record when the Trip runs — a start and an end — so that Trips
  identify and order themselves without me smuggling a year into the name. Dates
  stay optional: a Draft Trip often has none yet.
- **Dates never drive the Trip's phase** (story 32). A Trip does not become On
  trip because its start date arrived; it moves when I say it has.
- I can record which of the household People participate — its Participants — and
  change that later.

### 32. Move a Trip through its phases

As a Quartermaster, from planning a Trip to filing it away, I want the Trip to
say plainly where it stands — being drafted, packed, away, unpacked, done — so
that I open the app and see what needs doing next instead of reconstructing it
from a list of half-packed Gear.

Acceptance criteria:

- A Trip stands in exactly one phase: `draft` → `pack-out` → `on trip` →
  `unpack` → `closed`. It shows me which, and what the next thing to do is.
- **I move it; it never moves itself.** Nothing advances on a date, a timer, or a
  count of packed Gear (story 5).
- **A phase never locks anything.** I can add a forgotten Entry during Pack-out,
  Re-home during the Trip, mark something packed while Unpacking. The phase
  describes what is happening; it does not police it.
- **I can move it back**, not just forward — I said we had left, then found the
  duffel still in the hall.
- Only Trips in Pack-out, On trip, or Unpack are **Active** — those are the ones
  whose packing counts: Whereabouts reports them (story 3) and they hold Gear
  against other Trips (story 6). A Draft Trip and a closed Trip hold nothing.
- Starting Pack-out on a Draft Trip is where an overlap with another Active Trip
  surfaces (story 6) — the moment I would actually have to choose.
- **Closing is gated** on the Unpack pass being finished (story 11), and
  **reopening a closed Trip is a deliberate, confirmed act** — the same weight as
  deleting one (story 14), because it makes settled history live again. Reopening
  restores the Trip as it stood; nothing was thrown away to close it.
- Reopening a Trip makes it Active again and so may collide with a Trip started
  since. The app tells me — it never refuses to reopen, because correcting the
  record must not be blocked by an unrelated Trip.

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
- **Two Active Trips cannot both take the same Gear.** The Depot's supply is
  finite, so when I add Gear that an Active Trip already holds, the app tells me
  before I create a contradiction: Single Gear can be on one Active Trip; Counted
  Bring-counts across Active Trips cannot exceed the Owned-count; Per-person Gear
  is per Participant, so two Trips may take it for two different People.
- **Draft Trips may overlap freely** — I plan two Trips ahead in peace, and the
  clash surfaces when I start packing the second (story 32).
- Because we both work offline, this cannot always be caught as it happens. If two
  Devices claim the same Gear while apart, the app shows me the clash and I settle
  it by removing the Entry from one Trip. **Nothing I recorded is ever discarded
  to resolve it.**

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
- Every Entry and every Per-person Piece takes an **Unpack outcome** — exactly one
  of:
  - **`back`** — it came home.
  - **`consumed`** — it was used up. For Counted Gear I record how many (its
    **Consumed-count**); that many come off the Owned-count, because we really do
    own fewer now. The rest came back.
  - **`lost`** — it did not come home and I do not know where it is.
- An Entry with no outcome yet is **open**. Trip-only Gear takes no outcome: it
  never entered the Depot and is simply cleared when the Trip closes.
- **`lost` is honest, not final.** It changes nothing in the Depot: the Gear keeps
  its recorded Home, stays searchable, and reads as **unaccounted for** wherever I
  look it up (story 3), naming this Trip as where it was last seen. It is settled
  by the next thing I learn — I Re-home it when it turns up, or a later Trip
  brings it back. It is **not** a Retirement (story 2): the Gear is still ours and
  still expected.
- **I cannot close the Trip until nothing is open.** The button tells me how many
  remain ("Close trip — 6 open") and only becomes available at zero. There is no
  way to close around it — and none is needed, because `lost` is always a truthful
  answer for anything I genuinely cannot account for. This gate is what stops the
  Depot drifting after every Trip.
- Marking an Entry resolved **hands its Gear straight back** — mid-pass, before
  the Trip closes: its Whereabouts reads Home again (story 3) and another Trip may
  claim it (story 6). Putting things away as I go is immediately true, not true
  only at the close.
- Once the Trip is closed it is kept as history (story 14), and **nothing is
  destroyed** to close it: its packed arrangement and Container Journeys simply
  stop having effect, and its outcomes and Consumed-counts are kept — so I can ask
  later how many gas canisters the Alps cost us.
- **I can reopen a closed Trip** (story 32) when I closed too early, or when the
  tent I marked `lost` turns up in November. Reopening restores the Trip exactly as
  it stood and lets me change an outcome. Changing away from `consumed` **offers**
  to put the Owned-count back and waits for me to confirm — it never silently
  rewrites a count I may have already corrected by hand.
- Richer outcomes ride on Later features: Promoting a Note into a maintenance
  need (story 17), the wishlist (story 18), or a retirement (story 19).

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
  Pre-trip tasks, and kept reference Notes (story 12); Packing status, Container
  Journeys, Unpack outcomes, Consumed-counts, and dates all start fresh.

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

### 36. Undo a change

As a Quartermaster, during Inventory management and Packing, I want to reverse
the change I have just made — a mistyped record, a Move applied to the wrong
Gear, a Packing status tapped by accident — so that working quickly is safe and
I never have to reconstruct by hand what something looked like before I touched
it.

Acceptance criteria:

- After a change, the way to reverse it is offered where the change happened,
  and reversing takes one deliberate action.
- Reversing restores what I would recognise as the previous state. It does not
  leave the Gear marked, Retired, or otherwise visibly different from how it
  stood before.
- The offer means the same thing every time. It never quietly becomes a weaker
  kind of reversal because time passed, because the change reached the rest of
  the Household, or because I was offline when I made it.
- What can and cannot be reversed is stated where it applies, rather than
  discovered by trying.
- Reversing never silently discards another Quartermaster's work.

**This story opens with a design phase, not a slice.** Undo is the first
requirement that pushes back on decisions the rest of the system has already
made, and the criteria above are deliberately written as the user's expectation
rather than as something the current design can obviously deliver. Settle these
in the docs that own them, before any slice is cut:

- **Language.** Is there one term, and does it mean exactly one thing? Undo on
  a mistyped record, on a Move, on a Packing status tap, and on story 35's bulk
  action may be four different promises. Is what is offered *reverse my last
  change* or *reverse this change*? The [glossary](ubiquitous-language.md)
  takes a headword either way.
- **Domain.** Is reversal a domain operation, or only an affordance built over
  operations that already exist? The [model](domain-model.md) names no inverse
  today, and some operations have none that restores the prior state —
  Retiring Gear is not the opposite of recording it.
- **Persistence and sync.** The change log is append-only and merges per field
  by last writer, which makes a reversal a *new* change carrying a later clock
  rather than the removal of an old one. So a reversal can itself be lost to a
  concurrent edit, and reversing a field another Device changed at the same
  moment may resurrect a value nobody wants. Whether reversal is expressible at
  all without a new kind of entry belongs to that design, not to a slice.
- **Scope and window.** Everything, or only the last thing? Always, or only
  while the change is still on this Device? A window that expires quietly is
  exactly the failure the third criterion above forbids.

Until that design lands, **the MVP does not lean on Undo**: a screen that would
drop a confirmation on the grounds that Undo exists keeps its confirmation
instead.

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

### 33. See a piece of Gear's history

As a Quartermaster, during Inventory management, I want to see what has happened
to one piece of Gear — when we got it, where it has lived, which Trips it went
on, when it came back — so that the Depot answers questions about the past and
not only about today.

Acceptance criteria:

- A piece of Gear shows an append-only account of its own life: recorded, moved,
  listed on a Trip, packed, brought back, lost, retired — each with when, and by
  which of us.
- The account is **derived from changes already recorded**; foerier keeps no
  second history alongside them, and nothing can be edited into it by hand.
- It reads as a ledger, in the app's plain voice: facts and dates, no narrative.

### 34. Save a slice of the Depot

As a Quartermaster, during Inventory management, I want to name and keep a filter
combination I use often (story 13) — "our kid's Gear", "everything `bushcraft`
not in a Trip" — so that a slice I work weekly is one tap away instead of rebuilt
each time.

Acceptance criteria:

- I can name and keep any combination story 13 can express, and reach it again
  later.
- A saved slice survives the things it points at changing: a Tag renamed, a
  Person or Place removed. It tells me plainly when part of it no longer applies
  rather than silently returning the wrong Gear.
- I can rename and delete saved slices.

### 35. Act on many pieces of Gear at once

As a Quartermaster, during Inventory management, I want to select several pieces
of Gear and act on them together — move, Tag, set owner, Retire — so that
re-organising a shelf is one action rather than twenty.

Acceptance criteria:

- I can select several pieces of Gear from a list and apply Move, Tag, Set owner,
  or Retire to all of them at once.
- The result is exactly what doing each one by hand would have produced, and I
  can undo it as one action.
- Note this needs **no new domain concept** — each verb already exists for a
  single piece of Gear (story 2, story 4, story 13), and moving a Container
  already carries its contents (story 1). It is an affordance, not a capability,
  which is why it can land in any later slice at no structural cost.

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
