# The leftovers the code took

The implementation design for **S9 round 4**, which rules eleven decisions S9a
and S9 round 2 took in code and recorded only in their own dated specs.

This is a **feature spec**: retired once it has shipped. **No op types, no
endpoints, no migration, no `reduce.ts`, no `state.ts`.** Everything here is
read side, and most of it is already shipped — the round's job was to put the
code's readings on the record, not to change them.

**The boards are the authority.** [`docs/design/README.md`](../design/README.md)
**§5g** (E1–E11) and `S9 Round 4 - The Leftovers the Code Took.dc.html` rule
everything below; where this document and §5g disagree, §5g wins and this
document is wrong.

**Why a round was needed for shipped code.** A dated spec is historical by this
repo's own rule — `docs/specs/` is the shelf for designs that retire once they
land, and nothing regenerates from it. So the eleven decisions recorded in
[`2026-09-01-packing-and-the-journey.md`](2026-09-01-packing-and-the-journey.md)
§11.2–11.3 and
[`2026-09-04-per-person-rows-in-container-mode.md`](2026-09-04-per-person-rows-in-container-mode.md)
§10 were invisible to a design round that re-seeds from `design/README.md`, and
would have been silently redecided — or silently regenerated away — at the next
one. **Everything ruled here is now written into §1, the Status Grammar and the
type and spacing tables**, which is what makes it survive.

---

## Decisions at a glance

Eight blessed, three redrawn. Only four moved a line of code.

| # | Concern | Decision | Code |
| --- | --- | --- | --- |
| E1 | The PERSON header circle | Two tones: **filled = nothing left, bordered otherwise** | — built |
| E2 | The residence segment in PERSON mode | **Amber**, as in ALL — one encoding | — built |
| E3 | `×N` in PERSON mode | **Kept.** One meta line in three modes | — built |
| E4 | The ▲ disagreement line | **Two colours**: glyph in attention, words in staged amber, glyph its own element | — built |
| E5 | A board's number vs. a shared token | **The token wins**, and the difference is recorded at the token | — built; comments moved |
| E6 | Gap between group cards from Roomy up | **12** | — built |
| E7 | A Participant with nothing in any bucket | **No header** | — built |
| E8 | A group header under `○ LEFT` | Drawn while **anything at any depth beneath it** survives | **changed** |
| E9 | A per-person Entry with no Pieces | Under `Loose`, meta `PER-PERSON · NO PIECES`, **inert** | **changed** |
| E10 | `SET EVERYONE`'s N | One op per Piece **that changes** | — built |
| E11 | D5's hint | Two clauses ⇒ two terminated sentences; **one clause stays unterminated** | **changed** |

---

## 1. What the round changed in code

Three of the eleven moved behaviour, and one moved only comments.

### 1.1 E8 — the group header reads the subtree its count reads

**Before:** `if (leftOnly && group.rows.length > 0 && rows.length === 0)`. The
question was asked of the group's **own** rows, so a duffel whose eight direct
rows were packed vanished while the stuff sack inside it — three things still
unpacked — kept its 16px indent with nothing above it. The header's `9/12` and
its ▲ line both counted those three, and the header stating them was the thing
removed.

**After:** `if (leftOnly && !group.hasLeft)`, where `hasLeft` is the filter's
own predicate over the **same population the count reads**: a container's
subtree at any depth, `Loose`'s own items.

That is one new selector,
`containerHasLeft(trip, state, entryId, view, items)`, placed beside
`containerTotals` in `shared/src/selectors/packing.ts` and asking `isInside`
over `subtreeOf` exactly as it does. Sharing the two functions is the point: a
header's survival and the number printed on it cannot come apart.

**It is deliberately not `containerTotals(…).left > 0`,** which is the tempting
one-liner. `PackingCount` sums **units**, and a Counted Entry whose Bring-count
a peer wrote as `0` is an unpacked item the filter keeps and the arithmetic
cannot see — the header would hide over a row drawn beneath it. The filter's own
predicate is asked, once, of the same list.

**Two shapes fall out and neither needs a clause.** The orphan is *unreachable*,
not merely undrawn: a nested group survives only if something beneath it does,
and that something is beneath its ancestor too. And a container whose only
children are nested containers keeps its rail while any of them holds work —
which is what the retired `group.rows.length > 0` conjunct was reaching for and
got right only by accident, since it also kept a container whose whole subtree
was packed. That second case now leaves, because `○ LEFT` keeps meaning *what is
left*.

### 1.2 E9 — a per-person Entry with no Pieces is a fact, not a control

Position blessed as built (under `Loose`, and listed in ALL mode). Two things
redrawn:

- **The meta.** `PER-PERSON · 0/0` becomes `PER-PERSON · NO PIECES`, with
  `NO PIECES` in `N ELSEWHERE`'s own faint tone and its own element for the same
  reason — a single text node would force one class onto the whole line. Not
  `NO PARTICIPANTS`, which is false once the set has been emptied one tombstone
  at a time; not `0/0`, which is the arithmetic the empty state refuses one
  screen up.
- **The targets, both withheld.** The cluster is one control and zero circles
  are not a control; the body's act on a per-person row is the Piece status
  sheet, which would open on no rows over a `SET EVERYONE` that sets nobody. So
  the row renders **no `<button>` at all** — the only row on F4 that does not —
  rather than a disabled one, because a disabled control still announces an act
  the row does not have.

`PackingRow`'s left-hand half is lifted into a `bodyContent` fragment so that
what changes is only *what wraps it*; two copies of that tree would be two places
for the meta line's separators to drift.

### 1.3 E11 — the full stop belongs to the second clause

S9b shipped `SEARCH + FILTERS COMBINE WITH AND.` terminated unconditionally, so
every `GROUP BY` in the app grew a full stop no board draws. The blessing is of
the **two-sentence** shape; a one-clause hint is a label, and keeps its
unterminated S3 form. One clause: `SEARCH + FILTERS COMBINE WITH AND`. Two:
`SEARCH + FILTERS COMBINE WITH AND. GROUPS FILE EACH GEAR UNDER THE CONTAINER IT
IS IN.`

### 1.4 E5 — the record moved, the pixels did not

Both numbers were already built to the token. What the round adds is the general
rule, stated once instead of as two more code-authored lines:

> Where a board's number differs from a shared token, the token wins and the
> difference is recorded **at the token**, for a round that can change it
> everywhere.

So `docs/design/README.md`'s type table marks *34 on desktop* **drawn but not
built**, its Spacing & grid row marks *20 at Roomy* the same way, and §1's Widths
bullet stops carrying a gutter number of its own. `Packing.module.css`'s two
comments are repointed accordingly — they had cited §1's Widths bullet, which no
longer says it. **Both token questions stay open at the token**, not deleted:
adding the Desktop title step and deleting the parenthesis are both legal, and
neither is F4's call to take for every screen.

---

## 2. What the round did not change

Seven rulings blessed what shipped, and each was verified against the code
rather than assumed:

- **E1** — `PersonCircle tone={done ? 'filled' : 'control'}`, pinned by
  `Packing.test.tsx`'s *fills an all-done header circle*. The frame drew one
  partial state two ways (Els 9/13 half, Kees 6/9 bordered), so no rule fitted
  it; the frame is the half that moved.
- **E2** — one `.residence` class, amber, for both modes. Now pinned by a test
  asserting PERSON and ALL render the *same class*, since the fault this guards
  is PERSON reaching for a second, muted one.
- **E3** — the meta line is built once and only its last segment is
  mode-dependent, so `×N` was never dropped. Pinned by *ends a row's meta line
  in its trip residence, ×N and all*.
- **E4** — `<span className={styles['attention']}>▲</span>` beside a staged-amber
  line, the shape `TripCard` already had.
- **E6** — `.groups { gap: var(--space-12) }` inside the Roomy media query, 0
  below it.
- **E7** — `personGroups` maps `personPartition`'s buckets, and a Participant
  with no gear has no bucket. The screen holds `participantIds` and does not use
  them here, which is the losing candidate the board drew.
- **E10** — `setEveryone` skips a row already at the tapped status, with the
  rail's A15 reason in its own header.

---

## 3. Tests

- **`shared/src/selectors/packing.counts.test.ts`** gains a describe block for
  `containerHasLeft`: the ruled duffel shape, a fully-packed subtree and an empty
  container both dropping, `staged` reading as left, agreement with
  `containerTotals(…).left > 0` wherever the count *can* see the item, and the
  `×0` Counted Entry where it cannot.
- **`app/src/screens/Packing.test.tsx`**: the orphan test **retires** — it pinned
  the state E8 overturned, *in as many words* — and is replaced by two, one per
  side of the predicate. Three new tests for E9 (the string, the two withheld
  targets, the ALL-mode row) plus a stylesheet-text pin for `.noPieces`' tone,
  and one new pin for E2.
- **`app/src/components/SliceBar.test.tsx`**: the one-clause hint is asserted
  **unterminated**, and the two-clause form as the whole sentence pair.

---

## 4. Doc amendments

- [`docs/design/README.md`](../design/README.md) — §5g added (the register); §1's
  PERSON, `○ LEFT`, `SET EVERYONE`, Widths and CONTAINER bullets amended; the
  Status Grammar's disagreement line, the type table's DISPLAY row, the Spacing &
  grid row and the Vocabulary's whereabouts-words entry amended; §5f D5 amended in
  place; four boards corrected or annotated.
- [`docs/patterns.md`](../patterns.md) — new **§3.7, *Nothing to do is drawn as
  nothing, never as a disabled control***. Not a new rule: five sites already
  practised it (`Trip`'s withheld `PACKING ›` band, F4's empty state, F4's PERSON
  header, §3.6's withdrawn login ring) and E9 is the fifth size — a row. It had
  no entry.
- **Not amended:** the two dated specs E8 and E9 overturn a sentence in each.
  They are historical records and are left as they were written; this file and
  §5g are where the overturn lives. That is the precedent
  `trips-and-phases.md` §10 set and `the-gear-list.md` §11 followed.

---

## 5. What this does not build

- **The Desktop title step and the Roomy gutter.** Left open at the token by E5,
  with both answers legal. They are decisions deliberately not taken, so they are
  argued where they live and carry no `technical-debt.md` line.
- **The six code-authored lines carried forward**, unchanged and still awaiting a
  frame to rule against: `N INSIDE RIDE ALONG` as units plus nested containers;
  A6's carve-out never reaching the *unknown* status; a Trip with an empty gear
  list having no drawn door to F4; the empty state withholding the controls row
  and hint; the container's *where* target being its group header; gear detail's
  EDIT sheet letting a Single → Counted conversion record no count. E8 touches
  the first only in that `○ LEFT` and the ride-along count now read the same
  subtree.
