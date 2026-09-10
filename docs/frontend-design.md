# foerier — Frontend Solution Design

How the [architecture](architecture-design.md)'s "offline-first React PWA with
build-time CSS" becomes concrete HTML, CSS, and React: the scaling model, the
responsive system, the CSS architecture, the component package, and the
resilience layer. This is the design the maintainer approved on 2026-08-21; it
sits one level below the architecture spec and does **not** change it.

It realises the visual system in [`docs/design/`](design/) (the Claude-Design
`*.dc.html` boards and their token/spacing/status specs). Those boards are the
design intent; this doc is how we build it. It stays inside the architecture's
settled choices — Vite + React + TS, `vite-plugin-pwa`, build-time CSS, the
`shared` / `ui` / `app` / `landing` split — and fills in the frontend decisions
that spec left open (Tailwind *or* CSS Modules; how scaling, theming, and
responsiveness actually work).

The conceptual [domain model](domain-model.md),
[ubiquitous language](ubiquitous-language.md), and
[user stories](user-stories.md) stay untouched and persistence-ignorant.

The recurring code shapes these decisions have settled into — how a screen
reads and writes, what a picker and a confirm may each do, the selector
conventions the app leans on, the CSS rules every module follows — are named
once, with their canonical examples, in [`patterns.md`](patterns.md). This doc
says what was decided; that one says what it looks like at the third site.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Scaling philosophy | **Fluid, user-respecting, accessible.** Not classic progressive enhancement — the app is unapologetically a JS SPA — but it scales beautifully and honours the reader's font-size and zoom |
| Styling approach | **Hand-authored CSS Modules** + design **tokens as CSS custom properties** (in `rem`), under declared `@layer`s. **No Tailwind, no styled kit** (MUI/Chakra/Mantine) |
| Interactive widgets | **Radix UI** headless primitives (sheets, popovers, menus, tabs, checkboxes) — wrapped **exactly once** in `ui/`, styled entirely by our CSS |
| Units | `rem` for the global grid (type, spacing, radii); `em` for intrinsically-local component internals; touch **hit areas** floored at 44px minimum / 48px target, never the paint (§2.1) |
| Root font-size | `:root { font-size: 100% }` — respect the user. **No `62.5%` trick.** Tokens authored by dividing design-doc px by 16 |
| Type scaling | **Discrete + rem** with responsive bumps at breakpoints (matches the design's discrete sizes); fluid `clamp()` deferred as a later per-size upgrade |
| Theming | Dark default; `prefers-color-scheme` auto-detect **plus** a persisted manual override via `[data-theme]` on `<html>`, swapping the semantic-token layer |
| Responsive shell | **Five named layout modes** on `em`-based media queries (Compact · Comfortable · Roomy · Split · Desktop); nav morphs bottom-tabs → icon-rail → labeled-sidebar |
| Responsive components | **`@container` queries** — components adapt to the width they're *handed*, not the viewport; fail open to single-column |
| Component package | Three tiers in `ui/` (primitives · composites · screens); **`ui/` never imports the store** — screens in `app/` read selectors and pass data down |
| Fonts | **Self-hosted** variable woff2, subset to Latin, Workbox-precached; `font-display: swap` + metric-matched fallback. **No Google Fonts CDN** |
| Resilience | Fail-open CSS, error boundaries, stale-chunk reload+retry, print styles, reduced-motion/-data, honest `<noscript>` — each pinned to a concrete home (§6) |

---

## 1. Scaling philosophy

The app is a client-rendered SPA whose reads come from an in-memory op-log fold —
there is **no server-rendered HTML to enhance**, so classic progressive
enhancement ("works with no JS, then layer JS on") is not a goal here and would
fight the offline-first architecture. What we *do* commit to is the pair of
properties that request was really reaching for:

1. **User-respecting, accessible scaling** — the UI honours the reader's
   browser/OS font-size and zoom, and *everything* (spacing, controls, touch
   targets) scales **with** text rather than being pinned to px.
2. **Fluid responsiveness** — one layout that flexes cleanly from a ~360 px phone
   through large-phone, foldable, and tablet to a centred desktop, without a pile
   of brittle device breakpoints.

On top of these we adopt a broad **graceful-degradation / resilience** posture
(§6): always prefer a fallback over an error in the user's face; fallback-first
CSS where the last parsing declaration wins; fail open when a feature is missing.
This is deliberate so the UI survives real browsers — privacy add-ons, corporate
proxies, blocked third parties, stale installed clients — without a rebuild.

## 2. The scaling & token model

### 2.1 Root and units

- **`:root { font-size: 100% }`** — inherit the browser/OS setting, whatever the
  reader chose. **No `62.5%` "1rem = 10px" trick**; it quietly rescales everyone's
  preference. Tokens are authored by dividing the design-doc px by 16
  (`16px → 1rem`, `28px → 1.75rem`). The px values in the design boards remain the
  documented *intent*; the CSS ships `rem`.
- **`rem` for the global grid** — type scale, layout spacing, gaps, radii.
  Predictable, scales with the root only.
- **`em` for intrinsically-local internals** — padding *inside* a chip/button
  relative to its own text; an inline icon sized `1em` to track its adjacent
  label. Keeps a component proportioned if its local font-size ever changes,
  without a second token.
- **Touch targets get a physical floor — on the *hit area*, never on the
  paint.** Minimum tap size is about *finger* size, which does **not** shrink
  when a user picks a smaller font: 44px is the minimum, 48px the target. But
  the floor is not `min-height`, and was until the S7 amendment round
  (`docs/design/README.md` §5b, O). Written that way it floors the *painted*
  box, and `min-height` beats `height` regardless of cascade layer — layers
  resolve a conflict within one property, never across two — so a control drawn
  at 22px or 32px was silently painted at 48 while its own declaration looked
  like it was working. The rule now reads:
  1. **A drawn size is the painted size.** A control states its own paint.
  2. **48 floors the hit area.** A dense in-row control keeps its drawn size
     and grows a non-painting `::after` — `Stepper.module.css`,
     `EntryRow.module.css` and `Trip.module.css`'s `.addParticipant` are the
     worked examples.
  3. **A hit extension clamps at its owning row's bounds**, so two targets can
     never overlap. The counter-example is real: a `✕` whose hit area reached
     13px into the next row deleted the neighbouring Entry, unconfirmed.
  4. **A standalone control is simply drawn ≥48** and needs no extension.

  There is deliberately no global declaration for this. What a hit area may
  grow into is a fact about the owning row, which a base layer cannot know, and
  `input`/`select` are replaced elements that render no pseudo-element at all.

### 2.2 Token layers (CSS custom properties)

Three layers, all `rem`/color values, defined in the `tokens` cascade layer:

- **Primitive** — the raw scale: `--space-4 … --space-32`, `--text-*` size/line
  pairs, the color hexes from the design boards.
- **Semantic** — intent, and the **only** layer that flips theme:
  `--color-bg-base`, `--color-ink-primary`, `--color-status-packed`, etc.
  Components consume *this* layer.
- **Component** — optional local knobs, only where a component needs one. The
  ones that exist: `--gutter`, `--nav-size` and `--fab-clearance` on the
  shell, `--packing-indent` on the packing list, `--stack-gap` and
  `--cluster-gap` on the two layout utilities.

Because everything traces back to `rem` primitives, changing one thing — the root
font-size, or a future fluid root — scales the **entire** UI in proportion. That
is the "scalable UI" property, and it is structural rather than per-component
effort. The token set is also the single source of truth shared by `app/` and the
`landing` demo components.

### 2.3 Type scaling — discrete + rem (Decision)

The design boards specify mostly **discrete** sizes (e.g. display 28 px phone /
34 px desktop), which points away from heavy continuous fluid-scaling. We ship
**fixed `rem` tokens with responsive bumps** at breakpoints (display
`1.75rem → 2.125rem` on desktop, exactly as specified). This is the simplest,
most predictable option, matches the design intent literally, and always honours
user font-size. Individual sizes can be promoted to fluid `clamp()` later —
always written **with a `rem` term** (e.g.
`clamp(1.75rem, 1.5rem + 1.2vw, 2.125rem)`) so user zoom still wins — without
rearchitecting.

### 2.4 Theming — auto + persisted override (Decision)

Dark is the default. We combine `prefers-color-scheme` auto-detection **with** a
manual override the user can set and that persists locally. Mechanism: a
`[data-theme="dark|light"]` attribute on `<html>` re-points the **semantic**
token layer; absent the attribute, `prefers-color-scheme` decides. Cheap, and the
whole app re-themes by swapping one layer.

## 3. Responsive system

Two axes: **media queries drive the shell** (where nav lives, whether panes
split), **container queries drive the components** (each picks its own internal
layout from the width it is handed). All breakpoints are in **`em`** so a user
who zooms or bumps their font-size triggers layout changes at the right
perceptual point — a near-free accessibility win.

### 3.1 Shell — five named layout modes (media queries)

Each mode is defined by *what structurally changes*, not by a target device:

| Mode | Range (em / px) | Nav | Panes | What reclaims the space |
| --- | --- | --- | --- | --- |
| **Compact** | `< 30em` (< 480) | Bottom tabs | Single col | Tightest gutters (12) |
| **Comfortable** | `30–40em` (480–640) | Bottom tabs | Single col | Standard gutters (16) |
| **Roomy** | `40–52em` (640–832) | Bottom tabs | Single col + max measure | Large-phone / foldable / portrait-tablet fix: gutters → 20–24, text capped, card grids go **2-up**, chip rows wrap, rows show more inline meta |
| **Split** | `52–64em` (832–1024) | Icon rail | **List + detail two-pane** | The two-pane unlock lives *here*, earlier than 1024 |
| **Desktop** | `≥ 64em` (≥ 1024) | Labeled sidebar (216px) | Two/three-pane | Full density; content **centres at max-width 1120** past `75em` (1200) |

Nav therefore has three treatments — bottom tabs (thumb zone) → icon rail →
labeled sidebar. **Roomy** is the mode added specifically to kill the wasted side
space a 393-px-designed single column leaves on a large phone or foldable.

**The brand mark belongs to whichever treatment is drawn, and never to a
screen.** It is chrome — it says which app this is, which is a fact about the
shell — so `AppShell` draws it once per mode and a destination screen opens
with its own title row and nothing above it: below Split in the header band,
mark left and the sync line plus the account avatar right, exactly as every
phone and Roomy frame draws that band; at Split atop the 56px rail; at Desktop
in the sidebar, where it is the **only** place a board draws the wordmark
beside it. It shipped as each screen's job instead and drifted three ways —
`Depot` and `Find` drew one and `Trips` drew none, both drew `Logo` rather than
the bare `Mark`, and both gated on `!isDesktop`, which is true at Split, where
the rail already carries one. The gate is `mode === 'tabs'`; the count that
holds it is in `screenBand.test.tsx`, beside the sync line's, because one mark
per page is a fact about the composed page (`patterns.md` §3.2a).

**The two-pane unlock is not one screen's alone.** `DepotView` was the first to
take it — the Depot list and the gear detail, as two panes of one view — and
until S7 the only one. S7's gear-list builder (`/trips/:id/list`) is the
second: the depot picker in the left pane, the Trip's own editable list in the
right, existing **only** from Split up, exactly as `DepotView`'s second pane
does, and gone below it in favour of the trip screen editing in place and the
picker as its own route. A comment in `app/src/screens/Trip.tsx` once named
`DepotView` "the only two-pane view in `App.tsx`"; it no longer is, and the
comment is corrected. See [technical-debt.md](technical-debt.md) for what this
means for the pane-local-scroller debt both views now carry.

**The gutter in that last column is `.shell__main`'s, and a screen adds none
of its own.** The main area carries `padding-inline: var(--gutter)` and
`padding-block: var(--space-16) var(--fab-clearance)`, so a `.screen` that
declares its own inline or block padding pays twice and drifts from its
neighbours at every width at once — which `Find` and `GearDetail` both did
until the layout review (`patterns.md` §6.8). A `max-width` measure cap is a
different thing and stays the screen's.

**The shell is one viewport tall in every mode, and the screen scrolls inside
it.** `.shell` is a fixed `100svh` grid and `.shell__main` is the scroll
container. The document does not scroll behind it, and no ancestor of a screen
does — a component may still scroll its own overflow, as the slice bar's chip
row does below 40em. That is what makes each nav treatment *persistent* rather
than merely present: below Split the bottom tabs stay in the thumb zone on a
two-hundred-item Depot, and from Split up the nav column's pinned foot — the
`ACCOUNT` row above the sync marker — stays at the bottom of the screen instead
of sliding to the bottom of the document, which is where a shell sized by
`min-height` put it. The same mechanism pins the phone header band, which below
Split carries the sync line and the only route to Account. Five consequences
are worth knowing before touching the shell:

- **A screen's floating control is sticky against `.shell__main`, so its inset
  is `0`.** A sticky inset is resolved against the scrollport reduced by the
  scroll container's own padding, and `.shell__main`'s bottom padding is
  already the drawn 18px (`--fab-clearance`). An inset on the control would be
  added to that padding rather than restate it — measured in Chromium,
  `bottom: 18px` against an 18px foot floats the control 36px above the bar. So
  the clearance is said once, at the foot, and the control carries a zero.
- **A route change resets the offset to the top**, in `AppShell` and nowhere
  else, because a scroll container that outlives the route carries its offset
  into whatever renders next. **It is a behaviour chosen here, not one
  restored:** `pushState` does not reset scroll — measured, an offset of 1200
  survives both the call and a full re-render — so the document scroller this
  replaced kept its offset too and was merely *clamped* by a shorter next
  screen. Most next screens were shorter, which is what made it read as a
  reset. It is a reset and not a restore, either: restoring is per history
  entry rather than per path, and nothing here holds history entries.
- **The reset is keyed on a scroll group, not on the path.** At Split
  `DepotView` draws the Depot list and the gear detail as two panes of one view
  that never unmounts, so `/` and `/gear/:id` are two routes over a single
  scroll offset and a per-path reset would take the list to the top on every
  row tap. They collapse to one key there and to the path everywhere else.
  Panes with scrollers of their own would be the more design-true answer — and
  would move this reset's target with them — which is left to the task that
  builds them.
- **The scrollbar belongs to the content column, not the window.**
  `.shell__main` is what carries the `max-width` cap and the centring at Roomy
  and Desktop, so where a platform draws a classic scrollbar it lands on the
  1120px column's right edge.
- **`svh`, not `dvh`.** With an inner element scrolling, a mobile browser's
  toolbars never retract, so the small viewport *is* the viewport and a dynamic
  unit would chase a transition that does not happen. It also matches the unit
  the sheets' `max-height` already uses.

**At large user font sizes the shell stops being pinned, deliberately.** The
middle row is `minmax(50svh, 1fr)` rather than a bare `1fr`. Without the floor
a scroll container's automatic minimum size is zero, so the reading area is
crushed before anything overflows: measured at a 600px viewport with a 300px
header and a 400px bar — reachable by zoom, where the CSS viewport shrinks
while both bands keep their `rem` and `min-height` sizes — it came out **34px
tall while the document was scrollable to 734 anyway**, two scrollers at once
and the bar half off the screen. With the floor the screen keeps half the
viewport; past that the shell overflows, the document scrolls, and the bar sits
at the bottom of the *document*, reached by scrolling to its end. What is given
back there is the **unpinned bar**, not the single scroller `min-height` had:
the reading area keeps its own scrollport, so in that case two are live at
once. The trade is deliberate — an unpinned bar above a usable screen beats a
pinned one above a 34px slot.

**Radix's scroll lock still holds, and it takes both halves to say why.**
`react-remove-scroll`, which every `Sheet` and `Confirm` sits inside, does two
things: `overflow: hidden` on `body`, and `wheel` and `touchmove` listeners on
`document` that cancel any such event whose target lies outside the locked
subtree. Those two are registered non-passive — `{ passive: false }`, which is
what lets them call `preventDefault` — and in the bubble phase; a third
listener, `touchstart`, only records the gesture's origin and cancels nothing.
(The package's capture-phase handlers are React props on the locked subtree
itself, `onWheelCapture` and `onTouchMoveCapture`, which is a separate
mechanism.) The `body` rule becomes a no-op once the body no longer scrolls;
the two `document` listeners are what stop a pointer, and they are indifferent
to which element the scrollport is. Verified in Chromium against a scrolling
`.shell__main` with a Radix dialog open: wheel and touch over the background
both leave the offset where it was.

**There is no `keydown` listener anywhere in the package**, so the keyboard is
covered by something else: `Sheet` and `Confirm` use `Dialog.Portal` with no `container`, which
mounts them on `document.body` — verified, the parent chain is
`body › [the dialog]`, outside `.shell` — and the focus trap keeps space,
PageDown and the arrows on the dialog's own scroll chain, which ends at the
locked body rather than at `.shell__main`. **Portalling an overlay into the
shell would break that silently**, and nothing else in the app would notice.

### 3.2 Components — container queries

The same list row, trip card, or filter cluster appears in a 393-px phone, a
~440-px split-pane, *and* a wide desktop column. Viewport width cannot tell it
which. So components carry `@container` queries and adapt (1-up vs 2-up, inline vs
stacked meta) to the width they are **actually given**. This makes "renders
efficiently at every size" robust rather than a one-off tweak. Container queries
are supported across evergreen browsers and **fail open**: with no `@container`
support, components fall back to their base single-column layout (§6).

**The fold is `38rem` (608px), and `ui/src/GearRow.module.css` owns it.**
Settled at S3, which built the first `@container` query in the codebase. Both
this section and the boards had left it as an unowned approximation — the
boards annotate `~600px` in three places and this section named no number at
all — so the first component to need it picked one and wrote it down. `rem`
rather than `px`, like every other breakpoint here, so a reader who raises
their font-size crosses it at the right *perceptual* point; and it sits clear
of Split's 308px list pane below and Roomy's 640px shell boundary above.

**Where the line between §3.1 and this section actually falls.** A query is a
**media** query when it decides *which panes or elements exist* — the two-pane
unlock, the Depot's table-versus-list — because that changes what is rendered,
and a CSS-only switch would mean rendering both and hiding one, putting every
fact in the accessibility tree twice. It is a **container** query when it
decides *how what exists lays out*. S3 is the worked example both ways:
`DepotView` chooses its panes from a media query, and `GearRow` folds inside
whichever pane it lands in, which is why Split 900's 308px list renders the
two-line row at a viewport of 900.

### 3.3 Screen headers — the back link and the sync line

A screen reached *from* a destination draws a band above its title: a back link
(`‹ DEPOT`, `‹ TRIPS`) and the sync marker. **Each is withheld, and neither is
withheld at a single width**, because the two answer different questions.

- **The sync line is drawn at Split (`52–64em`), and only there.** `AppShell`
  states the status in **words** in two of its three modes — the phone header
  band below Split, and the 216px sidebar at Desktop — and in the third it draws
  a bare 6px dot on the 56px rail, hanging the words on an `aria-label`. Split
  is therefore the one mode where nothing legible says it, and the one mode
  where a screen draws its own. Both boards that draw a pushed screen at 900
  agree: `Screens A` §05's `Depot split` carries `● SYNCED` in the detail pane's
  own band with a bare dot in the rail beside it, and §06's
  `Add gear — split 900` is the same pane and the same dot.

  **The line has three states, not two** (§5n K24): sage `SYNCED`, amber
  `OFFLINE`, and attention `▲ N NOT SAVED` for a write this Device could not
  save. The third **outranks** the other two — being offline is normal and
  reversible and the app says so on purpose, while a lost write is neither —
  and it is the only one that is also a **route**, because unlike offline
  there is something to read. The ▲ takes the dot's own slot rather than
  sitting beside it, which is what keeps §5n K10's foot (one 22px marker
  column, one text edge at 40) aligned across all three. The count is drawn at
  N=1 too, and it counts **refusals, not ops**: a gesture refused whole is one
  thing the Quartermaster did. `ScreenBand` reads that count from the store
  rather than taking it as a prop — it is a fact about the Device, not about
  any screen, and threading it through twelve callers is the paste that
  component exists to end.
- **The back link is drawn unless its destination is already on the page**,
  which is not a width alone. At Desktop the labeled sidebar *is* that
  destination — `Trip screen — S6 desktop` draws `TRIPS` and the sync line in
  the sidebar and neither in the main column — so no screen whose destination
  is a sidebar row draws one there. Five screens' destination is one specific
  Trip, which no sidebar row carries — `Packing`, `Unpack`, `NoteComposer`,
  `DepotPicker` and `GearListBuilder`'s trip door — and all five keep their
  link at Desktop (`screenBand.test.tsx` asserts it). **None of them says so.**
  Each hands `useScreenHeader` the `href` its back link points at and the hook
  answers `sidebarCarries` for itself (§5n K27); the parameter used to be a
  per-screen boolean, `atDesktopSidebarCarriesDestination`, which a screen with
  two doors cannot answer once — the builder had to recompute it from its own
  query string, and the fact then lived twice, as the flag and as the `href`
  beside it, with nothing making the two agree. The sidebar's list and the
  hook's list are pinned against each other by `AppShell.test.tsx`.
  Below Desktop it depends on the screen: `GearDetail` is the detail half of
  `DepotView` at Split with the Depot list in the pane beside it, and
  `Depot split` contains **no `‹` anywhere**; every other pushed screen has no
  two-pane view at any width, so at Split each stands alone against an
  unlabeled rail and the link is the only route back.

The `<header>` element therefore needs a third answer: at Split a detail pane
draws a sync line with no back link beside it, so "the band exists exactly when
the back link does" is not true.

`Gear list builder` is the 1024 frame that draws `‹ TRIPS` — and it is a bare
pane with **no sidebar**, which is what makes it consistent with
`Trip screen — S6 desktop` rather than a contradiction of it: *sidebar drawn ⇒
back link not.*

**One hook says it: `useScreenHeader` in `app/src/shell/useMediaQuery.ts`**,
which composes the two queries it sits beside, takes a `ScreenPlacement`
(`splitPane`, true only for `GearDetail`, and the Desktop flag above) and
returns `{band, backLink, syncLine}`. It exists because a rule spelled per
screen is one chance per screen to spell it differently — which is exactly how
`Account` came to carry `Trip`'s defect from a different slice.

**One component draws it: `ScreenBand` in `app/src/shell/ScreenBand.tsx`.**
The hook decided the band and, for two slices, each screen still drew it —
the same fifteen lines of JSX and the same four CSS rules pasted ten times.
The drift that invites arrived on schedule: the sync dot is amber when the
box is unreachable, and the two screens written in one slice carried the tone
while the other eight drew a sage dot beside the word `OFFLINE`. A screen now
hands the hook's answer, its back link and the sync state to `ScreenBand`,
and the dot's tone is decided in one place, by `syncTone`. Its own suite is
`ScreenBand.component.test.tsx`, because on a case-insensitive filesystem
`ScreenBand.test.tsx` *is* the composed suite below; that composed suite is
where the amber dot is proved through nine screens at once.

**A screen tested without the shell can only prove half of this.** A per-screen
suite renders its screen alone, so an absence assertion there says the screen
withheld a line and nothing about whether `AppShell` drew one — which is how the
rule shipped inverted, with a visible double print on a phone, and passed
review. `app/src/shell/screenBand.test.tsx` is the other half: it renders a
pushed screen **inside** `AppShell` and counts one visible `SYNCED` at phone
width, at Split and at Desktop. That is a permanent property of the two suites,
not a note about one round.

**The hook's reach is every screen that draws either half of the band —
twelve, since S10.** `AddGear`, `GearDetail`, `Trip`, `NewTrip`, `Account`,
`People`, `Devices` and `InviteIssued` ask it, and no screen spells the rule
itself. S7 added `GearListBuilder` (`/trips/:id/list`) and `DepotPicker`'s
screen variant (`/trips/:id/add`), both answering `splitPane: false` — the
builder is two panes of itself, not a detail pane of a list also on screen, so
it does not take `GearDetail`'s `true`. S9a added `Packing`
(`/trips/:id/packing`) and S10 `Unpack` (`/trips/:id/unpack`), both unguarded
at every width. **All twelve draw a sync line**: eleven always did, and §5n
K23 makes `InviteIssued` the twelfth — the round drew the Split frame whose
absence was the only thing holding it open.
`splitPane` is true for `GearDetail` alone. Three of the answers are
worth stating, because they are about the app as built rather than as drawn:

- **`AddGear` answers `splitPane: false`, against its own board frame.**
  `Add gear — split 900` draws it as a pane with the Depot list beside it, and
  that two-pane Add gear has never been built: `<Route path="/add">` renders it
  standalone at every width. So at Split `‹ DEPOT` still points at something
  not on the page, and the link is drawn.
- **`People` and `Devices` `Redirect to="/account"` at Desktop**, so their
  Desktop band is never reached and the composed suite counts them at the two
  widths `App.tsx` actually mounts them at. `People` has a second render, the
  `inline` variant Account unfolds into its own card at Desktop, which draws no
  band at all. Before S7 they were the **only** two of the eight whose route
  carried a width guard; S7 makes it four, and S9a's unguarded `Packing`
  makes that four of eleven. `/trips/:id/add` redirects
  to `/trips/:id/list` at Split and up, and `/trips/:id/list` redirects to
  `/trips/:id` below it — `App.tsx`'s `isDesktop ? <X/> : <Redirect/>` shape,
  parameterised on `isSplit` instead. `AddGear`, `Trip`, `NewTrip`, `Account`,
  `InviteIssued`'s three routes, and `GearDetail` by way of `DepotView` —
  which renders it standalone below Split and at Desktop and as the
  right-hand pane between — are mounted at every width.
- **`InviteIssued`'s label is the one that is not fixed**, now that its band
  gates on `band` like every other screen's: `‹ ACCOUNT` from Account's own device link,
  `‹ PEOPLE & LOGINS` from a join Invite and from a device link minted for
  someone else. Where it points is the screen's own decision; whether it is
  drawn is this rule's — and at Desktop it is not, where the sidebar carries a
  labelled `Account` row and `/account/people` redirects to `/account`, so the
  link would have bounced through a redirect to a row already in the
  navigation.

**Closed — `InviteIssued` draws the line, and what was missing was a frame,
not a reason** (§5n K23). This section recorded the gap for three slices: at
Split the reader got exactly what the rail gives every screen there, a bare
6px dot whose state is carried only in an `aria-label`, and nothing on the
page said it in words — while the sync line's own reason, that Split is the
mode where nothing legible states it, applied to this screen as plainly as to
the other ten. What held it back was that no board drew the screen at Split at
all; the round drew one, and the answer it gives is the ordinary one. The
reason is if anything *stronger* here: this screen's whole content is a
credential the server just minted, so `OFFLINE` beside `Copy link` is the
reader's one warning that the link they are about to hand over may not exist.

**What that closure removed is an exemption, not just a line.** `ScreenBand`'s
`sync` prop was optional for exactly one caller, and the component carried a
second gate — *draw the wrapper if the back link is there, or if the sync half
is both asked for and suppliable* — so a band could be true for a half its
caller declined to hand in. With every caller supplying one, `header.band` is
the whole gate, `sync` is required, and the shape where the hook and the
caller disagree is unrepresentable rather than handled.

**The gap at Split has since been drawn and closed.** This section once
recorded an open question — the FAB was gated `!isDesktop` and offset a literal
74px, so at Split it cleared a bar that is not there and, on `Depot`, floated
over the detail pane rather than sitting in the list pane's box. `Screens B`
02A answered it: **the FAB accompanies the bottom tab bar, and pane modes carry
the control in the pane's own title row** (`docs/design/README.md` §5). Both
screens now gate the button on `!isSplit` and dock a title-row control from
Split up, and the offset names no height of the bar at all — see §3.1's shell
paragraph for the mechanism that replaced the literal.

## 4. CSS architecture

### 4.1 Cascade layers

One declared order, app-wide, in the global entry stylesheet:

```css
@layer reset, tokens, base, layout, components, utilities, overrides;
```

Layers are load-bearing here: they make "fallback-first, last-declaration-wins"
and cascade outcomes **deterministic**. A utility can never lose a specificity
fight to a component; Radix's minimal styles slot predictably; tokens are always
resolvable. The graceful-degradation CSS only stays reliable if the cascade is
boringly predictable.

**That order is a property of the emitted bundle, not of this stylesheet.**
CSS layers take their order from **first mention**, so whichever `@layer` the
bundler emits first decides it — and every `*.module.css` opens
`@layer components { … }`. `app/src/main.tsx` imported a component from
`@foerier/ui` *above* its own `import '@foerier/ui/styles.css'`, so module
evaluation reached a dozen component modules before the statement above:
`components` was created first, and the declared order then appended every
other layer **after** it. The sentence before this one was false in the built
bundle — `reset`, `base`, `layout` and `utilities` all beat every component in
`ui/`.

**One import, and one day between breaking it and finding it.** The commit
that inverted the cascade is the one that added the crash fallback: it gave
`main.tsx` the first `ui` component it had ever imported, and until then the
stylesheet genuinely was first. Nobody did anything unusual — which is the
argument for making the order structural rather than a convention about import
order in one file.

What it looked like, all from one cause: `reset`'s `button { color: inherit }`
winning, so the journey rail's current chip painted its fill and inherited its
text colour (white on white) and the sign-in CTA drew dark on dark at 1.7:1;
both FABs losing `position: fixed` and standing in the content flow; the
Depot's title row and the Desktop sidebar's foot losing their layout.

**The statement travels with the package now** — `ui/src/index.ts` imports the
stylesheet ahead of every component it re-exports, so any path that reaches a
component reaches the order first, and no consumer's import order can invert
it. Two guards, because the mechanism and the outcome are different claims:
`ui/src/layerOrder.test.tsx` pins the import and that every module in the
package claims a layer at all; `test/e2e/shell.spec.ts` measures the CTA's
label against its own fill in a real browser, which is the only tier that can
see a computed style. **Assert contrast, not difference** — the first draft of
that check asserted the two colours differ and passed against the bug, because
inherited ink on an accent fill is a different colour and merely an illegible
one.

- **reset** — minimal modern reset (box-sizing, zeroed margins,
  `img { max-width: 100% }`, form-control inheritance). Not a heavy normalize.
- **tokens** — `:root` primitives + semantic layer; `prefers-color-scheme`
  default + `[data-theme]` override. The only layer that flips theme.
- **base** — element defaults: `html { font-size: 100% }`, body type/color/bg,
  `:focus-visible` amber ring, `::selection`, the print baseline.
- **layout** — the shell's grid, gutters and `--nav-size`, and the four
  media-query steps that resize them. Viewport-level only. **The nav
  treatments and the pane structure are not here**: the tab bar, rail and
  sidebar are styled in `app/src/shell/AppShell.module.css` and the panes in
  `DepotView.module.css` and `GearListBuilder.module.css`, all under
  `components`, because which treatment renders is chosen by JS
  (`useMediaQuery`), not by a CSS ladder — see §3.2 for why.
- **components** — every `*.module.css`, each wrapping its rules in
  `@layer components { … }`. CSS Modules give scoped names; the layer gives
  cascade order. Component **`@container` queries** live here.
- **utilities** — a *tiny* hand-rolled set only: `visually-hidden`,
  `truncate`, `clamp-2`, `stack`, `cluster`. Not a utility framework — just
  the handful that earn their keep, and as of this writing only
  `visually-hidden` has a caller; the other four wait for one.
- **overrides** — escape hatch, declared and empty.

### 4.2 File shape

```
ui/styles/
  reset.css      tokens.css     base.css
  layout.css     utilities.css        (each declares its @layer)
  index.css      → @layer order + @imports + self-hosted @font-face
ui/src/<Name>.module.css                       → @layer components
app/src/{components,screens,shell}/<Name>.module.css → @layer components
```

Flat, beside the component, in both workspaces — not a directory per
component. Most modules live in `app/`, since most components do (§5); the
layer rule is the same on both sides.

## 5. Component architecture — the `ui/` package

Three tiers, with one hard rule: **`ui/` never imports the store.**

- **Primitives (`ui/`)** — `Button`, `Chip`, `StatusPill`, `SegmentedControl`,
  `Stepper`, `PersonCircle`, `Row`, `Card`, `Field`, `Sheet`, `Confirm`,
  `Popover`, `Menu`, `Tabs`. The interactive ones are **thin wrappers around a
  Radix primitive** (`Sheet` wraps Radix Dialog with our styling + a11y
  defaults; `Confirm` wraps AlertDialog). Radix is wrapped **once**, here, so
  the rest of the app imports *our* component and we keep a single point to
  restyle or replace it. Radix is tree-shakeable per-primitive, respecting the
  app-shell JS budget. Pure props-in, no data access.

  **Built so far: `Chip` (S3), `Sheet` and `Confirm` (the Radix conversion),
  `Stepper` (S7), `PersonCircle` (S8), and `SegmentedControl` + `StatusPill`
  (the post-S9 consolidation)** — plus **`PersonCluster`**, which
  S8 built in `ui/` and which this list has never named, **`ExpiryChip`**
  (S3.5, named only under composites below), **`QrCode`** (S3.5, the one
  module that imports `uqr`), and the `Logo`, `Mark` and three `Icon`
  components from S0. `ui/src/index.ts` is the authoritative list; this
  paragraph is the reasoning. `Sheet` and `Confirm`
  converted every overlay in the app in one slice
  ([its spec](specs/2026-08-29-radix-conversion.md)). Two primitives rather
  than one because a picker is a `dialog` and a decision is an `alertdialog`,
  and Radix's two packages differ in more than the role: an AlertDialog does
  not dismiss on an outside pointer-down and gives initial focus to its
  Cancel. Both are **mounted-is-open** — there is no `open` prop, so a caller
  writes `{open && <Sheet …/>}` and mount is what resets a picker's draft
  state. `Stepper` (S7) is **not** a Radix wrapper — Radix ships no number
  field, so it is a plain `{value, min, onChange, size?, label}` component
  holding no **business** state (it keeps a local text buffer so a keystroke
  that has not yet resolved to a number stays on screen, but `value` is the
  one source of truth) and importing neither the store nor the router. Two
  sizes, h48 default and an in-row h32 whose hit area pads to ≥44px beyond the
  painted box (the status-pill minimum, allowed on touch); `min` defaults to
  `0`, since a Bring-count of zero is expressible on the wire and is not the
  same as removing the Entry it belongs to. Three callers: `GearDetail`'s
  hand-rolled Owned-count stepper folds in, and the gear list's Bring-count
  control (`EntryRow.tsx`, dense size) is a new caller rather than a folded
  one — S7 is the first slice with a gear list to hand-roll anything into.
  **Add gear is the third, folded in after the MVP landed.** `value`/`onChange`
  widened to `number | null` partway through S7, which is what made it
  possible; what kept it undone was that its field also owns a label, a fact
  line and a CTA gate, and all three survive the fold — the label as a
  `<span>` (the component names its own well), the fact line beside the
  control, and the gate reading `null`. What the fold ended is one control
  answering to **two accessible names**: `Fewer` / `More` there against
  `Decrease {label}` / `Increase {label}` here. What it cost that screen is
  the per-keystroke commit — the count is now stated on blur (ruling K), and
  the CTA it gates is `disabled` until then, which holds only because a tap
  over a disabled button still blurs the well. Measured in Chromium and
  WebKit rather than assumed; `KEYBOARD-PASS.md` carries it, since no tier
  can.

  **`SegmentedControl` and `StatusPill` landed together after S9**, each on
  §5's own trigger (`patterns.md` §5.5) rather than on a slice. The segmented
  control had **four** hand-rolled copies — `AddGear` twice, `GearDetail`,
  `Packing`, `TripOnlySheet` — and only one had worked out that a container
  with `overflow: hidden` cannot hold a hit extension, because a clipped
  descendant is not hit-testable and a stylesheet-text test would find the
  `::after` and pass over a hit area that does not exist. One component, two
  sizes on `Stepper`'s pattern: h48 in the body face, h40 in mono caps with
  ruling O's vertical-only clamp. The face rides the size because all four
  callers co-vary; split them the day a board draws one that does not. `value`
  takes `undefined` for *nothing selected*, which gear detail's edit sheet
  genuinely needs — it may not assert a Kind nobody stated. `StatusPill` owns
  the grammar its two callers share (pill radius, chip stroke, mono caps,
  glyph then word, 44 by paint rather than by clamp) and takes a `tone`
  naming the paint, per `PersonCircle`'s rule; its two callers are genuinely
  two controls, one that states a status and one that writes one.
  `PersonCircle` itself gained a sixth size, **40**, for the one band where
  the circle is its own subject — Account's `you` block — and absorbed the two
  hand-rolled avatars with it.

  The rest of
  this list is unbuilt, and `Popover` is the one with waiting callers —
  **seven of them** that a board *names* as a popover: §4a's desktop tag
  picker and the slice bar's `ValueMenu` are approximated by `Sheet`'s
  `desktopCard` until it lands, and so are S8's Piece picker and S9a's Piece
  status sheet, both popovers from Split up on the boards; since S10, the
  outcome sheet and its roster variant, approximated the identical way; and
  since S14, the template source picker, whose own round declined to draw the
  seventh popover rather than take a set of visual decisions against nothing. Four more sheets pass
  `desktopCard` with no board behind them (`patterns.md` §4.5 records which),
  which is the count to look at when `Popover` does land.

  **"Names" is doing real work in that sentence, and it was checked.** No
  board *draws* a popover: the bundle holds no popover artboard, the only
  popover token in `Foundations` is the `bg/raised` background it shares with
  a hovered row, and the whole specification is one repeated sentence —
  *sheet below Split, popover anchored to the cluster from Split up* (§5d C,
  §4a), with `S9 Round` adding only *`ui/Popover` is not built, so this lands
  with the primitive*. Side, alignment, offset, width, collision behaviour
  and whether it carries an arrow are all unstated. Building it was therefore
  a design sitting rather than an afternoon, and there was a second half to
  rule with it: Radix's popover wants its trigger and its content as siblings
  under one root, which cuts against the mounted-is-open convention every
  overlay in the app follows (`patterns.md` §4.1), so the trigger anatomy is
  part of the same question.

  **That sitting happened, and it answered both halves** (§5n K15–K17). The
  anatomy is drawn from tokens and rules the app already has — `bg/raised`,
  a 1px `rule` border, **radius 12** (the card step, not the sheet's top-only
  16 and not a control's 8), elevation by the theme's own rule so dark gets no
  shadow and light does, **offset 8** so the gap reads *attached to* rather
  than *sibling of*, and **no arrow**, the app drawing none anywhere. Side is
  **bottom, always**, because five of the seven triggers are a row's
  right-edge control a gutter from the pane edge at Split, where a side
  popover collides on open every time; alignment follows the trigger's own
  edge; width is `min(20rem, available)`; the content scrolls itself at
  `max-height: available`. And the trigger question is answered by not having
  one: **`Popover.Trigger` is not used at all** — the root wraps an *anchor*
  and the content, `open` is the caller's own state, and `{open && …}`
  survives, so drafts still reset on mount and each caller's existing button
  keeps its props, its accessible name and its hit extension. `ui/Popover`
  takes `anchor` as a `ReactNode`, `GearRow`'s own idiom.
- **Composites (`ui/`)** — `GearRow`, `TripCard`, `JourneyRail`,
  `WhereaboutsCard`, `LedgerList`. Presentational; take domain data as **props**.

  **Only `GearRow` has moved so far** — `TripCard` and `WhereaboutsCard` are
  still in `app/src/components/` with one caller each, and a second caller is
  the bar `GearRow` cleared (`Depot`, `Find`) and `ExpiryChip` after it
  (`InviteIssued`, `People`, and since the pattern audit `Join`, which had
  hand-rolled a rounding copy). `WhereaboutsCard` is props-in already, and
  the rest of that sentence used to read *"wants only its second caller plus a
  type-only `@foerier/shared` import"* — which was wrong on both halves and is
  corrected here. The `shared/` import is **not** type-only:
  `containerText`, `LOOSE_TEXT`, `sliceCountLabel` and `stageWord` are runtime
  values called on every render, so it is `JourneyRail`'s blocker exactly, not
  a lighter one. And it renders the router's `Link` for `RESOLVE`, which is
  `TripCard`'s second blocker. Its move is therefore an **API redesign**: each
  `shared/`-derived string has to arrive pre-resolved as a row view model, and
  `RESOLVE` has to arrive as a `ReactNode` the caller builds — the shape
  `Sheet` and `Confirm` already use to keep routing in `app/`. Designing that
  view model against a single screen is the second reason to wait for the
  second caller, not just the bar. `TripCard` is blocked four ways, not
  one: it reads `useHousehold`, renders the router's `Link` where `GearRow` takes
  `anchorProps`, imports `app/`'s own `household/trips` helpers and
  `GearListSection`'s label, and calls `shared/` selectors at runtime.
  `LedgerList`, named in this list, is story 33 and has never existed.
  **`JourneyRail` was built at S9a and built in `app/`**, making three: it is
  props-in and clears the hard rule already, but it reads `STAGES` and
  `stageLabel` from `@foerier/shared`, which `ui/` does not depend on — so the
  move is either a new dependency edge or a stage table passed down as props,
  and that is a decision rather than a relocation. Its one caller is `Packing`.
- **Screens / containers (`app/`)** — read the fold through `useHousehold`, derive
  with **`shared/`'s selectors** (plain functions; `shared/` knows nothing of
  Zustand), then hand plain data down to `ui/`.

The store-agnostic seam is what lets the **landing page render the real
components on static demo data** (an architecture goal): `app/` feeds them from
the live fold, `landing` feeds them a fixture — same `ui/`. It also keeps `ui/`
trivially unit-testable in isolation.

Cross-cutting pieces, also in `ui/`:

- **`Band`** — the section band: a mono caps label, and a trailing slot for
  what the section counts or leads to. **Built** after the MVP, out of its
  three copies; `Screens B` §08 named it among what S12/S13's shell commit
  was to land, and the shell that landed was `TripPanels` alone.
- **`Icon`** set — inline-SVG React components (the design mandates no rasters;
  the duffel logo and stroke icons live here). **Built.**
- **`ErrorBoundary`** — wraps each screen and each independent panel.
  **Built.** Three boundaries, each owned by the element that knows what its
  unit is: `main.tsx` around `<App/>` (`variant="page"`, the only one with no
  shell to stand in), `AppShell` around the routed screen and *inside* the
  scroller, so a crashed screen keeps the nav that reached it, and
  `TripPanels` around each panel it is passed, so no future panel's author has
  to remember one. The screen boundary is **keyed on the location**: nothing
  else clears a boundary's state, and a deterministic crash would otherwise
  hold the main column for the rest of the session. The fallback is two
  sentences, a `Try again` and a collapsed report carrying `error.stack`,
  React's component stack and `BUILD <sha>` — which is what `build.sourcemap`
  and `esbuild.keepNames` in `app/vite.config.ts` exist for. The copy is
  code-authored (`docs/design/README.md` §16): no board draws a crashed
  card.
- **`motion`** module — the single place gating transitions behind
  `prefers-reduced-motion` **and** `prefers-reduced-data`. **Unbuilt**, and
  currently moot: `base.css` carries the reduced-motion query, no module
  declares a transition or animation for it to guard, and
  `prefers-reduced-data` appears nowhere.

The lazy-**chunk-load-error → SW-update → reload+retry** handler is app-shell
level (in `app/`, near the router), not `ui/`. **Unbuilt, and moot for the
same reason**: every screen is imported eagerly, there is no `lazy()` or
`Suspense` in `app/src`, so there is no chunk to fail. It becomes due the day
a route is code-split. Neither carries an entry in
[`technical-debt.md`](technical-debt.md) any more: with the boundary built,
what is left has no trigger yet, and work whose trigger has not fired is a
deferral rather than a debt. Both become due the day it does.

## 6. Resilience layer

Broad posture: **always prefer a fallback over an error in the user's face.** Each
concern has a concrete home and mechanism.

| Concern | Home | Mechanism |
| --- | --- | --- |
| Fonts blocked / down | `ui/styles` + build | **Self-hosted** woff2, hashed, Workbox-precached — zero third-party requests to block (privacy add-ons, corporate proxies, blocked CDNs) |
| FOIT / swap shift | `@font-face` | `font-display: swap` + **metric-matched fallback `@font-face`** (`size-adjust` / `ascent-override` / `line-gap-override`) so the swap doesn't reflow |
| Reduced motion / low power | `ui/motion` + base | `@media (prefers-reduced-motion: reduce)` kills transitions; `prefers-reduced-data` drops non-essential motion/work. **Built: the base query only** (§5) |
| Print | `layout` layer | `@media print`: nav hidden, single column, ink-on-white, truncation expanded. **Built**, across three sheets: `layout.css` hides the nav and unpins the shell's three viewport pins (fixed height, inner scroller, capped column) and makes the grid one column; `base.css` prints ink on white and expands truncation globally — `!important`, and `.visually-hidden` excluded, since the module-level ellipsis rules are hashed and unreachable by name; `utilities.css` unwinds its own two. `app/src/shell/print.test.ts` pins all four, since jsdom has no print medium |
| `line-clamp` unsupported | `clamp-2` utility | `@supports (-webkit-line-clamp: 2)` guard → **fail open** to full content |
| New-CSS fallbacks | discipline + `@supports` | Safe declaration first, enhancement second; `@supports` for structural upgrades (container queries, `color-mix`, `gap`) |
| Component crash | `ui/ErrorBoundary` | Wraps each screen + panel; in-place terse fallback (ledger voice), not a full-screen white-out; local reset action, plus a collapsed report (both stacks + build) the reader can copy. **Built** (§5) |
| Stale client / missing chunk | `app` shell | Catch `import()` rejection → trigger SW update → **reload once** (`sessionStorage` guard against reload loops) + a quiet "new version" header line. **Unbuilt and moot until a route is code-split** (§5) |
| Offline | core (op-log / SW) | Already the default; surfaced as one quiet sync-state header line, never a blocking dialog |
| No JavaScript | `index.html` | Honest one-line `<noscript>` in ledger voice ("foerier needs JavaScript."). **Built.** The lightweight shell skeleton before hydration is not: the body is one empty `#root` |

**On dropped signals.** The Battery Status API is effectively unavailable
(removed/never-shipped/gated across browsers), so battery-driven behaviour is not
implementable; its intent is served by `prefers-reduced-motion` and
`prefers-reduced-data`. A WebSocket-killed-by-proxy fallback is moot — the sync
design uses **no** WebSocket (HTTP `POST`/`GET` polling; SSE only as a later
seam), so there is nothing to fall back *from*.

## 7. Fonts

- **Variable woff2, subset to Latin, one file per family** — Bricolage Grotesque,
  Spline Sans, Spline Sans Mono all ship variable versions; one variable file
  covers each family's whole weight range (600–700 / 400–600) and typically beats
  three static cuts. **3 files, not 8.**
- **Hashed by Vite, Workbox-precached** → available offline (a CDN never would
  be). `<link rel="preload">` the primary UI font (Spline Sans) only —
  **built**, as a `transformIndexHtml` plugin in `app/vite.config.ts` rather
  than a line in `index.html`: the file is hashed and lives in `ui/fonts/`, so
  there is no path the HTML could carry that survives a build, and the emitted
  bundle is where the real name is. It carries `crossorigin`, which is not
  about CORS policy — a font is fetched anonymously, so a preload without it is
  a second fetch rather than a warm cache hit. Build only; in dev the font is
  unhashed and served off the filesystem.
- **Metric-matched fallbacks auto-generated** with the **Fontaine** Vite plugin,
  deriving the `size-adjust`-tuned fallback `@font-face` from the real fonts
  rather than hand-tuning. Stacks read
  `'Spline Sans', 'Spline Sans fallback', system-ui, sans-serif`.
- `font-display: swap` across the board; with metric matching the swap is
  visually near-silent.

## 8. What this doc does not settle

- Exact per-component markup and class names — emerge during the vertical slices.
- The full icon inventory — grows as screens land.
- Whether any specific type size is later promoted from discrete to fluid
  `clamp()` (§2.3) — a reversible, per-size call.
- Animation/transition specifics beyond the reduced-motion/-data gate.

## 9. Feeding decisions back to the design boards

The design boards in [`docs/design/`](design/) originally defined only phone
and tablet frames and a Google-Fonts CDN link, against the five-mode ladder +
Roomy and self-hosted fonts this doc settled on. That pass has since landed:
[`docs/design/README.md`](design/README.md) is headed "Typography
(**self-hosted**)" (`:36`), documents all five layout modes (`:57`), and names
the **Roomy** and **Split** frames (`:111`). The visual source and this
solution design are consistent.

### 9.1 Reconciliation with the domain (2026-08-24), landed

Seven concepts drawn on the boards had no story, glossary entry, or aggregate
behind them. They were reconciled into
[`user-stories.md`](user-stories.md), [`ubiquitous-language.md`](ubiquitous-language.md)
and [`domain-model.md`](domain-model.md), and the boards owed the changes
below in the same pass as the frames and fonts above. That pass has since
landed too, in [`docs/design/README.md`](design/README.md); each item below
now records where.

The boards' own **Fidelity** note claimed copy and layout final and to be
recreated pixel-perfectly, with no scope annotation anywhere — which was the
root of the problem: a developer building the MVP from them built Later
features. The first ask of the pass was therefore that the boards **carry
scope**, marking anything not in the MVP — done: the `LATER` tag (`:12`,
`:212`).

**Marked Later — the design was right, the timing was not**

- **`LEDGER` group** on Gear detail — story 33, derived from the change log.
  Design kept, tagged Later (`:118`).
- **Weight totals** — `EST 48.2 KG` in the builder header and footer, `1.9 KG
  EACH` in gear meta. This is story 16, already tagged Later. Where weight is
  welded into a composite line (`34 GEAR · 61 PIECES · 18 PER-PERSON · 3
  TRIP-ONLY · EST 48.2 KG`), the board also shows the MVP variant without the
  weight segment (`:115`, `:124`).

**Redrawn — the design contradicted the model**

- **Depot `PIECES` rows** (`Piece 1/2 · BOUGHT 2022 · GOOD`) — counted gear has
  no per-unit identity, deliberately (domain-model §6). Replaced with the
  **split-whereabouts quantity line** (`×1 ⌂ CRATE B` + `×1 ▸ ALPS 2026`), no
  per-unit rows, no condition, no purchase year anywhere (`:117`).
- **The word "Piece"** — reserved, narrowly, for one participant's copy of
  per-person gear on a trip. Per-person Pieces now belong only in a trip
  context; the vocabulary guard is explicit in the boards (`:200`).
- **`OUT` vs `OPEN`** on Unpack — two words for one state, and `OUT` misread as
  "still away". Settled on **open**, matching story 11 (`:91`).

**Removed — no story, decided against**

- **Condition and purchase year** (`BOUGHT 2022 · GOOD`). No story asks for
  either; condition is maintenance territory (story 17, Later) and belongs to
  gear rather than to units if it ever lands. Gone from the boards (`:117`,
  `:200`).

**Added — the model said something the boards did not**

- **Reopening a closed Trip** (stories 11, 32) — a confirmed action on a
  closed trip, restoring it to Unpack, using the boards' confirm-sheet
  primitive; the copy makes clear nothing was thrown away at close, and that
  changing away from `consumed` **offers** to restore the Owned-count rather
  than doing it silently. Drawn in §02B (`:128`).
- **Over-claim warning** (stories 6, 32) — the moment two Active Trips want
  the same gear, shown when adding, when starting pack-out on a draft, and
  when reopening. A warning, never a block, that never discards work — it
  takes the attention colour and the ▲ marker, not a filled red button.
  Drawn in §02B (`:128`).
- **Unaccounted-for gear** (stories 3, 11) — `▲ LAST SEEN: TESSIN 2025` with
  `RESOLVE`, already drawn on Find, now reads consistently on Find, Gear
  detail, and the Depot's Whereabouts column (`:92`, `:116`, `:133`).
- **Trip phases moving backwards** (story 32) — the phase chip is right as
  drawn, and the phase is reachable in both directions; the CTA is a
  suggestion rather than the only route (`:123`).
- **Optional Trip dates** (story 5) — drawn throughout and correct, and the
  boards also show a Trip without dates, since they are optional and a Draft
  usually has none (`:122`).
