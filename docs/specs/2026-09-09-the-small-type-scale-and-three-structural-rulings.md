# The small type scale, and three structural rulings

**No story, no op type, no endpoint, no migration.** Design authority:
`docs/design/README.md` **§5n**, rulings **K28**, **K28b**, **K4** and
**K18**, drawn on
`docs/design/Post-MVP Round - Debt, Regressions and Open Questions.dc.html`.

The post-MVP debt pass closed twenty of thirty-seven entries and stopped where
the answers needed a board. §5n gave thirty; twenty-three of them owe the code
a change. This spec covers the four that are **foundational or structural** —
the ones where getting the order wrong means doing the work twice. The
remaining nineteen are either blessed-as-built or small enough that a commit
message carries them, and they follow this.

**K28 leads because everything inherits it.** The type scale is a Foundations
change: `ui/Popover` (K15–K17) will draw labels, the two-pane Add gear (K20)
will draw a fact line, and the refusal sheet (K24b) is nine mono strings. Each
of those built before the scale exists is a surface built against numbers and
then migrated — the migration this spec exists to do once.

## Decisions at a glance

| # | Decision | Ruling |
| --- | --- | --- |
| 1 | Four steps at the small end, every value derived from the drawn 11/14 | K28 |
| 2 | Line-height is size + 3; tracking rises as size falls | K28 |
| 3 | The recipe becomes a `.label` utility class with three modifiers | K28 |
| 4 | The status pill's 9.5 and the tag chip's 10.5 both become 10 | K28b |
| 5 | The whole tag chip in `ON THIS GEAR` is the remove target | K4 |
| 6 | `desktopCard` stops being a prop and becomes what `Sheet` is at Desktop | K18 |
| 7 | `SortGroupSheet`'s `desktopCard` is dead code and goes with the prop | K18 |

## 1. K28 — four steps, and why a token alone was never the fix

`patterns.md` §6.2 records the mono-caps label as **the most-copied rule in the
codebase**: seventy-six uppercase-label rules across twenty-nine modules,
nineteen of them carrying the full three-line recipe verbatim, and ~170
`font-size` declarations setting a raw `rem` because the drawn sizes run
8.5–10.5 and the token scale stops at 11.

Five raw sizes ship — 11, 10, 9.5, 9, 8.5 — plus a 10.5 on the tag chip. K28's
finding is that these are **not six decisions but four jobs**: the label
itself, a label riding a control, a label in chrome or a hint, and a column
head or eyebrow. So:

| Token | Size / line-height | Tracking | The job |
| --- | --- | --- | --- |
| `--text-label` | 0.6875rem / 0.875rem (11/14) | 0.08em | the label itself — **drawn** |
| `--text-label-control` | 0.625rem / 0.8125rem (10/13) | 0.10em | a label riding a control |
| `--text-label-chrome` | 0.5625rem / 0.75rem (9/12) | 0.12em | chrome, and hints |
| `--text-label-head` | 0.53125rem / 0.71875rem (8.5/11.5) | 0.14em | a column head or eyebrow |

**Every value is derived, not chosen.** Line-height is **size + 3**, which is
what the one drawn pair (11/14) states and what a caps run with no descenders
wants. Tracking rises as size falls across the drawn .05–.14em range, one value
per step. That derivation is the whole reason four steps can be added to a
scale whose own §5g E5 note says a per-screen override is the drift tokens
exist to prevent: nothing here is a new opinion about type, it is the drawn
pair extended by its own rule.

### 1.1 The recipe is a class, because a token cannot hold four declarations

A step token carries size and line-height. The recipe carries **four** things —
family, size/line-height, tracking, weight, and a transform — and the three
that are not the step are identical at every size. Nineteen modules spell all
of them; a token migration would leave nineteen copies of the other three.

So `ui/styles/utilities.css` gains `.label` and three modifiers. It is a
**global class**, which is legal exactly there: `utilities` is one of the seven
declared layers, and a global class in it needs neither `composes` nor
`:global`, both of which four module headers refuse by name.

```css
.label          /* --text-label, mono, 600, uppercase, .08em */
.label--control /* 10/13, .10em */
.label--chrome  /* 9/12,  .12em */
.label--head    /* 8.5/11.5, .14em */
```

A modifier restates the `font` shorthand, because the shorthand resets
`line-height` and there is no way to set one half of it. **Weight and
`text-transform` ride the class, not the step** — a step is a size, and a
caller that wants 10px mono in sentence case should not have to unset a
transform it never asked for.

### 1.2 What this buys that the migration alone does not

**A test can assert a class.** It could never assert 170 raw `rem`s: the
existing net (`app/src/screens/drawnSizes.test.ts`) works by parsing stylesheet
text for one rule at a time, which is why it pins fourteen controls and not
seventy-six labels. A class is one string, greppable across every module, and a
label that stops using it is visible in a way a `font-size` that drifted by
half a pixel is not.

### 1.3 Scope, and what stays raw

A rule migrates when it is **the recipe at one of the four sizes**. A rule that
sets a mono size for something that is not an uppercase label does not, and
neither does a rule whose size is not one of the four after K28b — those are
left, and named at the end of this spec, rather than rounded to fit.

**The line-height is the risk, and it is the intended change.** Many of the 170
set `font-size` alone and inherit their line-height from the row they sit in;
moving them to a step sets it explicitly. That is what K28 rules, and it is
also the thing no tier in this repo can see — jsdom computes no layout. Section
5 says how that is covered.

## 2. K28b — two drawn sizes move, under E5's own rule

The status pill's **9.5 → 10** and the tag chip's **10.5 → 10**, both into
`--text-label-control`, because both are exactly what that step names: a label
riding a control.

This is not a board being overruled. §5g **E5** exists for this case — *where a
board's number differs from a shared token, the token wins and the difference
is recorded at the token, for a round that can change it everywhere* — and
§5n **is** that round, so the difference is **spent** rather than recorded a
second time. Half a pixel at 600 weight in mono caps, and two surfaces gain a
shared step.

Nine call sites hold `0.59375rem` (9.5) and three hold `0.65625rem` (10.5);
both become `--text-label-control`. The boards keep their drawn numbers with a
strike and a pointer to K28b — **that mark is board hygiene owed by §5n's own
list, not by this spec**.

## 3. K4 — the whole tag chip is the remove target

The debt pass gave `TagPicker`'s `✕` a hit extension reaching **44 tall and 40
wide**, and recorded the missing 4px as a trade: the width could only come from
the tag's own label, and a tap that appears to land on the word would then
delete it.

K4 reverses it, and the reason is that the trade accepted a premise the app has
rejected three times: **the `✕` is the control and the word is scenery.** The
whole row is the tap target (§5l I22's ticked row, whose 18px square is a
readout); the cluster and its `×N` are one control (§5d B). So the chip is one
control that removes, its painted box is the target — 32 tall and past 44 wide
at every tag — and the `::after` disappears, taking the 40 with it. A tap on
the word does what the word's own `✕` announces instead of nothing.

Removal already confirms nothing (§4: one op, instantly reversible), which is
what makes a bigger target safe rather than dangerous. Accessible name
`Remove #cooking`, which the `✕` already carries.

**Not** the slice bar's selected filter chip — its `✕` removes a value while
its body is a live dimension read, two acts, so it keeps its own target and
clamp. **Not** the dashed `+ tag` ghost, already a standalone ≥48.

### 3.1 A conflict this spec names rather than resolves

K4's own words include *"on gear detail's chips and in the picker's
`ON THIS GEAR` row"*. **Gear detail's chips carry no remove act at all**, and
§4 says why in as many words: *"✕ lives in the picker, not on the chips"*, the
trailing dashed `+ tag` ghost being *"the one edit affordance on this read
screen"*, because a read screen should not destroy anything by mis-tap. §5n
does not list this among its six named conflicts.

Two readings. Either K4 adds a remove act to gear detail — which reverses a
settled board line the ruling never claims to be reversing — or it governs
chips that **already carry a ✕**, and names gear detail loosely.

**This spec builds the second**, on three grounds: K4's own rule is stated as
*where a dense control carries **one act and a mark that names it***, and gear
detail's chips carry neither; the 44×40 trade K4 exists to dissolve lives only
in the picker; and reversing §4 would be a change to what a read screen can
destroy, which is a larger decision than a hit target. **Flagged for the next
round.** If K4 did mean gear detail, that is one prop and a board line, and it
should be ruled explicitly rather than arrived at through a hit-area fix.

## 4. K18 — `desktopCard` stops being a prop

Five sheets pass `desktopCard` with no board drawing them as a popover, while
their nearest siblings do not — so at Desktop the Owner picker is a centred
card and the Home picker a bottom sheet **on the same edit sheet**. The debt
entry called it *a per-slice choice masquerading as a rule*.

K18 rules the set: **two Desktop forms and no third.** A sheet a board *draws*
as a popover becomes one; **every other sheet is a card at Desktop** — not a
flag a caller reasons about but what `Sheet` is there.

The implementation follows the ruling's own words: **the prop goes.** `Sheet`
draws the card at Desktop, always, and a caller has nothing left to get wrong.
Eleven callers stop passing it; five sheets gain the card they lacked —
`ExplainerSheet`, `PackPicker`, gear detail's `Edit gear`, `TripOnlySheet` and
`HomePicker`, which is the one the entry names.

**`SortGroupSheet`'s `desktopCard` is dead code**, and removing the prop
deletes it rather than fixing it: that sheet is the phone's collapsed form of
the Desktop arrange row, so at Desktop it never renders and has been passing a
treatment nothing reaches.

### 4.1 One ordering dependency, stated because it is invisible

`ValueMenu` leaves this set for the popover one (K17). `ui/Popover` is not
built, so until it is, `ValueMenu` is a `Sheet` and takes the card like every
other — which is what it already does. **Nothing here blocks K15–K17 and
K15–K17 change nothing here**: the seven popover callers switch component at
the caller, not by a flag on `Sheet`.

## 5. How this is verified, and what it cannot be

Three of the four are structural and the suite holds them: a removed prop is a
type error at every call site, a changed target is a DOM assertion, a deleted
dead pass is a diff.

**K28 is the one the suite cannot fully hold.** `app/vitest.config.ts` sets no
`css` option, so CSS modules are not processed, `toHaveStyle` passes
unconditionally, and jsdom computes no layout at all — the same wall
`drawnSizes.test.ts` was built against. So:

- the **tokens and the class** are asserted as stylesheet text, the technique
  `drawnSizes.test.ts` and `print.test.ts` already use, including the
  derivation (each step's line-height is its size + 3);
- the **migration** is asserted by absence: no module may set one of the four
  sizes as a raw `rem` once the step exists;
- the **paint** is not asserted, and cannot be. A browser pass is owed, and is
  recorded in `KEYBOARD-PASS.md` beside the other measurements no tier can
  hold — the dense rows are where an explicit line-height would show first:
  F4's packing rows, the Depot's column heads, the gear meta line, and the
  three nav modes' chrome.

## 6. Not in this spec

The other nineteen owed ids. **K15–K17** (`ui/Popover` and its seven callers),
**K20**+**K21** (the two-pane Add gear and pane-local scrollers), **K24**+
**K24b** (the refused write) are each their own piece of work; the rest are
small enough to land under their own commit message. **K19** and **K26** owe
the code nothing — one retires a frame, the other blesses a tone.
