# S3.5 — Auth 3+4: device links and the Account screen

The implementation design for [auth-design §13](../auth-design.md)'s slices
**3** and **4**, landing together and ahead of S4. It delivers stories **29**
(sign in on another Device) and **30** (see and manage my Devices), and with
them the [§5 compatibility floor](../auth-design.md) — the path that needs
nothing of a Device beyond a browser.

This is a **feature spec**: it is retired once the slice has shipped. It settles
what the durable docs left to the implementer. It does **not** revisit anything
above it — the credential model, the token, the Invite state machine, the
tenancy rule and the whole HTTP surface are settled in
[`auth-design.md`](../auth-design.md), and every ambiguity here is resolved by
reading that document, not this one.

**The screens were designed before the code.** `docs/design/Screens C — Auth +
Account.dc.html` and `docs/design/README.md` §§10–15 are the handoff, and where
this spec and the boards disagree, **the boards win and this spec is wrong**.
§8 records the one deliberate departure.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Ops | **None.** Auth state is tables, not ops ([sync §4.2](../sync-protocol.md)); `shared/` is untouched |
| Position | **Ahead of S4**, exercising the float §8.6 already granted — not a renumbering |
| Backup auth method | **The device link, exactly as §5 designed it.** No passwords, no PIN, no recovery code in this slice (§11) |
| New endpoints | 10 — `device/claim` (unauthenticated, like the other redemption routes) plus **nine authenticated**: three on `invites`, two on `devices`, four on `passkeys`; and one additive field on `/auth/me` |
| Migration | One additive column, `invite.person_recorded` — recording a fact the server currently guesses (§4) |
| Maintainer scripts | Two — `admin:invite` and `admin:list`. The break-glass for §5's "the one case that leaves the product" |
| Shell | The `ACCOUNT` affordance lands in **all three nav modes** at once; `AppShell.test.tsx`'s absence assertion inverts |
| Local sign-out | Clears local data unconditionally, online or off. The token dies with the database, so an unreachable server costs nothing (§7.3) |
| Storage | `navigator.storage.persist()` on every session establishment — a token-only Device cannot self-recover (§9) |
| QR code | **`uqr`** — 4.3 KB gzip, zero runtime deps, ESM, renders SVG directly. Wrapped as `ui/src/QrCode.tsx` (§6.4) |
| Passkey names | **Named when added**, one prefilled field. Renaming later is **story 37**, Later |
| Radix | **Deferred a third time**, with a named condition that ends it (§10) |
| Not built | People & logins (§13 of the boards), in-app *join* Invites, disabling another Login — all S5, all behind S4 |

---

## 1. Why this moves ahead of S4

Three forces, and the third is the one that decides it.

**It is free.** [architecture §8.6](../architecture-design.md#86-what-can-be-built-in-parallel)
already says auth 3 and 4 "introduce no ops, touch `shared/` not at all, and can
be built alongside any domain slice from S2 onwards, in either order." Moving
them is not a re-plan; it is the float being spent. Nothing is renumbered — the
slice is **S3.5**, for the same reason stories are never renumbered: every
cross-reference in §12 and in git history would break, forever, each time an
order changed.

**Four settled affordances are waiting on it.** The R3 shell round
([§12.6](../architecture-design.md#126-consequences-of-the-r3-shell-round))
drew an `ACCOUNT` row pinned to the desktop sidebar, an avatar on the Split
rail, and an avatar in the phone header; `sign out this device` has been
drawn since Screens C. All four open the same screen, and all four are absent
because an affordance that leads nowhere is worse than a missing one. That
absence is currently pinned by a test (`app/src/shell/AppShell.test.tsx`, "the
account affordance"), which is an honest way to hold a debt and a poor way to
hold it for long.

**And a real Device cannot otherwise be used.** A phone in the household — the
primary target for a tool whose whole premise is a cold garage with no signal —
cannot mint a passkey into the credential store the household chose. §2 records
what was learned about why. Until this slice lands, that phone has no route in
at all, which makes the compatibility floor the difference between a working
product and a demo.

## 2. What a real device taught us about the floor

[§5](../auth-design.md) states the problem as "a phone whose OS ships no
credential provider gives a modern browser and a modern password manager
nothing to work with." Testing against a real device sharpens that, and the
sharpening matters for the UI:

- The device **can** complete a WebAuthn ceremony. The platform's own credential
  store answers, and a WebAuthn test site registers against it successfully.
- What it cannot do is offer the **third-party credential store the household
  chose**. Android routes passkeys through Credential Manager, a third-party
  provider needs the OEM build to expose the setting that grants it that seat,
  and several builds do not. Mobile browsers cannot be extended the way desktop
  Firefox and Chrome can, so there is no browser-side route around it.

So the floor's real shape is not "devices that cannot hold a passkey" but
**"devices that cannot hold a passkey the household is willing to use."** The
mechanism is unchanged — a device link needs nothing but a browser either way —
but the *trigger* changes, and §8 is the consequence: capability detection alone
would sail straight past such a device into a credential store its owner
deliberately does not want.

Two facts worth writing down while they are fresh, because they are the ones
people get backwards:

- **A passkey is not portable.** The private half is non-exportable by design;
  provider sync happens inside the provider's own encrypted channel and there is
  no user-facing export, import, or paste. Moving between credential stores on a
  future Device is therefore **not a migration** — it is `add a passkey` on the
  new Device followed by `remove` on the old one, against the same Login.
  Several passkeys per Login is the designed-for case
  ([§2](../auth-design.md)), which is what makes that a two-tap operation and
  not a data move. It is also why `POST /auth/passkeys/*` is in this slice
  rather than deferred: without it that path does not exist.
- **The link is short-lived; the session it creates is not.** A device Invite
  lasts an hour ([§3.1](../auth-design.md)); the Device token it issues is valid
  until a year after last use, refreshed at most daily
  ([§6.2](../auth-design.md)). The hour bounds the interception window and
  nothing else. The genuine fragility on a token-only Device is local storage
  eviction, not expiry — hence §9.

## 3. Endpoints

All under `/api/v1`, all from [§9.1](../auth-design.md)'s table, none invented
here. **A** = requires a valid Device token.

| Method | Path | Notes for this slice |
| --- | --- | --- |
| POST | `/auth/device/claim` | Redeems **either** Invite kind for a token with no credential. A device Invite signs its Login in; a join Invite creates the Login first, exactly as `register/verify` would, minus the passkey |
| POST | `/auth/invites` | **A** — `{ purpose: 'device' }` only in this slice; `'join'` answers `400`. See below |
| GET | `/auth/invites` | **A** — outstanding Invites issued by the calling Login |
| DELETE | `/auth/invites/:id` | **A** — revoke |
| GET | `/auth/devices` | **A** — this Login's Devices |
| DELETE | `/auth/devices/:id` | **A** — revoke one, scoped to the calling Login |
| POST | `/auth/passkeys/options` | **A** — creation options appended to the calling Login |
| POST | `/auth/passkeys/verify` | **A** — attach |
| GET | `/auth/passkeys` | **A** — list |
| DELETE | `/auth/passkeys/:id` | **A** — remove, **including the last one** |
| GET | `/auth/me` | **A** — gains `household_name` (§3.3) |

**`POST /auth/invites` accepts only `purpose: 'device'`.** A join Invite must
name a Person that exists, and there is no way to pick one until S4 records
People and S5 builds the picker. Rejecting the other purpose outright is
better than accepting it against an unrecorded Person and producing exactly
the defect §4 is about. The `400` is a plain error, not
[§9.4](../auth-design.md)'s deliberately-vague failure: vagueness exists to
close an enumeration surface, and there is no secret here to enumerate.

**A device Invite needs no `person_id` in the request.** The Person is the
caller's, taken from the token like every other tenancy fact
([§9.3](../auth-design.md)). Issuing one *for another Person's Login* is the
boards' §13 affordance and waits for S5.

**Removing the last passkey is allowed and warned about**, per
[§6.3](../auth-design.md). It drops the Login into the device-link-only mode of
§5, which is a supported mode and not a lockout. The warning states the
consequence in one line; it does not block.

### 3.1 `device/claim` is the only endpoint that can create a Login without a credential

Which makes it the one to get exactly right. It shares `finishRegistration`'s
transaction shape and its checks, minus the WebAuthn verification:

```
validate Invite (fresh · unexpired · unrevoked · unused)
  → in ONE transaction:
      join purpose:   create Login, create Device, consume Invite
      device purpose: create Device for invite.login_id, consume Invite
  → issue and return the Device token
```

Single-use is enforced by consuming the Invite inside that transaction, so a
double-tap or a retried request cannot yield two Devices — the same rule
[§3.1](../auth-design.md) already states and `finishRegistration` already
implements. A claim against a **disabled Login** is refused, matching the
middleware's rule rather than creating a Device that would 401 on its first
request.

### 3.2 Revoking scopes to the caller's Login, and says nothing about the rest

`DELETE /auth/devices/:id` and `DELETE /auth/invites/:id` answer identically
for "not yours" and "does not exist". There is no cross-Login Device management
in this slice (that is `DELETE /auth/logins/:id`, S5), so a Device id belonging
to another Login is simply not found.

### 3.3 `/auth/me` gains the household's name

The Account screen's `VELDKAMP HOUSEHOLD` line (boards §11) is a server fact:
the Household has a `name` column, and unlike the Person it is not in the fold.
`/auth/me` returns `household_name` alongside the four ids it already returns.
Purely additive, and read tolerantly — a client that does not know the field
ignores it, per the additive-ops discipline applied to the auth surface too.

The Person's *name* stays client-side, resolved against the fold from
`person_id` ([§2.1](../auth-design.md)). A Login whose `person_id` matches no
folded Person renders as an unnamed Quartermaster, exactly as that section
requires — which §4 is about making rare rather than routine.

## 4. The defect this slice must fix before a second person can join

Found while checking how a second Quartermaster would be onboarded, and it
would have bitten on the first attempt.

`previewInvite` (`api/src/auth/service.ts:193`) answers the join screen's
"does the joiner name themselves?" question like this:

```ts
// A Person exists only as the fold of an op log, so the server can never
// answer "is this Person recorded" directly. What it can say is whether
// this Household has any Login yet — and a Household with none is
// necessarily one whose first Person is created as they join.
personRecorded: anyLogin !== undefined,
```

The reasoning is sound and the proxy is exactly right — **for the first Login,
and only for it.** The second Person to join an existing Household inverts every
term:

1. Their Invite reports `person_recorded: true`, because the Household now has
   a Login — the first one.
2. `app/src/screens/Join.tsx:112` (`const namesThemselves =
   !preview.person_recorded`) therefore renders the confirm frame with **no name
   field**.
3. `onConfirm(null)` runs, `pendingFirstPerson` saves nothing, and no
   `person.recorded` op is ever authored.
4. They hold a Login pointing at a `person_id` that no Person will ever match —
   [§2.1](../auth-design.md)'s unnamed-Quartermaster fallback, permanently, with
   no People screen until S4 to repair it by hand.

**The fix is to stop guessing and start recording.** The issuer always knows
which case it is: the Maintainer's script pre-binds a fresh UUID for a Person
who does not exist yet, and S5's in-app issuance picks a Person who does. So
the fact belongs on the Invite.

- **Migration `0004_invite_person_recorded`** — add `invite.person_recorded
  boolean` nullable; backfill each existing row with the current proxy
  (`exists (select 1 from login where login.household_id =
  invite.household_id)`), so every outstanding Invite keeps precisely the
  behaviour it has today; then `set not null`. No default, so every insert
  after this must state it.
- `previewInvite` returns `personRecorded: invite.person_recorded`. The
  `anyLogin` query goes away.
- `bootstrapHousehold` inserts `false`. `admin:invite --household` inserts
  `false`. S5's in-app join Invites will insert `true`.

Note what does **not** change: the wire field is already called
`person_recorded`, the client already reads it, and `Join.tsx` already branches
on it correctly. There is no API change and no client change — the value simply
starts being true.

## 5. Two Maintainer scripts

[§3.4](../auth-design.md) puts exactly one thing out of band: the first Login of
a brand-new Household. That is still right, and `admin:bootstrap` still does it.
But two adjacent Maintainer needs have no route at all today, and both are
break-glass rather than routine:

**`npm run admin:invite`**, mirroring `bootstrap.ts`'s structure, argument
handling, and origin-aware link printing:

| Invocation | Mints | `person_recorded` |
| --- | --- | --- |
| `-- --household <id>` | a **join** Invite into an existing Household, pre-binding a fresh UUIDv7 | `false` — the joiner names themselves |
| `-- --login <id>` | a **device** link for an existing Login | n/a |

The first is how a second Quartermaster gets in before S5 exists. It is a
deliberate, temporary widening of §3.4 — and it is the *reverse* of the route
[§3.4](../auth-design.md) describes for later Invites ("the inviter creates the
Person in the app first"), because there is no People screen to create one in
yet. When S5 lands, in-app issuance becomes the normal path and this flag
becomes what it should be: a Maintainer's tool.

The second is [§5](../auth-design.md)'s named escape hatch — *"In a Household
with exactly one Login and no passkey, it needs the Maintainer — the single
case in this design that leaves the product."* Until now that case had no
mechanism at all, only a sentence.

**`npm run admin:list`** — Households, and for each, its Logins with
`person_id`, created date, and Device count. Small, and load-bearing: `--login
<id>` is unusable without a way to find the id, and the alternative is the
Maintainer writing SQL against a production database to do routine recovery.

Both print to stdout only, and neither prints a token, a token hash, a secret
hash, or a challenge ([§9.4](../auth-design.md)).

## 6. Screens

The boards are the specification. What follows is only what the code has to
decide.

### 6.1 Routes

Three new routes, all inside `SignedInShell`:

| Route | Screen | Boards |
| --- | --- | --- |
| `/account` | Account | §11 |
| `/account/devices` | Devices | §12 |
| `/account/device-link` | Invite issued — device link | §14 |

**At Desktop, `/account` renders everything and the other two routes redirect
to it.** The board is explicit: desktop Account is "a pane inside the
216px-sidebar shell, **never a modal**", with "the phone's summary rows
unfold — full device list … inline". That is a difference in *which elements
exist*, so it is a media query and not a container query
([frontend-design §3.2](../frontend-design.md)) — the same rule, applied for
the same reason, as the shell's three nav treatments.

### 6.2 Account is not a fourth destination

`DESTINATIONS` stays at three, and `App.test.tsx`'s assertion that there are
exactly three stays true. Account is reached from the avatar (boards §11), so
the tab bar is untouched.

### 6.3 The four affordances land together

All four open `/account`, so all four land in this slice or none of them do:

| Affordance | Where it goes |
| --- | --- |
| `ACCOUNT` row, pinned bottom of the desktop sidebar | `AppShell`'s `.navFoot` — the `margin-top: auto` group already exists for it |
| 22px avatar above the sync dot, Split rail | the rail's 40px `.railSquare` slot |
| avatar in the phone header | `AppShell`'s `tabs`-mode `<header>`, beside the sync line |
| `SIGN OUT` in Account's footer | the screen itself (§7) |

**`AppShell.test.tsx`'s "the account affordance" test inverts.** It currently
asserts absence in all three modes; it must assert presence in all three, with
the same loop and the same viewports. The absence assertion was the right way
to pin the debt and this is the commit that discharges it — the test should be
edited, not deleted, so the diff records that.

**Naming, at the rail and the phone header.** Both draw an avatar with no
label, so both need an accessible name or the affordance is a link nobody can
follow — the same rule `NavItem` already applies at rail mode. `Account` is the
name; it does not carry the Person's name, for the reason the sidebar's count is
`aria-hidden`: a name that changes as data loads is a name that reads as data.

**The avatar carries an initial, and the chrome cannot read it.** The boards
draw `M` inside the circle for Mark — folded state, from the Person the Login
points at. But `AppShell` renders *outside* `DepotProvider`
([§12.6](../architecture-design.md#126-consequences-of-the-r3-shell-round)),
deliberately, so the nav never depends on a store the signed-out shell has never
had.

The pattern for this is already set by the same section: **counts are handed in,
not read.** `App` resolves the initial exactly where it resolves `depotCounts`
and passes it to `AppShell` as a prop. A Login whose `person_id` matches no
folded Person has no initial to draw — the half-finished bootstrap of
[§2.1](../auth-design.md) — so the circle renders empty rather than with a
placeholder letter, and the accessible name stays `Account` either way. Account
*itself* is a screen, renders inside the provider, and uses `useDepot()`
normally.

### 6.4 The QR code needs a dependency, and which one was measured

Boards §14 draw a real QR on a light tile — 126px including a 10px quiet zone —
and it is not decoration. The whole point of a device link is reaching a phone
that cannot be handed a 43-character base64url secret by any other means, so
scanning is the primary path and typing is not a path at all.

Nothing in the repo encodes QR, and hand-rolling one is not the trade it looks
like: byte-mode encoding, Reed–Solomon error correction over GF(256), mask
selection with penalty scoring and format bits, whose failure mode is a code
that scans on the author's phone and not on anyone else's. So a dependency —
chosen by measuring rather than by reputation. Minified and gzipped through
`esbuild`, bundling only the SVG path each library actually needs:

| Package | min | **gzip** | Runtime deps | Notes |
| --- | --- | --- | --- | --- |
| **`uqr`** | 11.0 KB | **4.3 KB** | **none** | ESM, TypeScript, SVG out, MIT, `unjs` |
| `@nuintun/qrcode` | 26.0 KB | 8.5 KB | `tslib` | |
| `qrcode` | 24.9 KB | 9.7 KB | `pngjs`, `dijkstrajs`, `yargs` | CJS; the CLI and PNG paths resist tree-shaking |

`uqr` is under half the nearest alternative and the only candidate with no
runtime dependencies. It returns an SVG **string** with a `viewBox`, so it
scales to the board's 126px without a canvas, without a `data:` URI, and
without anything the CSP has to be widened for. `renderSVG(link, { border: 1,
whiteColor: '#F0EBDD', blackColor: '#151A15' })` produces exactly the drawn
tile — verified against a real 43-character secret in a full join URL.

**The honest caveat: it is pre-1.0** (0.1.3). Three things make that a small
risk rather than a live one — it has no dependencies to rot, the QR
specification is frozen so there is nothing to keep up with, and the encoder is
self-contained enough to vendor into `ui/` if it were ever abandoned. The
dependency lands in **`ui/`**, behind `ui/src/QrCode.tsx`, per
[frontend-design §5](../frontend-design.md)'s rule that a primitive is reached
through a wrapper rather than imported at each call site.

### 6.5 A passkey is named when it is added

Boards §11 show rows reading `Pixel 9` and `YubiKey, desk drawer`. The second
cannot be derived — no authenticator reports which drawer it lives in — so a
label is user-authored. But [§6.3](../auth-design.md) offers "rename or remove"
while the boards draw only `REMOVE`, which leaves the label with no origin at
all: every row would render null.

Resolved by naming at the moment of adding, which is also the only moment the
person reliably knows what the thing is. The add-a-passkey flow carries **one
field, prefilled with `deviceLabelFrom(userAgent)`** — already implemented in
`api/src/auth/session.ts`, already yielding `Firefox on Android` — and editable
before the ceremony's result is saved. A field left as it came still produces a
useful row.

**Renaming later is story 37, Later, and out of this slice.** It matters only
once a list has gone stale, which needs several passkeys to happen at all; a
prefilled field at the moment of creation covers the case that actually recurs.
So `DELETE /auth/passkeys/:id` is in S3.5 and there is no `PATCH`. A board
departure in the same direction as §8's: the boards draw a label with no way to
set one, and this slice gives it exactly one way rather than two.

## 7. Sign out this device — the one auth action that can discard work

Boards §12's second confirm sheet, and the only auth surface carrying `▲`.

### 7.1 The count is exact, and omitted rather than zeroed

`store.unsyncedCount()` (`app/src/depot/store.ts:471`) gains its second caller.
The line reads `▲ 4 changes not yet synced. Signing out clears them.` and is
**omitted entirely** when the count is zero — not rendered as `0 changes`, which
would invent a warning where there is nothing to warn about.

The count must be read **before** the sheet is confirmed and while the store is
alive, the same ordering `App.tsx:169` already documents for the session-lost
line: ending the session drops the store that can answer the question.

### 7.2 `clearLocalData()` finally has its caller

`app/src/depot/wiring.ts:243` is genuinely uncalled today and its doc comment
already names this screen as the caller. The sequence:

```
confirm → POST /auth/signout   (best effort)
        → stopSync()
        → clearLocalData()
        → navigate('/signin')
```

### 7.3 Offline sign-out clears anyway, and that is safe

The app works offline everywhere else, and a sign-out that fails because a hut
has no signal would be the one place auth blocks a local action — against
[§7.3](../auth-design.md)'s own rule. So the revocation is best-effort and the
local clear is unconditional.

That is not a security hole, because **the token lives in the database being
deleted.** `clearLocalData()` drops the one `foerier` IndexedDB database, which
holds the op log, the cursor, the HLC, the snapshot, the pending first Person
*and* the session token. A `device` row left unrevoked on the server is inert:
nothing anywhere holds the secret that would use it, and it falls out on its own
at the one-year sliding expiry, or sooner from another Device's `DELETE
/auth/devices/:id`.

This is the same honesty [§6.2](../auth-design.md) already applies in the other
direction — *"a revoked Device that is offline keeps working locally until it
next reaches the server"* — and it is stated in the sheet rather than pretended
away.

## 8. One deliberate departure from the boards, in two parts

**The join confirm screen gains a door, and §10's first line stops claiming
something that is sometimes false.**

[§5](../auth-design.md) says the client reaches the token-only path "by falling
through from §3.5 when `PublicKeyCredential` is absent, when
`isUserVerifyingPlatformAuthenticatorAvailable()` and the create call both come
back empty-handed, or when the user simply declines." Boards §10 draws the
destination but not the door, and every trigger in that list is a *failure* to
make a passkey.

§2 is why that is not enough. On the device that motivated this slice, every one
of those checks passes: `PublicKeyCredential` exists, a platform authenticator
is available, and the ceremony succeeds — by silently minting a credential into
the platform store, which is precisely the one the household declined.
Capability detection cannot see the difference between "this device cannot" and
"this household will not", and only the person holding the phone can.

So the confirm frame carries a ghost line beneath its primary, in the same words
the sign-in screen already uses for its explainer — `No passkey on this
device?` — leading to §10 as a deliberate choice. The automatic fall-through
stays exactly as §5 specifies; this adds a door beside it, it does not replace
one.

**And the same finding falsifies one drawn line.** §10's first body line reads
`This device cannot make one.` — which is exactly wrong on the device that
motivated the slice, because it can. It becomes **`No passkey is made here.`**,
true in both cases and no longer than what it replaces. This screen's whole
discipline is that it states a plain fact without amber, ▲, or apology; a line
that is occasionally a lie fails that discipline more than a blunter one does.

Everything else about §10 is untouched, and its anatomy is the point: same
accent primary, **no amber, no ▲, no "however."** A Device on this path is a
first-class Device, and the screen says so by looking identical to the one that
made a passkey.

**Two doors, two destinations — do not collapse them.** The words `No passkey on
this device?` now appear on both the sign-in screen and the join confirm frame,
and they lead to different places on purpose. On sign-in there is no secret in
hand, so the answer is the explainer sheet (boards §15): *ask a household member
for a device link.* On the confirm frame a secret **is** in hand, so the answer
is this screen and the path is available immediately. Wiring both to one
destination would make one of the two a dead end.

Both parts are on the boards (`Screens C`, and the flow chip on `User Flows`)
and recorded in `docs/design/README.md` §10 as departures, per the precedent S3
set for its own two (§3b/§3c there).

## 9. Persistent storage

`navigator.storage.persist()` is called best-effort on every session
establishment — sign-in, join, and claim — and its result is logged, never
surfaced.

Nothing in `app/` calls it today. It matters more here than it would have in any
earlier slice, because a Device with no passkey **cannot re-sign-in by itself**:
lose the database and you lose the token, and the way back is another Device's
device link. An installed PWA on Android is generally granted persistence
automatically; a plain browser tab is not, and the tab is how a link is first
opened.

It protects the op log too, which is the larger prize — the same eviction takes
unsynced work with it.

## 10. Radix stays deferred, with a condition

[frontend-design §5](../frontend-design.md) assigns every interactive primitive
to a thin wrapper in `ui/`; Radix is still not a dependency, deferred at S2, at
S3, and now here. This slice adds two confirm sheets to the existing scrims,
taking the count to roughly six.

Deferring again is the right call for *this* slice — an auth slice is a poor
place to also change how every overlay in the app is built, and the sheets it
adds share `ExplainerSheet`'s anatomy exactly, so they cost nothing new.

But "deferred again" has now been said three times, so it gets a condition
instead of a fourth repetition: **the conversion is its own slice, immediately
after this one, before S4.** It is pure `ui/` work with no ops, no endpoints and
no `shared/`, it converts all six sheets at once as CLAUDE.md requires, and it
is the last moment the count is small enough that one commit can carry it.

## 11. What this slice deliberately does not build

- **People & logins** (boards §13), in-app **join** Invites, `GET
  /auth/logins`, `DELETE /auth/logins/:id`. All of story 28, all S5, all behind
  S4 — an Invite for another Person needs a Person to name.
- **Issuing a device link for someone else's Login.** Same reason: it is a row
  on §13's screen.
- **A recovery code.** The self-service gap the device link leaves is real —
  a Login with no passkey that has lost every session needs another
  Quartermaster, or the Maintainer. A single long-lived, rotating-on-use secret
  redeemed through `device/claim`'s existing path would close it without any of
  the machinery [§11](../auth-design.md) rejects passwords for. It is not built,
  because while a Household holds two Quartermasters and the Maintainer is one
  of them, the case is not reachable. §11 of the auth design now records the
  shape so the household that first reaches it raises a story rather than
  re-deriving the design.
- **Renaming a passkey.** Now **story 37**, Later — see §6.5. Naming happens
  once, when the passkey is added. Deriving a label from an AAGUID stays
  [§14](../auth-design.md)'s open question and is not this slice's either.
- **Step-up auth** before a destructive act. [§11](../auth-design.md) defers it
  and nothing here changes the argument.

## 12. Tests

Slots into [testing.md](../testing.md)'s tiers.

### 12.1 Tier 1 — unit

- `person_recorded` is read from the Invite, never derived. The `anyLogin`
  query's removal should take its test with it.
- Invite state machine for `purpose: 'device'` at its **one-hour** lifetime —
  `INVITE_LIFETIME_MS` already carries both, and only the join lifetime is
  currently exercised.

### 12.2 Tier 2s — server integration

The slice's centre of gravity. Against the real `@simplewebauthn` software
authenticator (`api/test/server/softwareAuthenticator.ts`) where a credential is
involved, and against no authenticator at all where the point is that none is:

- `device/claim` with a **device** Invite → a token, a `device` row, and
  **zero `passkey` rows**.
- `device/claim` with a **join** Invite → a `login` row, a `device` row, zero
  `passkey` rows — a Login whose very first Device holds no credential.
- Second use of either → refused. Expired → refused. Revoked → refused. A claim
  for a **disabled** Login → refused.
- `POST /auth/invites` with `purpose: 'join'` → `400`, and no row written.
- `GET /auth/devices` returns this Login's Devices and no other's; `DELETE
  /auth/devices/:id` against another Login's Device is not found, and that
  Device keeps working.
- The revoked Device's next request is `401` — already covered for sign-out,
  extended to remote revocation.
- Add a passkey to a Login that has none, then **remove the last one**: allowed,
  and the Login still claims Devices afterwards.
- `/auth/me` carries `household_name`.
- **The multi-household isolation test extends to the new endpoints.** Story 31
  is a property every slice preserves, and nine new authenticated routes are
  nine new chances to read `household_id` from the wrong place
  ([§9.3](../auth-design.md)).

### 12.3 Tier 3 — component

Account, Devices, Invite issued, and Continue-without-a-passkey. The two
assertions that carry real rules: the unsynced line is **absent** at a count of
zero and states the **exact** number otherwise; and §10 renders with no `▲` and
no attention colour.

### 12.4 Tier 5 — e2e

Three golden paths, and the second is the one this slice exists for:

1. **Device link, end to end.** Sign in with the virtual authenticator → issue a
   device link → open it in a **second browser context with no virtual
   authenticator registered** → claim → signed in and syncing. That context is
   the honest simulation of the phone: WebAuthn is present and there is nothing
   behind it.
2. **The second Login joins.** `admin:invite --household` → the join screen
   shows the name field → the joiner names themselves → `person.recorded` is
   authored and their name renders. This is §4's regression test, and it is only
   meaningful end to end, because the defect lives in the seam between a server
   guess and a client branch.
3. **Sign out this device**, with a non-empty outbox: the sheet states the exact
   count, and afterwards the database is gone and `/signin` is showing.

Remote sign-out (`DELETE /auth/devices/:id` from one context, the other
discovering `401` at its next sync and keeping its queued ops) rides on the
existing 401 e2e rather than adding a fourth path.

## 13. Doc amendments

The durable docs this slice changes, and the one it must not.

- **`auth-design.md`** — §5 gains §2's finding, that the floor's real shape is a
  device that cannot hold a passkey *the household will use*; §9.1 marks which
  endpoints exist as of this slice; §11's `Passwords` bullet is rewritten to
  record the **recovery code** as the deferred shape, unwritten as a story so the
  next household takes the next unused number; §13 records that slices 3 and 4
  landed together and ahead of slice 2, with §4's defect as the reason the
  Maintainer scripts came with them.
- **`architecture-design.md`** — §8.3 gains the S3.5 entry; §8.6's "recommended
  landing point: any time before S10" is replaced by what actually happened and
  why. A §12 entry is written **after** the slice lands, not with it: those
  sections record consequences, and consequences are not knowable yet.
- **`CLAUDE.md`** — current status, and the debt list, which this slice shortens
  by four affordances and one uncalled function and lengthens by one named Radix
  slice.
- **`docs/design/README.md`** — §10 gains the §8 departure. Nothing else. And if
  this slice ever commissions a design round, **diff `README.md` before
  committing the drop**: R3's boards came back generated from a pre-S3 base and
  silently reverted four annotations recording what had already shipped. The
  boards cannot know what the code did after they were last drawn.
- **`user-stories.md`** — story **37** (name a Passkey after the fact) is added,
  Later, placed late in that section's want-order because renaming needs a list
  that has already gone stale. Stories **27** and **29** are amended. Both frame the
  fallback purely as a Device that *cannot* hold a Passkey, and §2 shows the
  need is also a Device that can only offer to keep one somewhere its owner has
  chosen not to. Story 27 additionally gains the §8 door: declining is "a plain
  choice offered alongside making one, not a failure I have to provoke."
  Problem-level throughout, naming no platform and no vendor. Stories 28, 30 and
  31 are unchanged. The **recovery code** of §11 stays unnumbered, recorded in
  `auth-design.md` §11 rather than as a story, because unlike the rename it is
  not a thing anyone has yet needed.
