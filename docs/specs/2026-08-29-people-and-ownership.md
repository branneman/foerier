# S4 — People and ownership

The implementation design for [architecture §8.3](../architecture-design.md#83-the-slices)'s
**S4**: two op types, the People screen, owner on gear, and **Person and
Ownership as two more rows in S3's dimension table**. It delivers story **4**
and advances story **13** through the engine S3 built
([§8.5](../architecture-design.md#85-where-story-13-attaches)) rather than
beside it.

This is a **feature spec**: it is retired once the slice has shipped. It settles
what the durable docs left to the implementer and records the decisions taken
before any code was written. It does **not** revisit anything above it — the op
envelope, the HLC, per-field LWW, the op catalogue and the evolution rules are
settled in [`sync-protocol.md`](../sync-protocol.md), and every ambiguity here
is resolved by reading that document, not this one.

**The boards win.** Where this spec and `docs/design/*.dc.html` disagree, the
boards are right and this spec is wrong. Components §04 carries the slice bar
and its dashed future-dimension ladder; Components §05 the Home picker rows this
slice borrows from; Screens C §08 carries People & logins; Screens A's `Depot
desktop`, `Depot phone` and `Add gear` frames carry the rest.
`docs/design/README.md` §2, §3, §3a, §3b, §4, §11 and §13 are the written
handoff.

S4 also unblocks **S5** ([§8.2](../architecture-design.md#82-four-stories-accrete-across-slices-rather-than-landing-in-one)):
story 28 issues Invites for People recorded here, so it cannot be built until
they exist.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types | **2** — `person.renamed`, `gear.ownership_set`. `person.recorded` is S2's |
| Endpoints | **None.** S4 is client-side plus two op types |
| `person.renamed` payload | Settled as **`{name: string｜null}`** — the question [sync §4.2](../sync-protocol.md) deferred to this slice |
| Absent `owner` register | Reads **`SHARED`**. Stated once, in `shared/`, and read through one function everywhere |
| Owner label | **`SHARED` ｜ `PERSONAL E`** — one selector, three surfaces |
| Dimensions | **Two rows, `ownership` and `person`**, per Components §04's dashed ladder — not one merged `OWNER` |
| The always-empty pair | `OWNERSHIP: SHARED` + `PERSON: ELS` is **reachable and not guarded** ([§3.3](#33-two-consequences-named-rather-than-discovered)) |
| `Dimension.format` | Gains **`state`** — S3 anticipated this and put the parameter on the wrong function |
| `GROUP BY` | Gains **`OWNER`**, via a **grouping table** beside the dimension table, not a third dimension |
| Group order | **`Shared` first, then people alphabetically** |
| People screen | **`/account/people`**, the board's Screens C §08 **minus its entire login half** |
| Person removal | **Never.** EDIT mode carries `RENAME` only |
| Add gear (F1) | Gains an **`OWNER` row after `HOME`, carrying over within a sitting** — a departure ([§6](#6-two-departures-from-the-boards)) |
| Owed by S5 | The person row's **meta line**, the circle's **login border**, and the section rename ([§7](#7-what-s4-leaves-for-s5-on-purpose)) |

---

## 1. Two ops, and one that was already built

§8.3 budgets S4 at two op types. The People screen's `+ NEW PERSON` needs a
third verb — recording a Person — and does **not** spend one, because
`person.recorded` landed in S2 and folds today. [Sync §4.2](../sync-protocol.md)
explains why: S1's join screen pre-binds the joiner's Person id, so until
something authored that op the Household's own Login pointed at a Person nobody
ever created. The op went to the first slice with an op log to append to. S4
inherits it and gives it a second caller.

### 1.1 `person.renamed`

[Sync §4.2](../sync-protocol.md) types this row `{name}` and says so
deliberately:

> `person.renamed` is not yet implemented by any reducer and is left as
> `{name}` here until the slice that folds it settles the same question for
> that row.

S4 is that slice, and settles it as **`{name: string｜null}`** — folded through
`writeNullableIfPresent`, exactly like `place.recorded`, `place.renamed`,
`gear.recorded`, `gear.renamed` and `person.recorded`. An explicit `null`
clears; an absent field leaves the register alone.

There is no carve-out to argue about. [§1.3](../sync-protocol.md) states the
absent-versus-null distinction generally, and the reducer's own rule — *a
register whose declared type includes `null` takes an explicit `null` as a
clear* — already covers `PersonState.name`, which is `Register<string | null>`
and has been since S2's Task 3. The handler is `setPlaceName`'s shape with
`writePerson` substituted; `person.recorded` and `person.renamed` become one
handler under two keys, the way `place.recorded` and `place.renamed` already
are.

### 1.2 `gear.ownership_set`

`{owner: {"type":"shared"} ｜ {"type":"person","person_id":<uuid>}}`, setting the
`owner` register. This is the cheapest op in the catalogue after the tag pair:
`GearState.owner` already exists, `readOwner` already parses the payload and
`wireOwner` already serialises it, because `gear.recorded` may carry `owner?`
and S2 wired all three for that. The handler is `gearKindSet`'s shape with
`readOwner` substituted; the authoring function is `gearKindSet`'s with
`wireOwner` applied.

### 1.3 An absent `owner` register reads `SHARED`

No board draws an unowned state. Every Depot table row the boards draw reads
`SHARED` in the OWNER column, including `Tent, 2p (old)`, whose HOME column
reads `—` — so the boards distinguish "no home recorded" from "no owner
recorded" and only draw the former. `GearDetail.tsx` has rendered it this way
since S2.

This stops being a rendering convenience in [§3](#3-the-engine) — the Ownership
dimension's values depend on it, and a filter that disagreed with the readout
would be a bug a Quartermaster could see. So it is stated **once**, in
`shared/`, and every surface reads it through the same function.

### 1.4 `ownerLabel` moves into `shared/`

Today it is private to `GearDetail.tsx`. Three surfaces need it at S4 — the
Depot row's meta line, the Depot table's OWNER column, and gear detail's own
meta line — and they must agree. It moves to `shared/src/selectors/` beside
`whereabouts.ts`, which is the same shape of problem solved the same way.

It returns **`SHARED`** or **`PERSONAL E`** — the initial, matching the person
circle's own convention. The boards spell it two ways: `PERSONAL E` on Depot
rows (the `Depot desktop` and `Depot phone` frames) and `PERSONAL · E` on
Packing rows (`Packing by container`).
**Resolved to `PERSONAL E`**, because the Depot is what S4 ships and the `·` in
the Packing form is that screen's own separator between owner and count
(`PERSONAL · E · ×2`), not a different vocabulary. S9 inherits the same
function.

A Person whose `name` register is absent or `null` formats as **`PERSONAL`**
alone — there is no initial to draw, and inventing one would be a fact the app
does not have. This is `AppShell`'s `AccountAvatar` rule, applied to text.

---

## 2. State shape

Nothing is added. `GearState.owner` and `PersonState.name` both exist, both are
registers, and `registersOf` in `slice.ts` already counts `gear.owner` — so
`NEWEST FIRST` keeps working unchanged for gear whose only S4-era write is an
ownership set.

That is the architecture paying out for the second slice running: S4 is two
handlers, two authoring functions, two dimension rows, one grouping row, one
screen and four edited ones. No migration, no endpoint, no server deploy
ordering to think about.

---

## 3. The engine

### 3.1 Two dimensions, because the boards drew two chips

The folded state is **one** register — `Owner = {type:'shared'} | {type:'person',
personId}` — and a single merged `OWNER` dimension whose values were `shared`
plus each person id would express both of story 4's narrowings, with one chip,
matching the Depot table's own OWNER column head.

**The boards decided otherwise.** Components §04's `FUTURE DIMENSIONS — NEVER
AVAILABLE EARLY` ladder draws two dashed ghost chips, `PERSON · S4` and
`OWNERSHIP · S4`, and [§8.5](../architecture-design.md#85-where-story-13-attaches)'s
table says the same. Story 13's own acceptance criterion names them separately:
"Tag, Person, Ownership (Personal/Shared), Kind". Two rows.

| id | label | arity | `valuesOf(gear, state)` | chip |
| --- | --- | --- | --- | --- |
| `ownership` | `OWNERSHIP` | `single` | exactly one, always: `personal` or `shared` (absent → `shared`, §1.3) | `OWNERSHIP: SHARED` |
| `person` | `PERSON` | `single` | `[personId]` when personal; `[]` otherwise | `PERSON: ELS` |

Both are `single`, so both hide their ghost add-chip while active and both
degenerate to equality under S3's one filter rule. Neither needs a line of code
in `SliceBar`: arity already decides add-or-replace, and the ghost rule already
falls out of it.

### 3.2 `Dimension.format` gains `state`

S3's table comment anticipated this exactly:

> `state` is handed in as well as `gear` because dimensions arriving later need
> it: S4's Ownership resolves a `personId` to a Person […]. Costing it now saves
> the table being reshaped by the first dimension that asks.

The anticipation was right and the parameter is one function off. It is
`format` that resolves a `personId` to a name, not `valuesOf` — `valuesOf`
returns the id. So `format(value: string, state: HouseholdState): string`.

`SliceBar` stays state-free: it gains a bound **`formatFor(id, value)`** prop
beside its existing `valuesFor(id)`, and `Depot.tsx` supplies both from the
state it already holds and already passes to `sliceDepot`. `ValueMenu`'s
`format: (value) => string` prop is unchanged; it receives the bound one.

An unnamed Person formats as **`—`**, the same glyph `UNGROUPED_LABEL` uses. The
picker row is then still selectable and still counted, which is better than an
empty chip label or a raw UUID.

### 3.3 Two consequences, named rather than discovered

**`OWNERSHIP: SHARED` + `PERSON: ELS` is reachable, and always returns nothing.**
It is not guarded. S3's engine already permits empty slices — `KIND: COUNTED`
plus a tag no counted gear carries is the same shape — the count line reads
`0 OF 128`, which is the honest answer, and `CLEAR (2)` is one tap away as
story 13's undo. The only fix would be a second combinator between dimensions,
and refusing to build one is [§3.2 of S3's spec](2026-08-27-tags-and-slicing.md)'s
central decision. A structurally-empty pair is a worse *suggestion* than an
accidentally-empty one, not a different *mechanism*.

**A Person who owns nothing is absent from the `PERSON` picker.** `dimensionValues`
derives from the visible depot rather than from any declared list — the rule
that lets an unrecognised Kind from a peer on a different build appear at all,
and that makes the Tag vocabulary work with no Tag entity. Applied to Person it
means Kees, who owns nothing, cannot be picked. That is right: narrowing to him
would return zero, and the People screen is where a recorded-but-unowning Person
is visible.

### 3.4 `GROUP BY` gains `OWNER`, via a grouping table

Story 13 asks to "narrow, sort, **and group** lists by at least: Tag, Person,
Ownership, Kind […]". The boards draw `GROUP BY` as `NONE · KIND` at S3's ship
state and never draw its S4 state, so this is S4's to settle.

`groupGear` today hardcodes `item.kind?.value` and calls `dimension('kind').
format`. It generalises onto a **`GROUPINGS` table** beside the dimension table:

```ts
interface Grouping {
  id: Exclude<GroupKey, 'none'>
  label: string                                  // 'KIND', 'OWNER'
  keyOf(gear: GearState, state: HouseholdState): string | undefined
  format(key: string, state: HouseholdState): string
}
```

- **`kind`** — delegates to the kind dimension. Behaviour unchanged, including
  the `—` bucket for gear with no `kind` register.
- **`owner`** — `keyOf` returns `'shared'` or the person id; never `undefined`,
  because §1.3 makes absence mean shared. Groups read `Shared`, `Els`, `Mark`.

`GroupKey` becomes `'none' | 'kind' | 'owner'`.

**Why a separate table rather than a third dimension.** `owner` groups by the
register itself, which *neither* filter dimension does alone: grouping by
`person` would file every shared piece of gear into the `—` bucket, and grouping
by `ownership` would give two coarse groups and never name a Person. The
partition the boards' segmented control wants is the register's.

The table also turns a special case into a missing row. "GROUP BY never offers
TAG — deliberate: tags are multi-valued, so tag groups would not partition the
list" stops being a rule written in prose beside a hardcoded branch: a tag has
no `keyOf`, so Tag simply has no row in `GROUPINGS`.

### 3.5 Group order: `Shared` first

S3 sorts groups alphabetically by label, case-insensitively, with the `—` bucket
last. `owner` keeps the `—`-last rule (unreachable, but total) and **pins
`Shared` first**, then sorts people alphabetically.

Not plain alphabetical, because `Shared` is not a name: filing it between `Mark`
and `Zoe` reads as a bug rather than as an ordering. It is the same reasoning
that pins `Loose` to the top of the Home picker's rows — the pseudo-value that
means "belongs to no one in particular" is the list's spine, not an entry in it.
The order stays **total**, which is what stops two devices with identical state
drawing the list differently.

---

## 4. Screens

### 4.1 People — `/account/people`

The board's Screens C §08, **minus its entire login half**.

`Account.tsx` currently omits the section outright, and says why:

> **PEOPLE & LOGINS is omitted outright.** Its screen is story 28's (S5) —
> building the row now would point at nothing, and "an affordance that leads
> nowhere is worse than a missing one" […]

That rule now argues the other way: the row leads somewhere real. It takes the
slot the board reserved for it, between `DEVICES` and the footer, titled
**`PEOPLE`** at S4.

Anatomy, at S4:

- Title `People`; count line `3 people.`
- Rows, alphabetical: 30px initial circle, name, `YOU` badge on self.
  **The meta slot is empty and the right column is absent** — every line the
  board draws there is login state (`SIGNED IN · 2 DEVICES`, `NO LOGIN · JOINS
  TRIPS AS PARTICIPANT`, `INVITE OUT · SINGLE USE`), and `GET /auth/logins` is
  S5's endpoint.
- **The circle carries no login encoding.** The board's rule is accent border
  `#93BC9F` = holds a login, control border `#47523F` = none. S4 cannot tell
  them apart, and drawing every circle as "no login" would render the joiner —
  who demonstrably holds one — as having none. So the circle draws the control
  border with no meaning attached, and S5 lights it. This is Find's
  `S8 · PIECES` pattern: drawn final, falls through to a simpler variant until
  its slice lands.
- Dashed **`+ NEW PERSON`** row at the bottom, authoring `person.recorded`.
- **EDIT mode** for renaming — the quiet mono toggle, top right, the Home
  picker's own settled vocabulary (`design/README.md` §3c, R2: "RENAME / REMOVE
  moved off the pick rows into an EDIT mode"). **`RENAME` only, never `REMOVE`**: a Person
  is never removed ([sync §4.2](../sync-protocol.md) — gear ownership and past
  trips reference them, and the model gives no removal operation), so the Home
  picker's second verb has no counterpart. Authors `person.renamed`.
- The row's trailing `›` is **not drawn at S4**. The board gives it to a
  person's login detail, which is S5's.

**At Desktop, People unfolds inline into Account**, and `/account/people`
redirects back to `/account` — precisely what `/account/devices` already does,
for the reason `Account.tsx` already records: the board draws desktop with the
summary rows unfolded, "full device list and all three people inline". A media
query, because it decides what *exists*
([frontend-design §3.2](../frontend-design.md)).

### 4.2 The owner picker

One sheet, two callers (Add gear, gear detail's Edit sheet). Rows: **`Shared`**
first, then each Person alphabetically, then a dashed **`+ NEW PERSON`**.

Inline creation is the Home picker's precedent — "a place created while picking
is **selected**" — and without it, recording gear for a Person nobody has
recorded yet is a dead end in the middle of a sitting, which is exactly the
moment Add gear is designed to protect.

### 4.3 Add gear (F1)

Gains a bordered 48px **`OWNER`** row after `HOME`, defaulting to `Shared`,
opening §4.2's picker. It **carries over between records within a sitting**, and
resets to `Shared` on a fresh entry — the same treatment `HOME` already has, for
the same reason. See [§6.1](#61-add-gear-gains-an-owner-row) for why this is a
departure and why it is taken.

Still **one** `gear.recorded` op carrying every field. Nothing new is emitted
and the screen's "no failure state" property is untouched.

### 4.4 Gear detail

The Edit sheet gains an `OWNER` row, emitting `gear.ownership_set` **only when
it changed** — the sheet's existing discipline for `name`, `kind` and `count`.
The meta line (`ITEM · SHARED · ×2`) now has something to say when the owner is
a Person.

### 4.5 Depot

The table's OWNER column stops reading `—` and the row's meta line gains its
first segment (`PERSONAL E · SLAAPKAMER ▸ KAST · ×2`). `GearRow`'s `owner` prop
has been waiting since S3, which recorded it as "**S4 fills it**"; no `ui/`
change beyond deleting that note.

---

## 5. Tests

### 5.1 Tier 1 — unit

- `gear.ownership_set` as an ordinary register: LWW by `(hlc, deviceId)`, an
  absent register reading `SHARED`, an ownership set never touching the
  tombstone.
- `person.renamed`: a rename, an explicit `null` clearing the name, an absent
  field leaving it alone, and a lost write propagating identity.
- **Story 4's two narrowings**, verbatim from its acceptance criterion: the
  Depot narrowed to one Person's Personal gear, and to Shared only.
- `OWNERSHIP: SHARED` + `PERSON: ELS` returning `shown: 0` and `active: 2`
  rather than throwing.
- Grouping by owner, including `Shared` first and the total order.
- `ownerLabel` across shared / personal / unnamed-person / absent-register.

### 5.2 Tier 2 — convergence

- **Concurrent ownership edits** (§8.3's named scenario): two devices setting
  different owners on one gear converge to the same owner on both.
- A `person.renamed` racing a `gear.ownership_set` — different aggregates,
  different registers, both survive in either delivery order. Free, and it
  proves the two ops do not interfere.

### 5.3 Tier 3 — component

The People screen (record, rename, `YOU`, alphabetical order, no `REMOVE`), the
owner picker from both callers, the two chips and their ghosts, `GROUP BY OWNER`.

### 5.4 Unchanged

**No Tier 2s and no Tier 4** — S4 adds no endpoint. Tier 0 and the golden-path
Tier 5 stay green; the fixture rule from S3's spec §9.4 applies unchanged.

---

## 6. Two departures from the boards

Recorded here and in `docs/design/README.md`, following the precedent S3 set
with Add gear's `UNDO` and the Home picker's `MOVE` confirm.

### 6.1 Add gear gains an `OWNER` row

The board's F1 order is settled and reasoned: `NAME · KIND · [count] · HOME ·
RECORDED AS`, "order = the ledger line being written", with the irreversible
trait last. It carries no owner.

**Taken anyway.** Without it, S4's only route to attributing gear is one
gear-detail visit per item, and the Depot's bulk `SET OWNER` band is story 35,
tagged Later and drawn `LATER` on the boards (`design/README.md` §2). A household attributing a
two-hundred-item depot would make two hundred screen visits, and §8.3's own test
for the slice — "**Usable?** Personal gear stops being everyone's problem" —
would fail on the first day of real use.

The board's own argument for `HOME` carrying over between records is that "a
depot is recorded shelf by shelf". A shelf in a bedroom belongs to one person;
the argument is the same one, and the two rows sit adjacent because they behave
identically.

Owner is also part of the ledger line the board says the order follows — it is
one of the five shared attributes the domain model lists (home, owner, kind,
tags, weight), and it is the only one F1 omitted.

### 6.2 `GROUP BY` gains `OWNER`

The boards draw the segmented control at S3's ship state (`NONE · KIND`) and
never draw an S4 state, so this is not contradicted so much as unaddressed.
Story 13's criterion asks for grouping by Person and Ownership, and
[§8.5](../architecture-design.md#85-where-story-13-attaches) makes each slice's
dimension part of that slice's definition of done "never as a follow-up".

The refactor it forces — `groupGear` off its hardcoded kind and onto a table —
is one §8.5's remaining four slices imply anyway. Paid once, here, rather than
argued four more times.

---

## 7. What S4 leaves for S5, on purpose

Written down so S5 inherits a **stated obligation** rather than a gap somebody
has to notice. All three are on the People screen:

1. **The person row's meta slot is empty.** S5 fills it with the board's own
   lines: `SIGNED IN · 2 DEVICES`, `NO LOGIN · JOINS TRIPS AS PARTICIPANT`,
   `INVITE OUT · SINGLE USE`. Needs `GET /auth/logins`.
2. **The circle carries no login encoding.** S5 applies the board's rule —
   accent border `#93BC9F` for a Person who holds a Login, control border
   `#47523F` for one who does not.
3. **The section and screen are titled `PEOPLE`.** S5 renames both to
   `PEOPLE & LOGINS`, adds the count line's second clause (`1 of 3 people holds
   a login. 1 invite out.`), the right column (`INVITE ›`, `DEVICE LINK ›`,
   `REVOKE`), the outstanding-invite row, and the own row's `›`.

None of the three is a defect at S4: each is a fact the client cannot know until
S5's endpoints exist, and the alternative in every case is to draw something
false.

---

## 8. What this slice deliberately does not build

- **Person removal.** There is no op, by design.
- **The bulk `SET OWNER` band** — story 35, Later, drawn `LATER`.
- **Per-person Pieces** — S8. Ownership is a Depot attribute; Pieces are a trip
  concept, and nothing here touches them.
- **Trip participants.** `trip.participant_added` needs recorded People and is
  now unblocked, but it is S6's.
- **In-app Invites and the Logins list** — S5, per §7.
- **A saved slice** — story 34, Later, and it attaches to this engine with no
  structural change, which stays the test that the engine sits at the right
  altitude.

---

## 9. Doc amendments

| Doc | Change |
| --- | --- |
| [`sync-protocol.md`](../sync-protocol.md) §4.2 | `person.renamed` typed `{name: string｜null}`; the "not yet implemented by any reducer" note retires |
| [`architecture-design.md`](../architecture-design.md) | §12.10, consequences of S4; §8.3's S4 entry marked landed |
| [`design/README.md`](../design/README.md) | Following the §3b/§3c precedent, each departure is appended to the section for the screen it changes: **§3b** takes [§6.1](#61-add-gear-gains-an-owner-row)'s `OWNER` row; **§2** takes [§6.2](#62-group-by-gains-owner)'s `GROUP BY OWNER` and the `PERSONAL E` spelling; **§13** takes [§7](#7-what-s4-leaves-for-s5-on-purpose)'s three S5 obligations |
| `CLAUDE.md` | Status: S4 landed, and the three things worth knowing before touching People or ownership |
