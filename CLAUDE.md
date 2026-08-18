# CLAUDE.md

Guidance for working in this repository.

## What foerier is

A quartermaster's tool for a household's shared outdoor gear: a year-round
inventory of what is owned and where it lives, plus the outfitting and packing
of individual trips from that depot. See [README.md](README.md) for the full
framing and [docs/user-stories.md](docs/user-stories.md) for the requirements.

## Current status

Pre-code. The repo holds requirements only. Two decisions are **deliberately
open, in this order**:

1. **Data model** — not designed.
2. **Tech stack** — not chosen.

Do not introduce either without an explicit decision from the maintainer. Do
not smuggle a schema, entity model, or framework choice into docs, examples, or
prose.

## Working conventions

- **Stay at problem level.** User stories describe needs and behavior, not
  representations. When tempted to write a story or doc in terms of tables,
  fields, screens, or objects, stop — that is modeling, and modeling is a
  separate, later phase. Frame it as a user need instead.
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
