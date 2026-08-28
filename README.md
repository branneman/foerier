# Foerier

_Foerier_ is Dutch for the quartermaster who runs a gear depot and issues
equipment for a mission. That is what this app is: a home for a household's
shared outdoor gear — the year-round inventory of what we own and where it
lives, and the outfitting of each trip from that depot.

It is a personal tool for people who plan and pack, plus whoever joins a trip.
It replaces the sheets and docs we have tended for years.

## The problem

We own a lot of outdoor gear and take very different trips with it: multi-day
hüttentours, multi-week basecamp camping holidays, ski trips, solo ultralight
weekends. A few realities make this hard to manage in spreadsheets:

- **We never take all the gear.** Every trip is a different subset of the
  depot.
- **We don't always take all the people.** A solo trip takes one person's gear
  plus a slice of the shared pool; gear of whoever stays home is irrelevant.
- **Conditions change what we bring.** Expected weather decides whether the
  tarp, the extra chair, or the warmer bag comes along.
- **Everything lives somewhere and gets packed into something.** Gear has a
  home — a shelf in the attic, a stuff sack inside a bigger bag — and on a trip
  it sits in a specific crate, duffel, or backpack. "Where is it?" needs an
  answer in both worlds.
- **Packing is a multi-day journey.** Containers move from attic to a staging
  spot in the living room, get filled over days, then go into the car. The
  administration has to stay trustworthy through every stage.

The inventory is not a nice-to-have we hope to keep up: we already keep it
accurate year-round, because with this amount of gear it is unmaintainable any
other way. The spreadsheets prove the habit; they're just the wrong tool for
it — the structure (locations, statuses, people, containers) lives in color
codes and column conventions only we can read.

## Why not an existing app

LighterPack, Packstack, Carryless, and their kin are built for the solo
ultralight hiker: one person, one pack, grams first. Generic packing-checklist
apps are flat lists with checkboxes. None of them combine a **shared gear
pool**, **per-person assignment**, **container tracking**, and **reusable
trip templates** — and that combination is the whole point here.

## Core concepts

A quick tour in prose. The precise, single-meaning terms are the project's
[ubiquitous language](docs/ubiquitous-language.md), and the structure behind them
— aggregates, invariants, the two worlds of home and trip — is the
[domain model](docs/domain-model.md).

- **Gear** — anything we own, whether a plain item or a container. Each piece has
  a home; some of it is one person's (boots, sleeping bag), the rest is the
  shared pool (tent, stove).
- **People** — the household. Trips take a subset of us; some gear is per person,
  and packing tracks whose piece is whose.
- **Containers and places** — a place is a fixed storage spot; a container is
  gear that can hold other gear, nested to any depth (a stuff sack inside the
  duffel in the attic). During a trip, gear leaves its home and travels inside a
  specific container — a second, independent world from where it lives at home.
- **Trips** — a named undertaking with participants, a gear list drawn from the
  depot, quantities, packing progress, and pre-trip tasks. Past trips are kept
  and serve as templates for the next similar one.

Requirements live in [docs/user-stories.md](docs/user-stories.md).

## What foerier is not

- **Not a gram-counter.** Weight tracking may come later, as a supporting
  attribute — it is never the point.
- **No route planning.**
- **No campsite or hut booking.**
- **No weather data.** Judging conditions happens in weather apps and with
  local knowledge; foerier only carries the consequences ("if rain: tarp").
- **No social features.** No accounts for friends, no sharing, no lending
  administration.

## Development

**Everything in this section runs on your own machine, against the local
Postgres.** The one task that has a production counterpart — minting the first
Login of a Household — says so explicitly and shows both. Nothing else here
touches a deployed environment, and no command in this repository can: where
foerier runs is a separate repository's business (see
[Deployment](#deployment)).

Requires Node — the version in [`.nvmrc`](.nvmrc) — and Docker for the local
database.

```
npm install
docker compose -f docker-compose.dev.yml up -d   # Postgres on :5433
npm run db:setup                                 # creates foerier_dev if needed
npm run migrate
```

Then, in two terminals:

```
npm run dev              # the PWA on :5173
npm run dev:api          # the server on :8080
```

Outside production the server defaults to the database
`docker-compose.dev.yml` creates, so none of these need `DATABASE_URL` set.
Export it to point somewhere else; in a container it is required and its
absence is a refusal to boot.

### Getting into the app

There is no public sign-up — deliberately, since that removes the abuse
surface rather than mitigating it ([auth-design](docs/auth-design.md) §3). The
first Login of a Household is minted out of band by the **Maintainer**, who is
not a role in the product but simply whoever has server access (§3.4). Every
Invite after that is issued by a Quartermaster from inside the app.

**Locally** — writes to the `docker-compose.dev.yml` Postgres:

```
npm run admin:bootstrap -- --name "Veldkamp"
```

It prints a single-use join link at `http://localhost:5173`. Open it, name
yourself, and the browser's passkey prompt does the rest.

**In production** — the same script, shipped in the `foerier-api` image as a
second entrypoint and run *inside the deployed container*:

```
node dist/bootstrap.js --name "Veldkamp"
```

It prints a link at `https://app.foerier.app`. How you get a command into the
running container is the infrastructure repository's business, not this one's —
see [Deployment](#deployment).

Two reasons it lives in the image rather than being pointed at production from
a laptop. The database has no public port and is not meant to get one, so
in-container is the only place the script can reach it. And the origin it
prints is chosen by `NODE_ENV`, which the image already sets to `production` —
so running it there makes the link right by construction. A link minted against
the wrong origin does not fail as a bad URL; it fails as a passkey ceremony the
browser refuses for an RP ID mismatch, which reads like a bug in the app.

Either way the link is single-use, and each run creates a **new** Household —
so run it again for another rather than reusing one. Sign-out lives under
Account, which is a later slice; to test signing in again, delete the `foerier`
IndexedDB database in devtools and reload — the passkey stays in the browser.

The test tiers, from cheapest to most expensive
([strategy](docs/testing.md)). All but the last run entirely on your machine:

```
npm run typecheck && npm run lint && npm run format:check   # Tier 0
npm test               # Tiers 1-3: unit, convergence, component
npm run test:server    # Tier 2s: the real server on the local Postgres
npm run test:e2e       # Tier 5: Playwright, on a local production *build*
npm run test:contract  # Tier 4: the real DEPLOYED server — see below
```

Note which environment each targets, because two of them are easy to misread.
`test:e2e` runs a production *build* of the PWA on `localhost` — a build mode,
not a deployed environment. `test:contract` is the only command in this
repository that leaves your machine: it asserts against the live
`api.foerier.app` and `app.foerier.app`, because its whole charter is to prove
things a local database cannot surface — that the migrations ran *there*, that
the front door forwards the `Authorization` header, that the deployed process
serves the production relying party. Point it elsewhere with
`CONTRACT_API_URL` / `CONTRACT_APP_URL`.

It is safe to run against production: it authenticates nothing, needs no
Household, and writes nothing but a short-lived WebAuthn challenge row that the
next ceremony sweeps up. CI runs it automatically after every deploy, so
running it by hand is for diagnosing, not for gating.

Tier 0 also runs full-repo in a pre-commit hook — the same three commands, no
separate fast path.

### Layout

```
app/      the PWA: shell, screens, sync client        → ghcr.io/branneman/foerier-app
api/      Hono + Kysely + Postgres                    → ghcr.io/branneman/foerier-api
shared/   pure TypeScript: op types, reducer, HLC, selectors
ui/       presentational React components, tokens, self-hosted fonts
```

`shared/` is framework-free so the same merge logic runs in the app, in the
convergence tests, and on the server if it ever needs to. `ui/` never imports
the store.

### Deployment

Not here. Where foerier runs — the host, TLS, the front door, backups — belongs
to a separate infrastructure repository, so that no application repo knows
about another. That is why no hostname, container name or deploy command
appears anywhere above: this repository cannot deploy itself and is not
supposed to be able to.

Its entire obligation is to publish its two images to GHCR tagged `:latest` and
`:<commit-sha>`, listen on a documented port, run its own migrations at start,
and answer `GET /api/v1/version` with the commit it was built from. Pushing to
`main` does all of it; a commit touching only prose skips the build, since
there is no new image in it.

The `foerier-api` image carries two entrypoints:

```
node dist/index.js       # the server (the image's default command)
node dist/bootstrap.js   # the Maintainer bootstrap, run on demand
```

Both read their configuration from the environment and nothing else.

## Status

**Four slices in.** The monorepo, toolchain, test tiers and both container
images exist and are green (S0); a Quartermaster can join a Household from an
invite and sign in with a passkey (S1, stories 26, 27); and the Depot itself
is real (S2a + S2b, stories 1–3). The op log and its reducer, eleven op
types, and per-field last-writer-wins by Hybrid Logical Clock all ship, synced
through `POST /sync/push` and `GET /sync/pull`. On top of that: F1 Add Gear,
the Depot list, gear detail, F2 Find, whereabouts, and the join screen's
gated first-sync fold. A Quartermaster can record gear on a phone with no
signal, find it, and see where it lives.

Trips do not exist yet — that lands in S6 onward. Alongside the running code,
the repo contains requirements (user stories), a DDD domain design (the
[ubiquitous language](docs/ubiquitous-language.md) and
[domain model](docs/domain-model.md)), an approved
[architecture & delivery design](docs/architecture-design.md), and example
exports of the spreadsheets it will replace. The domain is modelled conceptually,
independent of storage; the persistence approach (a per-aggregate operation log
synced to Postgres) and the tech stack (an offline-first React PWA over a small
Hono + Postgres server) are now chosen — the technical detail lives in the
[architecture design](docs/architecture-design.md), with the op log and its sync
specified as a concrete contract in the
[sync protocol](docs/sync-protocol.md).
