# S5 — Auth 2: bring another Person in

The implementation design for [architecture §8.3](../architecture-design.md#83-the-slices)'s
**S5**, which is [auth-design §13](../auth-design.md)'s **slice 2**: issuing
join Invites from inside the app, the Logins list, and revoking a Login. It
delivers story **28** and finishes the screen S4 shipped half of.

This is a **feature spec**: it is retired once the slice has shipped. It settles
what the durable docs left to the implementer and records the decisions taken
before any code was written. It does **not** revisit anything above it — the
Invite's shape, its two purposes, the hashed secret, the fragment, and the rule
that redemption is never a side effect of a GET are all settled in
[`auth-design.md`](../auth-design.md) §3, and every ambiguity here is resolved
by reading that document, not this one.

**The boards win.** Where this spec and `docs/design/*.dc.html` disagree, the
boards are right and this spec is wrong — except at the three points [§6](#6-three-departures-from-the-boards)
names and argues. Screens C §08 carries People & logins and §09 carries Invite
issued; Components §09 carries the auth atoms; `docs/design/README.md` §11,
§13, §14 and §15 are the written handoff.

S4 unblocked this slice ([§8.2](../architecture-design.md#82-four-stories-accrete-across-slices-rather-than-landing-in-one)):
story 28 issues Invites for People *recorded* under story 4, so there was
nothing to name until they existed.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Op types | **None.** `shared/` is untouched, as at S3.5 |
| Migration | **One** — `0006_login_reinvite`, making the login uniqueness **partial** ([§1](#1-one-migration-and-the-defect-it-prevents)) |
| New endpoints | `GET /auth/logins`, `DELETE /auth/logins/:id` |
| Changed endpoints | `POST /auth/invites` gains `purpose: "join"` and an optional `person_id` for `"device"`; `GET · DELETE /auth/invites` widen **by purpose** |
| List/revoke scope | **A join Invite is Household business; a device Invite stays with its issuer** ([§2.4](#24-listing-and-revoking-scope-by-purpose-not-by-a-flag)) |
| At most one Login per Person | Enforced **twice** — the partial unique index, and a `400` when issuing |
| At most one join Invite out per Person | Issuing **revokes the Person's other outstanding join Invites** in the same transaction |
| Self-revocation | **Refused** (`400`). It is what makes "a Household always keeps a Login" true by construction |
| Revoking a Login | `disabled_at` + `revoked_at` on its Devices and on Invites bound to it, one transaction. **Nothing it recorded is touched** |
| Errors on these routes | **Precise `400`s, not the vague `401`** — the caller is already inside the Household, so there is no enumeration surface to protect |
| People screen | Becomes **People & logins** — the three slots S4's spec §7 booked, filled |
| Offline | Falls back to **exactly S4's render**, plus one line. State less, never state something false |
| `DeviceLink.tsx` | Becomes **`InviteIssued.tsx`** — boards §14's "one screen for both purposes", three entry points |
| `REOPEN ›` | **Not built.** The secret is hashed and exists only in the link ([§6.1](#61-reopen--is-not-built)) |
| New `ui/` primitive | **`ExpiryChip`** — a second caller is what moves it out of a screen's CSS module |
| Tier 5 | **Local-only, untagged.** Proving a join stays off production ([§5.4](#54-tier-5--local-only-and-why)) |

---

## 1. One migration, and the defect it prevents

`0002_auth.ts` gives `login` a plain unique constraint:

```
login_household_person_unique (household_id, person_id)
```

That is the right shape while no Login can ever be revoked. `DELETE
/auth/logins/:id` disables a Login by stamping `disabled_at` — the row stays,
because deleting it would take its Passkeys and Devices with it and leave no
record that access was ever granted. So the moment revocation exists, the
constraint means **a revoked Person can never hold a Login again**: the next
`register/verify` for that `person_id` hits the unique index and fails with a
raw Postgres unique-violation error. That is not an `AuthError`, so `failure()`
(`api/src/auth/routes.ts:422`) rethrows it, and with no `app.onError` Hono
answers a plain-text `500` — not the vague `401` every other failure on these
routes gets — on a screen that can only say "ask for a new invite," which
produces another invite that fails the same way. (`JoinContainer` treats any
non-decline error alike, so the user-facing experience is the intended one
even though the status code is not.)

Story 28 says "A Person may hold at most one Login", not "at most one ever".

**`0006_login_reinvite`** drops the constraint and creates a partial unique
index in its place:

```sql
create unique index login_active_household_person_unique
  on login (household_id, person_id)
  where disabled_at is null
```

It is a pure loosening — every row that satisfied the old constraint satisfies
the new index — so the expand-contract rule is satisfied trivially and no
backfill exists to do. Kysely expresses the predicate through
`sql` in a raw `createIndex(...).where(...)`; the `down` restores the original
constraint, which is honest only while no Household holds a disabled Login,
and the migration says so in a comment rather than pretending otherwise.

**`api/test/server/migrations.test.ts` gains the case that names the defect:**
disable a Login, register a new one for the same `person_id`, and expect it to
succeed.

---

## 2. The server surface

Four changes and one new pair, all in `api/src/auth/`. Every one takes its
Household from `AuthContext` and never from a body, so §9.3's tenancy rule
applies unrelaxed and `householdIsolation.test.ts` extends to each by adding a
row rather than a mechanism.

### 2.1 `GET /auth/logins`

```json
{
  "logins": [
    { "id": "…", "person_id": "…", "device_count": 2,
      "last_seen_at": "2026-08-20T19:04:00.000Z" }
  ]
}
```

- **Active Logins only** — `disabled_at is null`. A disabled Login is not a
  fact the screen has any use for: the Person reads `NO LOGIN`, and that is
  true, because they cannot sign in.
- `device_count` counts Devices that are neither revoked nor expired — the same
  predicate the middleware admits a request on, so the number on screen and the
  number that can actually reach the server are the same number.
- `last_seen_at` is the newest across those Devices, `null` when there are none.
- One query: `login` left-joined to the admissible `device` rows, grouped by
  `login.id`. No N+1, and no second round trip for a Household of five people.

It returns `person_id` and never a name. The server has never folded an op and
does not start here — the client already holds the names, and §2.1's rule that
the Person reference is opaque to the server is exactly what keeps auth out of
the domain.

### 2.2 `DELETE /auth/logins/:id`

One transaction, in this order:

1. `login.disabled_at` — scoped to the caller's Household, and to
   `disabled_at is null` so a double-tap cannot move the timestamp.
2. `device.revoked_at` for every Device of that Login not already revoked.
3. `invite.revoked_at` for every outstanding Invite **bound to** that Login
   (`login_id = target`) — a device link into a Login nobody may use is a live
   credential for a dead account.

Invites that Login *created* for other People are **left alone**. A join Invite
creates a Login for somebody else; it is a Household fact, and Kees's onboarding
does not collapse because Els lost access.

**Nothing in the transaction touches `op`**, which is how story 28's "everything
they recorded stays" is kept — by construction rather than by care. The op rows
carry a `device_id` and no foreign key to `device`, and revocation is a
timestamp rather than a delete, so there is no cascade to think about and no
column whose value changes what `/sync/pull` returns.

`disabled_at` alone would already be enough to lock the account out — the
middleware rejects a request whose Login is disabled (`middleware.ts:71`), and
`login/verify`, `device/claim` and `mintDeviceLink` each check it (`service.ts`
`:592`, `:519`, `:814`). Steps 2 and 3 exist so the Devices list and the Invite
list stop *claiming* something that is no longer true. Revocation is one fact
and it is written everywhere it is read.

**Self-revocation is refused** with `400 cannot_revoke_self`, checked before
anything else. The boards give the reason — "only your own row lacks them (your
exit is SIGN OUT)" — and the consequence is stronger than a screen rule: since
no Login can disable itself, **a Household can never end up with zero active
Logins** by any single act. Two Logins revoking each other in the same instant
can, and that case is accepted rather than guarded: it needs two people
deliberately racing, and `npm run admin:invite` is the named escape hatch
[auth-design §5](../auth-design.md) already provides for exactly this.

A well-formed id that matches nothing returns `204`, and so does a
non-UUID — "not yours", "does not exist" and "not even a UUID" are one answer,
which is the convention `DELETE /auth/invites/:id` already set.

### 2.3 `POST /auth/invites` gains the join purpose

The body becomes `{ purpose: "join" | "device", person_id?: string }`.

**`purpose: "join"`** requires `person_id`:

- `400 person_id_required` when it is missing or not a UUID.
- `400 person_has_login` when an active Login already exists for that Person.
  Story 28's "A Person may hold at most one Login" is enforced here as well as
  by the index, because a screen that mints a doomed link and only fails at
  redemption — on a stranger's phone, with the vague `401` — is not enforcement
  a Quartermaster can act on.
- Otherwise, in one transaction: revoke that Person's other outstanding join
  Invites, then insert the new one — `purpose: 'join'`, `login_id: null`,
  `created_by_login`: the caller, 7-day expiry per §3.1, and
  **`person_recorded: true`**.

`person_recorded` is stated by the minting code, which is §12.7's rule and the
whole reason the column exists: the client picked this Person off the folded
list, so the joiner does not name themselves and `JoinContainer` already reads
the flag to decide that. Nothing about the join screen changes in this slice —
S3.5 built it against the fact rather than against a guess, and this is the
first caller to exercise the other branch in earnest.

The revoke-then-insert keeps `INVITE OUT` singular **by construction**. With
[§6.1](#61-reopen--is-not-built)'s row there is no in-app path to two
outstanding invites for one Person anyway; two Quartermasters on two Devices are
the path, and one link quietly superseding the other is a better outcome than
two links of which the second dies at redemption for reasons nobody can see.

**`purpose: "device"`** gains an optional `person_id`. Absent, it means the
caller's own Login and the existing path is unchanged. Present, the route
resolves that Person's active Login in this Household — `400
no_login_for_person` if there is none — and mints the device link against it,
`created_by_login` still the caller. auth-design §3.1 has always said a device
Invite may be issued by "that Login, **or any Quartermaster of the
Household**"; this is the route that finally means it, and
`insertDeviceLinkInvite` already takes exactly the four fields it needs.

**Why precise `400`s and not the vague `401`.** §9.4's vagueness protects the
redemption endpoints, which are unauthenticated and answer questions about
secrets held by strangers. These are authenticated routes whose caller is
already inside the Household and can already list its People. There is nothing
to enumerate, and `unsupported_purpose` already set the precedent on this exact
handler.

### 2.4 Listing and revoking scope by purpose, not by a flag

`listInvites` is scoped today to `created_by_login = caller`. That is right for
a device link and wrong for a join Invite: the boards put the outstanding-invite
row on **People & logins**, where any member may revoke it, and two
Quartermasters who cannot see each other's invites will both issue one for Els.

The rule is a sentence, not a query parameter:

> **A join Invite creates a Login — that is Household business. A device Invite
> is a credential for one Login, and stays with its issuer.**

which is §3.1's own "revocable and listable by the issuer while outstanding",
kept for the purpose it was written about, and widened for the one it was not.
So both handlers gain one predicate:

```
purpose = 'join' or created_by_login = <caller>
```

`GET /auth/invites` additionally selects `person_id`, which the People screen
keys rows on; the response entries become
`{ id, purpose, person_id, expires_at }`.

**Nothing existing is disturbed by the widening**, because `listInvites` has no
caller in `app/` at all today — S3.5 built the client method and the route
together and left the list unread, since `DeviceLink` revokes the one Invite it
minted and never needed to enumerate. People & logins is its first consumer,
and it reads `purpose === 'join'`: a device link Mark issued for Els must not
make Els's row read `INVITE OUT`, which describes a Login that does not exist
yet.

---

## 3. Screens

### 3.1 People & logins

`People.tsx` takes `api` and `token` and loads two things on mount:
`listLogins` and `listInvites`. One `LoadStatus` covers both — the same
`'loading' | 'loaded' | 'failed'` triple `Account.tsx:76` and `Devices.tsx:28`
already use — because the login half is one claim and half of it is not worth
drawing.

The screen title, Account's section label and the route's own back-link all
become **`PEOPLE & LOGINS`**. The count line gains its second clause:

```
1 of 3 people holds a login. 1 invite out.
2 of 3 people hold a login.
```

Singular and plural on both clauses; the second is **omitted entirely** when
nothing is out, which is the same rule §12's sign-out sheet uses for its ▲ line.

### 3.2 The five row states

Alphabetical order and identical anatomy, unchanged from S4 — equality is
typographic law, and nothing here earns a badge.

| # | Condition | Circle | Meta | Right column |
| --- | --- | --- | --- | --- |
| 1 | Your own Login | accent `#93BC9F` | `SIGNED IN · 2 DEVICES` | `›` → `/account/devices` |
| 2 | Another's Login, ≥1 Device | accent | `SIGNED IN · 1 DEVICE · LAST SEEN 2026-08-20 19:04` | `DEVICE LINK ›` · `REVOKE` |
| 3 | Another's Login, no Device | accent | `LOGIN · NO DEVICE SIGNED IN` | `DEVICE LINK ›` · `REVOKE` |
| 4 | No Login, join Invite out | control `#47523F` | `INVITE OUT · SINGLE USE` | `EXPIRES IN 6 d` · `REVOKE` |
| 5 | No Login, nothing out | control | `NO LOGIN · JOINS TRIPS AS PARTICIPANT` | `INVITE ›` |

Notes the table cannot carry:

- **State 3 is not on the boards** and is argued in [§6.2](#62-login--no-device-signed-in).
  Your own row can never reach it — you are reading this on a Device.
- **`LAST SEEN` renders in the reader's local time**, formatted
  `YYYY-MM-DD HH:MM` with no zone suffix. This spec argued the opposite twice
  and was wrong both times; the boards settled it (Screens C §08, "DECISIONS
  DRAWN AFTER THE FACT"). **UTC is false for every reader of a one-timezone
  household** — `19:04Z` is 21:04 on the phone in their hand — and a relative
  form (`5 DAYS AGO`) fights a ledger that writes dates as data. The
  machine-independence this spec was protecting is a property of the *test
  runner*, not of the product, and it is bought instead by pinning
  `TZ=Europe/Amsterdam` in `app/vitest.config.ts` — deliberately not UTC,
  under which a local formatter and the ISO-slicing one it replaced emit
  identical strings and every assertion would pass against the bug it exists
  to catch. One formatter, `app/src/format.ts`, now serves this line,
  `Devices.tsx`'s twin and Account's `ADDED`/`LAST USED`: while `LAST SEEN`
  was local and `SIGNED IN` was not, a single Devices row could print a date
  from one calendar beside a time from another. It appears only on another
  Person's row — printing when *you* were last seen, on the screen you are
  looking at, is noise.
- **The own row's `›` is omitted in the `inline` variant.** At Desktop, People
  unfolds into Account's card and `/account/devices` redirects back to
  `/account` — a chevron whose destination is the card two rows above it is an
  affordance that leads nowhere, which is the rule that kept `PEOPLE` out of
  Account at S3.5 in the first place.
- **EDIT mode replaces the right column with `RENAME`**, rather than adding to
  it. The two never compete for the slot, and EDIT stays what §3c settled it
  as: a mode, not a decoration.
- The states are computed from three inputs — the folded People, the logins
  list, and the invites list filtered to `purpose === 'join'`. A Person with a
  Login can never also show state 4: `person_has_login` refuses to mint one, and
  redemption consumes it.

**`REVOKE` on a Login is a decision, so it is `Confirm`** — Radix AlertDialog,
no scrim dismissal, per the Radix conversion's §3.1:

> **Revoke Els's login?**
> Els's devices lose access at their next sync. Everything Els recorded stays
> with the household.
> `Revoke login` · `Cancel`

The copy is the board's, not this spec's first draft: "at their next sync"
because that is the phrase §12's Devices sheets already use for the same
delay, and "stays with the household" because "stays" alone leaves open
*where*.

No ▲. Nothing is discarded, and §12's rule is that signing out this device is
the only auth action that earns the attention class. **`REVOKE` on an Invite is
not confirmed** — it kills a link and never data, which is the treatment
`InviteIssued`'s own `REVOKE LINK` already has.

Both refetch on success rather than patching local state: two lists whose
consistency with each other is what the row states are computed from is not a
place to hand-maintain a cache.

### 3.3 Offline

The People half of this screen is a fold of the op log and keeps working with
the radio off. The login half is a server fact and cannot.

When either request fails, the screen renders what S4 rendered **everywhere
except the circle** — no meta, no right column, `3 people.`, and **circles
with the ring withdrawn** — plus one line in the established wording:

```
Login state could not be loaded. Check your connection.
```

This is not a degraded mode bolted on; it is S4's screen, which was designed to
be true while knowing less. The rule it keeps is the one that governed the whole
S4 → S5 seam: **drawing every circle as "no login" would render the joiner as
having none, and stating something false is worse than stating less.** Offline
is the same situation as S4, arriving later.

**The circle is where that rule was nearly lost, and the boards are what saved
it.** S4 could say its circle "carried no meaning attached"; S5 gives the
control border the meaning `= no login`, so the same pixel becomes a claim.
This spec's first answer was a third *colour* for "not known", which held in
sage and flattened in parchment — where `--color-rule`, `--color-rule-row` and
`--color-rule-control` all resolved to one value — putting the false statement
straight back for every light-theme reader. The boards' answer is a
**withdrawal**: the ring *is* the statement "login state is known", so when the
list cannot load the ring goes with it (Screens C §08, "THE PERSON CIRCLE —
THREE STATES"). Adding no colour is what makes it unflattenable in any theme,
now or later. Parchment separately gained the rule hierarchy it was missing —
a control border at `#d8d2be` fails at 1.5px on a light surface — but no
circle depends on it.

**Withdrawal is screen-level, never per-row.** Every circle loses its ring at
once, which is what makes the single line above legible as the explanation for
the whole list rather than a note about one row.

`+ NEW PERSON` and EDIT/RENAME stay live offline throughout — they author ops.

### 3.4 Invite issued — one screen, three entry points

`DeviceLink.tsx` becomes **`InviteIssued.tsx`** (with its CSS module and test
file), which is what boards §14 — "one screen for both purposes" — always
described. Its own header comment already booked this:

> This file builds only the **device-link** variant of boards §14. The **join**
> variant … belongs to story 28 / S5's People & logins screen.

Props gain `subjectPersonId` and `purpose`; `own` is
`subjectPersonId === personId`. Everything else is a lookup:

| | back | title | lead | fact | TTL |
| --- | --- | --- | --- | --- | --- |
| own device link | `‹ ACCOUNT` | `Sign in on another device` | `Open this on the other device. It signs that device in as you, Mark.` | `The link is the credential. Treat it like a key.` | 1 h |
| another's device link | `‹ PEOPLE & LOGINS` | `Device link for Els` | `Open this on Els's device. It signs that device in as Els.` | same | 1 h |
| join Invite | `‹ PEOPLE & LOGINS` | `Invite for Els` | `Hand it over yourself — foerier sends no mail.` | `It creates a login for Els. Nothing else can use it.` | 7 d |

Routes: `/account/device-link` (unchanged, own),
`/account/people/:personId/device-link`, `/account/people/:personId/invite`.
Revoking navigates to the back-link's target rather than always `/account`.

**Two things survive verbatim, because each was bought with a bug.** The
`useRef` mint-once guard — an effect that re-issues under Strict Mode burns
single-use Invites and leaves dead links behind with no explanation on
screen — and the rule that urgency is computed from raw remaining milliseconds
and never from the rounded display. Both move into `ExpiryChip` or stay in the
screen unchanged; neither is re-derived.

### 3.5 Account

Two lines. The section label at `Account.tsx:495` becomes `PEOPLE & LOGINS`,
and the row meta beneath it gains the login clause the count line carries. The
comment at `:493` that explains why it read `PEOPLE` is replaced by the fact
that it no longer does.

---

## 4. `ui/ExpiryChip`

The expiry chip is a local class in `DeviceLink.module.css` today, which was
right for one caller. The People row is the second, so it moves into `ui/` as a
new **primitive**, joining `Sheet`, `Confirm` and `Chip` — an addition to
[frontend-design §5](../frontend-design.md)'s list rather than something that
list already anticipated, and the extraction follows `GearRow`'s reasoning at
S3 rather than a rule stated anywhere.

**It is not a `Chip`.** `ui/Chip` is the tag-and-filter chip settled by
Components §04 and §06 — 36px or 32px, three appearances, a `#`-bearing label
somebody taps. The expiry chip is README §14's own separate anatomy: radius
999, 1.5px stroke, mono 10/600, inert, and a *status* rather than a value. Two
components that share a border radius are not one component.

```tsx
<ExpiryChip expiresAt={invite.expires_at} />
```

- **Formats** `N d` (floor, ≥ 48 h) · `N h` (≥ 1 h) · `N min` (rounded). A
  fresh 7-day Invite reads `EXPIRES IN 6 d`, which is what the board draws, and
  is a floor rather than a round because a link that says `7 d` on the day it
  dies is a lie in the direction that costs somebody a handover.
- **Urgency** is `remaining <= 1 h`, computed from raw milliseconds. Muted
  `#47523F`/`#97A08C` above it, amber `#E2A65B` on an 8% tint below — README
  §14's anatomy, unchanged.
- **Owns its own tick** (30 s), so the People row counts live for free and no
  screen has to remember to. Reads `Date.now()` at render, never a stored
  snapshot.

The `SINGLE USE` label beside it on the invite card is not part of the chip; it
is a different fact that happens to sit next to one.

---

## 5. Tests

### 5.1 Tier 2s — the server

New `api/test/server/logins.test.ts`:

- the list counts only admissible Devices, and reports the newest `last_seen_at`
- a Login with no Device appears with `device_count: 0` and `last_seen_at: null`
- a disabled Login does not appear
- revoking disables the Login, revokes its Devices, and revokes Invites bound to
  it — and **its Devices' very next request is `401`**
- ops pushed by that Login's Devices are still returned by `/sync/pull` after
  the revocation, and join Invites it created for other People stay outstanding
- revoking your own Login is `400`
- an unknown or malformed id is `204`

New `api/test/server/invites.test.ts`:

- a join Invite is single-use — the second `register/verify` on the same secret
  fails
- an expired join Invite fails (clock injected, as elsewhere)
- issuing for a Person who already holds a Login is `400`
- issuing revokes that Person's previous outstanding join Invite
- a join Invite is listable and revocable by a **second** Login in the
  Household; a device Invite is listable and revocable only by its issuer
- `purpose: "device"` with another Person's `person_id` mints against **their**
  Login; with a Person who holds none it is `400`

`api/test/server/householdIsolation.test.ts` gains `GET /auth/logins` and
`DELETE /auth/logins/:id`, by adding rows to the table it already drives.
`migrations.test.ts` gains §1's re-invite case.

### 5.2 Tier 3 — the screens

`People.test.tsx` covers all five row states, the two count-line clauses with
their plurals, the revoke confirm (including that Cancel changes nothing), the
`inline` variant's missing chevron, and **the offline fallback rendering
identically to S4's** — asserted against the absence of meta and the presence of
the line, not against a snapshot.

`InviteIssued.test.tsx` (from `DeviceLink.test.tsx`) keeps every existing case
and adds the join and other-person variants: the title, lead, fact and back-link
lookup, and the mint-once guard holding for each.

`ui/ExpiryChip.test.tsx` covers the three format bands, the floor at `6 d`, and
the rule that a freshly issued device link reads `urgent` — the case that
caught the rounding bug the first time.

### 5.3 Tier 4 — contract

The contract tier does not sweep the auth surface and is not made to here — it
checks a small number of specific claims about a deployed box. It gains one:
`GET /auth/logins` answers `200` with the calling Login present. That is what
fails if the route did not ship, and it costs one request on a tier whose whole
value is that it is short.

The partial index of [§1](#1-one-migration-and-the-defect-it-prevents) is **not**
checked here — a schema fact is not observable over HTTP without minting a
Login on the box, which is precisely what [§5.4](#54-tier-5--local-only-and-why)
rules out. `migrations.test.ts` (Tier 2) is where it is proved, against a real
Postgres.

### 5.4 Tier 5 — local-only, and why

`test/e2e/invite.spec.ts`, **untagged**: a signed-in Quartermaster records a
Person, issues a join Invite from their row, and the link is opened in a fresh
browser context with its own virtual authenticator, which joins and lands in the
Depot. The first context then shows that Person holding a Login.

It does **not** carry `@production`. [The Tier 4/5 spec](2026-08-28-tier-4-and-5-against-production.md)
§5 rules that anything which "proves joining" stays local, and the mechanism
behind that rule is decisive here: `POST /test/reset` **cannot delete a
Login** — by design, since it can never create one either — so every production
run would leave a Login behind in the disposable Household, and the tripwire
that says `passkeys = 0, invites = 0, revoked ≤ 1` would have nothing to say
about it. §8's S5 line predates that spec and is amended by [§8](#8-doc-amendments)
rather than obeyed.

`deviceLink.spec.ts` already establishes the two-context-with-authenticators
pattern this reuses.

---

## 6. Three departures from the boards — since adopted

**All three are now drawn.** They are kept below as the arguments that were
made, because the boards took each of them and a reader who finds a departure
recorded here should know it stopped being one. The design pass that adopted
them also **overturned two decisions this spec had made without a board** —
`LAST SEEN`'s timezone ([§3.2](#32-the-five-row-states)) and the revoke sheet's
copy — and answered the one thing this spec parked rather than settled, the
circle's third appearance ([§3.3](#33-offline)). Twelve decisions went to that
pass; ten came back blessed as built.

### 6.1 `REOPEN ›` is not built

Screens C §08 draws the outstanding-invite row as `EXPIRES IN 6 d` + `REOPEN ›`
+ `REVOKE`, and README §13 calls it "the collapsed handover screen".

It cannot be built. [auth-design §3.1](../auth-design.md): the secret is stored
**hashed**, and "the plaintext exists only in the link. A database reader cannot
mint access from an invite row." Neither the server nor a reloaded client has
anything to reopen. The board drew a screen the security design forbids, and the
security design is the one that is right.

The row ships as **`EXPIRES IN 6 d` + `REVOKE`**. Re-handing a link is `REVOKE`,
which returns the row to state 5, and then `INVITE ›` — two deliberate steps,
each of which says exactly what it does. The rejected alternatives, for the
record: keeping the plaintext in client memory makes `REOPEN` work until the
first reload and fail silently after it; minting a fresh Invite under the word
`REOPEN` tells the reader the link they already sent still stands, when the act
has just killed it.

### 6.2 `LOGIN · NO DEVICE SIGNED IN`

An **added** meta state, not a changed one. The boards draw a Login with two
Devices and a Login with one; they do not draw a Login with none, and
`SIGNED IN · 0 DEVICES` would be false in both of its words. The state is real
and the product already talks about it — §15's explainer sheet is written for
"if yours is the only login and it is signed in nowhere". `DEVICE LINK ›` is
exactly the affordance that Person needs, and it is already on the row.

### 6.3 A device link's back link follows the route

README §14 fixes the device-link variant's back link as `‹ ACCOUNT`, which was
true while Account was the only way in. People & logins is now a second, and a
back link that returns somewhere the reader has not been is worse than one word
of variance. The join variant's `‹ PEOPLE & LOGINS` is the board's own.

---

## 7. What this slice deliberately does not build

- **Roles, owners, or any hierarchy.** Story 28 is explicit: every Quartermaster
  has the same powers. There is no column to add and none is added.
- **Re-enabling a disabled Login.** The route back is a fresh join Invite, which
  §1's partial index is what makes possible. A resurrect verb would bring back
  Passkeys nobody has audited.
- **Renaming a Passkey** — story 37, Later, unchanged from S3.5.
- **Person removal** — no op, by design, unchanged from S4.
- **Widening `/test/reset` to delete Logins.** It would make a `@production`
  join test possible, and it would put "can destroy a Login" into a route whose
  whole argument is that it can never create one. Not this slice's trade.
- **Any change to the join screen.** S3.5 built it against `person_recorded`
  rather than a guess; this slice is its second caller and needed nothing.

---

## 8. Doc amendments

Landing this slice updates, in the same commit range:

- **[`auth-design.md`](../auth-design.md) §9.1** — drop the "What exists as of
  S3.5" caveat; state that `POST /auth/invites` takes an optional `person_id`
  for both purposes and that list/revoke scope by purpose. **§9.2** — the login
  uniqueness is a partial index. **§13** — slice 2 marked landed, with its date
  and the note that it arrived after slices 3 and 4.
- **[`architecture-design.md`](../architecture-design.md) §8.3** — S5 marked
  landed; its "Endpoints" line corrected to include the widened
  `/auth/invites`; a "Migration" line added; the Tier 5 line corrected to
  local-only per [§5.4](#54-tier-5--local-only-and-why). A new **§12.11**
  records the consequences.
- **[`design/README.md`](../design/README.md) §13** — S5's three debts marked
  discharged, [§6.1](#61-reopen--is-not-built) and
  [§6.2](#62-login--no-device-signed-in) recorded. **§14** — the third entry
  point and [§6.3](#63-a-device-links-back-link-follows-the-route)'s back-link
  rule.
- **`CLAUDE.md`** — the S5 status block, what is worth knowing before touching
  auth, and S6 as next.

`docs/specs/2026-08-29-people-and-ownership.md` §7 is **not** amended. A shipped
feature spec is a historical record of what was decided before its slice was
written, and this document is where its three obligations are discharged.
