# The per-person Entry in CONTAINER mode

The implementation design for **S9 round 2**, which rules the one hole S9a
recorded: a per-person Entry's own trip residence can be written by nobody, so
CONTAINER mode and ALL mode stated different places for the same gear.

This is a **feature spec**: retired once it has shipped. **No op types, no
endpoints, no migration, no `shared/` state change.** Everything here is read
side — one reader gate, one grouping rule, one arithmetic, one meta line.

**The boards are the authority.** [`docs/design/README.md`](../design/README.md)
**§5e C** (C0–C5) and `S9 Round 2 - The Per-person Entry in CONTAINER Mode.dc.html`
rule everything below; where this document and §5e disagree, §5e wins and this
document is wrong.

**The product question was ruled before the round**, by the maintainer: **for
per-person gear, *where it is* is only ever a per-Piece fact.** Nothing sits
above the Pieces. That follows
[`domain-model.md`](../domain-model.md)'s own sentence — *"Each piece is tracked
and packed on its own; each can be removed individually."* — and it is what
eliminated one of the two candidates the README had recorded, before any frame
was drawn.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types · endpoints · migration | **None.** Read side only |
| A per-person Entry's own `residence` | **Folded and never read** — the `bring_count`-on-non-Counted shape (C0) |
| A Piece with no `residence` | Reads **loose**, never its Entry's. Overturns S9a spec §11.2 (C0) |
| Group membership | **One row per group holding at least one of the Entry's Pieces** (C1) |
| Unplaced Pieces | Draw under `Loose` — it means `NOT IN A CONTAINER`, not *undecided* (C4) |
| The cluster | Scoped to the group's Pieces. A one-circle cluster is a legal cluster (C1) |
| Absent Pieces | **Never a dashed circle** — that is `PersonCluster`'s word for *excluded* (C1) |
| The meta line | `PER-PERSON · 1/1 · 2 ELSEWHERE`, `N ELSEWHERE` only above zero (C2) |
| `PER-PERSON · 1/3` | **String unchanged**, meaning narrowed to *packed over Pieces in this group* (C2) |
| The sheet | Lists **all** of the Entry's Pieces, from any row (C3) |
| Header counts | **Pieces, apportioned** — a partition, exact to the trip total (C5) |
| ALL and PERSON modes | Untouched. Both already read per-Piece |

---

## 1. The reader gate (C0)

`trip.entry_moved` on a per-person Entry is **fold-but-ignore**. The reducer
keeps folding it — a peer on another build may write one, and
[sync §5.3](../sync-protocol.md)'s tolerant reader is absolute — and no reader
consults it for this Kind.

This is the third instance of a shape the codebase already has twice:
`bringCountOf` returns `null` for anything non-Counted whatever the register
holds, and `statusOf` returns `null` for a container whatever the register
holds. **Add the third gate beside them**, named, in `shared/src/selectors/`, so
no call site re-derives it:

```ts
/** The Entry's own trip residence, or `null` for a per-person Entry — whose
 *  *where* is only ever a per-Piece fact (§5e C0). */
export function entryResidenceOf(
  entry: EntryState,
  state: DepotState,
): TripResidence | null
```

**Two S9a decisions fall with it**, both recorded in that slice's §11.2 and
§11.4. §11 is a **dated record and is not edited** — this document is where the
overturn lives:

- *"a Piece with no `residence` register of its own reads its Entry's, then
  loose"* — **overturned.** It reads **loose**.
- *"a Piece cannot be pinned against a later Entry move"* — **moot.** There is
  no Entry move for this Kind to be pinned against.

---

## 2. Group membership (C1, C4)

Today a group's `rowIds` come from the containment view, which resolves **Entry**
residences. Under the ruling that is right for Single, Counted and trip-only
Entries and wrong for per-person ones.

**A per-person Entry belongs to a group when at least one of its Pieces is
there**, and it draws **one row per such group**. The two frames the boards
already carry are the two ends of that one rule: all Pieces together is today's
single clustered row; all Pieces apart is a row under each group. **One rule,
both frames stand** — no drawn frame changes.

Unplaced Pieces read loose, so a per-person Entry with one Piece in the duffel
and two unplaced draws a row under the duffel **and** under `Loose` (C4).
`Loose` means `NOT IN A CONTAINER`; hiding those Pieces from it would make its
header lie about its contents, which is the fault this round exists to remove.

`PackingGroup.rowIds` therefore stops being a list of Entry ids and becomes a
list of **rows**, each naming the Entry and — for a per-person Entry — the
Pieces of it that sit in that group:

```ts
interface PackingGroupRow {
  entryId: string
  /** The Entry's Pieces in THIS group. Absent for every other Kind. */
  personIds?: readonly string[]
}
```

---

## 3. The arithmetic (C5)

A container header counts **Pieces, at any depth, apportioned**: a per-person
Entry spanning two groups contributes to both, each Piece counted once at its
own place. That makes the top-level groups plus `Loose` a **partition** of the
trip's items, so they sum to the trip total exactly and `● 48/61` does not move
when a Piece changes bags.

`containerTotals` currently filters `items` by `item.entryId` against the
container's subtree — i.e. by the **Entry's** holder. It must filter by **each
item's own residence** instead.

**One thing this exposes, and it is load-bearing for the exactness C5 claims.**
A Piece's residence is a raw pointer and can name an Entry that this replica has
not folded, has seen removed, or that is not a container — the same four
loose-reasons `tripContainmentView` already resolves for Entries. Unresolved,
such a Piece lands in **no** group and the partition silently stops summing to
the total.

So `packingItems` must return **effective** residences, resolved through the
containment view, exactly as an Entry's is. It takes the view as an optional
parameter for the reason `containerTotals` already does — a screen builds one
view, not one per group.

---

## 4. The row (C2)

Scoped, and it names the rest:

- `PER-PERSON · 1/1 · 2 ELSEWHERE` under the duffel
- `PER-PERSON · 0/1 · 2 ELSEWHERE` under `Loose`
- `1 ELSEWHERE` pinned at `N=1` (§5b M)

**`N ELSEWHERE` appears only above zero**, which is what keeps
`PER-PERSON · 1/3` standing on every drawn frame with its meaning narrowed to
*packed over Pieces in this group*. **The string does not change; its meaning
does.**

**Muted, not amber** — a remainder, not a residence. The residence is the
header, and a set in two bags is not a fault.

**`N ELSEWHERE` counts the whole Entry even under `○ LEFT`.** It says where the
rest of the set is, not what the filter is showing.

**Accessible name:** `Headlamp, 1 of 1 packed here, 2 elsewhere`.

**The cluster is scoped to the group's Pieces**, and a one-circle cluster is a
legal cluster. **Absent Pieces are never drawn as dashed circles** — dashed and
dim is `PersonCluster`'s word for *excluded* on the builder, and a removed Piece
is not drawn on F4 at all, so a dashed circle here would read *not bringing
one*, the state invariant 11 expresses by removal. One tone may not mean two
things across two callers of one primitive (§5d J).

The cluster **and its count remain one control** (§5d B, §5e A1). Scoping
changes what it covers, never that it is one target.

---

## 5. The sheet (C3)

**One sheet per Entry, never one per row.** Opened from any of the Entry's rows,
it lists **all** of that Entry's Pieces: the title is the gear name, the fact
line is Entry-wide, `SET EVERYONE` means everyone, and each row already names
its own Piece's residence — so it is the one surface where the split is seen
whole and mended at `MOVE`.

This is believed to be **already true** — the sheet takes an `entryId` and
derives its rows from the Entry. Verify rather than assume, and pin it with a
test opened from a scoped row.

**Cost, accepted:** a status tap in the sheet may move a count under a header
elsewhere on the screen. Ruling A2b's confirm is **not** owed — the sheet shows
the change in place, and a status tap has never confirmed.

---

## 6. What is untouched

- **ALL mode** and its `▸ MIXED`. Already per-Piece, already correct.
- **PERSON mode.** Already partitions a per-person Entry into Pieces (A7).
- **The row's two targets** (A2) — a per-person row's body opens the sheet on
  every row C1 draws.
- **`Loose` last** (A3); **a container is not a piece** (A5); the journey rail,
  the ▲ threshold, the Pack picker, the container-move confirm.
- **Every op type, the reducer, and all folded state.**

---

## 7. Tests

- **The gate:** `entryResidenceOf` answers `null` for a per-person Entry **even
  when a `residence` register was folded** — the tolerant reader's own case,
  since a peer on another build may write one.
- **A Piece with no residence reads loose**, not its Entry's — asserted against
  an Entry that *has* a residence, so the old fallback would fail it.
- **Membership:** a per-person Entry with Pieces in two containers draws a row
  under each; with one Piece placed and two unplaced, a row under the container
  **and** under `Loose`; with all Pieces together, exactly one row (today's
  frame, unchanged).
- **The partition is exact:** the top-level groups' counts plus `Loose` sum to
  `packingTotals`. Build a fixture where a per-person Entry is split, and assert
  the sum **before and after** moving one Piece between bags — the total must not
  move. This is the assertion C5's claim rests on.
- **A Piece pointing at a removed container** is counted under `Loose`, not
  dropped — the case that would silently break the partition.
- **The meta line:** `PER-PERSON · 1/1 · 2 ELSEWHERE`; `N ELSEWHERE` absent at
  zero, so an all-together Entry still reads `PER-PERSON · 1/3`; `1 ELSEWHERE`
  singular; the remainder still counts the whole Entry under `○ LEFT`.
- **The accessible name** on a scoped row.
- **No dashed circle** appears on any F4 row.
- **The sheet lists all Pieces** when opened from a scoped row.

---

## 8. Doc amendments

- **[`domain-model.md`](../domain-model.md) §5** says each Entry carries a trip
  residence. One sentence: a per-person Entry's is folded and never read,
  because *where it is* is only ever a per-Piece fact.
- **[`sync-protocol.md`](../sync-protocol.md) §4.4** lists `trip.entry_moved`
  with no Kind restriction. One sentence, beside the identical notes
  `TagString` and `bring_count` already carry: the restriction is an
  **authoring rule gated on the way out**, never a reader gate — the `stage`
  xor `status` shape.
- **S9a's spec §11 is NOT edited.** It is a dated record. This document is
  where its two overturned decisions are recorded.
- **[`technical-debt.md`](../technical-debt.md)**: the per-person-residence
  entry **closes** — delete the line. Its anchor phrase lives in
  `design/README.md` §1 and stays there as the record of how the hole was found.
- **`CLAUDE.md`**: a short paragraph after S9a's, noting the round and the one
  rule a reader needs — *where* is per-Piece for per-person gear.

---

## 9. What this does not build

- **Any control for moving a per-person Entry as a whole.** The fact does not
  exist; there is nothing to move.
- **`▸ MIXED` in CONTAINER mode.** C1 removes the need for it — a row is only
  ever in one group.
- **Anything in S9b.** It reads what this rules.
- **A correct `N INSIDE RIDE ALONG`.** The container-move confirm's
  `insideCount` still walks the Entry tree, so it counts a per-person Entry
  whose Entry-level `residence` names the container — and under C0 such an
  Entry does **not** ride along, its Pieces having residences of their own.
  Reachable only through a foreign client's op, since no shipped control writes
  that register. Left standing on purpose: the confirm belongs to **ruling
  A2b**, not to this round's C0–C5, and the consistent fix is one more consumer
  of the item-residence rule — a decision for a later round rather than a
  bolt-on past this round's remit. Recorded in the code at the call site too.

---

## 10. What changed during implementation

Two things this document would otherwise mislead a reader about, and two
findings the final whole-branch review turned up that are **recorded rather
than fixed**. All four sit here rather than edited into the sections above, the
precedent
[`trips-and-phases.md`](2026-08-29-trips-and-phases.md) §10 and
[`the-gear-list.md`](2026-08-29-the-gear-list.md) §11 set: a dated spec is left
as it was written, and what moved lives in its own section.

**`tripContainmentView` is deliberately NOT gated on the ruling.** §1 reads as
though `entryResidenceOf` retires the Entry-level register everywhere, and it
does not: the view still resolves a per-person Entry's own residence, so
`holderOf` can place one under a container and `childrenOf` will list it there.
Gating was considered and refused for three reasons. The view resolves
**structure**, and its four loose-reasons are about whether a *pointer* can be
followed — an unfolded target, a removed target, a non-container target, a
cycle — never about whether a Kind's pointer is meaningful; gating there would
fold a domain read-rule into pointer resolution, where it does not belong. The
blast radius is far wider than this round: `holderOf` feeds `tripPath`, the Pack
picker's exclusion set and every subtree walk. And it would cost moving
`TRIP_LOOSE` out of `packing.ts` to break an import cycle, churn for no gain.

**The rule is applied once instead, at the read that needs it.** The arithmetic
reads **item** residences (§3), so row membership reads them too — a group's
rows come from the items filed under it, never from `childrenOf`. `childrenOf`
stays correct for the **container tree** (which container nests inside which,
an Entry-level fact) and is wrong only for placing a non-container row. That is
the sharpest constraint in the round, and it is pinned by a test that fails the
moment membership is taken from the holder instead: filing items by
`view.holderOf(item.entryId)` turns eleven of the fourteen new `Packing.test.tsx`
assertions red.

**A per-person Entry with no Pieces draws under `Loose`.** A Draft with no
Participants yet is the ordinary shape of one. It yields no item, so C1's *a
group holding at least one of its Pieces* names none and the literal rule draws
it nowhere — **a state no ruling reaches**. Keeping S9a's read is the safer
half: a line vanishing from the mode the screen rests in while ALL mode still
lists it is the confusing outcome, and `Loose` means `NOT IN A CONTAINER`, which
is true of a set with no Pieces. It contributes **0 to every count either way**,
so nothing arithmetic turns on it, and the boards may prefer it absent — one
line to change if a round says so.

**An Entry whose id is literally `loose` would collide with the `Loose`
group.** `PackingGroup.key` is the raw entry id for a container and the
literal `'loose'` for the group that closes the list, so such an Entry would
share a React key and a heading id with it. **Pre-existing and not introduced
by this round** — the key predates it unchanged — and recorded only because
this round worked in the neighbouring code. The new `byHolder` index is immune
by construction: its keys carry a `container:` prefix, which is what
`LOOSE_KEY`'s own comment says can never collide. Ids are minted, not typed, so
the case is not reachable in practice; the fix, if one is ever wanted, is the
same prefix on the group key.

**The board's §01 frame is transcribed as a fixture, but its group header
counts are not asserted from it.** The split that frame draws is pinned — the
rows, their scoping and their `N ELSEWHERE` — and the header arithmetic C5
claims is pinned too, by the catcher's `0/3` and `0/0` and the Loose test's
`0/2`. What is missing is the two meeting: no test reads the frame's own
headers off the fixture the frame supplied. Not a gap in coverage of the rule,
only in coverage of the drawn example.
