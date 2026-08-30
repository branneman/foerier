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

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Scaling philosophy | **Fluid, user-respecting, accessible.** Not classic progressive enhancement — the app is unapologetically a JS SPA — but it scales beautifully and honours the reader's font-size and zoom |
| Styling approach | **Hand-authored CSS Modules** + design **tokens as CSS custom properties** (in `rem`), under declared `@layer`s. **No Tailwind, no styled kit** (MUI/Chakra/Mantine) |
| Interactive widgets | **Radix UI** headless primitives (sheets, popovers, menus, tabs, checkboxes) — wrapped **exactly once** in `ui/`, styled entirely by our CSS |
| Units | `rem` for the global grid (type, spacing, radii); `em` for intrinsically-local component internals; touch targets floored at `max(3rem, 48px)` |
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
- **Touch targets get a physical floor: `min-height: max(3rem, 48px)`.** Minimum
  tap size is about *finger* size, which does **not** shrink when a user picks a
  smaller font. Targets may *grow* with text (`3rem`) but never fall below the
  physical `48px` minimum.

### 2.2 Token layers (CSS custom properties)

Three layers, all `rem`/color values, defined in the `tokens` cascade layer:

- **Primitive** — the raw scale: `--space-4 … --space-32`, `--text-*` size/line
  pairs, the color hexes from the design boards.
- **Semantic** — intent, and the **only** layer that flips theme:
  `--color-bg-base`, `--color-ink-primary`, `--color-status-packed`, etc.
  Components consume *this* layer.
- **Component** — optional local knobs (`--row-pad-x`, `--pill-radius`), only
  where a component needs one.

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

**The shell is one viewport tall in every mode, and the screen scrolls inside
it.** `.shell` is a fixed `100svh` grid and `.shell__main` is the scroll
container; in the signed-in app nothing else scrolls, the document included.
That is what makes each nav treatment *persistent* rather than merely present:
below Split the bottom tabs stay in the thumb zone on a two-hundred-item Depot,
and from Split up the nav column's pinned foot — the `ACCOUNT` row above the
sync marker — stays at the bottom of the screen instead of sliding to the
bottom of the document, which is where a shell sized by `min-height` put it.
The same mechanism pins the phone header band, which below Split carries the
sync line and the only route to Account. Four consequences are worth knowing
before touching the shell:

- **A screen's floating control is sticky against `.shell__main`, so its inset
  is `0`.** A sticky inset is resolved against the scrollport reduced by the
  scroll container's own padding, and `.shell__main`'s bottom padding is
  already the drawn 18px (`--fab-clearance`). An inset on the control would be
  added to that padding rather than restate it — measured in Chromium,
  `bottom: 18px` against an 18px foot floats the control 36px above the bar. So
  the clearance is said once, at the foot, and the control carries a zero.
- **A route change resets the offset to the top**, in `AppShell` and nowhere
  else. A scroll container that outlives the route carries its offset into
  whatever renders next; the document scroller this replaced reset itself. It
  is a reset and not a restore: restoring is per history entry rather than per
  path, and nothing here holds history entries.
- **The scrollbar belongs to the content column, not the window.**
  `.shell__main` is what carries the `max-width` cap and the centring at Roomy
  and Desktop, so where a platform draws a classic scrollbar it lands on the
  1120px column's right edge.
- **`svh`, not `dvh`.** With an inner element scrolling, a mobile browser's
  toolbars never retract, so the small viewport *is* the viewport and a dynamic
  unit would chase a transition that does not happen. It also matches the unit
  the sheets' `max-height` already uses.

**Radix's scroll lock still holds.** `react-remove-scroll`, which every `Sheet`
and `Confirm` sits inside, does two things: `overflow: hidden` on `body`, and
capture-phase `wheel`/`touchmove` handlers that cancel any such event whose
target lies outside the locked subtree. The first becomes a no-op once the body
no longer scrolls; the second is what does the work, and it is indifferent to
which element the scrollport is. Verified in Chromium against a scrolling
`.shell__main` with a Radix dialog open: wheel and touch over the background
both leave the offset where it was.

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
- **The back link is drawn unless its destination is already on the page**,
  which is not a width alone. At Desktop the labeled sidebar *is* that
  destination — `Trip screen — S6 desktop` draws `TRIPS` and the sync line in
  the sidebar and neither in the main column — so no screen draws one there.
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
(`splitPane`, true only for `GearDetail`) and returns `{band, backLink,
syncLine}`. It exists because a rule spelled per screen is one chance per screen
to spell it differently — which is exactly how `Account` came to carry `Trip`'s
defect from a different slice.

**A screen tested without the shell can only prove half of this.** A per-screen
suite renders its screen alone, so an absence assertion there says the screen
withheld a line and nothing about whether `AppShell` drew one — which is how the
rule shipped inverted, with a visible double print on a phone, and passed
review. `app/src/shell/screenBand.test.tsx` is the other half: it renders a
pushed screen **inside** `AppShell` and counts one visible `SYNCED` at phone
width, at Split and at Desktop. That is a permanent property of the two suites,
not a note about one round.

**The hook's reach is every screen that draws either half of the band — all
eight.** `AddGear`, `GearDetail`, `Trip`, `NewTrip`, `Account`, `People`,
`Devices` and `InviteIssued` ask it, and no screen spells the rule itself.
Seven of the eight draw a sync line; `InviteIssued` does not, which is left
open below rather than settled. `splitPane` is true for `GearDetail` alone.
Three of the answers are worth stating, because they are about the app as
built rather than as drawn:

- **`AddGear` answers `splitPane: false`, against its own board frame.**
  `Add gear — split 900` draws it as a pane with the Depot list beside it, and
  that two-pane Add gear has never been built: `<Route path="/add">` renders it
  standalone at every width. So at Split `‹ DEPOT` still points at something
  not on the page, and the link is drawn.
- **`People` and `Devices` `Redirect to="/account"` at Desktop**, so their
  Desktop band is never reached and the composed suite counts them at the two
  widths `App.tsx` actually mounts them at. `People` has a second render, the
  `inline` variant Account unfolds into its own card at Desktop, which draws no
  band at all. They are the **only** two of the eight whose route carries a
  width guard: `AddGear`, `Trip`, `NewTrip`, `Account`, `InviteIssued`'s three
  routes, and `GearDetail` by way of `DepotView` — which renders it standalone
  below Split and at Desktop and as the right-hand pane between — are mounted
  at every width.
- **`InviteIssued` gates its `<header>` on `backLink` rather than on `band`.**
  It draws no sync line, so the back link is the only thing the band could
  hold, and `band` exists precisely so a wrapper is never rendered empty. (For
  `splitPane: false` the two answers coincide — `syncLine` is `isSplit &&
  !isDesktop` and `backLink` is `!isDesktop`, so the first implies the second —
  but the gate names the half the screen actually draws.) Its label is the one
  that is not fixed: `‹ ACCOUNT` from Account's own device link,
  `‹ PEOPLE & LOGINS` from a join Invite and from a device link minted for
  someone else. Where it points is the screen's own decision; whether it is
  drawn is this rule's — and at Desktop it is not, where the sidebar carries a
  labelled `Account` row and `/account/people` redirects to `/account`, so the
  link would have bounced through a redirect to a row already in the
  navigation.

**Open — `InviteIssued`'s sync half has no drawn answer, and this doc does
not invent one.** At Split the reader gets exactly what the rail gives
every screen there — a bare 6px dot whose state is carried only in an
`aria-label` — and nothing on the page states it in words; the sync
line's own reason, that Split is the mode where nothing legible says it,
applies to this screen exactly as it applies to the other seven. What
holds it back is not that reason: no board draws `InviteIssued` at Split
at all — the one frame it has is the phone 393 door — so there is no
drawn line to build toward. Mitigating, not resolving: the screen's one
action is a live `POST /auth/invites`, so a device that cannot sync fails
by that call failing, visibly, rather than by an invite that silently
never reaches the household. Left open rather than added — adding the
line without a board to draw it from is exactly the guess this doc keeps
refusing to make.

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

- **reset** — minimal modern reset (box-sizing, zeroed margins,
  `img { max-width: 100% }`, form-control inheritance). Not a heavy normalize.
- **tokens** — `:root` primitives + semantic layer; `prefers-color-scheme`
  default + `[data-theme]` override. The only layer that flips theme.
- **base** — element defaults: `html { font-size: 100% }`, body type/color/bg,
  `:focus-visible` amber ring, `::selection`, the print baseline.
- **layout** — the shell: app grid, tab-bar/rail/sidebar, pane structure, and the
  five-mode media-query ladder. Viewport-level only.
- **components** — every `*.module.css`, each wrapping its rules in
  `@layer components { … }`. CSS Modules give scoped names; the layer gives
  cascade order. Component **`@container` queries** live here.
- **utilities** — a *tiny* hand-rolled set only: `visually-hidden`, `truncate`,
  and layout primitives (`stack`, `cluster`, `grid-auto`). Not a utility
  framework — just the handful that earn their keep.
- **overrides** — escape hatch, near-empty by design.

### 4.2 File shape

```
ui/styles/
  reset.css      tokens.css     base.css
  layout.css     utilities.css        (each declares its @layer)
  index.css      → @layer order + @imports + self-hosted @font-face
ui/components/<Name>/<Name>.module.css → @layer components
```

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

  **Built so far: `Sheet` and `Confirm`** — every overlay in the app, converted
  in one slice
  ([its spec](specs/2026-08-29-radix-conversion.md)). Two primitives rather
  than one because a picker is a `dialog` and a decision is an `alertdialog`,
  and Radix's two packages differ in more than the role: an AlertDialog does
  not dismiss on an outside pointer-down and gives initial focus to its
  Cancel. Both are **mounted-is-open** — there is no `open` prop, so a caller
  writes `{open && <Sheet …/>}` and mount is what resets a picker's draft
  state. The rest of this list is unbuilt, and `Popover` is the one with a
  waiting caller: §4a's desktop tag picker is approximated by `Sheet`'s
  `desktopCard` until it lands.
- **Composites (`ui/`)** — `GearRow`, `TripCard`, `JourneyRail`,
  `WhereaboutsCard`, `LedgerList`. Presentational; take domain data as **props**.
- **Screens / containers (`app/`)** — read Zustand **selectors from `shared/`**,
  then hand plain data down to `ui/`.

The store-agnostic seam is what lets the **landing page render the real
components on static demo data** (an architecture goal): `app/` feeds them from
the live fold, `landing` feeds them a fixture — same `ui/`. It also keeps `ui/`
trivially unit-testable in isolation.

Cross-cutting pieces, also in `ui/`:

- **`ErrorBoundary`** — wraps each screen and each independent panel.
- **`Icon`** set — inline-SVG React components (the design mandates no rasters;
  the duffel logo and stroke icons live here).
- **`motion`** module — the single place gating transitions behind
  `prefers-reduced-motion` **and** `prefers-reduced-data`.

The lazy-**chunk-load-error → SW-update → reload+retry** handler is app-shell
level (in `app/`, near the router), not `ui/`.

## 6. Resilience layer

Broad posture: **always prefer a fallback over an error in the user's face.** Each
concern has a concrete home and mechanism.

| Concern | Home | Mechanism |
| --- | --- | --- |
| Fonts blocked / down | `ui/styles` + build | **Self-hosted** woff2, hashed, Workbox-precached — zero third-party requests to block (privacy add-ons, corporate proxies, blocked CDNs) |
| FOIT / swap shift | `@font-face` | `font-display: swap` + **metric-matched fallback `@font-face`** (`size-adjust` / `ascent-override` / `line-gap-override`) so the swap doesn't reflow |
| Reduced motion / low power | `ui/motion` + base | `@media (prefers-reduced-motion: reduce)` kills transitions; `prefers-reduced-data` drops non-essential motion/work |
| Print | `layout` layer | `@media print`: nav hidden, single column, ink-on-white, truncation expanded |
| `line-clamp` unsupported | `truncate` utility | `@supports (-webkit-line-clamp: 2)` guard → **fail open** to full content |
| New-CSS fallbacks | discipline + `@supports` | Safe declaration first, enhancement second; `@supports` for structural upgrades (container queries, `color-mix`, `gap`) |
| Component crash | `ui/ErrorBoundary` | Wraps each screen + panel; in-place terse fallback (ledger voice), not a full-screen white-out; local reset action |
| Stale client / missing chunk | `app` shell | Catch `import()` rejection → trigger SW update → **reload once** (`sessionStorage` guard against reload loops) + a quiet "new version" header line |
| Offline | core (op-log / SW) | Already the default; surfaced as one quiet sync-state header line, never a blocking dialog |
| No JavaScript | `index.html` | Honest one-line `<noscript>` in ledger voice ("foerier needs JavaScript."); lightweight shell skeleton before hydration |

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
  be). `<link rel="preload">` the primary UI font (Spline Sans) only.
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
