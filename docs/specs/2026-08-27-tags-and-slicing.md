# S3 — Tags and the slicing engine

The implementation design for [architecture §8.3](../architecture-design.md#83-the-slices)'s
**S3**: two op types, one composable selector, the first two components in
`ui/`, and the Depot's slice bar at all five layout modes. It advances story
**13** and owns the engine that five later slices extend
([§8.5](../architecture-design.md#85-where-story-13-attaches)).

This is a **feature spec**: it is retired once the slice has shipped. It settles
what the durable docs left to the implementer, and records the decisions taken
before any code was written. It does **not** revisit anything above it — the op
envelope, the HLC, per-field LWW, the op catalogue and the evolution rules are
settled in [`sync-protocol.md`](../sync-protocol.md), and every ambiguity here
is resolved by reading that document, not this one.

**S3 is the first slice whose screens were designed before its code.** A full
design pass landed in `e6935db`, `4c7d09c` and `84ecd9b`, so where this spec and
the boards disagree, **the boards win and this spec is wrong**. The boards are
`docs/design/*.dc.html`; `docs/design/README.md` §2, §3, §3a, §3b, §3c, §4 and
§4a are the written handoff, and Components §03, §04 and §06 carry the component
anatomy.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types | **2** — `gear.tag_applied`, `gear.tag_removed`, per-tag registers ([sync §3.4](../sync-protocol.md)) |
| Endpoints | **None.** S3 is client-side plus two op types |
| `TagString` | A **brand**. `normalizeTag` is the only way to make one, so a raw string cannot be authored into a tag op |
| Enforcement | **Authoring normalises; readers never enforce.** A non-conforming tag folds exactly as received |
| Filter combination | **One rule: every selected value must be carried.** Search ANDs with it. Single-arity dimensions degenerate to equality |
| `NEWEST FIRST` | Derived as the **minimum `(hlc, deviceId)` across a gear's registers** — no new field, no new op |
| `GROUP BY` | `NONE · KIND` only, ordered **alphabetically by label**. Never TAG |
| `ui/` extraction | `GearRow` (three `@container` variants) and `Chip`. Radix stays deferred |
| Container-query breakpoint | **`38rem` (608px)**, replacing the boards' annotated `~600px` |
| Split two-pane | **S3 absorbs it**, and [§12.1](../architecture-design.md#121-deviations-from-8s-s0-and-why) records the S0 shortfall that left it unbuilt |
| Slice persistence | Sort + group per device in `localStorage`; filters + search are React state |
| Add gear's `UNDO` | **Not built.** Story 36 is Later and op removal is not expressible ([§8](#8-two-deliberate-departures-from-the-boards)) |
| Home picker `MOVE` | **Gains a confirm**, for the same reason |

---

## 1. The two ops, and why they are the cheapest in the catalogue

[Sync §3.4](../sync-protocol.md) already decided the hard part:

> Tags and participants are **not** single registers holding an array — that
> would make two quartermasters tagging concurrently clobber each other. Each
> member is its own register.

So the register key is `(gear_id, "tags", <tag string>)` and its value is
present/absent. `gear.tag_applied` writes `true`, `gear.tag_removed` writes
`false`, and both go through the existing `writeRegister`. There is no new merge
rule, no new comparison, and no set arithmetic anywhere in the reducer.

That is what makes the named Tier 2 scenario — **concurrent tagging must union,
never clobber** — a property of the *shape* rather than of the code:

- `tag_applied{food}` on device A and `tag_applied{kitchen}` on device B touch
  **different registers**. Neither is a contested write, so both survive. The
  union is not computed; it is the absence of a conflict.
- `tag_applied{food}` and `tag_removed{food}` touch **one register**, and
  resolve by plain LWW on `(hlc, device_id)` like every other field.

The whole reducer addition is:

```ts
const gearTagWritten = (present: boolean): Handler =>
  (state, op, stamp) =>
    writeGear(state, op.aggregate_id, stamp, (gear, st) => {
      const tag = readString(op.payload, 'tag')
      if (tag.kind !== 'value') return gear
      const current = gear.tags?.[tag.value]
      const next = writeRegister(current, present, st)
      if (next === current) return gear
      return { ...gear, tags: { ...gear.tags, [tag.value]: next } }
    })
```

`readString`, not a tag validator. That is §2's rule, and it is load-bearing.

### 1.1 State shape

```ts
export interface GearState {
  // …
  /** Per-tag registers (`sync-protocol.md` §3.4). The key is the literal
   *  string that arrived — never normalised on the way in. */
  tags?: Readonly<Record<string, Register<boolean>>>
}
```

Optional, like every other register on `GearState`. Under
`exactOptionalPropertyTypes` an absent `tags` key means *no tag op has ever
addressed this gear*, which is a different fact from an empty map — the map is
non-empty the moment any tag op lands, including one that removed a tag that was
never applied. A register holding `false` is a real fact with a real clock, and
discarding it would lose the removal.

---

## 2. `TagString` — an authoring rule, not a validation gate

[Sync §4.3](../sync-protocol.md) types the payload `TagString` and then spends
two paragraphs saying that readers must not enforce it. Both halves are
implemented, in different files, and the split is the point.

**Conforming:** lowercase `[a-z0-9-]`, 1–40 characters, stored **without** the
`#` every screen draws.

**`shared/src/tags.ts`** is the strict half:

```ts
declare const TAG: unique symbol
export type TagString = string & { readonly [TAG]?: never }

/** Normalises to a conforming tag, or `null` when nothing conforming
 *  survives. Case folded down, whitespace runs collapsed to one hyphen, a
 *  typed `#` stripped, then truncated to 40. */
export function normalizeTag(input: string): TagString | null
```

The brand is the defence the design asks for. `docs/design/README.md` §4a is
explicit that the picker is the *only* place a spelling is ever decided — there
is no Tag entity and no rename op, so a misspelling is corrected only by
removing it and applying the right one. A brand makes that structural:
`gearTagApplied(id, tag: TagString)` cannot be handed a raw string, so every
authoring path in the app is forced through `normalizeTag`, and the compiler is
what enforces it rather than a code review.

**The cost, stated honestly:** this is the project's first branded type, and it
buys nothing at runtime. A test that wants a conforming tag writes
`normalizeTag('winter')!`. A test that wants a **non**-conforming one — proving
the tolerant reader — hand-shapes an `OpSpec` and passes it to `anOp`, which is
exactly right: that test is simulating an op authored by a different build, and
it should not be able to reach our builders.

**`shared/src/payloads.ts` is untouched.** The reducer reads the tag with plain
`readString`. A tag that does not conform is folded exactly as received, never
rejected, never rewritten, never dropped, and the register key is the literal
string that arrived. Two spellings of one intent are two registers that both
fold. This is not a concession — [sync §5](../sync-protocol.md)'s
tolerant-reader discipline outranks the normalisation rule, and an installed PWA
may hold ops queued offline against an earlier normalisation. Rejecting them
would discard a Quartermaster's work to enforce a cosmetic rule.

Tightening the rule later is additive and needs no migration.

---

## 3. The slicing engine

A new pure selector, `shared/src/selectors/slice.ts`, composing over
`visibleGear`. It replaces ad-hoc component code rather than extending a
selector seam: the Depot's current name-substring filter lives **inside the
component**, at `app/src/screens/Depot.tsx:57-63`.

### 3.1 A dimension table, not a fixed set of fields

[§8.5](../architecture-design.md#85-where-story-13-attaches) is the constraint
that shapes this file: five later slices each add a dimension to *this* engine
as part of their own definition of done, never as a follow-up.

| Dimension | Arrives with |
| --- | --- |
| Tag; Kind | **S3** |
| Person; Ownership | S4 |
| Trip membership | S7 |
| Per-Person grouping of Pieces | S8 |
| Packing status; Container | S9 |
| Outcome | S10 |

So the shape is a table of dimensions, and adding one is a row:

```ts
export type DimensionId = 'tag' | 'kind'   // widened by S4, S7, S8, S9, S10

export interface Dimension {
  id: DimensionId
  /** The chip's label: `TAG`, `KIND`. */
  label: string
  /** `multi` keeps its ghost add-chip while active; `single` hides it. */
  arity: 'single' | 'multi'
  /** The values this gear carries in this dimension. Empty is legal. */
  valuesOf(gear: GearState, state: HouseholdState): readonly string[]
  /** How one value is drawn: `#winter`, `COUNTED`. */
  format(value: string): string
}

export interface SliceSpec {
  search: string
  filters: Partial<Record<DimensionId, readonly string[]>>
  sort: SortKey
  group: GroupKey
}

export interface SliceGroup {
  key: string
  label: string
  gear: readonly GearState[]
}

export interface SliceResult {
  groups: readonly SliceGroup[]
  /** After search and filters — the `9` in `9 OF 128`. */
  shown: number
  /** Every visible piece of gear — the `128`. */
  total: number
  /** What `CLEAR (n)` counts: selected values plus a non-empty search. */
  active: number
}
```

`valuesOf` takes `state` as well as `gear` because S4's Ownership dimension must
resolve a `personId` to a Person, and S7's Trip membership is a cross-aggregate
question. Passing it now costs nothing and saves the table being reshaped by the
first dimension that needs it.

### 3.2 One filter rule

> **Every selected value must be carried by the gear.** Search ANDs with the
> result.

That is the board's `SEARCH + FILTERS COMBINE WITH AND · COUNT UPDATES PER TAP`,
stated once. It has three consequences worth naming, because a second
combinator would have been the obvious thing to build:

- **Several tag chips AND together** — `#winter` + `#sleep` returns gear
  carrying both. Components §04 says so explicitly.
- **A single-arity dimension degenerates to equality.** `KIND` can hold at most
  one value, so "every selected value is carried" *is* `kind === value`. No
  special case.
- **A dimension with no selected values does not participate.** Not "matches
  everything" as a predicate — it is skipped, so an empty `filters` object costs
  nothing.

Search reuses the fold from `selectors/find.ts` — case- and
diacritic-insensitive substring over the name — rather than the Depot
component's plain `toLowerCase().includes()`. Two search boxes in one app that
disagree about whether `Ölzeug` matches `olzeug` is a bug waiting to be filed.

### 3.3 `NEWEST FIRST` has no field to sort on

Components §04 lists three sort keys at S3: `NAME A→Z`, `NAME Z→A`,
`NEWEST FIRST (recorded)`. The first two are `depot.ts`'s existing
`byNameThenId` and its reverse. The third has nothing to read: **`GearState`
carries no `createdAt`**, and no op in the catalogue supplies one.

Three options were considered:

1. **Add a `recordedAt` register seeded by `gear.recorded`.** Rejected: it
   duplicates a fact the envelope already carries, and it would be absent on
   every gear recorded before this slice — so the sort would be wrong for the
   entire existing depot, which is the only depot that exists.
2. **Read `gear.container`'s stamp.** It is the one register with no mutation op
   ([sync §4.3](../sync-protocol.md)), so its clock *is* the recording clock.
   Rejected: it is absent whenever a tolerant read dropped the field, and it
   silently ties the sort to an omission the catalogue records as deliberate.
3. **The minimum stamp across all of the gear's registers.** Taken.

```ts
/** The earliest `(hlc, deviceId)` any of this gear's registers carries —
 *  which is the clock of the op that first addressed it. Convergent on every
 *  replica, because every replica holds identical registers. */
function recordedAt(gear: GearState): Stamp
```

It needs no new field, no new op and no migration; it is correct for gear
recorded before this slice; it is identical on every replica, because the
registers are; and a later edit can never lower it, because a register only ever
accepts a strictly later write. Tag registers are included in the minimum for
the same reason every other register is — excluding them would make the answer
depend on which dimensions happened to exist when the gear was recorded.

`NEWEST FIRST` is descending `recordedAt`, tiebroken by id so the order is
total.

### 3.4 Grouping

`GROUP BY` offers `NONE · KIND` and **never offers TAG**. Components §04 states
the reason and it is a domain fact, not a UI preference: tags are multi-valued,
so a three-tag piece of gear would land in three groups and the "groups" would
not partition the list.

`group: 'none'` returns one group with an empty `key` and `label` — one code
path in the component, not a branch.

`group: 'kind'` orders groups **alphabetically by label** (`Counted`,
`Per-person`, `Single`), which is what the board's grouped frame draws and is
*not* the enum's order. Two cases the tolerant reader makes reachable:

- An **unrecognised** kind value ([sync §5.3](../sync-protocol.md) obligation 4
  stores it verbatim) becomes its own group, labelled with the raw value, sorted
  in alphabetically with the rest.
- Gear whose `kind` register is **absent** groups last, under `—`.

Neither is reachable from anything this app authors. Both are reachable from a
peer running a different build, which is the whole point of tolerating them.

### 3.5 The tag vocabulary

There is no Tag entity. The vocabulary is derived, in `selectors/depot.ts`:

```ts
/** The tags currently applied to this gear, sorted. */
export function tagsOf(gear: GearState): readonly string[]

/** The household's whole tag vocabulary with counts, for both pickers.
 *  Sorted by count descending, then tag ascending. */
export function depotTags(state: HouseholdState): readonly TagCount[]
```

The sort is descending-count-first because the boards draw it that way —
`#winter 23 · #cooking 14 · #sleep 9` in the slice-bar popover, and
`#cooking 14 · #cook-set 3` in the gear-detail sheet. The second pair settles
it: `cook-set` sorts *before* `cooking` alphabetically, so the board's order can
only be by count. The tag ascending tiebreak is what makes it total, and
totality is what stops two devices with identical state drawing the picker
differently.

Retired gear does not contribute to the counts, for the same reason it does not
contribute to `depotCounts` — the picker offers a vocabulary for slicing the
visible depot.

---

## 4. `ui/` receives its first composites

[Architecture §12.4](../architecture-design.md#124-consequences-of-s2b-find-whereabouts-and-the-fold)
names S3 as when this happens, and names the evidence: `Find.module.css` and
`Depot.module.css` share nine byte-identical blocks, and `Find`'s `PlainRow`
duplicates `Depot`'s row JSX. The second copy is what makes the extraction
worth doing; a third would make it overdue.

`ui/src/` holds only `Logo` and `Mark` today. S3 adds two things and no more.

### 4.1 `GearRow` — one component, three renders

Components §03 carries the canonical variant map, and it is built from that,
not invented here:

| Variant | Container width | Anatomy |
| --- | --- | --- |
| `2-LINE` | `< 38rem` | name + trailing whereabouts word; meta line = owner · path · qty |
| `1-LINE` | `>= 38rem` | meta moves inline: name · owner/path/qty · whereabouts right |
| `TABLE-44` | desktop table | the 8-column row |

Three rules travel with it:

- **Picked by `@container`, never by viewport.** Split 900's 308px list pane
  renders the *folded* two-line row even though the viewport is 900. Rows
  respond to the pane they are handed.
- **Find's plain match is the same `2-LINE` row with the meta slot swapped** to
  the `⌂` path. Answer-first is a meta-slot choice, not a new component.
- **Phone rows never show tags.** Tags appear only in the table's `TAGS` column
  (plain mono, ellipsis-truncating) and on gear detail. A tag filter changes
  *which rows appear*, not the rows.

The builder's 40px row is explicitly a **different component** — trailing
action, no whereabouts — and is S6's, not S3's.

`ui/` never imports the store ([frontend-design §5](../frontend-design.md)), so
`GearRow` takes domain data as props and its root is an `<a>` that forwards
`href`/`onClick`. `app/` wraps it in wouter's `<Link asChild>`.

### 4.2 `Chip`

Two sizes, one component: **36px** for the slice bar's filter chips and **32px**
for gear detail's tag chips. Components §04 settles the first — "the chip is
36px everywhere; the 32/36/40 drift across boards is settled here" — and
Components §06 settles the second for the tag chip specifically.

### 4.3 Radix stays deferred

[Frontend-design §5](../frontend-design.md) assigns `Sheet`, `Popover`, `Menu`
and the rest of the interactive primitives to thin Radix wrappers in `ui/`.
Radix is not a dependency yet, and S3 does not add it. The sheets that shipped
in S2 are hand-rolled scrims, the two new surfaces (the sort-and-group sheet,
the tag picker) match them, and pulling in a dependency mid-slice would widen
S3 for no S3 gain. Recorded as a deliberate deferral, not an oversight.

---

## 5. The layout ladder, and who owed it

**No responsive layout ships at screen level.** Exactly one `@media` rule exists
in all of `app/src` CSS — `AppShell.module.css:73`, which turns the tab bar into
a rail — and there is not one `@container` query anywhere. Every board frame
above phone width is greenfield, not a restyle.

That is not S3 scope creep; it is an **unrecorded S0 shortfall.**
[§8.3](../architecture-design.md#83-the-slices)'s S0 entry chartered *"the app
shell only — the five layout modes and nav treatments of
[frontend-design §3.1]"*, and
[§12.1](../architecture-design.md#121-deviations-from-8s-s0-and-why) lists S0's
deviations without mentioning it, so the ladder was believed delivered. Half of
it was:

- **Built** (`ui/styles/layout.css`): the em ladder, the gutter steps, the
  content max-widths, `--nav-size` flipping 56px → 216px, and the nav's three
  treatments.
- **Never built:** the *pane structure* §3.1 promises at Split and Desktop, and
  the entire `@container` layer §3.2 describes. §3.2 also names no owner and no
  breakpoint value — the only number that exists is the boards' annotated
  `~600px`, tilde included.

**S3 absorbs both**, because the boards draw its own content in the missing
pane: Split 900's gear-detail column carries S3's settled tag chips and `+ tag`
ghost. Shipping the slice bar into a pane structure that does not exist would
leave the slice half-drawn.

Two doc amendments go with it, in [§10](#10-doc-amendments).

### 5.1 The container-query breakpoint

`38rem` (608px), one named custom property, used by every component that folds.

The boards annotate `~600px` in three places and frontend-design §3.2 gives no
number at all. 608px is 38rem at a 16px root, which keeps it on the `em`/`rem`
discipline every other breakpoint follows — a reader who raises their font size
crosses it at the right *perceptual* point — and it sits clear of the Split
list pane's 308px on one side and Roomy's 640px shell boundary on the other.

---

## 6. Screens

### 6.1 Depot — the slice bar at five modes

The count line is **one line, everywhere**: `9 OF 128 · CLEAR (1)`. Search and
filters AND together, so S2's shipped `4 MATCHES` becomes `4 OF 128`. Find keeps
its own `4 MATCHES · ON-DEVICE INDEX` — it answers a question rather than
slicing a list, and the two reads are deliberately different.

| Mode | Slice bar | List |
| --- | --- | --- |
| Compact / Comfortable 393 | chips scroll horizontally; readout `NAME A→Z ▾` at the count line's right opens the sort-and-group sheet | 2-line rows, FAB |
| Roomy 540 | chips **wrap** onto two lines; readout stays on the count line | 1-line rows, inline meta |
| Split 900 | as phone, in a 308px list pane | folded 2-line rows (container query) + gear-detail pane |
| Desktop 1024 | expanded `GROUP BY` row; **sort is a column head**, and the `NAME A→Z ▾` control appears only where no heads exist | 8-column table, 44px rows, sidebar |

Ghost add-chips are **dimension-only** (`+ TAG`) and open a picker. The old
value-carrying ghost (`+ TAG: #WINTER`) is retired. `KIND` hides its ghost while
active; `TAG` keeps its, because tags AND together.

`CLEAR (n)` is story 13's "can be undone" criterion, and stays visible while
anything narrows.

### 6.2 Tag pickers — one anatomy, two modes

`docs/design/README.md` §4a; drawn in Screens B §01B.

- **Gear-detail sheet**, from the `+ tag` ghost: `ON THIS GEAR` chips with ✕ ·
  an input well with a fixed, undeletable `#` prefix · `IN THE DEPOT` rows
  **with counts**, so near-duplicates become visible at the moment they would be
  created · a visibly distinct accent `+ CREATE #…` row.
- **Slice-bar mode**, from the `+ TAG` ghost chip: the same sheet minus
  `ON THIS GEAR` and minus `+ CREATE`. It picks from what exists and **never
  creates**. A popover at Split and Desktop, a sheet below.

Input is normalised as typed, and that normalisation **is** the op payload.

**Trip-only gear is never tagged** (invariant 9). Neither picker ever mounts on
it. Nothing enforces this in S3 because trip-only entries are not Gear
aggregates and so have no tag register to write — it is stated here because the
trip-side screens reuse this exact chip and picker from S7 on.

### 6.3 Gear detail

The settled tag chip row: lowercase, mono 10.5, 32px, bordered, `#` drawn never
stored, with a trailing dashed `+ tag` ghost. That ghost is the **one** edit
affordance on this read screen. **✕ lives in the picker, not on the chips.** A
gear with no tags shows the lone ghost.

Removal confirms nothing — one op, instantly reversible by re-applying.

### 6.4 Add gear (F1), rebuilt to R2

The shipped screen no longer matches the boards. Order is **the ledger line
being written**: title (+ right mono `7 RECORDED` once recording) · NAME (48px
well, focused on open) · KIND segmented 48px · **Owned count** — Counted only,
inserted *below* Kind so nothing at or above the thumb moves, stepper-flanked,
**opens empty and gates the CTA** because a silent ×1 is a wrong ledger line ·
HOME row (48px bordered, defaults `Loose`, **carries over between records within
a sitting**) · **RECORDED AS** segmented `ITEM · CONTAINER` — the trait sits
last, being the rarest decision and the only irreversible one; round 1's
checkbox is retired, because a checkbox reads as a setting · CTA · mono fact
line.

**After Add the screen stays.** Round 1's navigate-to-detail is retired. Name
clears and keeps focus so the batch loop is type → return → type; Kind, count
and trait reset; Home persists; a confirmation line appears under the title.

See [§8](#8-two-deliberate-departures-from-the-boards) for what that line does
*not* carry.

### 6.5 Home picker, rebuilt to R2

One sheet, **two modes**, shared by Add Gear and gear detail's `MOVE`.

**Pick mode** (default) is the fast path: every row a bare tap target, and
selection closes the sheet. `Loose` first and two-line (`NO RESIDENCE — THE
DEFAULT`); the current home marked `● NOW`; Places as `⌂`-prefixed
sentence-case rows with containers nested beneath, **indent 16px per level
capped at two levels below the Place** — deeper rows keep the cap indent and
carry their skipped ancestry as a meta line, replacing round 1's inline parent
prefix. A dashed `+ New place` keeps creation in the pick path, and a place
created while picking is **selected immediately**.

**Edit mode** (`EDIT` → `DONE`) suspends selection: Place rows gain RENAME and
REMOVE, container rows and Loose dim — containers are gear, renamed from their
own EDIT. REMOVE always confronts the loose count first, in a bordered attention
button, never a filled red one.

**MOVE** adds a context line (`MOVING CRATE B · 5 INSIDE RIDE ALONG`) and makes
the moved gear and its whole subtree **absent at any depth**, with one footer
line saying so. Components §05's old blocked-rows mock is retired: a picker
never shows un-pickable rows.

---

## 7. Slice persistence

> Sort and group persist per device. Filter chips and search reset on a fresh
> start, and survive navigation.

Sort and group go to `localStorage`. This deviates from the app's
IndexedDB-for-everything pattern (`app/src/db.ts` owns one database for auth and
the op log), and the reason is that **`localStorage` is synchronous**: an async
`META_STORE` read would paint the default sort on every mount and then flip it,
on the app's most-visited screen. The data is a two-field per-device UI
preference with no durability requirement, no sync, and no household meaning —
losing it costs one tap. It is not household data and must never hold any.

Filters and search are ordinary React state, so "reset on a fresh start" is what
happens by construction, and "survive navigation" is what lifting them to the
route's owner gives.

---

## 8. Two deliberate departures from the boards

Both come from the same source: **story 36, Undo, is Later and opens with a
design phase.** Until that design lands, the MVP does not lean on Undo — a
screen that would drop a confirmation on the grounds that Undo exists keeps its
confirmation instead.

### 8.1 Add gear's confirmation line ships without `UNDO`

Screens A §06 specifies `UNDO restores the record into the form and removes the
op`. **The second half is not expressible.** The op log is append-only, the op
may already have been pushed, and story 36 rules out the only compensating op
that exists: *"It does not leave the Gear marked, Retired, or otherwise visibly
different from how it stood before"* — which is precisely what `gear.retired`
would do.

A local-only retraction before push was considered and rejected against story
36's own third criterion: *"It never quietly becomes a weaker kind of reversal
because time passed, because the change reached the rest of the Household, or
because I was offline when I made it."* An UNDO that works for four seconds and
then silently stops is that failure exactly.

So S3 ships the confirmation line — `RECORDED · GAS CANISTER 450 G → CRATE B`,
tappable to open the record's detail — and no UNDO affordance. The board element
should gain a scope tag; the design is not wrong, it is blocked on story 36.

### 8.2 The Home picker's `MOVE` gains a confirm

Screens A §07's MOVE ends `Selection moves and closes; UNDO per the global
rule`. With no global Undo rule in force, a mis-tapped destination in a nested
picker is unrecoverable without re-navigating. MOVE therefore confirms before
emitting `gear.rehomed`, carrying the same ride-along count the context line
does.

---

## 9. Tests

Per [`testing.md`](../testing.md). The named Tier 2 scenario for this slice is
**concurrent tagging must union, never clobber**.

### 9.1 Tier 1 — unit

- **`tags.test.ts`** — `normalizeTag` over case, whitespace runs, a typed `#`,
  a doubled `##`, punctuation, the 40-char cap, and the inputs that normalise
  to `null`.
- **`reduce.test.ts`** — both ops; apply then remove then apply; an out-of-order
  arrival losing at O(1); two tags on one gear as two registers; **a
  non-conforming tag folding exactly as received**, built by hand-shaping an
  `OpSpec` through `anOp`, which is how a foreign build's op reaches us; and
  identity preservation on a lost write, so a memo downstream is not
  invalidated for nothing.
- **`slice.test.ts`** — the bulk. Each dimension alone; two dimensions composed;
  several tags ANDing; search ANDing with filters; a dimension with no selected
  values not participating; all three sorts including `recordedAt`'s
  derivation and its stability under a later edit; both groupings; the
  unrecognised-kind and absent-kind groups; and `shown`/`total`/`active`.
- **`depot.test.ts`** — `tagsOf` and `depotTags`, including the count-descending
  order, the alphabetical tiebreak, and retired gear contributing nothing.

### 9.2 Tier 2 — convergence, the signature tier

- **The named scenario**, pinned: A applies `food` while B applies `kitchen`,
  offline; they exchange; both hold both. Asserted as a union, and asserted
  *because* the two writes never met — the registers are distinct.
- **Concurrent apply and remove of the same tag** resolving by LWW on
  `(hlc, device_id)`, in both directions, with the loser's clock proving it lost
  rather than never arriving.
- **Both op types added to `arbSpec`**, with tags drawn from a **small shared
  pool** for the same reason the gear and place ids are: with a large pool two
  devices would never contest one register, and the property would prove a union
  rather than a merge.

### 9.3 Tier 3 — component

The filter cluster is this tier's named target. Depot's chips, count line and
`CLEAR (n)`; the sort-and-group sheet; both tag-picker modes, including that the
slice-bar mode offers no create row; gear detail's chips and ghost; Add gear's
R2 batch loop and its gated Counted well; the Home picker's two modes and the
MOVE exclusion. `ui/` gets `GearRow.test.tsx` and `Chip.test.tsx`.

### 9.4 The fixture rule

[§8.7](../architecture-design.md#87-what-every-slice-must-preserve-not-deliver):
**capture an op fixture in the same commit as the slice that introduces the op
type.** S3 owes fixtures for `gear.tag_applied` and `gear.tag_removed`, replayed
by the backward-compatibility group through the current reducer. A fixture
written later is captured from a format that has already drifted.

---

## 10. Doc amendments

| Doc | Amendment |
| --- | --- |
| `architecture-design.md` §12.1 | New entry: the S0 layout shortfall — the shell ladder landed, the pane structure and the `@container` layer did not |
| `architecture-design.md` §8.3 | S3's entry names the Split two-pane and the `ui/` extraction among its deliverables |
| `architecture-design.md` §12 | New §12.5, consequences of S3 |
| `frontend-design.md` §3.2 | The container-query breakpoint gains a value (`38rem`) and an owner |
| `design/README.md` §4a | Drop "PROPOSED for `docs/sync-protocol.md` §4" — it landed in `84ecd9b` |
| `CLAUDE.md` | Current status: S3 shipped; next slice |

---

## 11. What this slice deliberately does not build

- **`SAVED SLICES` (story 34) and the whole bulk bar (story 35).** Later, not
  MVP, and tagged on the boards. Story 34 attaching to this engine with no
  structural change is the test that the engine was built at the right altitude.
- **Undo (story 36).** Later, and opens with a design phase. See
  [§8](#8-two-deliberate-departures-from-the-boards).
- **The LEDGER group** on gear detail (story 33) and every **weight** total
  (story 16). Drawn final, tagged LATER.
- **Any dimension past Tag and Kind.** Components §04 draws the ladder dashed
  and it is *never available early*. A dimension arrives with the slice that
  gives it meaning; offering `PERSON` before People exist would be a control
  that filters by nothing.
- **A Tag entity, or a rename op.** Settled, permanently. A misspelling is fixed
  by remove + apply, and the picker is the only defence.
- **Radix.** See [§4.3](#43-radix-stays-deferred).
- **Any endpoint.** The server has no op vocabulary
  ([sync §6.2](../sync-protocol.md)); two new op types are a client-side deploy.

---

## 12. What the build changed, and why

This spec was written before the code. Four things it did not foresee, kept
here so the spec is not read as a record of what shipped — the durable record
is [architecture §12.5](../architecture-design.md#125-consequences-of-s3-tags-and-the-slicing-engine).

- **Normalisation needed two halves.** [§2](#2-tagstring--an-authoring-rule-not-a-validation-gate)
  assumed one `normalizeTag`, applied on every keystroke. A failing picker
  test found that it trims the trailing hyphen — as a *finished* tag must —
  and so eats the space in `cook set` before the `s` arrives to give it
  something to separate, silently storing `cookset`. `normalizeTagInput` is
  the typing-time half; `normalizeTag` is now defined in terms of it, so there
  is one pipeline and no third rule between what a field shows and what an op
  stores.
- **`GearRow`'s table variant is a prop, not a container query.**
  [§4.1](#41-gearrow--one-component-three-renders) repeated Components §03's
  "picked by `@container`, never by viewport" for all three renders. It holds
  for `2-LINE` ↔ `1-LINE` and not for `TABLE-44`, which is a different DOM:
  choosing it in CSS means rendering both sets of cells and hiding one, which
  duplicates every fact in the accessibility tree — and Roomy's widest
  container (~672px) against Desktop's narrowest table (~760px) leaves a 24px
  margin that would break at one untested viewport.
- **The desktop arrange row keeps its `SORT` options.**
  [§6.1](#61-depot--the-slice-bar-at-five-modes) took the board's "sort on
  desktop = click a column head" literally. No column shows when a piece of
  gear was recorded, so column heads alone leave `NEWEST FIRST` unreachable at
  that width. The `GEAR` head toggles A→Z / Z→A *and* the options stay.
- **`depotTags` became `dimensionValues`.** [§3.5](#35-the-tag-vocabulary)
  scoped the derived vocabulary to tags. The `+ KIND` ghost chip needs the
  identical list, and so will every dimension S4 through S10 adds — so it is
  per-dimension, which is also how an unrecognised Kind from a peer on another
  build reaches the menu at all: it is in the depot, so it is offered, with no
  list of known values for anyone to have forgotten to update.
