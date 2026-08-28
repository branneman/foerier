# foerier — Auth & Web Security Design

How a person gets into foerier and stays in: enrolment, sign-in, sessions,
devices, and the HTTP surface that carries them. This is the design the
maintainer approved on 2026-08-21. It sits one level below the
[architecture spec](architecture-design.md) and **replaces its §6** with the
full picture; the architecture spec keeps the one-line summary and points here.

It stays inside the settled choices — WebAuthn/passkeys, relying party
`foerier.app`, invite-only enrolment, long-lived bearer tokens, no cookies — and
fills in what that spec left open: who issues invites, how a second device gets
in, what happens on a device that cannot hold a passkey, and exactly which
headers, endpoints, and tables are involved.

The conceptual [domain model](domain-model.md) and
[user stories](user-stories.md) stay persistence-ignorant; the
[ubiquitous language](ubiquitous-language.md) carries the six access terms
(Household, Login, Passkey, Device, Invite, Maintainer) this document
mechanises. Stories 26–31 are the user-facing contract.

---

## Decisions at a glance

| Concern | Decision |
| --- | --- |
| Primary credential | **Passkeys (WebAuthn)** only. **No passwords**, anywhere, ever |
| Relying Party ID | **`foerier.app`** — the registrable parent, valid across `app.` / `api.` |
| Discoverability | **Discoverable credentials** (resident keys) — sign-in needs no username |
| Enrolment | **Invite-only.** No public sign-up, no open registration endpoint |
| Who invites | Any **Quartermaster**, from inside the app. The **Maintainer** only bootstraps a Household's first Login |
| Invite secret | 256-bit random in the URL **fragment**; stored hashed; single-use; short-lived |
| Second device | **Device-link Invite** (our mechanism) + the browser's own cross-device QR sign-in (free) |
| Compatibility floor | A Device that cannot hold a passkey — **or cannot hold one the household will use** — is **fully supported** via a Device link: token only, no feature loss |
| Session | Opaque **bearer token per Device**, hashed at rest, **sliding 1-year expiry** |
| Session transport | `Authorization` header. **No cookies** → no CSRF surface, no cookie-domain juggling |
| Revocation | Per-Device, from any Device; per-Login by any Quartermaster |
| App lock | **None.** The device's own lock screen is the boundary |
| Tenancy | `household_id` resolved **from the token**, never from the request body |
| Web hardening | Strict CSP (no `unsafe-inline`), single-origin CORS allowlist, HSTS preload, `no-referrer`, `no-store` on API |
| Library | `@simplewebauthn/server` + `@simplewebauthn/browser` |

---

## 1. Guiding constraints

Six forces, in rough priority. Where they conflict, the higher one wins.

1. **Never a hurdle in the field.** Signing in happens once per device; ordinary
   use — including days offline — never re-prompts. Auth must never sit in the
   path of recording that a crate went into the car.
2. **Compatibility is a value, not a nice-to-have.** Some phones, browsers, and
   locked-down machines have no usable credential store, and that is not the
   user's fault. **Every flow must have a path that needs nothing of the device
   beyond a browser.** A design that works only on current hardware is a design
   that excludes people.
3. **Privacy of a sensitive signal.** The app documents what a household owns and,
   by implication, when its house is empty. Access is invite-only, revocable per
   device, and never crosses the Household boundary.
4. **No passwords and no third-party identity.** Nothing to phish, nothing to
   breach, no Google/Apple/Auth0 sitting between a household and its own gear —
   consistent with the EU-sovereign posture of the architecture spec.
5. **No email dependency.** foerier sends no mail. Recovery is social: another
   Quartermaster in the Household re-invites you. This removes a whole
   subsystem (deliverability, reset tokens, address verification) and the
   phishing surface that comes with it.
6. **Small enough to be correct.** Two adults per household. Every mechanism here
   must be simple enough to hold in one head and cover with tests.

## 2. The identity model

```
Household ─┬─ Person ──── Login ─┬─ Passkey  (0..n)
           │  (in the op log)    └─ Device   (0..n)
           ├─ Person  (no Login — a child, a guest participant)
           └─ Invite  (join | device link)
```

- A **Household** is the tenancy boundary. Every op, row, and token names one.
- A **Person** is a domain entity: it lives in the **op log**, like Gear and
  Trips, and is created, renamed, and synced like any other record.
- A **Login** belongs to exactly one Person and one Household. At most one Login
  per Person; a Person with a Login is a Quartermaster, and all Quartermasters
  have identical powers. There is no owner and no admin role.
- A **Passkey** is a WebAuthn credential bound to the Login. Several per Login is
  normal (phone keychain, desktop password manager); **zero is legal** (§5).
- A **Device** is one signed-in browser installation holding one bearer token.

### 2.1 The Person reference is opaque by design

`login.person_id` points at a Person that exists **only as the fold of an op
log** — there is no `person` table and there never will be, because that would
drag domain state into the thin op store the architecture deliberately keeps
(spec §5). So:

- The server stores `person_id` as a plain UUID with **no foreign key** and
  attaches no meaning to it. It is echoed back at sign-in and otherwise inert.
- The **client** resolves it against its folded state to show "you are Ada".
- A Login whose `person_id` matches no folded Person (a half-finished bootstrap,
  a Person op still queued on someone else's phone) renders as an unnamed
  Quartermaster rather than as an error. Tolerant reader, as everywhere else.

This is the one place where an access row references domain data, and keeping it
a dumb UUID is what stops auth and domain from entangling.

## 3. Enrolment

There is **no registration endpoint that can be called without an Invite.** That
is not a mitigation of abuse; it removes the surface. There is nothing to
rate-limit into safety, no approval queue, and no cleanup job for abandoned
sign-ups.

### 3.1 The Invite

One record, two purposes:

| Purpose | Creates | Issued by | Lifetime |
| --- | --- | --- | --- |
| **join** | a new Login for a named Person | any Quartermaster (first one: the Maintainer) | **7 days** |
| **device** | another Device for an existing Login | that Login, or any Quartermaster of the Household | **1 hour** |

Shape and handling:

- The secret is **32 random bytes, base64url** (256 bits — brute force is not a
  threat model, so no lockout logic is needed on the secret itself).
- Stored **hashed** (SHA-256, unique index); lookup is by hash. The plaintext
  exists only in the link. A database reader cannot mint access from an invite
  row.
- **Single-use**, marked consumed in the same transaction that creates the
  Login/Device, so a double-tap or a re-sent request cannot yield two Logins.
- **Revocable** and listable by the issuer while outstanding.
- Always **pre-binds `person_id`**, which is what makes "a Login is always a
  Person" true by construction rather than by convention.
- **Delivered out of band** — the app shows the link, a QR code, and a copy
  button; the household passes it over whatever they already use. foerier sends
  nothing.

### 3.2 The secret lives in the URL fragment

```
https://app.foerier.app/join#<secret>
```

Not in the path, not in the query. The **fragment is never sent to a server**,
so the secret stays out of Caddy's access log, out of any intermediary's log,
and out of the `Referer` header on any subsequent navigation. `/join` is a
normal SPA route served the precached app shell; the client reads
`location.hash`, then immediately replaces the history entry with a bare
`/join` so a screen-shared address bar and the back button do not carry the
secret around.

Residual exposure is the honest one: the link sits in whatever chat app carried
it, and in that device's clipboard. Single-use plus a short lifetime is the
answer, not secrecy theatre.

### 3.3 Redemption is never a side effect of a GET

Opening the link does nothing but load the app and show a confirmation screen
("Join this household as Ada?"). The Invite is consumed only by an explicit
`POST` the user triggers. This matters concretely: **chat apps and mail scanners
fetch links to build previews**, and a GET-consumes design would let a link
preview burn a single-use Invite before its recipient ever taps it.

### 3.4 Bootstrapping a Household

Only the first Login of a brand-new Household is arranged out of band, by the
Maintainer, with a small script in `api/` (`npm run admin:bootstrap -- --name
"…"`). It inserts the `household` row and one **join Invite**, printing the
link. There is a chicken-and-egg here worth naming: a new Household has no ops,
therefore no People, so nothing exists to bind the Invite to. Resolution:

1. The script **generates a fresh UUIDv7** and pre-binds the Invite to it.
2. Onboarding asks the joiner their name and emits the **`person.recorded`** op
   **with that exact id**, as the Household's first op. (This document
   originally said `person.create`; the MVP catalogue in
   [`sync-protocol.md` §4.2](sync-protocol.md) is authoritative and names it
   `person.recorded`.)

So the invariant holds from the very first second, and the script never has to
know anything about the domain. Every later Invite takes the reverse route: the
inviter creates (or picks) the Person in the app first, then issues the Invite
for that `person_id`.

### 3.5 Joining

1. `POST /auth/register/options` `{secret}` → the server validates the Invite and
   returns WebAuthn **creation** options: a fresh challenge, `rp.id =
   foerier.app`, a random 32-byte **user handle** (never the Person's name or
   any household data — user handles are stored by the authenticator and may be
   displayed by password managers), `residentKey: "required"`,
   `userVerification: "preferred"`, `attestation: "none"`.
2. `navigator.credentials.create()` — the device or password manager makes the
   passkey.
3. `POST /auth/register/verify` `{secret, attestationResponse}` → the server
   verifies, and in **one transaction** creates the Login, stores the credential,
   consumes the Invite, and issues this Device's token.
4. The client stores the token, then pulls the Household's ops.

If step 2 is impossible or refused, the screen falls through to §5.

## 4. Sign-in

Discoverable credentials mean the sign-in screen is a single button and no text
field: the authenticator already knows which credential belongs to
`foerier.app`.

1. `POST /auth/login/options` — no body. Returns a challenge with an **empty**
   `allowCredentials` (that is what makes it username-less) and
   `userVerification: "preferred"`.
2. `navigator.credentials.get()` — platform biometric, device PIN, or the
   password manager's own unlock. All three satisfy WebAuthn's *user
   verification*; **"biometrics" is a UX detail, not a requirement.**
3. `POST /auth/login/verify` `{assertionResponse}` → on success, a new Device
   token.

**Server-side verification checks, all mandatory:** challenge exists, is
unconsumed, unexpired, and matches; `origin` is in the allowlist (§7.1);
`rpIdHash` matches `foerier.app`; the credential id is known and its Login is not
disabled; the signature verifies against the stored public key; the flags carry
`UP`, and `UV` where the policy demands it; the signature counter is greater than
the stored one **or both are zero** (passkey authenticators legitimately report
0 — treating that as a clone would lock out every synced credential).

**On `userVerification: "preferred"` rather than `"required"`.** Required would
be stricter, and would also hard-fail on setups that cannot perform UV at all —
exactly the devices constraint 2 protects. Preferred keeps the strong case strong
(essentially every real passkey store performs UV) without turning a UV gap into
a lockout. The verified UV flag is recorded per credential, so tightening this
later is a policy change, not a migration.

**Cross-device sign-in comes free.** When a browser holding no local credential
runs the ceremony, it offers "use a phone or tablet": a QR code, a Bluetooth
proximity check, and the phone signs. We implement nothing for this; it is the
browser's own flow. It is an escape hatch rather than a daily path — after using
it, the app offers to add a local passkey (§6.3).

## 5. Devices that cannot hold a passkey

This is the design's compatibility floor, and it is deliberate rather than
grudging.

**The problem.** Passkey support is an *operating system* capability as much as a
browser one. A phone whose OS ships no credential provider gives a modern browser
and a modern password manager nothing to work with. The browser's cross-device
QR flow does not help, because there the phone must be the *authenticator*, and
it is the device that cannot hold credentials. WebAuthn's own fallback — a
hardware security key over USB or NFC — is not something to require of a
household.

**The floor is wider than "cannot", and testing against a real device is what
showed it.** Android routes passkeys through Credential Manager, and a
third-party credential provider can only take that seat if the OEM's build
exposes the setting for it. Several do not. Such a phone *can* still complete a
ceremony — the platform's own credential store answers, and a WebAuthn test site
registers against it happily — so every capability check passes. What it cannot
offer is **the credential store the household chose**. The real shape of this
section is therefore *a Device that cannot hold a passkey the household is
willing to use*, and the mechanism below is unchanged by that: a Device link
needs nothing but a browser either way. What changes is the **trigger**.
Capability detection alone sails straight past such a device and into a store
its owner deliberately declined, so the token-only path must be reachable **by
choice** and not only by failure. See
[`docs/specs/2026-08-28-auth-device-links.md`](specs/2026-08-28-auth-device-links.md)
§8 for the affordance that follows.

**Two facts about passkeys that this section depends on**, stated here because
they are the ones most often assumed the other way round. A passkey is **not
portable** — the private half is non-exportable by design, provider sync happens
inside the provider's own encrypted channel, and there is no user-facing export
or import. Moving between credential stores is therefore not a migration but
`add a passkey` on the new Device followed by `remove` on the old one, against
the same Login, which is why several passkeys per Login (§2) is load-bearing
rather than a convenience. And **the link is short-lived; the session it creates
is not** — an hour bounds the interception window, while the Device token it
issues runs to a year after last use (§6.2). The real fragility on a token-only
Device is local storage eviction, not expiry.

**The answer: a Device link needs nothing but a browser.**

- From any signed-in Device, a Quartermaster issues a **device Invite** for a
  Login (their own, or another member's when that member is locked out).
- Opening it on the constrained device and confirming calls
  `POST /auth/device/claim`, which — after the same single-use, unexpired checks
  — issues that Device a token **without creating any credential**.
- The **same endpoint serves a join Invite** on such a device: it creates the
  Login exactly as `register/verify` would, minus the credential, so a Person's
  very first Device can be one that holds no passkey. The client reaches it by
  falling through from §3.5 when `PublicKeyCredential` is absent, when
  `isUserVerifyingPlatformAuthenticatorAvailable()` and the create call both come
  back empty-handed, or when the user simply declines.
- That Device is then a first-class Device: it syncs, it appears in the Device
  list, it is revocable, and it stays signed in indefinitely (§6). **No feature
  is withheld from it.**

**The consequence, stated plainly.** A Login with zero passkeys cannot start a
session by itself; each new Device needs a link from an already-signed-in one.
Within a Household of two Quartermasters that is a ten-second favour. In a
Household with exactly one Login and no passkey, it needs the Maintainer — the
single case in this design that leaves the product. The app therefore nudges
(never blocks): a Login with no passkey sees a quiet, dismissible line offering
to add one whenever it lands on a device that can.

The same path covers cases with nothing to do with old hardware: a borrowed
laptop, a work machine with the credential store locked down by policy, a
browser profile in a kiosk.

## 6. Sessions

### 6.1 The Device token

- **Opaque, 32 random bytes, base64url, `foe_`-prefixed** (the prefix makes the
  string recognisable to secret scanners and to a human reading a log by
  accident). Not a JWT: there is one server and one database, so a self-contained
  token would buy nothing and cost instant revocability.
- Sent as `Authorization: Bearer foe_…` on every API call. **Never a cookie** —
  which is what removes CSRF from the threat model entirely and avoids
  cross-subdomain cookie rules between `app.` and `api.`.
- Stored **hashed (SHA-256) server-side**. A plain fast hash is right here: the
  token is 256 bits of uniform randomness, so there is nothing to brute-force and
  nothing that a slow KDF would protect (unlike a password).
- Stored **client-side in IndexedDB**, in an `auth` store beside the op log
  (§7.4 is honest about what that costs).

### 6.2 Lifetime and revocation

- **Sliding expiry: valid until one year after last use.** A Device in weekly use
  never expires; one abandoned for a year falls out by itself. The refresh write
  is **throttled to at most once a day** per Device, so the common sync request
  stays read-only.
- **Revocation is immediate and server-side** — a revoked Device fails at its
  very next request. Sources: the Device signs itself out; another Device signs
  it out (story 30); a Quartermaster disables the whole Login (story 28).
- **A revoked Device that is offline keeps working locally until it next reaches
  the server.** That is inherent to offline-first and is stated in the UI rather
  than pretended away: revocation protects the *account*, the local wipe protects
  the *data on that device*, and only one of the two can be done remotely.

### 6.3 Managing credentials and devices

Under Account, a Login can: add a passkey on the current Device
(`/auth/passkeys/options` + `/verify`, same ceremony as §3.5 but authenticated
and appending to an existing Login); rename or remove a passkey — removing the
last one is allowed but warned about, since it drops the Login to the
device-link-only mode of §5 rather than locking it out; see all
Devices with a coarse label derived from the User-Agent (`Firefox on Android`)
and a `last seen`; sign out any of them; issue a device link for itself; and
issue or revoke Invites for other People.

## 7. Client

### 7.1 Routes and states

Three auth-relevant app states, all served by the same precached shell:

| State | Route | Notes |
| --- | --- | --- |
| Signed out | `/signin` | One button. Loads offline; the ceremony itself needs the network, and says so |
| Redeeming | `/join#<secret>` | Confirmation screen; single deliberate POST; falls through to token-only (§5) |
| Signed in | the app | Auth invisible; only Account exposes it |

### 7.2 The 401 contract

A single place in the sync client interprets `401`:

1. Mark the session invalid and route to `/signin`.
2. **Keep the op log and the outbox untouched.** Queued ops authored offline are
   the user's work and are not auth's to discard (story 26).
3. On a successful re-sign-in **as the same Login**, resume and flush the outbox.
4. On a successful sign-in as a **different Household**, wipe local IndexedDB
   **first**, then bootstrap the new one. This is the one place data is dropped,
   and it is dropped because keeping it would leak one Household's records onto
   another's screen.

Case 4 has an ugly corner worth naming: unsynced ops belonging to the previous
Household are lost by that wipe. The UI therefore warns explicitly when an
outbox is non-empty, both here and on local sign-out (story 30).

### 7.3 Offline behaviour

Auth never gates local work — reads, edits, packing, and search run entirely
against local state with no token check. The token is consulted only when the
sync client talks to the API. There is **no app lock and no periodic re-verify**:
the device's own lock screen is the boundary, which keeps the offline promise
absolute and avoids a re-auth prompt that would be impossible to satisfy on the
devices of §5.

### 7.4 Where the token lives, honestly

IndexedDB is readable by any JavaScript running on the origin, so **an XSS on
`app.foerier.app` means token theft.** The alternative — an `httpOnly` cookie —
is worse *here*: `app.` → `api.` is cross-origin, so the cookie would need
`SameSite=None` plus credentialed CORS, reintroducing CSRF and cookie-domain
complexity to defend against a vector we close by other means. The mitigations we
actually rely on are structural: a strict CSP with no inline script (§8.2), **no
third-party JavaScript at all** (self-hosted fonts, no CDN, no analytics, no
tag manager), React's default escaping with no `dangerouslySetInnerHTML`, and
per-Device revocation to bound any theft that does happen. The trade is recorded
here rather than left implicit.

## 8. The web surface

### 8.1 Origins and the relying party

| Origin | Serves | Auth role |
| --- | --- | --- |
| `foerier.app` | landing (GitHub Pages) | none — no auth, no household data |
| `app.foerier.app` | the PWA (Caddy, static) | the only origin WebAuthn accepts |
| `api.foerier.app` | Hono (Caddy reverse proxy) | verifies everything |

**RP ID `foerier.app`** — the registrable parent, so credentials remain valid
across `app.`, `api.`, and any future subdomain. It is baked into every
credential and cannot be changed without invalidating all of them, which is why
the architecture spec pinned it before any code existed.

**Verified origin allowlist:** `https://app.foerier.app` in production, plus
`http://localhost:5173` in development only (WebAuthn permits `localhost` over
plain HTTP as a special case). The allowlist is config, not a wildcard, and the
production value is asserted by a Tier 4 contract test against the real deployed
server (see [testing.md](testing.md)) — a wrong RP origin in production is
precisely the class of bug that only the real box can catch.

### 8.2 Response headers

On `app.foerier.app`, set by Caddy:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self' https://api.foerier.app;
  manifest-src 'self';
  worker-src 'self';
  frame-ancestors 'none';
  base-uri 'none';
  form-action 'none';
  object-src 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: publickey-credentials-create=(self),
                    publickey-credentials-get=(self),
                    camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
```

Notes that make this stick:

- **No `unsafe-inline`, no hashes, no nonces** — the build must emit zero inline
  script and zero inline style. Concretely: register the service worker **from
  app code**, not from `vite-plugin-pwa`'s inline snippet, and keep theme
  bootstrapping in the stylesheet rather than an inline `<script>`. This is
  affordable only because the frontend design already self-hosts fonts and ships
  no third-party JS; the CSP is the enforcement of a rule we hold anyway.
- **`frame-ancestors 'none'`** — the sign-in screen cannot be framed, which
  removes clickjacking against the WebAuthn button.
- **`Referrer-Policy: no-referrer`** — belt to the fragment's braces on Invite
  secrets.
- `require-trusted-types-for 'script'` is deferred, not rejected (§11).

On `api.foerier.app`:

```
Cache-Control: no-store
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Resource-Policy: same-site
```

The landing site cannot set headers on GitHub Pages; it carries a `<meta
http-equiv="Content-Security-Policy">` with the same shape minus
`connect-src api.` — it never talks to the API, holds no token, and shows
synthetic demo data only.

### 8.3 CORS

`app.` → `api.` is cross-origin, so the API answers with an explicit allowlist
echo — **never `*`**, and never a reflected arbitrary `Origin`:

```
Access-Control-Allow-Origin: https://app.foerier.app
Vary: Origin
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: 86400
```

**`Access-Control-Allow-Credentials` is deliberately absent** — there are no
cookies to send. A request without a valid `Authorization` header is anonymous no
matter which page issued it, which is the property that makes CSRF a non-issue
rather than a mitigated risk.

### 8.4 Caching and the service worker

- Every API response is `no-store`; the service worker uses **NetworkOnly** for
  `api.foerier.app` and never places auth traffic in a cache.
- The precache holds the shell only. Navigation fallback serves the shell for
  `/signin` and `/join` so a cold, offline, or freshly-installed client resolves
  those routes.
- No token, Invite secret, or challenge is ever written to a Cache Storage entry.

## 9. Server

### 9.1 Endpoints

All under `/api/v1`, replacing the three placeholders in the architecture spec.
Marked **A** = requires a valid Device token.

**What exists as of S3.5:** everything below except `GET /auth/logins` and
`DELETE /auth/logins/:id`, which are story 28's and wait for S5. `POST
/auth/invites` accepts only `purpose: "device"` until then — a join Invite must
name a Person, and there is no way to pick one before S4 records People.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/join/preview` | describe an Invite (household name, expiry) so the join screen can ask before anything is agreed to. Consumes nothing |
| POST | `/auth/register/options` | validate a join Invite, return creation options |
| POST | `/auth/register/verify` | create Login + credential + Device, consume Invite |
| POST | `/auth/login/options` | return username-less request options |
| POST | `/auth/login/verify` | verify assertion, issue a Device token |
| POST | `/auth/device/claim` | redeem **either** Invite kind for a token **without** a credential (§5) — a device Invite signs its Login in; a join Invite creates the Login first, exactly as `register/verify` would, minus the credential |
| GET | `/auth/me` | **A** — Login id, `person_id`, `household_id`, `household_name`, current Device |
| POST | `/auth/signout` | **A** — revoke the calling Device |
| GET | `/auth/devices` | **A** — list this Login's Devices |
| DELETE | `/auth/devices/:id` | **A** — revoke one Device of this Login |
| POST | `/auth/passkeys/options` | **A** — creation options for an additional passkey |
| POST | `/auth/passkeys/verify` | **A** — attach it to the calling Login |
| GET · DELETE | `/auth/passkeys` · `/:id` | **A** — list / remove a passkey |
| POST | `/auth/invites` | **A** — issue a join or device Invite for a `person_id` |
| GET · DELETE | `/auth/invites` · `/:id` | **A** — list outstanding / revoke |
| GET | `/auth/logins` | **A** — which People in the Household hold a Login |
| DELETE | `/auth/logins/:id` | **A** — disable another Login and all its Devices |

`POST /sync/push`, `GET /sync/pull`, and `GET /version` are unchanged;
`/version` stays unauthenticated.

### 9.2 Tables

New and purely additive — no existing shape changes, so the expand-contract rule
is satisfied trivially.

| Table | Columns (essentials) |
| --- | --- |
| `household` | `id`, `name`, `created_at` |
| `login` | `id`, `household_id` →`household`, `person_id` (opaque UUID, §2.1), `created_at`, `disabled_at`; unique `(household_id, person_id)` |
| `passkey` | `id`, `login_id` →`login`, `credential_id` (bytea, unique), `public_key`, `sign_count`, `transports`, `aaguid`, `uv_seen`, `label`, `created_at`, `last_used_at` |
| `device` | `id`, `login_id`, `household_id`, `token_hash` (bytea, unique), `label`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at` |
| `invite` | `id`, `household_id`, `person_id`, `purpose` (`join`\|`device`), `secret_hash` (bytea, unique), `login_id` (device Invites only), `created_by_login`, `expires_at`, `used_at`, `revoked_at` |
| `webauthn_challenge` | `id`, `challenge` (bytea, unique), `purpose`, `login_id` (nullable), `expires_at`, `consumed_at` |

`device.household_id` is denormalised so the auth middleware resolves a request
in **one indexed lookup**. Challenges live 5 minutes and are consumed on use;
expired rows are deleted lazily on write rather than by a cron job.

The table is **`passkey`**, not `credential` — one word means one thing in this
repo, and Passkey is the word the glossary, the stories, and every screen use.
The *column* stays `credential_id`, because that one is WebAuthn's own term for
the value it holds. (There is a practical bonus: TypeScript's DOM library
already declares a global `Credential`, which a domain type of that name would
shadow.)

### 9.3 Auth middleware and tenancy

One middleware in front of every authenticated route:

```
Bearer token → SHA-256 → device by token_hash
  → reject if missing, revoked, expired, or its Login is disabled
  → context = { deviceId, loginId, householdId }
  → last_seen_at refreshed at most once per day
```

**The tenancy rule, which the whole sell-later story rests on:** every handler
takes `household_id` from that context and **never** from the request body, the
query string, or a header. A pushed op whose `household_id` disagrees with the
context is rejected outright rather than silently rewritten — silence would hide
a client bug that is indistinguishable from an attack. This is the property the
dedicated multi-household isolation test in [testing.md](testing.md) exists to
protect.

### 9.4 Rate limits, logging, and errors

- **Rate limits** on the unauthenticated auth endpoints, per IP: a coarse token
  bucket (order of 30/min) sized to protect the box, not to substitute for the
  256-bit secrets. In-memory is correct while there is one server instance; if
  that ever changes, the bucket moves to Postgres. `/sync/*` gets a separate,
  much higher limit, since a returning offline client legitimately bursts.
- **Never logged:** tokens, token hashes, Invite secrets, challenges, public
  keys. Auth events *are* logged — outcome, `login_id`, `device_id`, coarse UA,
  timestamp — because that is what makes "last seen" and after-the-fact
  questions answerable. IP is logged by Caddy already and not duplicated.
- **Errors are deliberately vague to the client and precise in the log.** An
  Invite that is unknown, expired, used, or revoked returns one indistinguishable
  response; so does a failed assertion. There is no username enumeration surface
  because there are no usernames.

## 10. Threat model — and what we accept

| Threat | Answer |
| --- | --- |
| Password reuse / credential stuffing | No passwords exist |
| Phishing a sign-in | WebAuthn binds the assertion to `foerier.app`; a look-alike origin gets nothing usable |
| Server database breach | No passwords; tokens and Invite secrets stored hashed; public keys are public by nature |
| CSRF | No cookies; a bearer header is never attached by the browser on a cross-site request |
| Clickjacking | `frame-ancestors 'none'` |
| Invite interception | Single-use, short-lived, fragment-carried, consumed only by a deliberate POST |
| Cross-household read | `household_id` from the token only; isolation test at Tier 2s |
| Lost/stolen device | Remote per-Device revocation; local wipe on sign-out |
| Brute-forced secrets | 256-bit random Invites and tokens; coarse IP limits as box protection |
| **XSS on `app.`** | **Accepted residual risk**, bounded by strict CSP, zero third-party JS, and revocation (§7.4) |
| **A revoked device that stays offline** | **Accepted** — inherent to offline-first; stated in the UI, not hidden (§6.2) |
| **Malware on a signed-in device** | **Out of scope** — the device's own lock screen is the boundary (§7.3) |
| **A Household member turning hostile** | **Out of scope** — Quartermasters are equal and trusted by design; the domain has no permissions |

## 11. Deferred — named so they are not built ahead of need

- **Passwords.** Considered and rejected for the MVP: §5's Device link already
  covers the compatibility case that motivated them, and a password would add a
  hashing scheme, a breach-relevant table, a handle, lockout logic, and a reset
  story — for a mechanism whose recovery path would be the same social re-invite.
  Revisit only if Device links prove insufficient in practice.
- **A recovery code** — the shape a second credential should take *if* one is
  ever needed, recorded here so it is not re-derived from scratch. The Device
  link leaves exactly one real gap: a Login holding no passkey that has lost
  every session needs another Quartermaster, or the Maintainer. A single
  256-bit secret per Login, shown once, stored in whatever password manager the
  household already keeps, redeemed through `device/claim`'s **existing** path
  and rotated on use, closes that gap while adding none of the machinery the
  bullet above rejects — no hashing scheme beyond the `invite` table's, no
  lockout, no reset story, no mail. Its honest cost is that it is phishable in
  a way a passkey is not, which is tolerable for a path used once a year and
  intolerable as a daily one. **Not built and not written as a story**, because
  with two Quartermasters and a Maintainer who is one of them the gap is not
  reachable. The household that first reaches it should write it as a story and
  take the next unused number.
- **Email.** Nothing sends mail. Would be a prerequisite for password reset and
  for delivering Invites in-product.
- **App-level lock / re-verify on open** — rejected for now (§7.3); would be
  inconsistent across devices that cannot perform user verification.
- **Trusted Types** (`require-trusted-types-for 'script'`) — a real hardening
  step beyond CSP; deferred until the React tooling story is boring.
- **Step-up auth for destructive acts** (re-verify before disabling another
  Login) — cheap to add later, unnecessary between two trusted adults.
- **A visible audit trail** of auth events, beyond `last seen` per Device.
- **Hardware security keys as a first-class path** — they already work as
  ordinary passkeys; nothing special is built for them.
- **Sub-Household roles / read-only members** — the domain has one role by
  design; the [share link](user-stories.md) covers outsiders.

## 12. Testing

Slots into the existing tiers in [testing.md](testing.md) rather than inventing
a new one:

- **Unit (`shared`/`api`)** — Invite state machine (fresh · used · expired ·
  revoked), token hashing, sliding-expiry throttle, sign-counter rules including
  the legitimate `0/0` case, label derivation.
- **Tier 2s, server integration** — full register and login ceremonies against
  `@simplewebauthn`'s test authenticator; the token-only `device/claim` path; a
  revoked Device receiving `401`; an Invite refusing its second use; and the
  **multi-household isolation** test, which must also cover "Household A's token
  cannot push ops carrying Household B's id".
- **Tier 4, contract** — against the real deployed box: the RP origin and RP ID
  are what production actually serves, Caddy passes the `Authorization` header
  through unmangled, CORS answers exactly one origin, and the security headers
  above are present on both hosts.
- **Tier 5, e2e** — Playwright's virtual authenticator (CDP `WebAuthn` domain)
  for join → sign in → add a second passkey → sign out remotely; plus the
  offline-critical case: **queued ops survive a 401 and flush after
  re-sign-in.**

## 13. Delivery

Auth is the first vertical slice, in front of story 1 — the architecture spec's
"first usable slice: auth + add-gear + find-gear". Ordered so each commit leaves
something usable:

1. **Bootstrap + join + sign in** (stories 26, 27) — the Maintainer script, the
   two ceremonies, the token, the middleware, tenancy scoping. At this point one
   Quartermaster can be in the app.
2. **Invite another Person** (story 28) — issuing Invites in-app, the Logins
   list, disabling a Login.
3. **Second Device, including the passkey-less path** (story 29) — device
   Invites, `device/claim`, add-a-passkey.
4. **Device management** (story 30) — the list, remote sign-out, local sign-out
   with the unsynced-work warning.

Story 31 is not a slice; it is a property that each of the four must preserve,
and it is enforced by the isolation tests rather than by a screen.

**Interleaving with the domain slices.** The
[architecture spec §8](architecture-design.md#8-the-slice-plan) places these four
inside the full MVP order and makes one correction to the list above: **slice 2
cannot precede story 4**, because it issues Invites for People *recorded* in the
Household. It therefore lands after the People slice. Nothing is lost — slice 1
already admits a second Quartermaster on a Maintainer-minted Invite (§3.4); only
in-app issuance waits. Slices 3 and 4 introduce no ops and touch `shared/` not at
all, so they float and may be built alongside any domain slice.

**What actually happened: slices 3 and 4 landed together, as S3.5, ahead of
slice 2 and ahead of the People slice.** Three reasons, and only the third
forced it. They are free to move — that is the float above. Four settled
affordances were queued behind the Account screen that slice 4 builds
([architecture §12.6](architecture-design.md#126-consequences-of-the-r3-shell-round)).
And the maintainer's own phone could not sign in at all until §5's Device link
existed, which makes the compatibility floor the difference between a working
product and a demo. Two things rode along that slice 1 should arguably have
carried: a **`admin:invite`** script, because §3.4's "only the first Login is
arranged out of band" left the *second* Login with no route at all before slice
2 exists; and a fix to the way the join screen learned whether the joiner names
themselves, which had been inferred from "does this Household have any Login"
and was therefore correct for exactly one Person per Household. See
[`docs/specs/2026-08-28-auth-device-links.md`](specs/2026-08-28-auth-device-links.md)
§4 and §5.

## 14. What this document does not settle

- **Screens.** Closed. The follow-up pass over the design boards landed:
  [`docs/design/Screens C - Auth + Account.dc.html`](design/) is the full auth
  and account surface, and [`docs/design/README.md`](design/README.md) §§8–13
  document sign-in, join, the passkey-less path, Account, Devices, and People
  & logins.
- Exact wording of the auth screens, in the design system's strict-ledger voice.
- The precise Device label taxonomy derived from the User-Agent.
- Whether `userVerification` is later tightened to `required` (§4) — a policy
  change, deliberately not a migration.
