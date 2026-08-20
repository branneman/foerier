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

Pre-code. The repo holds requirements plus a DDD domain design: a
[ubiquitous language](docs/ubiquitous-language.md) (the glossary) and a
conceptual, persistence-ignorant [domain model](docs/domain-model.md)
(aggregates, invariants, the two worlds of home and trip). Two decisions remain
**deliberately open, in this order**:

1. **Persistence / storage schema** — not designed. The domain model says
   nothing about how state is stored.
2. **Tech stack** — not chosen.

Do not introduce either without an explicit decision from the maintainer, and do
not smuggle a storage schema or framework choice into docs, examples, or prose.
The conceptual domain model _is_ decided — it is the agreed vocabulary and
structure; extend it deliberately and keep it persistence-ignorant.

## Design docs

- [`docs/ubiquitous-language.md`](docs/ubiquitous-language.md) — the glossary;
  each term means exactly one thing. Use these words, capitalised, in the user
  stories.
- [`docs/domain-model.md`](docs/domain-model.md) — the structure: aggregates,
  relationships, invariants, domain operations. Conceptual only.

Keep the design docs — stories, language, model — mutually consistent. A new or
changed concept updates the language and the model together, and the stories
adopt the term.

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
