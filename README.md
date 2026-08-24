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

Requires Node — the version in [`.nvmrc`](.nvmrc) — and Docker for the local
database.

```
npm install
docker compose -f docker-compose.dev.yml up -d   # Postgres on :5433
npm run migrate --workspace api
```

Then:

```
npm run dev              # the PWA on :5173
npm run dev:api          # the server on :8080
```

The test tiers, from cheapest to most expensive
([strategy](docs/testing.md)):

```
npm run typecheck && npm run lint && npm run format:check   # Tier 0
npm test              # Tiers 1-3: unit, convergence, component
npm run test:server   # Tier 2s: needs the local Postgres above
npm run test:e2e      # Tier 5: Playwright, against a production build
```

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

Not here. Where foerier runs — the box, TLS, the front door, backups — belongs
to a separate infrastructure repository, so that no application repo knows
about another. This one's entire obligation is to publish its two images to
GHCR tagged `:latest` and `:<commit-sha>`, listen on a documented port, run its
own migrations at start, and answer `GET /api/v1/version` with the commit it
was built from.

## Status

**Walking skeleton.** The monorepo, toolchain, test tiers and both container
images exist and are green; there is no domain behaviour yet. Alongside that,
the repo contains requirements (user stories), a
DDD domain design (the [ubiquitous language](docs/ubiquitous-language.md) and
[domain model](docs/domain-model.md)), an approved
[architecture & delivery design](docs/architecture-design.md), and example
exports of the spreadsheets it will replace. The domain is modelled conceptually,
independent of storage; the persistence approach (a per-aggregate operation log
synced to Postgres) and the tech stack (an offline-first React PWA over a small
Hono + Postgres server) are now chosen — the technical detail lives in the
[architecture design](docs/architecture-design.md), with the op log and its sync
specified as a concrete contract in the
[sync protocol](docs/sync-protocol.md).
