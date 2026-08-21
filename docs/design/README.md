# Handoff: Foerier — Quartermaster's tool (design system + core screens)

## Overview
Foerier is a household gear ledger for families who camp/trek: a **Depot** (where every piece of gear lives at home), **Trips** (gear lists, pack-out, unpack), and **Find** (offline "where is it?"). Dark theme is the default. This bundle contains the visual foundations, user flows, component sheet, seven core screens, and the full auth & account surface (Screens C).

## About the Design Files
The `.dc.html` files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. Recreate these designs in the target codebase's existing environment (React, Vue, SwiftUI, native, …) using its established patterns and libraries. If no environment exists yet, choose the most appropriate stack (this is an offline-first mobile-primary app; local-first storage with background sync is a core requirement) and implement the designs there. Open each file in a browser to view it (`support.js` must sit next to them).

## Fidelity
**High-fidelity.** Colors, typography, spacing, and copy are final; recreate pixel-perfectly. The boards also contain annotation cards ("DECISIONS ON THIS SCREEN") beside each phone frame — these are rationale for the developer, not UI. The screens themselves are the framed artboards — 393px (Compact/Comfortable), 540px (Roomy), 900px (Split), 1024px (Desktop) — each marked with `data-screen-label`.

## Design Tokens

### Color (dark default / light)
| Token | Dark | Light | Use |
|---|---|---|---|
| bg/base | `#151A15` | `#F0EBDD` | App background |
| bg/surface | `#1F2620` | `#F9F6EC` | Cards, group headers, sheets |
| bg/raised | `#28312A` | `#FFFFFF` | Hovered/active row, popover, segmented-active |
| ink/primary | `#E8E5D5` | `#232820` | Text, icons |
| ink/muted | `#97A08C` | `#6A7161` | Meta, secondary |
| ink/faint | `#6A7161` | — | Hints, column heads, ledger dates |
| ink/dim | `#5E6857` | — | Future/disabled chip text |
| rule | `#333C33` | `#D8D2BE` | Borders, dividers (row dividers dark: `#2A3129`; control borders: `#47523F`) |
| accent | `#93BC9F` | `#35523F` | Primary actions, selection, links, active tab |
| brand/amber | `#E2A65B` | `#B4741F` | Logo handle, focus ring, ON TRIP marker, trip-only badge |
| status/not-packed | `#97A08C` | `#6A7161` | ○ empty circle + label |
| status/staged | `#D3A344` | `#8A6717` | ◐ half-filled circle + label |
| status/packed | `#7BB389` | `#40724B` | ● filled circle + check |
| status/attention | `#D98263` | `#A84B2F` | ▲ missing/lost, destructive text |

Derived fills: selected filter chip bg `#35523F`; input well `#0F130F`; status pill tints `rgba(211,163,68,.08)` staged, `rgba(123,179,137,.08)` packed, `rgba(217,130,99,.08)` attention; phase chip `rgba(226,166,91,.14)` bg + `rgba(226,166,91,.5)` border; selected row `rgba(147,188,159,.05)`; suggestion band `rgba(147,188,159,.07)` + border `#35523F`.

### Typography (self-hosted)
- **Bricolage Grotesque** 600/700 — display/titles
- **Spline Sans** 400/500/600 — UI text
- **Spline Sans Mono** 400/500/600 — all data: paths, counts, labels, chips (tabular figures; counts are load-bearing UI)
- **Delivery:** self-hosted **variable woff2** (one file per family, subset to Latin), hashed and **service-worker-precached** — works offline, no Google Fonts CDN, can't be blocked by privacy add-ons or proxies. `font-display: swap` with a **metric-matched fallback** `@font-face` (size-adjust/ascent-override) so the swap doesn't reflow. Preload only Spline Sans (primary UI font).

| Style | Spec | Use |
|---|---|---|
| DISPLAY | 28/34 Bricolage 700 (34 on desktop) | Screen titles |
| TITLE | 22/28 Bricolage 700 | Section/sheet titles |
| HEADING | 17/24 Spline Sans 600 (16/22 in dense list rows, 14 in tables) | Item names |
| BODY | 15/22 Spline Sans 400 | Default UI text |
| SECONDARY | 13/18 Spline Sans 400, ink/muted | Help, timestamps |
| DATA | 13/18 Mono 500 (11px in row meta) | Paths, counts, dates |
| LABEL | 11/14 Mono 600 CAPS, letter-spacing .08em (8–10px in chips/column heads, ls .05–.14em) | Chips, column heads, status |

### Spacing & grid
- Base **4px**; steps 4 · 8 · 12 · 16 · 20 · 24 · 32. Gutter by mode: 12 Compact · 16 Comfortable · 20–24 Roomy · 24 Split/Desktop. Content max-width 1120px, centred past 1200.
- Stack rhythm: gap ≈ 0.5–0.75 × the **next** element's line-height, snapped to 4 (20 before a title, 12 before a heading, 8 before body, 4 for tight text+meta pairs). Between cards 8–12; between sections 24–32.
- List row anatomy: side padding 16, vertical padding 12, title→meta gap 4. Two-line row = 70px; one-line min 56; packing rows ≥64. Whole row is the tap target.

### Responsive (five layout modes)
Shell breakpoints are **em-based media queries** (they track user font-size and zoom). Component internals adapt via **container queries** to the width they're handed — the same row/card renders 1-up or folded depending on its pane, not the viewport; no `@container` support fails open to single column.
| Mode | Range | Nav | Panes |
|---|---|---|---|
| Compact | <30em (<480) | Bottom tabs | Single column |
| Comfortable | 30–40em (480–640) | Bottom tabs | Single column |
| Roomy | 40–52em (640–832) | Bottom tabs | Single column, capped measure; cards 2-up, chips wrap, rows gain inline meta |
| Split | 52–64em (832–1024) | Icon rail (56px) | List + detail two-pane |
| Desktop | ≥64em (≥1024) | Labeled sidebar (216px) | Two/three-pane; centres at max-width 1120 past 75em (1200) |

### Shape & elevation
Chips/pills 999 · controls 8 · cards 12 · sheets 16 top. Rules 1px; chip strokes 1.5px. Dark theme elevates by lighter surface; light theme by rule + faint shadow. Focus ring 2px amber (`box-shadow: 0 0 0 2px rgba(226,166,91,.3)` + amber border).

### Touch
Targets ≥48px (status pill min 44), rows ≥56px, primary actions in thumb zone (bottom). Undo always visible after a state change.

## Status Grammar (hybrid — decided)
Never color alone: every state = **shape + fill-level + label**.
- **Packing progress = one circle, fill = state:** ○ empty stroke `#97A08C` NOT PACKED → ◐ left-half filled `#D3A344` STAGED → ● filled `#7BB389` with dark check PACKED.
- **▲ triangle = separate attention class** (`#D98263`): missing, lost, disagreement. Never used for progress.
- **RETIRED** = strikethrough, muted `#6A7161`.
- Status pill: 1.5px colored border, radius 999, tinted bg when non-empty, 12px icon + mono 9.5/600 label, padding 11px 14px — sits at the row's right edge (thumb side).
- **Journey rail** (container headers): chips for ⌂ HOME ✓ → STAGING ✓ → CAR ● → PACKED; past = bordered muted + ✓, current = inverted (bg `#E8E5D5`, text `#151A15`, ●), future = dashed border `#47523F`, text `#5E6857`.
- **Disagreement marker:** mono amber `#D3A344` line, e.g. `▲ IN CAR · 3 INSIDE NOT PACKED`.
- **Per-person piece circles:** initial = person, fill = that piece's status (filled sage = packed, half amber + amber border = staged, bordered `#47523F` = not packed). Sizes: 34px in rows, 28px in group headers, 24px in builder. In the **builder** circles mean inclusion, not status: all bordered; dashed border + dim = excluded.
- **Two worlds:** ⌂ HOME (muted `#97A08C`) vs ▸ ON TRIP (amber `#E2A65B`), everywhere. Depot never shows packing status; a trip row keeps its home path visible but muted.

## Voice: strict ledger
Terse, factual, numeric; mono for counts; sentence case for UI text; CAPS mono for labels. No exclamation marks, no cheerleading, no "oops".
Write: `3 left.` · `Packed · 14:32.` · `Offline. Saved on device.` · `Retired 2024. Kept in ledger.` · `No matches. 2 filters active.`
Never: "Almost there!", "Great job 🎉", "Say goodbye to this item?".

## Screens / Views

### 1. Packing view — phone 393 (`Screens A`, labels "Packing by container", "Packing by person")
Purpose: mark gear staged/packed during pack-out, one-handed.
- Header: back link `‹ ALPS 2026` (mono 11 accent) left; sync state right (6px dot: sage SYNCED / amber OFFLINE + mono 9 label).
- Title `Pack-out` (28/34); count line `● 48/61 PIECES` vs `13 LEFT` (mono 11); 6px progress bar, radius 3, track `#333C33`, fill `#7BB389`.
- Controls: segmented CONTAINER | PERSON | ALL (40px tall, border `#47523F`, radius 8, active segment bg `#28312A`); `○ LEFT` filter pill (selected: bg `#35523F` + ✕).
- **By container:** group header (bg surface, 16/600 name + mono count `9/12`) carrying the journey rail + optional ▲ disagreement line; item rows: name 16/600 + mono meta (`SHARED · ×1`, `PER-PERSON · 1/3`), right = status pill or per-person circles. Trip-only items get amber bordered `TRIP-ONLY` tag (radius 3) and meta `NOT IN DEPOT`.
- **By person:** person group headers (28px circle + name, right `14/20 · 6 LEFT`); all-done person collapses to `● 20/20 — COLLAPSED`; participant who packs nothing is labeled `PARTICIPANT`.
- Footer bar (surface): hint `TAP CHIP = NEXT STATE · LONG-PRESS = ALL PEOPLE`, right `UNDO` in accent.

### 2. Depot browser — desktop 1024 (`Screens A`, "Depot desktop")
216px sidebar (logo, ALL GEAR count row active bg `#28312A`, PLACES list with counts, SAVED SLICES incl. struck-through RETIRED, sync line bottom) + main pane: title row (Depot, `128 GEAR · 214 PIECES`, search input 40px max-260 with `/` hint, `+ Add gear` accent button 40px); filter chips row (selected bg `#35523F` with ✕, ghost `+ PERSON` etc., right count `23 OF 128` + `CLEAR (2)`); optional bulk bar (tinted accent band: `3 SELECTED · MOVE · TAG · SET OWNER · RETIRE` — RETIRE in attention); table radius 12: 8 columns `34px 1.45fr .5fr .6fr 1.45fr .95fr 44px 130px` = checkbox, GEAR, KIND, OWNER, HOME (path `ATTIC ▸ SHELF L-TOP ▸ CRATE B`), TAGS, QTY (`×2`, right), WHEREABOUTS (`⌂ HOME` muted / `▸ ALPS · CAR` amber / `RETIRED` struck). Rows 44px; selected rows tinted; header row mono 8.5 caps. Keyboard: `↑↓ row · space select · / search · enter detail`.

### 3. Depot — phone 393 (`Screens A`, "Depot phone")
Logo + avatar header; title; 48px search; horizontally scrolling filter chips (36px); count line; 2-line rows (name + right whereabouts chip text; meta = owner/path/qty); container rows get `›`. 56px FAB (radius 16, accent bg, `+`) bottom-right, 74px above the 3-tab bar (DEPOT/TRIPS/FIND, active = sage icon + 2px top border). Keep 76px bottom list clearance for the FAB.

### 3a. Depot — Roomy 540 & Split 900 (`Screens A`, "Depot roomy", "Trips roomy — cards 2-up", "Depot split")
**Roomy 540:** same bottom-tab shell as phone; gutters 20; filter chips wrap onto two lines instead of scrolling; rows go one-line with inline meta (name · owner/path/qty · whereabouts right); Trips cards render 2-up (see excerpt frame). **Split 900:** 56px icon rail (logo mark top, DEPOT active on raised 40px square, sync dot bottom) + 308px list pane (folded 2-line rows via container query; selected row tinted `rgba(147,188,159,.05)` with 2px accent inset edge) + gear-detail pane (title 24, whereabouts card, pieces, Move/Edit/RETIRE).

### 4. Gear detail — phone 393 (`Screens B`, "Gear detail")
Header `‹ DEPOT` + sync. Title = gear name; meta mono `ITEM · SHARED · ×2 · 1.9 KG EACH`; tag chips (32px, bordered).
- **Whereabouts card** (surface, radius 12): stacked rows `⌂ HOME SLOT` (label mono 8.5 faint; path mono 12) with `×1 THERE`, and `▸ ON TRIP — ALPS 2026` (label amber) with `×1 OUT` amber; footer hint `SPLIT COUNT — BOTH TRUE AT ONCE. HOME SLOT IS KEPT WHILE OUT.`
- **PIECES** group: per-piece rows (Piece 1/2, meta `BOUGHT 2022 · GOOD`), right small chip `⌂ CRATE B` (neutral) or `▸ ALPS · PACKED M` (amber).
- **LEDGER** group (right hint `APPEND-ONLY`): mono rows `2026-08-19  PACKED → DUFFEL 90 L · BY M`, `LISTED ×1 · ALPS 2026`, `MOVED → CRATE B`, `BACK FROM VOSGES · OK`.
- Action bar (surface): bordered 44px MOVE and EDIT buttons; RETIRE right-aligned as attention-colored text (never a filled red button).

### 5. Trips + Gear list builder (`Screens B`, "Trips" phone / "Gear list builder" 1024)
**Trips phone:** one active trip card (surface, radius 12): `▸ Alps 2026` + phase chip `PACK-OUT · DAY 2` (amber tint), dates mono, 22px people circles, progress line + bar, full-width 48px accent CTA `Continue pack-out`. Drafts = dashed-border card (`DRAFT · 0 GEAR LISTED`, `BUILD LIST ›` link). CLOSED group = ledger rows (muted name, `JUL 2025 · 54 PIECES · 1 LOST` with LOST in attention, `›`). Tab bar, TRIPS active.
**Builder 1024:** header `‹ TRIPS` + `Alps 2026 — gear list` (Bricolage 24) + dates/people + right `61 PIECES · EST 48.2 KG` + accent `Start pack-out`. Two panes (`440px | 1fr`):
- Left "FROM THE DEPOT": search + filter chips; 40px rows (name + home path) with right `+ ADD` (bordered 32px) or `IN LIST ✓` (packed-green mono, row muted). Footer hint: `ADDING LISTS IT — GEAR DOES NOT MOVE UNTIL PACK-OUT`.
- Right list: suggestion band (`VOSGES 2025 LIST · 24 MATCH THIS DEPOT · ADD ALL / DISMISS`); groups by kind with mono headers + piece counts; shared rows get a `− ×2 +` stepper (32px, bordered radius 8); per-person rows get 24px inclusion circles + `×3`; every row has `✕` remove; TRIP-ONLY rows carry the amber badge; dashed add row `+ TRIP-ONLY ENTRY — NOT KEPT IN THE DEPOT, CLEARED AT CLOSE`; footer totals `34 GEAR · 61 PIECES · 18 PER-PERSON · 3 TRIP-ONLY · EST 48.2 KG`. Keyboard: `↑↓ row · enter add/remove · P per-person · T trip-only`.

### 6. Find — phone 393 (`Screens B`, "Find")
OFFLINE header state (amber dot). Title; 48px search field with amber border + caret and typed query; result count `4 MATCHES · ON-DEVICE INDEX`. Answer-first result card: gear header row (name + `PER-PERSON · ×3`), then one row per piece: 28px person circle + whereabouts (mono 11, amber for trip / muted for home / attention `▲ LAST SEEN: TESSIN 2025`), right mini status chip (`PACKED`, `⌂ HOME`) or `RESOLVE` accent action. Plain matches = standard 2-line rows. RECENT = mono 44px rows. Tab bar, FIND active.

### 7. Unpack & close — phone 393 (`Screens B`, "Unpack and close")
Header `‹ ALPS 2026`. Title `Unpack`; count line `● 52/61 BACK` vs `6 OPEN · 2 CONSUMED · 1 LOST`; progress bar; filter pills `○ OPEN ONLY ✕` (selected) + `BY DESTINATION`.
- **Grouped by home destination** (Attic 6/8 BACK, Kelder, Hal, No home slot) so the user walks the house once. Row meta = return path `→ CRATE B · ×2`.
- Pill verbs: **BACK** (filled circle, packed style) · **OUT** (empty circle, muted) · **CONSUMED** (dashed border `#6A7161`, no icon; meta e.g. `×2 TAKEN · ×2 EMPTY`) · **LOST** (▲ attention, meta `▲ NOT SEEN AT UNPACK`) · trip-only **CLEARS** (dashed, meta `CLEARED AT CLOSE`).
- Close card (surface): summary mono `52 BACK · 2 CONSUMED · 1 LOST · 6 OPEN`; full-width 48px button **gated** — disabled style (bg `#28312A`, muted text) reading `Close trip — 6 open` until open = 0, then accent `Close trip`; hint `CLOSE WHEN OPEN = 0. CONSUMED REDUCES DEPOT COUNT. LOST STAYS SEARCHABLE.`

### 8. Sign in — the signed-out shell, phone 393 + desktop 1024 (`Screens C`, "Sign in — idle / passkey ceremony / failed / offline", "Sign in desktop")
Purpose: the shell that loads offline from the service worker with zero data. **No username, no password, no email — one button.**
- Layout: centred stack — mark 72×57, wordmark Bricolage 700 32, ledger line 13 muted `The household's gear ledger.` Thumb zone: 48px accent `Sign in`, ghost `No passkey on this device?` (opens the explainer sheet, §15), mono 10.5 faint footer `Sign-in is a passkey. No passwords, no email.`
- **Ceremony state:** shell dims under `rgba(15,19,15,.62)`, button drops to disabled style. The OS passkey sheet (including the browser's own cross-device QR flow) is an **external surface — recreate nothing of it**, and never replace it with a spinner screen.
- **Failed:** mono 12 attention `▲ Sign-in did not complete. Nothing changed.` + secondary `Try again, or ask a household member for a device link.`; button returns to idle.
- **Offline:** header amber dot + `OFFLINE`; mono 12 muted `Offline. Sign-in needs a connection.`; button disabled (bg `#28312A`, text `#5E6857`); the explainer link stays enabled (needs no network).
- Desktop: signed out there is no sidebar — a centred 340px column on bg/base; focus ring 2px amber on the primary (Enter signs in); `BUILD 7C39F2A` bottom-right, mono faint. The shell keeps this structure across all five modes; the layout ladder applies to signed-in surfaces only.

### 9. Join — phone 393 (`Screens C`, "Join — confirm / name yourself / success / dead end")
- **Confirm:** title `Join Veldkamp?`; ledger card rows (LABEL mono 8.5 faint + value 16/600): HOUSEHOLD `Veldkamp` · YOU JOIN AS `Els` · INVITED BY `MARK · 2026-08-21` (mono value); chips `EXPIRES IN 6 d` + `SINGLE USE`. Directly above the button: mono 12 `Opening this link changed nothing yet.` (rule: nothing is consumed by opening a link). Primary `Join as Els`; quiet line `Not Els? Ask Mark for a new link.` Confirm → OS passkey-creation sheet → success.
- **Name yourself** (only for a brand-new household's first login, where the Person is created on join): body `This link starts a new household. Its first login is yours.`; one field YOUR NAME (48px, drawn focused: amber border + ring); mono `Household and depot start empty.`; primary `Continue`.
- **Success:** title `Signed in.`; `Els · Veldkamp`; FIRST SYNC card (mono `96 OF 128 GEAR`, 6px progress bar, `3 trips · 2 people · works offline from here on.`); mono `Passkey saved on this device.`; primary `Open the depot` — does not wait for sync to finish.
- **Dead end — one screen, swapped fact line.** Constant title `Invite not valid.`; the line swaps: EXPIRED `This invite expired 2026-08-18. Invites last 7 days.` · USED `This invite was used 2026-08-19 14:32. Invites are single-use.` · UNKNOWN `This server does not know this link.` Body `Ask a household member for a new one. Nothing was used up by opening this.`; bordered `Open sign-in`. **No attention color** — the link is done, nothing of the user's is wrong.

### 10. Continue without a passkey — phone 393 (`Screens C`)
The compatibility path, drawn deliberately first-class: same accent primary (`Continue as Els`), no amber, no ▲, no "however". Two body lines: `This device cannot make one. It stays signed in anyway — nothing is limited.` and `A passkey added later, on any device that supports one, makes future sign-ins self-service.` Mono fact `You stay signed in until you sign out.` The **standing nudge** is the Account ▸ Passkeys empty state — `None on this login.` + body + bordered `Add a passkey on this device` (rendered only where the device supports passkeys) — a quiet section state, never a toast or badge.

### 11. Account — phone 393 + desktop 1024 (`Screens C`, "Account phone", "Account desktop")
The fourth destination beside Depot · Trips · Find, reached from the avatar — not a tab, so the 3-tab bar is untouched; pushed screen with `‹ DEPOT` + sync line.
- Section order (frequency order): **YOU** (40px accent-border circle, name 17/600, `VELDKAMP HOUSEHOLD` mono 11) → **PASSKEYS** (rows: coarse label 16/600 — `Pixel 9`, `YubiKey, desk drawer` — + mono 11 `ADDED 2026-03-02 · LAST USED TODAY`; `REMOVE` attention text; bordered 48 `Add a passkey on this device`) → **DEVICES** (mono `3 devices signed in.`; `All devices ›` row with `THIS ONE: FIREFOX ON ANDROID`; bordered 48 `Sign in on another device` — the device-link entry point) → **PEOPLE & LOGINS** (row + `2 OF 3 PEOPLE HOLD A LOGIN`) → footer (surface): `SIGN OUT` attention text left, `BUILD 7C39F2A · 2026-08-21` mono faint right.
- Desktop: a pane inside the 216px-sidebar shell, **never a modal**. Sidebar carries app nav (DEPOT 128 / TRIPS 3 / FIND) with ACCOUNT as the active row pinned bottom (22px avatar circle + label, bg `#28312A`), sync line beneath. Content: 2-col cards; the phone's summary rows unfold — full device list and all three people inline; dense 40px buttons.

### 12. Devices — phone 393 (`Screens C`, "Devices" + two confirm sheets)
- Rows ≥56: coarse label 16/600 (`Firefox on Android`, `Edge on Windows`, `Safari on iPad`) — no IPs, no fingerprinting; `THIS DEVICE` chip (accent badge) on the current one; mono 11 meta `LAST SEEN 2026-08-19 14:32` / `SIGNED IN 2026-03-02 · NO PASSKEY HERE` (a passkey-less device is a plain fact, not a warning). Per-row `SIGN OUT` in attention color as **text, never a filled red button** (the RETIRE rule). Footer hint `SIGNING OUT A DEVICE REACHES IT AT ITS NEXT SYNC.`
- **Remote confirm sheet:** title `Sign out Safari on iPad?`; body `It loses access at its next sync. Everything already synced stays with the household.`; bordered-attention 48 `Sign out device` + ghost Cancel.
- **Sign out this device:** the only auth action that can discard work, therefore the only one carrying ▲: mono attention `▲ 4 changes not yet synced. Signing out clears them.` (exact count; the line is omitted entirely when nothing is unsynced) + body `Local data is removed from this device. Synced work stays with the household.`; `Sign out and clear` + Cancel. Afterwards: local data cleared → sign-in screen.

### 13. People & logins — phone 393 (`Screens C`, "People and logins — one login / two logins")
Count line `2 of 3 people hold a login.` Rows: 30px person circle — **accent border `#93BC9F` = holds a login, control border `#47523F` = none; fill never appears on account surfaces** (fill belongs to packing) — name 16/600 (+ `YOU` badge on self), mono 11 meta: `SIGNED IN · 2 DEVICES`, `NO LOGIN · JOINS TRIPS AS PARTICIPANT`, `INVITE OUT · SINGLE USE`. Right side: `INVITE ›` accent text for a person without a login; `DEVICE LINK ›` + `REVOKE` on another person's login (any member may issue/revoke for anyone); the **own row gets only `›`** — your exit is SIGN OUT, not self-revocation. The outstanding-invite row is the collapsed handover screen: expiry chip + `REOPEN ›` + `REVOKE`. Dashed `+ NEW PERSON` row at the bottom. Alphabetical order, identical anatomy, no owner badge — equality is typographic law.

### 14. Invite issued — phone 393, one screen for both purposes (`Screens C`, "Invite issued — join / device link")
Anatomy (invite card): QR on a light tile (`#F0EBDD`, radius 8, 126px incl. 10px quiet zone) · the link in the input well (`#0F130F`, mono 11.5, wrapped, `user-select:all`) · bordered 48 `Copy link` · expiry chip + mono `SINGLE USE` · `REVOKE` attention text (kills the link, never data).
- **Join invite:** `‹ PEOPLE & LOGINS`; title `Invite for Els`; lead `Hand it over yourself — foerier sends no mail.`; chip muted `EXPIRES IN 6 d`; fact `It creates a login for Els. Nothing else can use it.`
- **Device link:** `‹ ACCOUNT`; title `Sign in on another device`; lead `Open this on the other device. It signs that device in as you, Mark.`; chip amber `EXPIRES IN 58 min`; fact `The link is the credential. Treat it like a key.`
- **Expiry chip** (component): existing chip anatomy (radius 999, 1.5px stroke, mono 10/600); muted (`#47523F`/`#97A08C`) while ≥1 hour remains, amber (`#E2A65B` + `rgba(226,166,91,.08)` tint) under an hour; live count, minute granularity.

### 15. Explainer sheet + session lost — phone 393 (`Screens C`, "Explainer sheet", "Session lost")
- **Explainer** (opens from `No passkey on this device?`): the sheet primitive — radius 16 top, bg/surface, 1px rule top edge, 36×4 grabber `#47523F`, dim `rgba(15,19,15,.62)`, padding 10/20/24. Title 22 Bricolage; two paragraphs 14/21, first ink/primary, second ink/muted: (1) ask a signed-in household member for a device link — People & logins ▸ your name ▸ Device link — opened here it signs this device in; (2) if yours is the only login and it is signed in nowhere, ask whoever runs your server for a new join invite — **the only place the Maintainer is ever named**. Ghost `Close` 48.
- **Session lost** (token revoked/expired, discovered by the sync client): the sign-in shell plus one extra mono 12 **muted** line above the button — `Signed out on this device. 12 changes saved here and not yet synced.` Fact weight: no ▲, no red, no modal, no banner. In-app the only trace is the existing sync line reading `SIGNED OUT · SAVED ON DEVICE`; Depot/Trips/Find keep working offline. Signing back in flushes the queued changes automatically. **This must never read as data loss.**

## Auth vocabulary & rules
Use these words exactly; never "account" (except the tab name), "user", "profile", "log in", "admin", or "registration".
- **Household** — the people, depot and trips that belong together; the privacy boundary. **Person** — a household member who may join trips; most never sign in. **Quartermaster** — a Person who manages the Depot and outfits Trips; all identical in power, no hierarchy. **Login** — a Person's ability to sign in; one Person holds at most one. **Passkey** — a credential proving a Login; a Login may hold several or none. **Device** — one signed-in browser installation; listed and revocable. **Invite** — a single-use, short-lived link: a **join invite** creates a Login for a Person; a **device link** signs an existing Login in on another Device. **Maintainer** — whoever runs the server; not a role in the product.
- Verbs: *sign in / sign out* (never "log in/out"), *join*, *invite*, *revoke*, *add a passkey*, *issue a device link*.
- Rules the UI must keep visible: no passwords or email anywhere (foerier sends no mail) · no usernames — one button · devices without passkeys are equals · all Quartermasters equal · offline work is never lost to auth, and every session-ending screen says so · invites always state single-use + remaining time · opening a link does nothing until confirmed · auth exists on exactly two surfaces (signed-out shell, Account) and never interrupts Depot, Trips or Find.

## Interactions & Behavior
- Tap a status pill → next state (○ → ◐ → ● → ○). Long-press a per-person cluster → apply to all people. UNDO appears after every change.
- Moving a container moves its contents in one action; containment is a path (`ATTIC ▸ SHELF ▸ CRATE B`), one level shown at a time.
- Adding to a trip lists it; nothing moves until pack-out. Consumed decrements depot quantity quietly; Lost writes a ledger event and stays searchable; trip-only entries are cleared at close.
- Phase model: `DRAFT → PACK-OUT → ON TRIP → UNPACK → CLOSED`. The active-trip CTA always names the current phase verb; the phase chip carries the day count.
- Offline is normal, never a blocking dialog: sync state is one quiet header line (sage dot SYNCED / amber dot OFFLINE). Search, edit, pack fully on-device.
- Desktop keyboard: `↑↓` row, `space` select, `/` focus search, `enter` open/add, plus builder shortcuts above.
- Hover states (desktop): rows/nav items `background:#1F2620`. Focus: 2px amber ring.
- **Auth:** one button → OS passkey sheet (incl. the browser's cross-device QR — external, recreate nothing). Failure returns to idle with `▲ Sign-in did not complete. Nothing changed.` Invites: join 7 days, device link 1 hour, both single-use; opening a link changes nothing until confirmed; REVOKE kills the link only. Remote sign-out reaches a device at its next sync; sign-out-this-device clears local data and warns with the exact unsynced count. Session loss is discovered by the sync client, never interrupts a task, and queued work flushes on the next sign-in.

## State Management
- Entities: Gear (kind item/container, owner shared|person, qty, home path, tags, pieces with condition), Trip (dates, people incl. non-packing participants, phase, gear list with per-person allocation, trip-only entries), LedgerEvent (append-only: packed/listed/moved/back/lost/consumed/retired, timestamp, actor).
- Piece-level whereabouts: a gear's pieces can split across worlds (×1 home, ×1 on trip — both shown).
- Local-first store + on-device search index; background sync; last-synced timestamp surfaced in sidebar/header.
- Close gating: `open === 0` (every piece resolved to back/consumed/lost) enables Close; closing writes the trip's ledger lines.
- Auth entities: Household (privacy boundary — nothing crosses it), Person (holds at most one Login), Login (holds Passkeys and Devices; all Logins have identical powers — no roles in data), Passkey (coarse label, added, last-used), Device (coarse label, last-seen, token), Invite (kind join|device-link, single-use, expiry, revocable). The offline queue survives a revoked token; it flushes after the next successful sign-in — only an explicit "sign out this device" clears it.

## Assets
No raster assets. The logo is inline SVG (28×22 viewBox): soft-taper duffel outline (`M8,6 L20,6 Q25.5,6.5 25.5,13 Q25.5,19.5 20,20 L8,20 Q2.5,19.5 2.5,13 Q2.5,6.5 8,6 Z`, stroke ink 1.7–1.9), two vertical seams at x=10/18 (stroke 1.3), amber handle arc (`M11,5.6 Q14,1.6 17,5.6`, round caps). Seams drop at sizes ≤20px. Wordmark: lowercase `foerier`, Bricolage Grotesque 700, mark-to-text gap 0.35×cap height, clearspace = handle height. Known open nudge: wordmark should sit slightly higher and gain a touch more letter-spacing — treat `Logo Round 4 - Radius Sweep.dc.html` as the current reference. Icons (tab bar, search, checks) are simple inline SVG strokes at 1.6–1.9px.

## Files
- `Foundations.dc.html` — principles, logo spec, type scale, color tokens (dark+light), status grammar + the decided hybrid comparison, spacing/measured redlines, voice.
- `User Flows.dc.html` — flow maps: Depot entry → gear detail; Trip creation → list builder → packing → unpack & close; Find (offline); auth flows A–F (join, sign in, invite a person, device link, manage devices, session lost) with OS/browser steps marked external.
- `Components.dc.html` — component sheet: rows, chips, per-person indicators, filters, containment tree, quantity controls, empty/loading states, packing actions; §09 auth atoms (passkey/device rows, person-with-login indicator, sign-in button states, expiry chip, invite card, auth explainer sheet).
- `Screens A - Packing + Depot.dc.html` — layout-mode ladder (five em-based modes), Packing (container/person, phone), Depot (desktop + phone + Roomy 540 + Split 900 two-pane).
- `Screens B - Detail + Trips + Find + Unpack.dc.html` — Gear detail, Trips, Gear list builder (desktop), Find, Unpack & close.
- `Screens C - Auth + Account.dc.html` — sign-in shell (idle/ceremony/failed/offline + desktop), join (confirm/name yourself/success/dead end), continue without a passkey, Account (phone + desktop), Devices + both confirm sheets, People & logins (two states), invite issued (join + device link), explainer sheet, session lost.
- `Direction C - Field Tag.dc.html` — the chosen art-direction board (context).
- `Logo Round 4 - Radius Sweep.dc.html` — latest logo iteration (reference for the mark).
- `support.js` — runtime the `.dc.html` files need to render; keep it in the same folder.
