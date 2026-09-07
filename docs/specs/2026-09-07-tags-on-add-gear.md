# Tags on Add gear — F1's third attribute row

The implementation design for a **`TAGS` row on Add gear (F1)**: no op type, no
endpoint, no migration, and not a line of `reduce.ts`, `state.ts` or any
selector. The whole change is one screen growing a third attribute row over ops
that have shipped since S3, and one component gaining a second caller that
drives a draft instead of the log.

It is **not a slice**, and it does not advance story 13 — story 13 completed at
S9b with six dimensions
([architecture §8.5](../architecture-design.md#85-where-story-13-attaches)).
Tagging has been whole since S3: applied and removed from gear detail, filtered,
sorted and grouped from the slice bar. What has never existed is the ability to
tag a piece of Gear **at the moment it is recorded**, and the cost of that is
paid in screen visits — the identical argument S4 made when it took the `OWNER`
row against a settled board.

This is a **feature spec**: retired once it has shipped. The authority it
departs from is `docs/design/README.md` **§3b**, and the departure is recorded
there, in the same paragraph that already carries `UNDO` and `OWNER`.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types · endpoints · migration | **None of any.** `gear.tag_applied` has shipped since S3 |
| `shared/` files changed | **None** |
| Files changed | `app/src/screens/AddGear.tsx`, `AddGear.module.css`, `AddGear.test.tsx`, `drawnSizes.test.ts`, `docs/design/README.md` |
| Row position | **After `OWNER`**, before the `RECORDED AS` trait ([§2](#2-the-row)) |
| Row anatomy | The same 48px bordered control `HOME` and `OWNER` use — its **third** caller, which is the trigger the code itself names ([§2.1](#21-the-third-caller-renames-the-class)) |
| Component | `TagPicker`, `mode="gear"`, unchanged ([§3](#3-the-picker-needs-no-change)) |
| How it writes | `gear.recorded`, then one `gear.tag_applied` **per drafted tag** ([§4](#4-why-not-widen-gearrecorded)) |
| Carry-over | **Yes**, alongside `HOME` and `OWNER` ([§5](#5-carry-over)) |
| Empty row | Writes **nothing** — no op per untagged record ([§4.2](#42-an-empty-row-is-silent)) |

---

## 1. Why this is worth a departure

§3b's order is settled and reasoned. S4 broke it once, for `OWNER`, on the
ground that the alternative was *two hundred gear-detail visits* for a
two-hundred-item depot, with the bulk band sitting in story 35, `LATER`.

Every clause of that argument holds here, over the same story-35 band, whose
drawn verbs are `MOVE · TAG · SET OWNER · RETIRE` — **`TAG` among them**. Tags
are also one of the five shared attributes the domain model lists (home, owner,
kind, tags, weight); after S4 took `OWNER`, tags are the last of the five F1
still omits.

The difference from `OWNER` is that a tag is the trait a Quartermaster most
often knows **while holding the thing** — a shelf of `#food`, a box of
`#bushcraft` — and least often goes back for. An attribute recorded in the same
gesture as the thing is recorded at all; an attribute needing a second visit is
an attribute a real depot does not get.

## 2. The row

Placed **after `OWNER`**, so F1's order reads:

`NAME` · `KIND` · (`OWNED COUNT`) · `HOME` · `OWNER` · **`TAGS`** · `RECORDED AS` · CTA

The trait stays last for §3b's own reason — the rarest decision and the only
irreversible one, beside the CTA. `TAGS` joins the attribute block because it
behaves exactly as the other two do: a bordered row, a sheet, a value that
carries over.

Label `Tags`. Value = the drafted tags with their drawn leading `#`, space
separated (`#food #kitchen`), or **`None`** when empty — the position `HOME`'s
`Loose` and `OWNER`'s `Shared` hold. Overflow ellipsis-truncates, as the Depot's
own `TAGS` column does at 44px density (design README §2). Chips inline in the
row are **not** taken: gear detail draws a chip strip because tags are the
settled subject there; on F1 the row shape is established twice over by the rows
above it, and a third shape in the same block would be the drift.

### 2.1 The third caller renames the class

`AddGear.tsx`'s `OWNER` row carries this comment verbatim:

> The same 48px bordered control HOME uses, and deliberately the same classes:
> the board draws the two rows identically, and **a third caller is when to
> generalise the name.**

This is that third caller. `styles['homeRow']` becomes `styles['attrRow']`
across its three uses, and `styles['homeValue']` becomes `styles['attrValue']`.
The comment is replaced by one naming the three rows and the shared control,
rather than left pointing at a threshold already crossed.

`drawnSizes.test.ts` parses stylesheet text, so it follows the rename.

## 3. The picker needs no change

`TagPicker` in `mode="gear"` already is what F1 needs: `vocabulary`, `applied`,
`onApply`, `onRemove`, `onClose`, and no knowledge of where the tags go. Gear
detail's callbacks emit; F1's push and splice a local `useState<TagString[]>`
draft. This is `HomePicker`'s property restated — *a picker is a pure selection
component, and the caller owns the write* ([`patterns.md`](../patterns.md)) —
and it is why the row costs no component work.

`vocabulary` is `dimensionValues(state, 'tag')`, memoised on `state`, exactly as
`GearDetail.tsx` computes it. The near-duplicate defence the picker exists to be
therefore works from the first record of a sitting: the household's whole
vocabulary, with counts, offered before `+ CREATE`.

Mount is what resets the picker's own input, per the Radix conversion's rule
(**there is no `open` prop: mounted is open**). The row's draft is *not* reset by
the picker closing — it is the form's state, and it survives until the record is
committed.

## 4. Why not widen `gear.recorded`

`gear.recorded`'s payload ([sync §4.4](../sync-protocol.md)) carries `name`,
`container`, `kind`, `residence?`, `owner?` and `owned_count?` — **no `tags`**.
Widening it is the shape S4 used for `owner`, and it is wrong here for a reason
that did not apply to S4: `owner` was widened in the slice that *introduced* the
register, so no build in the wild could have folded it anyway. Tags have folded
since S3.

[Sync §5](../sync-protocol.md)'s tolerant reader **ignores unknown fields**. An
installed PWA on an S3-through-S10 build — every build a household actually
has — would fold a widened `gear.recorded` and silently drop its `tags`, so the
same Gear would read tagged on the recording Device and untagged on the phone in
the next room. That is a real divergence, not a theoretical one, and it is
invisible until somebody filters.

So the submit emits, in order:

1. one `gear.recorded`, unchanged in every field;
2. one `gear.tag_applied` per drafted tag, in the row's own order.

Both op types have shipped since S3, so every build in the wild folds the result
correctly, and a build that predates S3 ignores the tag ops and folds exactly
the Gear it would have folded anyway. Nothing is lockstep.

### 4.1 What this falsifies, and where it is corrected

`AddGear.tsx`'s header currently claims:

> Still **one** `gear.recorded` carrying every field. Nothing new is emitted,
> and the screen's "no failure state" property is untouched.

The first sentence becomes false and is rewritten. The **second stays true and
is the one that mattered**: every op is local and durable-first, appended to the
same log in the same submit, so there is no partial-write window, no request,
and nothing for the screen to draw a spinner or an error for. The mono fact line
`RECORDED ON THIS DEVICE · SYNCS IN THE BACKGROUND` is untouched, and still true
of N ops as it was of one.

Ordering across the N+1 ops is not a correctness question either: they address
different registers on one entity path, the reducer creates the entity for any
Gear op, and a tag op landing before its `gear.recorded` folds into a Gear that
then gets its name — the same tolerated shape the protocol already carries
everywhere.

### 4.2 An empty row is silent

A record with no drafted tags emits **exactly one op**. Not an empty tag op, not
a cleared register — [`patterns.md`](../patterns.md) §2.3: a needless write
moves the stamp LWW compares, and can therefore beat a genuine concurrent write
from a Device that was offline. This is the same rule that makes `OWNER` at
`Shared` write no ownership register.

## 5. Carry-over

Tags **carry over between records** within a sitting, alongside `HOME` and
`OWNER`; `NAME`, `KIND`, the owned count and the trait reset. A fresh entry
starts empty.

The board's own argument for `HOME` is that *a depot is recorded shelf by
shelf*; S4 extended it to `OWNER` because a shelf in a bedroom is one person's.
A shelf is also usually one **sort** of thing — the food shelf, the ski box —
which is the whole reason a run of records wants the same tags.

The risk carry-over carries is that an inattentive sitting tags twenty items
`#bushcraft`. It is bounded by the row being **on screen with its value
showing**, unlike `HOME`, whose only echo after a record is the confirmation
line. The mitigation is therefore the row itself, not a rule; nothing clears
tags on a Kind change, which would be a rule no reader could predict from the
screen.

## 6. Tests

`app/src/screens/AddGear.test.tsx` gains:

- **a record with two tags emits three ops**, `gear.recorded` first and one
  `gear.tag_applied` per tag, each carrying the normalised `TagString`;
- **a record with no tags emits exactly one op** — §4.2's silence, asserted on
  the emitted ops rather than on a screen read, since that is where the bug
  would be;
- **tags carry over and `KIND` does not**, across two records in one sitting;
- **the row reads `None` when empty** and the drafted tags with `#` when not.

`app/src/screens/drawnSizes.test.ts` follows the class rename, still asserting
the 48px the three attribute rows share.

No `shared/` test moves: no selector, no op builder and no reducer path changes.

## 7. Not in scope

- **Renaming a tag.** There is no Tag entity and no rename op, by design
  ([sync §4.4](../sync-protocol.md)); a misspelling is corrected by removing it
  and applying the right one.
- **Bulk tagging.** Story 35, `LATER` — the Depot's drawn `TAG` band.
- **`UNDO`.** Story 36, still `LATER`; this row inherits §3b's standing note and
  adds nothing to it.
