# CLAUDE.md

Guidance for working in this repository.

## What foerier is

A quartermaster's tool for a household's shared outdoor gear: a year-round
inventory of what is owned and where it lives, plus the outfitting and packing
of individual trips from that depot. See [README.md](README.md) for the full
framing, [docs/user-stories.md](docs/user-stories.md) for the requirements, and
[docs/ubiquitous-language.md](docs/ubiquitous-language.md) +
[docs/domain-model.md](docs/domain-model.md) for the domain design.

## Current status

Pre-code, architecture decided. The repo holds requirements plus a DDD domain
design — a [ubiquitous language](docs/ubiquitous-language.md) (the glossary) and
a conceptual, persistence-ignorant [domain model](docs/domain-model.md)
(aggregates, invariants, the two worlds of home and trip) — and now an approved
[architecture & delivery design](docs/architecture-design.md)
that settles the two formerly-open decisions:

1. **Persistence** — a per-aggregate **operation log** in Postgres; state is a
   fold of ops; per-field last-writer-wins by Hybrid Logical Clock.
2. **Tech stack** — offline-first React PWA (Vite + TypeScript) with an
   in-memory op-log store; **Hono + Kysely + Postgres** server; WebAuthn/passkey
   auth; one monorepo on the existing Hetzner box. See the spec for the full
   picture and [`docs/testing.md`](docs/testing.md) for the test strategy.

The op log itself is now specified as a concrete contract in
[`docs/sync-protocol.md`](docs/sync-protocol.md) — envelope, HLC, merge rules,
the full MVP op catalogue, and the `/sync` wire format.

**The conceptual domain docs stay persistence-ignorant.** The schema and stack
live in the architecture spec, and only there — do not smuggle tables, fields,
or framework choices into the [model](docs/domain-model.md),
[language](docs/ubiquitous-language.md), [stories](docs/user-stories.md), or
`examples/`. Extend the domain model deliberately and keep it conceptual.

## Design docs

- [`docs/ubiquitous-language.md`](docs/ubiquitous-language.md) — the glossary;
  each term means exactly one thing. Use these words, capitalised, in the user
  stories.
- [`docs/domain-model.md`](docs/domain-model.md) — the structure: aggregates,
  relationships, invariants, domain operations. Conceptual only.
- [`docs/architecture-design.md`](docs/architecture-design.md)
  — the persistence, stack, sync, auth, hosting, and delivery design. Where all
  the technical choices live.
- [`docs/sync-protocol.md`](docs/sync-protocol.md) — one level below the
  architecture: the op envelope, the HLC, conflict resolution, the **MVP op
  catalogue**, the evolution rules, the `/sync` wire format, and first-sync
  bootstrap. The contract every vertical slice is cut from, and the one interface
  that must stay forward-compatible forever.
- [`docs/frontend-design.md`](docs/frontend-design.md) — one level below the
  architecture: scaling, responsive system, CSS architecture, `ui/` package,
  resilience.
- [`docs/auth-design.md`](docs/auth-design.md) — one level below the
  architecture: enrolment, sign-in, sessions, devices, and the whole HTTP
  security surface (headers, CORS, CSP, endpoints, tables). Supersedes the
  architecture spec's §6 summary.
- [`docs/design/`](docs/design/) — the Claude Design boards (`*.dc.html`): visual
  foundations, flows, components, screens. Design intent; `frontend-design.md` is
  how it gets built.
- [`docs/testing.md`](docs/testing.md) — the permanent testing strategy (the
  seven-tier pyramid; the convergence tier is the signature).

Keep the design docs — stories, language, model — mutually consistent. A new or
changed concept updates the language and the model together, and the stories
adopt the term.

## Delivery model

Build in **vertical slices via XP-style continuous delivery.** Each story ships
end-to-end (server + app) as an independently valuable increment; stories are
ordered so every release gives the user something immediately usable, however
thin. No waterfall gate. A slice is naturally new op type(s) + reducer +
selector + endpoint + UI, and lands in **one atomic commit** (it is one
monorepo).

A slice's op types come from the catalogue in
[`docs/sync-protocol.md`](docs/sync-protocol.md) §4; new ones follow its naming
and evolution rules (§5).

This coexists with offline-first only under one **non-negotiable discipline:**
installed PWA clients run older app versions in the wild and may hold ops queued
offline against a previous version. So **never make a breaking lockstep change.**

- **Expand-contract migrations** — add the new shape, deploy readers tolerant of
  both, backfill, drop the old only much later.
- **Tolerant-reader, additive ops** — new fields optional; unknown fields and op
  types ignored, never rejected.

Versioning follows suit: deployables are versioned by **commit SHA** (not
semver); the API contract carries **one major in the path** (`/api/v1`), bumped
only on a genuine break; semver is reserved for the contract, not sprayed across
artifacts with no external consumer.

## Working conventions

- **Keep the stories at problem level.** User stories describe needs and
  behaviour, not representations; the domain design lives in its own docs. When
  tempted to write a _story_ in terms of tables, fields, screens, or objects,
  stop — frame it as a user need instead. The domain model may name aggregates
  and invariants, but it too stays conceptual: no tables, fields, or storage —
  that is persistence modeling, still a separate, later phase.
- **Challenge with reasoning; concede to evidence.** Push back on assumptions
  when warranted rather than validating by default, but update when the
  maintainer shows real-world evidence.
- **English** for all repository content.
- **Scope tags matter.** Stories are tagged MVP / Later / Out of scope. Respect
  the boundary; don't quietly promote Later work into MVP.
- **Never renumber user stories.** A story's number is a **stable identifier**,
  assigned once, never reused and never reshuffled — renumbering would break
  every cross-reference in the docs and in git history, forever, each time a
  story is added. A new story takes the **next unused number** and is placed
  where it belongs by topic and scope: story 26 may sit inside MVP between
  stories 2 and 3. The backlog's numbers are not a sequence and the document's
  order is the reading order. Deleting a story retires its number rather than
  freeing it.
- **Doc paths: no `spec`/`specs` directory, and no date prefixes on durable,
  generic docs.** A durable design doc lives flat in `docs/`, named for what it
  is — `docs/architecture-design.md`, not `docs/specs/2026-08-20-architecture-design.md`.
  (Same rule as the sibling repos.)

## Requirements process

New requirements go through brainstorming before they are written down, and land
in `docs/user-stories.md` as problem-level stories with testable acceptance
criteria and a scope tag. Unresolved points belong in that file's "Open
questions" section, not resolved by guesswork.

## `examples/` (gitignored)

The `examples/` directory holds private exports of the real spreadsheets this
app replaces. It is gitignored and must never be committed — it contains
personal data. Treat it as evidence of real workflows, not as seed data or a
schema source. Note that the original sheets encoded packing status as cell
colors, which did not survive export, so the files understate the real process.
