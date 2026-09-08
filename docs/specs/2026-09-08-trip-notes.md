# S12 — Trip notes

**Story 12.** Ops: `trip.note_posted`, `trip.note_kept` — both already in the
catalogue ([sync §4.4](../sync-protocol.md)). No endpoint, no migration, no
change to the slicing engine, no `ui/` component. Design authority:
`docs/design/README.md` **§5l**, rulings **I1–I8** (the shared shell) and
**I9–I20** (this slice), drawn on
`docs/design/S12 + S13 Round - Notes and Tasks.dc.html`.

**This slice is built in parallel with S13** (story 15, pre-trip tasks), in a
second worktree branched from `main`. Architecture
[§8.6](../architecture-design.md#86-what-can-be-built-in-parallel) grants that
on one condition — *the shell is settled first* — and §1 below is that shell.
It is S12's first commit and it belongs to neither slice.

## Decisions at a glance

| # | Decision | Ruling |
|---|---|---|
| 1 | The panel row is a shared wrapper, landed on `main` before S13 branches | I1, I2, I7 |
| 2 | `NOTES` sits between the over-claim band and `GEAR LIST`, second of two | I1 |
| 3 | A missing panel draws nothing — no band, no gap | I2 |
| 4 | The composer is a screen, `/trips/:id/note`, not a sheet | I9 |
| 5 | *About this Entry* is the composer's `ABOUT` row, never a host row | I10 |
| 6 | Oldest first; the envelope's clock; no byline | I11 |
| 7 | No edit, no delete, and nothing on screen says so | I12 |
| 8 | Absent `kept` is a third state — unreviewed | I13 |
| 9 | The review is a card above F5's close card | I14, I20 |
| 10 | Notes do **not** join the close gate | I15 |
| 11 | A discarded Note never vanishes | I16 |
| 12 | Post, keep and discard stay live on a closed Trip | I17 |

---

## 1. The shared shell — what lands on `main` first

The Trip screen gains two panels, and only one of them is this slice's. Both
sit in the same slot, so the slot itself is neither slice's to invent:

```
screen band → header block → EDIT → over-claim band → TASKS → NOTES →
GEAR LIST band + groups → the phone's add affordances
```

Bounded panels above the one unbounded region (I1). A panel below fifty-eight
gear rows is the dead end `EDIT LIST ›` was added to close.

**The wrapper.** I7 puts the two panels in a container query — stacked
edge-to-edge below a 40rem container, `1fr 1fr` with gap 24 as bordered cards
from there, a lone panel capped at A10's 560. Side-by-side means a real parent
element, so `app/src/components/TripPanels.tsx` is that parent: it takes
`children`, and **renders `null` when it has none**, which is I2 stated
structurally rather than by two callers agreeing to behave. S12 adds
`<NotesPanel/>` as a child; S13 adds `<TasksPanel/>` before it. Neither edits
the other's line, and neither owns the query.

**This is the branch point.** The wrapper, its CSS module and its shape test
land as S12's first commit and fast-forward onto `main` on their own. From that
commit S13 may branch: after it, the two slices share no file that either one
writes to — `notes.<id>` and `tasks.<id>` are disjoint registers
([sync §3.7](../sync-protocol.md)), the panels are separate components, and
Trip.tsx sees one added line from each.

The shell commit builds no panel. A wrapper with no children draws nothing, so
`main` between that commit and S12's second is exactly the Trip screen it is
today — which is also the proof that I2 holds.

## 2. The register and the two ops

[Sync §3.7](../sync-protocol.md) has always carried the row; `TripState`'s own
docblock has named it since S7 (*"entries, the first of the three remaining
nested maps — pieces, tasks, notes — belong to S8 onward, and a slice adds its
own row rather than pre-declaring everyone else's"*). This slice adds it.

| Entity path | Registers |
| --- | --- |
| `notes.<note_id>` | `text`, `entry_id`, `kept` |

```
trip.note_posted  { note_id, text, entry_id? }   creates the Note
trip.note_kept    { note_id, kept: bool }        true = kept, false = discarded
```

**A map of entities, not of registers** — `entries`' shape, not
`participants`'. `writeNote` nests inside `writeTrip` exactly as `writeEntry`
does, carrying the same identity guard for the same reason: a losing write must
return the identical object, or `slice.ts`'s `WeakMap` memo is invalidated by
an op that changed nothing.

**`text` is written unconditionally by `trip.note_posted`**, which makes it that
op's `trip.created`-shaped seed: unlike `trip.entry_added`, identity alone is
never ambiguous here, because a posted Note always writes at least one register.
`entry_id` is written **only if present** (`writeIfPresent`) — an absent field
leaves the register alone, and `null` clears it
([sync §1.3](../sync-protocol.md)); the composer sets it at post time and no op
addresses it again (I10).

**The reducer folds both unconditionally.** `kept` may arrive before the
`note_posted` that creates the Note — a peer reviewing on another Device while
the post is still queued — and `writeNote` creates the entity for any Note op,
so a Note can hold a `kept` register and no `text`. That is a reader's problem,
not the fold's; §3 says what it draws.

Fixture: `shared/fixtures/s12-notes.ops.json` +
`shared/src/fixtures.s12.test.ts`, captured in this slice and not a slice late —
S4's debt, and the lesson [`testing.md`](../testing.md) took from it.

## 3. The selectors — `shared/src/selectors/note.ts`

- **`notesOf(trip): NoteView[]`** — every folded Note, **oldest first** (I11),
  ordered by the `text` register's own stamp, ties broken by note id so two
  replicas order identically. A Note with no `text` register is folded, retained
  and **excluded from every list and every count** — S7's sourceless Entry, one
  aggregate row over: an entity nobody can draw a default for is not a line
  anybody can draw.
- **`noteKeptOf(note): boolean | undefined`** — `kindOf`'s shape, and I13's
  whole point. This is the one place in the slice where absent is **not**
  `ownerOf`'s rule: absent is a third state, *unreviewed*, and the surfaces draw
  three things. `true` appends `· KEPT`, `false` takes the RETIRED grammar plus
  `· DISCARDED`, `undefined` draws plain.
- **`noteCounts(trip): { total, toReview }`** — `total` counts every Note,
  discarded ones included (I16); `toReview` counts those with no `kept`
  register. F5's band reads `3 NOTES · 2 TO REVIEW` and drops the second segment
  at zero (G3's rule); the trip screen's reads `4 NOTES` and drops the count at
  zero (I3, I18).

For S14, stated here because S14 will read it and should not re-derive it: **a
Note not discarded is copied** — kept *and* unreviewed both travel (I13). A
discarded Note does not (I16).

## 4. The `NOTES` panel — `app/src/components/NotesPanel.tsx`

The `GEAR LIST` band's anatomy in **every** state, empty included (I6): label
`NOTES`, count `4 NOTES`, trailing `+ NOTE`. No `›` — it is a screen, not a
sheet, and the band link's grammar says which. Rows are text 15/22 in ink, whole
and unclamped, over mono 11 muted meta:

```
Ran low on gas by day 2. Bring ×6 next time.
2026-08-15 19:40 · ABOUT: GAS CANISTER 450
```

The clock is the **op envelope's**, rendered by `format.ts`'s one
`formatDateTime` in the reader's own zone, no zone suffix. **No byline** (I11):
the envelope carries a `device_id` and a Device is not a Person, so a name here
would be the `API FIELD` rule broken — copy blocked on a field that does not
exist is omitted, never faked.

The `ABOUT:` segment is the `LABEL: value` grammar and reads **on the note
alone**, never on the Entry's row (I10). A Note about an Entry since removed
keeps reading: the reference is to an id, and the Entry's own tombstone says
nothing about a sentence somebody wrote.

Empty (I18): the band with `+ NOTE`, then `0 NOTES.` and *Notes are reviewed at
the unpack pass.* — the `0 ENTRIES.` pattern, a permanent domain fact rather
than a promise.

Capture is live at **every width** (I4). The Split read/edit split exists
because the builder needs a second pane; this panel has none, and the
laptop-after-the-trip note is story 12's own case.

## 5. `/trips/:id/note` — the composer and the `ABOUT` picker

**A screen, not a sheet** (I9), for a mechanical reason: the `ABOUT` picker must
stack on top of the composer, and a picker over a picker is the shape §3b's rule
and `/trips/new`'s precedent already refused.

Header `‹ ALPS 2026` at every width — `useScreenHeader` with `splitPane: false`
and `atDesktopSidebarCarriesDestination: false`, `GearListBuilder`'s trip door
being the existing caller whose destination the sidebar cannot name. Title
`Note`; a multiline well focused on open, where **return is a newline**; the
`ABOUT` row; a pinned accent `Post note` gated on non-blank text — whitespace is
empty. No counter and no cap. Post returns to its caller, which is either the
trip screen or F5.

**The `ABOUT` row** is Add gear's `HOME` row: 48px, bordered, opening a picker
in the Home picker's anatomy — `The trip` first with meta `NOT ABOUT ONE ENTRY`
and `● NOW` on the current value, then the Trip's Entries A→Z, fact line `ONE
ENTRY ON THIS TRIP, OR THE TRIP`. Selection closes; the scrim dismisses
(`patterns.md` §4.2 — a picker dismisses, a decision does not). The picker is
pure selection and the composer decides (§4.3): `entry_id` is set at post and
never after.

**Nothing on either surface says a Note cannot be edited** (I12). S7's
un-renameable trip-only Entry is the precedent, and the defence here is better
than it was there: the text is on screen before `Post note`. The missing edit
and delete stay filed as a requirements gap in the sync protocol; a string in
the app naming a missing op is release meta-text for a Quartermaster
mid-sitting.

## 6. The review card on F5

A surface card **after the groups and directly above the close card**, so the
close card stays the list's last card (F11, I14). Band `NOTES` ·
`3 NOTES · 2 TO REVIEW` — the second segment in ink, as `6 OPEN` is — with the
same trailing `+ NOTE`, opening the same composer (I20).

Row routes are the settle-routes grammar, and **a reviewed row shows the other
route only** (I14, and `patterns.md` §2.3 — the route that would rewrite the
value it already holds is a needless write, and this one is visible):

| State | Meta | Routes |
|---|---|---|
| unreviewed | `2026-08-15 19:40 · ABOUT: GAS CANISTER 450` | `KEEP` `DISCARD` |
| kept | `… · KEPT` | `DISCARD` |
| discarded | `… · DISCARDED`, row struck and muted | `KEEP` |

A discard is reversed by `KEEP` and vice versa; both are one op.

**The card renders wherever F5 has a list** — gated or at open = 0, and on a
closed Trip. It is withheld only where F19 withholds everything, with the
`0 ENTRIES.` empty state (I20). Neither the `DESTINATION | PERSON | ALL` control
nor the `○ OPEN` pill touches it.

**Notes do not join the close gate** (I15). Invariant 18 is exact — *"every
entry and every per-person piece"* — and its purpose is the Depot: the close
writes a consumed reduction and an outcome settles a claim, while a Note writes
nothing anywhere. The summary line, the button's gating and both hints are
untouched. Story 12's *"at the Unpack pass I review"* is satisfied by the card
being on the path to Close and stating its own count; a Quartermaster who skips
it loses nothing that a discard would have removed.

## 7. Phase, and the closed Trip

**Post, keep and discard stay live at every phase, closed included** (I17).
`patterns.md` §3.8's test is *does an invariant close the write*, and none does:
19 and G6 freeze **outcomes**; 14 keeps notes as history in as many words; 16
locks no editing capability at all; and story 12 says *mid-trip or after*. The
November note posted against a July Trip is the case the story names.

Concretely: F5's `record` prop is invariant 19's and **does not reach the card**.
On a closed Trip every pill loses its border and the row body routes to gear
detail, while `KEEP` · `DISCARD` · `+ NOTE` stand.

## 8. What this slice does not do

- **No op is added and nothing is escalated to the domain.** Both ops were
  catalogued at planning time; unlike S11, the domain had nowhere left to be
  asked.
- **No promotion** (I19). Story 12's promotion clause is Later, waiting on
  stories 17–19; the entry reference *is* the seam (domain §10), so the panel
  draws no `LATER` tag and no ghost row.
- **No sixth line on the Trips card** (I5), for notes or for tasks. The card's
  five elements are full and the NEXT line carries the obligation.
- **No `ui/` change.** Nothing here has a second caller.
- **No slicing dimension.** Story 13 completed at S9b
  ([§8.5](../architecture-design.md#85-where-story-13-attaches) as corrected),
  and a Note is not a property of a piece of Gear.

## 9. Tests

- **Tier 1, `shared/`** — the reducer folds both ops; `entry_id` present, absent
  and `null`; a `note_kept` landing before its `note_posted`; a Note with no
  `text` excluded from `notesOf` and both counts; `noteKeptOf`'s three answers;
  oldest-first ordering with a tie broken by id.
- **Tier 2, convergence** — two Devices posting different Notes offline, both
  surviving (§8.6's own case for these two slices being disjoint); one Device
  keeping while another discards the same Note, resolving by plain LWW to the
  same answer on both.
- **Tier 3, `app/`** — the panel's three row states and its empty state; the
  band's count dropping at zero; the composer's gate on whitespace; the picker
  writing `entry_id` and `The trip` writing none; F5's card above the close
  card, its `2 TO REVIEW` segment absent at zero, and its absence in F19's empty
  branch; the reviewed row offering one route; the closed Trip keeping all three
  controls.
- **The shell commit's own test** is a shape test: `TripPanels` renders nothing
  with no children, and the query container is the panel row rather than
  `.screen` — jsdom computes no layout, so the assertion is structural, as
  `drawnSizes.test.ts` and the FAB tests already are.
- **Fixture** — `s12-notes.ops.json`, both op types, captured in this slice.

## 10. Documentation owed

`sync-protocol.md` §3.7's Trip register map (mark the `notes` row built) and the
§4.4 catalogue rows; `architecture-design.md` §12's new consequences section and
§8's S12 entry; `patterns.md` if the composer screen or the third-state selector
turns out to be a new shape rather than an instance of an existing one;
`CLAUDE.md`'s status section. `design/README.md` **is not rewritten** — §5l is
the shipped authority, and anything this slice's code decides that no ruling
reached goes there, not only into this file. That is S9 round 4's lesson: a
dated spec is invisible to the next design round.
