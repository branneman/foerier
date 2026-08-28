# The Radix conversion — every overlay in the app

The implementation design for the slice that discharges
[S3.5 §10](2026-08-28-auth-device-links.md)'s condition: **every hand-rolled
scrim in `app/` becomes a thin wrapper around a Radix primitive in `ui/`,
all of them at once, before S4.**

This is a **feature spec**: it is retired once the work has shipped.

It takes **no §8 slice number**, and that is deliberate. A slice in
[architecture §8.3](../architecture-design.md#83-the-slices) is "new op type(s)
+ reducer + selector + endpoint + UI"; this is none of those. It delivers no
story, adds no op, touches no `shared/` and no `api/`. It is a **refactor with
a named condition**, and the condition — not a story — is what schedules it.

Where this spec and the design boards disagree, **the boards win and this spec
is wrong**. `docs/design/README.md` §3c, §4a, §12 and §15 are the written
handoff for the surfaces converted here; Components §04 and §05 carry the
anatomy.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Surfaces converted | **Eleven**, not six — §1's census. Seven files, three anatomies |
| Dependencies | **Two**, both in `ui/`: `@radix-ui/react-dialog` and `@radix-ui/react-alert-dialog`, pinned `1.1.23` |
| Measured cost | **+13.45 kB gzip** on the app's one JS chunk (§5). Measured, not estimated |
| Primitives | **`Sheet`** (Radix Dialog, bottom anatomy) and **`Confirm`** (Radix AlertDialog, `variant: 'card' \| 'sheet'`) |
| Why two | The role difference is real: a picker is a `dialog`, a decision is an `alertdialog`. Radix ships them as two packages with different dismissal defaults, and we want both defaults |
| The `open` prop | **Removed everywhere.** A sheet component is rendered only while it is open — mounted *is* open (§2.1). Fixes a live stale-state bug in `HomePicker` |
| Accessible names | Move from `aria-label` to the visible `Dialog.Title`. **All eleven names are already byte-identical to their visible title**, so every existing `getByRole('dialog', { name })` keeps passing untouched (§2.3) |
| Escape | Now closes **all eleven**. Today only `ExplainerSheet` implements it |
| Scrim dismissal | Kept on the six `Sheet`s; **removed from all five `Confirm`s**, including the two Devices sheets that have it today (§3.1) |
| Initial focus | The sheet body itself, not its first control — `ExplainerSheet`'s current behaviour, applied once in the wrapper (§3.2) |
| CSS | Eight overlay blocks and eight surface blocks collapse to **one shared module in `ui/`**. Padding and gap unify; the drift is resolved, not preserved (§4) |
| Buttons | **Out of scope.** `ghost`, `confirmRemove`, `confirmAttention` and friends stay with their callers. Converting `Button` is a different slice (§8) |
| Landing order | Independent of the Tier 4/5 branch; three trivial contact points, named in §9 |
| Commits | One per task. **Fast-forward merge, history kept** — eleven surfaces is past the point where one commit reads (CLAUDE.md's merge convention) |

---

## 1. The census — eleven surfaces, not six

CLAUDE.md and S3.5 §10 both say "roughly six sheets". The real count, by
`aria-modal`:

| # | File | `role=` line | Anatomy | Dismisses on scrim | On Escape |
| --- | --- | --- | --- | --- | --- |
| 1 | `components/ExplainerSheet.tsx` | 44 | sheet | yes | **yes** |
| 2 | `components/HomePicker.tsx` | 285 | sheet | yes | no |
| 3 | `components/HomePicker.tsx` | 516 | card confirm | no | no |
| 4 | `components/HomePicker.tsx` | 553 | card confirm | no | no |
| 5 | `components/SortGroupSheet.tsx` | 111 | sheet | yes | no |
| 6 | `components/TagPicker.tsx` | 95 | sheet | yes | no |
| 7 | `components/ValueMenu.tsx` | 46 | sheet | yes | no |
| 8 | `screens/Devices.tsx` | 128 | sheet confirm | yes | no |
| 9 | `screens/Devices.tsx` | 215 | sheet confirm | yes | no |
| 10 | `screens/GearDetail.tsx` | 334 | sheet | yes | no |
| 11 | `screens/GearDetail.tsx` | 405 | card confirm | no | no |

Six *components* export a sheet; eleven *surfaces* are drawn. The three extras
are all nested confirms — two inside `HomePicker`'s own sheet DOM, one on gear
detail — and they are exactly the ones with the worst behaviour today: no
Escape, no dismissal of any kind but the Cancel button, no focus trap.

The CSS census is the same story told in duplication:

- **8 overlay blocks** — six `.scrim`, two `.confirmScrim`
- **8 surface blocks** — six `.sheet`, two `.confirmSheet`
- **5 `.grabber` blocks**, in two different colours (`--color-rule-control` in
  four, `--color-rule` in `TagPicker`) and two centring techniques
- `.confirmTitle`, `.confirmBody` and `.confirmActions` appear twice each,
  **byte-identical** between `HomePicker.module.css` and `GearDetail.module.css`

Of the eleven, exactly **one** implements Escape and exactly **one** puts focus
anywhere. None traps focus, none returns it, none hides the rest of the app
from a screen reader, and none stops the page behind from scrolling. That is
the whole argument for this slice: the duplication is the visible cost, and the
accessibility is the one that matters.

## 2. Two primitives

[frontend-design §5](../frontend-design.md) names `Sheet` and says it "wraps
Radix Dialog with our styling + a11y defaults". This slice ships that, and adds
one entry to §5's list:

- **`Sheet`** — Radix **Dialog**. The bottom-sheet anatomy: scrim, grabber,
  title, top radius, `max-height: 85svh`. Dismisses on scrim *and* Escape.
  Surfaces 1, 2, 5, 6, 7, 10.
- **`Confirm`** — Radix **AlertDialog**, in two variants. `variant="card"` is
  the centred confirmation card (surfaces 3, 4, 11); `variant="sheet"` is the
  same decision drawn as a bottom sheet (surfaces 8, 9 — the boards call these
  "confirm sheets" in so many words, `docs/design/README.md` §12). Dismisses on
  Escape and the Cancel button only.

**Why not one component with a `role` prop.** Because the role is not the only
difference, and faking it would throw away the half that matters. Radix's
`AlertDialog` does not dismiss on an outside pointer-down, gives initial focus
to its `Cancel`, and requires a `Description` — three defaults that are
*correct for a decision and wrong for a picker*. Passing `role="alertdialog"`
to a `Dialog.Content` would buy the announcement and none of the behaviour. Two
wrappers, two packages, the defaults we actually want.

**Why `variant` and not a third component.** The difference between surfaces 8
and 3 is where the box sits and how wide it is. Everything that makes it a
confirm — the role, the dismissal rule, the focus target, the
title/description/actions order — is identical. A variant is honest here in a
way it would not be between `Sheet` and `Confirm`.

### 2.1 There is no `open` prop

Every converted component is **rendered only while it is open**. `open`
disappears from `ExplainerSheet`, `HomePicker` and `SignOutThisDeviceSheet`;
`device: DeviceRow | null` disappears from `SignOutRemoteSheet`; the call sites
(`SignIn.tsx`, `AddGear.tsx`, `GearDetail.tsx`, and the pair in
`Devices.tsx`/`Account.tsx`) adopt the `{open && <X … />}` form that the other
seven surfaces already use.

This is not tidying. `HomePicker` is mounted unconditionally by
`GearDetail.tsx:282` and early-returns `null` when closed, so its seven pieces
of `useState` — `editing`, `addingPlace`, `newPlaceName`, `renamingId`,
`renameValue`, `removingId`, `pending` — **survive a close**. Open the picker,
tap `EDIT`, close, reopen: it is still in edit mode, with selection still
suspended. Nothing on screen says why. The same shape would bite `TagPicker`'s
`draft` if it were ever mounted the same way.

Mount-as-open kills that class of bug for all eleven, costs no code, and makes
the primitive's API smaller than Radix's own.

**What it trades.** Radix's `Presence` needs an `open` transition to animate a
sheet *out*. Nothing animates today — there are no transitions in any of the
eight surface blocks, and `ui/motion` does not exist — so nothing is lost now.
Recorded so that the first exit animation knows what it costs: the primitives
take `open`/`onOpenChange` again, and the components that hold draft state move
that state below `Dialog.Content`, which Radix unmounts.

The primitives therefore take `onClose`, not `onOpenChange`. Radix's
`onOpenChange` is wired inside the wrapper and only ever fires with `false`.

### 2.2 The parts, and what "wrapped exactly once" means

`Confirm` exposes two sub-components:

```tsx
<Confirm
  variant="card"
  title={`Remove ${name}?`}
  description={looseLine(removingCount)}
  onClose={() => setRemovingId(null)}
  actions={
    <>
      <Confirm.Cancel asChild>
        <button type="button" className={styles['ghost']}>Cancel</button>
      </Confirm.Cancel>
      <Confirm.Action asChild>
        <button
          type="button"
          className={styles['confirmRemove']}
          onClick={confirmRemove}
        >
          Remove place
        </button>
      </Confirm.Action>
    </>
  }
/>
```

`Sheet` exposes one, `Sheet.Close`, for the ghost `Close` buttons that
`ExplainerSheet`, `TagPicker` and `HomePicker` already draw.

These are thin components of ours that render the Radix part with `asChild`;
they are not re-exports. `app/` imports `Confirm.Cancel`, never
`AlertDialog.Cancel`, so §5's "Radix is wrapped exactly once, here" stays
literally true and replacing Radix stays a one-file change. `asChild` is what
lets every caller keep its own button styling — which is the whole reason
buttons are out of scope (§8).

The order `Confirm` renders is **title → children → description → actions**,
because `SignOutThisDeviceSheet` puts its `▲` lines above the body paragraph
and the other four have no children at all.

### 2.3 The accessible name moves to the visible title

Every surface today carries both an `aria-label` and a visible `<h2>`/`<h3>`
that repeats it. Radix wants a `Title`, and using it means the name comes from
the text on screen rather than from a string that can drift away from it.

This is safe to do in one step because **all eleven already agree**:

| Surface | `aria-label` today | Visible heading today |
| --- | --- | --- |
| ExplainerSheet | `No passkey on this device?` | same |
| HomePicker | `Home` | same |
| HomePicker remove | `Remove {place}?` | same |
| HomePicker move | `Move {gear} to {place}?` | same |
| SortGroupSheet | `Sort and group` | same |
| TagPicker | `Tags` | same |
| ValueMenu | `{title}` | same |
| Devices remote | `Sign out {label}?` | same |
| Devices this device | `Sign out this device?` | same |
| GearDetail edit | `Edit gear` | same |
| GearDetail retire | `Retire {name}?` | same |

So the sixteen existing `getByRole('dialog' | 'alertdialog', { name })`
assertions across five test files must pass **without being edited**. That is
the conversion's cheapest and strongest regression check, and any task that
finds itself editing one of those names has done something wrong.

`Sheet` passes `aria-describedby={undefined}` to its `Content` — our pickers
have no single describing paragraph, and Radix warns about a missing
`Description` otherwise. `Confirm` always renders one, so it needs nothing.

## 3. What changes behaviourally

Stated exactly, because a refactor that silently changes behaviour is not a
refactor.

| Behaviour | Today | After |
| --- | --- | --- |
| Focus trap | none, anywhere | all eleven |
| Focus return to the trigger | none | all eleven |
| Escape closes | 1 of 11 | 11 of 11 |
| Scrim closes | 8 of 11 | 6 of 11 — the `Sheet`s only (§3.1) |
| Rest of the app hidden from AT | no | `aria-hidden` while any overlay is open |
| Background scroll locked | no | yes, with scrollbar-width compensation |
| DOM position | inline, inside the screen | portalled to `<body>` |
| Nested confirm | inside the sheet's own DOM | a sibling portal, stacked above |

Portalling is what makes the two `HomePicker` confirms stop being descendants
of the sheet that opened them. Nothing in the CSS depends on that nesting —
every overlay block is already `position: fixed` — and the tokens are defined
on `:root` in `ui/styles/tokens.css`, so a portalled subtree inherits every one
of them.

### 3.1 Confirms stop dismissing on the scrim

Radix's `AlertDialog` ignores an outside pointer-down. Three of our five
confirms already behave that way; the two on `Devices` do not, and this slice
makes them match rather than fighting the default.

That is the right direction for two reasons. A confirmation exists to make a
decision deliberate, and a stray tap on the dim area is not a decision. And
`SignOutThisDeviceSheet` in particular can be *mid-flight* — `busy` is true
while `clearLocalData()` runs, and `blocked` says a second tab is holding the
database open — so a scrim tap that unmounted it would abandon a sequence that
has already called `stopSync()`, which is exactly the silent-failure case
`final-review.md` finding 4 was raised about.

Escape still closes all five, and both `Devices` sheets keep their Cancel.

No existing test asserts scrim dismissal on any surface — there is not one
reference to `scrim` in any test file — so this change breaks nothing and
therefore **must arrive with a test of its own**, in `ui/`, on `Confirm`.

### 3.2 Initial focus is the sheet, not its first control

Radix focuses the first tabbable element inside `Content` on open. For
`HomePicker` that is the `EDIT` toggle, which is the one control in the sheet
that suspends the task the sheet was opened for. For `TagPicker` it would be
the first `✕` on an applied tag.

So `Sheet` sets `onOpenAutoFocus` to focus the content container itself
(`tabIndex={-1}`) — which is what `ExplainerSheet` does today, by hand, and the
only behaviour of the eleven worth keeping. A screen reader then announces the
dialog and its title, and the first Tab lands on the first control rather than
starting inside one.

`Confirm` keeps Radix's default, which focuses `Confirm.Cancel`. For a
destructive decision, the safe control being focused is the point.

## 4. One sheet anatomy, one confirm anatomy

The shared CSS lives in **one module**, `ui/src/Sheet.module.css`, imported by
both components — they are one anatomy family, and splitting the file would
force a `composes … from` across modules inside `@layer components` for no
gain.

`ui/` owns: `.scrim`, the sheet and card surfaces, `.grabber`, `.title`,
`.description`, `.actions` (two variants), and the two new layer tokens.
Callers keep everything that is theirs: rows, chips, fields, facts, buttons.

**The drift is resolved, not preserved.** Today's six sheet blocks disagree:

| Surface | padding | gap | border-top | `max-height` |
| --- | --- | --- | --- | --- |
| ExplainerSheet | `0.625rem 20 24` | 12 | yes | **none** |
| HomePicker | `0.625rem 20 24` | 12 | yes | 85svh |
| Devices ×2 | `0.625rem 20 24` | 8 | yes | **none** |
| SortGroup / ValueMenu | `12 16 24` | 16 | **no** | 85svh |
| TagPicker | `12 16 24` | 16 | **no** | 85svh |
| GearDetail edit | `20 20 24` | 16 | yes | **none** |

The settled anatomy is the one four of the six already use and the one the
boards specify — `docs/design/README.md` §15: *"radius 16 top, bg/surface, 1px
rule top edge, 36×4 grabber, padding 10/20/24"*. So: `padding: 0.625rem
var(--space-20) var(--space-24)`, `gap: var(--space-12)`, the rule top edge,
the grabber always drawn, and **`max-height: 85svh; overflow-y: auto` on all
six** — its absence on `ExplainerSheet`, both `Devices` sheets and the
gear-edit sheet is a bug at 320×568 or with large text, not a choice.

Two callers need an internal rhythm the sheet's `gap: 12` does not give them:
`TagPicker` and `SortGroupSheet` wrap their bodies in a `gap: var(--space-16)`
flex column of their own. That is one line each, and it keeps the *outer*
anatomy single.

The gear-edit sheet gains a grabber it does not have today. It is a bottom
sheet on the same screen as one that has one; the omission is drift.

**One thing this table missed, found during the conversion.** `TagPicker` and
`SortGroupSheet` each ended with a `@media (min-width: 52em)` block that
redrew `.scrim`, `.sheet` and `.grabber` — so the slice-bar pickers were never
bottom sheets at Split and above: centred, unscrimmed, a bordered 22rem/20rem
card with a shadow and no grabber. Moving those three classes to `ui/` would
have deleted the block with them, silently, and §8's claim that the picker "is
a sheet at every width" was simply wrong. It survives as `Sheet`'s opt-in
`desktopCard`, at 22rem — opt-in rather than every sheet's desktop form,
because it is `docs/design/README.md` §4a's *"popover on desktop, same sheet on
phone"* approximated until `Popover` lands, and a Home picker is a popover on
no board. **The general lesson**: when a class moves out of a module, every
rule that *selected* on it dies too, and a media block at the foot of the file
is where that hides.

**Positioning changes shape.** Radix renders `Overlay` and `Content` as
siblings, so the flex centring that today's scrim does for its child moves onto
the surface itself: the sheet is `position: fixed; bottom: 0; left: 50%;
transform: translateX(-50%)`, the card is centred both ways with a
`var(--space-16)` inset. Nesting `Content` inside `Overlay` is possible and is
not done — it fights `react-remove-scroll` and Radix advises against it.

**Two tokens, so stacking is stated rather than guessed.**
`ui/styles/tokens.css` gains `--layer-sheet: 10` and `--layer-confirm: 20`,
replacing the literals (`10`, `20`, and one surface with no `z-index` at all)
that six modules carry today. Portal order already puts a confirm above the
sheet that opened it; the tokens make that true rather than incidental.

## 5. The cost, measured

Both packages were installed at `1.1.23`, every exported part of both
namespaces imported from a probe module reachable behind a runtime condition
(so nothing tree-shakes away), and `npm run build --workspace app` run before
and after:

| | before | after | delta |
| --- | --- | --- | --- |
| `index-*.js` | 335.10 kB / **106.75 kB gz** | 376.63 kB / **120.20 kB gz** | +41.53 kB / **+13.45 kB gz** |
| `index-*.css` | 69.00 kB / 9.64 kB gz | 69.00 kB / 9.70 kB gz | ~0 |

**+13.45 kB gzip for both primitives together** — a ceiling, since the real
conversion also deletes eight overlay blocks, eight surface blocks and roughly
120 lines of hand-rolled JSX. `AlertDialog` is built on `Dialog` and shares
almost all of it; they were measured together and no split is claimed.

There is no enforced bundle budget in this repo — nothing in CI checks a size —
so this number is recorded here to be argued with, not asserted against. S3.5
measured `uqr` at the same moment in its own design and for the same reason.

## 6. jsdom, and the tiers that run in it

Radix's modal `Dialog` sets `document.body.style.pointerEvents = 'none'` and
`pointer-events: auto` on the layer. `@testing-library/user-event` v14 refuses
to click an element whose computed `pointer-events` is `none`, so:

- clicks **inside** an open overlay resolve `auto` at the content and pass;
- a click on a **background** element while an overlay is open now throws.

Nothing found in the current suite does the latter, but the conversion is what
would reveal it. Task 3 runs the full `app` project immediately after the first
real surface is converted, precisely so this is discovered on one small file
rather than on seven.

Two further consequences of Radix's `aria-hidden` handling:

- While a `Confirm` is open, the `Sheet` beneath it is `aria-hidden`, so
  `getByRole` cannot see through to it. `HomePicker.test.tsx` and
  `GearDetail.test.tsx` query only the top layer while a confirm is open, so
  they pass — but a new test must not assume otherwise.
- `queryByText` ignores `aria-hidden`, which is why `Devices.test.tsx`'s
  `queryByText('▲')` assertions are unaffected.

`ui/src/testSetup.ts` is bare — `jest-dom` and `cleanup` — and `app`'s adds a
`matchMedia` stub. If Radix reaches for a jsdom gap (`ResizeObserver`,
`scrollIntoView`, pointer capture), the polyfill goes in **both** setup files
with a comment naming what needs it. Dialog is the primitive least likely to;
`Popover` and `Select`, which this slice does not build, are the ones that do.

## 7. Tests

### 7.1 Tier 3 — `ui/`, new

`Sheet.test.tsx` and `Confirm.test.tsx` carry the contract that is currently
implemented eleven times and tested zero:

- the surface is exposed as `dialog` / `alertdialog`, named by its **visible**
  title;
- Escape closes both;
- a pointer-down on the scrim closes a `Sheet` and **does not close** a
  `Confirm` — §3.1's rule, and the only place it is asserted;
- focus is on the sheet body on open for `Sheet`, and on `Confirm.Cancel` for
  `Confirm`;
- focus returns to the trigger on close;
- `Sheet.Close`, `Confirm.Cancel` and `Confirm.Action` each fire `onClose`, and
  `Confirm.Action` fires the caller's `onClick` as well;
- `Confirm` renders title, children, description and actions in that order.

### 7.2 Tier 3 — `app/`, mostly unchanged

The sixteen `getByRole` assertions of §2.3 are the regression suite and must
not be edited. What does change:

- the call sites that lose an `open`/`device` prop, in whichever test renders
  them directly (`HomePicker.test.tsx`'s `renderPicker`, `Devices.test.tsx`,
  `Account.test.tsx`, `SignIn.test.tsx`);
- one **new** test in `HomePicker.test.tsx` for the bug §2.1 names: open, enter
  `EDIT`, close, reopen — the sheet is in pick mode.

### 7.3 Tier 5 — e2e, unchanged and untouched

`deviceLink.spec.ts:241-249` drives surface 9 (`SIGN OUT` → `Sign out and
clear`) and is the only e2e that opens any overlay. It must pass with no edit:
the buttons keep their labels, and Playwright's `getByRole` sees the portalled
content exactly as well as it saw the inline content.

`shell.spec.ts:66` asserts the explainer's *trigger* is enabled and never opens
it. `depot.spec.ts` touches no overlay at all.

**Run the local e2e suite before merging.** Radix changes the DOM of every
overlay in the app, and Tier 3 in jsdom is not evidence about a real browser's
focus, portal and pointer behaviour.

## 8. What this slice deliberately does not build

- **The other primitives.** §5 also assigns `Button`, `Popover`, `Menu`,
  `Tabs`, `SegmentedControl`, `Stepper`, `Row`, `Card`, `Field` and
  `PersonCircle` to `ui/`. None is converted here. Buttons in particular stay
  with their callers, which is what `asChild` exists for — `ghost`,
  `confirmRemove`, `confirmMove`, `confirmRetire`, `confirmAttention` and
  `create` keep their modules and their meaning (the "attention border, never
  filled red" rule is design intent, not primitive behaviour).
- **The slice bar's desktop tag popover.** `docs/design/README.md` §4a draws
  the slice-mode tag picker as *"popover on desktop, same sheet on phone"*.
  What exists is a centred card at ≥52em — carried over from the two modules
  as `Sheet`'s `desktopCard` (§4) — not a popover anchored to the chip that
  opened it. That needs `Popover`, a width rule and a board reading: a
  separate piece of work, and the first thing the *next* `ui/` slice should
  take.
- **`ErrorBoundary`, `Icon` growth, `motion`.** Unrelated §5 entries.
- **Exit animations.** §2.1 records what re-enabling them costs.
- **`env(safe-area-inset-bottom)` on the sheet.** Not present today on any of
  the eight surface blocks; adding it is a design question about the whole
  bottom edge of the app, not a side effect of changing how sheets are built.
- **`SortGroupSheet`'s `inline` mode becoming a dialog.** It must not: the
  expanded arrange row is in-page content. It is split out as
  `SortGroupOptions`, which is what `SliceBar` renders inline — and which
  removes the `onClose={() => {}}` that call site passes today.
- **Any change to `shared/`, `api/`, the op catalogue, or `/sync`.** There is
  none, and a task that reaches for one has misread this spec.

## 9. Landing beside the Tier 4/5 branch

[`2026-08-28-tier-4-and-5-against-production.md`](2026-08-28-tier-4-and-5-against-production.md)
is in flight on its own worktree. The two surfaces are disjoint: that spec's
§11 names no file under `app/src`, `ui/src` or any manifest, and this one names
nothing under `api/`, `test/` or `.github/`. Three contact points, all
mechanical:

1. **`docs/architecture-design.md` §12** — both append a subsection after
   §12.7. Whichever lands second takes §12.9.
2. **`package-lock.json`** — this slice adds two `@radix-ui/*` entries; that
   one may add `@actions/core`.
3. **The e2e specs** — disjoint by luck and by design: Tier 4/5 edits
   `depot.spec.ts`, `shell.spec.ts` and `playwright.config.ts`, none of which
   opens an overlay; this slice's only e2e stake is `deviceLink.spec.ts`, which
   that spec's §6.2 keeps local-only and does not touch.

Neither order is better. No coordination is needed beyond a rebase.

**What actually happened.** Tier 4/5 landed on `main` first, in sixteen
commits touching 42 files. The rebase produced conflicts in exactly two of
the three predicted places and nowhere else: `architecture-design.md`, where
both had appended a `### 12.8` after §12.7 (Tier 4/5 keeps it; this takes
12.9), and `CLAUDE.md`, whose status section both edited — main's copy still
described this conversion as the next slice. `package-lock.json` merged
itself. The e2e specs did not collide: Tier 4/5 rewrote `depot.spec.ts`,
`shell.spec.ts`, `quartermaster.ts` and `playwright.config.ts`, and this
slice touches none of them. Nothing under `app/src` or `ui/src` appears in
that branch at all.

## 10. Doc amendments

| Doc | Amendment |
| --- | --- |
| `frontend-design.md` §5 | `Sheet` exists and wraps Radix Dialog; `Confirm` joins the primitive list and wraps AlertDialog; what remains unwrapped |
| `architecture-design.md` §12 | A new `### 12.9 Consequences of the Radix conversion` — §9 predicted the collision and Tier 4/5 landed on main first, so it holds 12.8. §12.5's "Radix is still not a dependency" bullet is left as written — it records what was true at S3 — and 12.9 supersedes it |
| `design/README.md` §15 | One line settling the sheet primitive's dismissal rule: a picker dismisses on the scrim, a confirm does not |
| `CLAUDE.md` | The Radix conversion moves from "the next slice" to landed; S4 becomes next; the "every sheet is a hand-rolled scrim" paragraph goes |
| `testing.md` | No change. `ui/` already runs at Tier 3 and the pyramid is unaffected — stated here so the omission reads as a decision |
| `ui/package.json` | Two `dependencies` (not dev, not peer): the app bundles them |

## 11. Order of work

Nine tasks. Each ends green on `npm run typecheck && npm run lint && npm run
test` — the pre-commit hook runs all three full-repo anyway — and each is one
commit.

1. **`Sheet`.** Add `@radix-ui/react-dialog@1.1.23` to `ui/`. Write
   `ui/src/Sheet.tsx`, the shared `ui/src/Sheet.module.css` (§4's settled
   anatomy, both surfaces, both `.actions` variants), the two layer tokens, and
   `Sheet.Close`. Export from `ui/src/index.ts`. `Sheet.test.tsx` per §7.1. Fix
   any jsdom gap in **both** setup files.
2. **`Confirm`.** Add `@radix-ui/react-alert-dialog@1.1.23`. Write
   `ui/src/Confirm.tsx` with both variants, `Confirm.Cancel`, `Confirm.Action`,
   and the title → children → description → actions order. `Confirm.test.tsx`
   per §7.1, including the scrim rule of §3.1.
3. **`ExplainerSheet`** — surface 1, the smallest, and the only one with an
   Escape test already (`SignIn.test.tsx:132`). Drop its `open` prop; `SignIn`
   renders it conditionally. **Then run the whole `app` project** and settle
   §6's pointer-events question on one file.
4. **`ValueMenu` and `SortGroupSheet`** — surfaces 5 and 7, plus the
   `SortGroupOptions` split and the removal of `SliceBar`'s
   `onClose={() => {}}`. `SortGroupSheet.module.css` keeps the row vocabulary
   both components share.
5. **`TagPicker`** — surface 6, including the `gap: 16` body wrapper.
6. **`HomePicker`** — surfaces 2, 3 and 4 together: the sheet, both card
   confirms, the `titleAction` slot for `EDIT`/`DONE`, the `open` prop removed
   at both call sites (`AddGear.tsx:320`, `GearDetail.tsx:282` — whose comment
   about unconditional mounting goes with it), and §7.2's new stale-`EDIT`
   test.
7. **`GearDetail`** — surfaces 10 and 11: the edit sheet (which gains a grabber
   and a `max-height`) and the retire confirm.
8. **`Devices` and `Account`** — surfaces 8 and 9 as `Confirm variant="sheet"`,
   the `open` and `device` props removed at both call sites, and the `▲` lines
   passed as `children` above the description.
9. **Docs and the full pass.** §10's amendments, then `npm run test`,
   `npm run test:server`, `npm run test:e2e`, and a visual check of all eleven
   surfaces at 393px and at Desktop — the one thing no tier in this repo
   covers, and the reason §4's unified padding is a decision rather than a
   hope.

Tasks 3–8 are independent of each other once 1 and 2 exist. They are ordered
smallest-first so the first real conversion is the cheapest place to be wrong.
