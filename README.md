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
- **Conditions change the load-out.** Expected weather decides whether the
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

In prose, deliberately — these are ideas, not a schema. The data model is
intentionally not designed yet.

- **Gear** — the items we own. Each has a home location; some of it is one
  person's (boots, sleeping bag), the rest is the shared pool (tent, stove).
- **People** — the household. Trips take a subset of us; some gear is per
  person, and packing tracks whose piece is whose.
- **Containers and places** — fixed storage spots and movable containers, which
  can hold other containers (a stuff sack inside the duffel in the attic).
  During a trip, gear leaves its home and travels inside a specific container.
- **Trips** — a named undertaking with participants, a gear selection drawn
  from the depot, quantities, packing progress, and pre-trip tasks. Past trips
  are kept and serve as templates for the next similar one.

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

## Status

Pre-code. The repo contains requirements (user stories) and example exports of
the spreadsheets it will replace. No tech stack chosen, no data model designed
— both deliberate, in that order.
