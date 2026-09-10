#!/usr/bin/env node

/**
 * Refuse a design-board edit that deletes an annotation.
 *
 * ## The failure this exists to make loud
 *
 * `docs/design/*.dc.html` comes out of Claude Design, and the five **living**
 * boards — `Foundations`, `Components`, and the three `Screens` — are re-opened
 * by every round. The per-round boards (`S9 Round …`, `S10 Round …`) are
 * written once and never re-edited, which is exactly why none of them has ever
 * lost anything.
 *
 * Since S9 the marks those rounds produced have been applied to the living
 * boards **in this repo, by hand** — twelve lines here, five there, two on
 * `Screens A`. Claude Design's own canvas never received them, so its first
 * re-export of those boards overwrote nine days of marks it had no way to know
 * existed: four retirement marks and two ruling-bearing lines the shipped app
 * implements, one of them replaced by `TAP A DOT = CYCLE THAT PERSON` — the
 * individual-circle target S8's ruling B exists to forbid.
 *
 * **It had happened twice before**, and the git log says so in its own commit
 * titles: *"Land the S7 bless/redraw round, and restore what its rewrite
 * dropped"* and *"Take the design round for S5 and S6, and put back what it
 * dropped"*. The first spells out the rule this script mechanises: *deletions
 * inside the rewritten section are evidence; deletions outside it are
 * suspects.*
 *
 * ## What it checks
 *
 * The **text** of every board in `docs/design`, tags stripped, compared
 * folder-wide against a base revision. Folder-wide because a string moving
 * between boards is not a loss; a string leaving the folder is.
 *
 * A loss fails the check when it carries an annotation — a retirement, a
 * supersession, a round pointer, a struck value's marker. Ordinary prose
 * churn is reported and allowed: a round genuinely rewrites copy, and a check
 * that fought that would be turned off within a week.
 *
 * ## What it cannot do
 *
 * It cannot tell a deliberate retirement from an accidental one. When a round
 * really does retire an annotation, this fails and the commit says why —
 * which is the point: the deletion becomes a sentence somebody wrote rather
 * than a diff nobody read.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'docs/design'
const base = process.argv[2] ?? 'HEAD'

/**
 * Phrases that make a lost string an **annotation** rather than prose.
 *
 * Each is a mark the boards use to say *this was decided, and here is where*:
 * a retirement, a supersession, a pointer into `README.md`'s ruling register
 * (`§5b G`, `§5n K24`, `S9 A15`, `ruling B4`), or the note a redraw leaves
 * behind. A board losing one of these is losing a decision.
 */
const ANNOTATION =
  /RETIRED|SUPERSEDED|Redrawn at|REDRAWN AT|Pixels kept|§5[a-z]?\s|\b[A-Z]?\d{1,2}\b\s*·|\bS\d+\s+A\d+\b|ROUND MARK|\(README §/

/** Tags out, entities left alone: a mark's text is what matters. */
function textOf(html) {
  return new Set(
    html
      .replace(/<[^>]*>/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 3),
  )
}

function boards() {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.dc.html'))
    .map((name) => join(DIR, name))
}

function atBase(path) {
  try {
    return execFileSync('git', ['show', `${base}:${path}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    // New board: nothing to lose.
    return ''
  }
}

const before = new Set()
const after = new Set()
for (const path of boards()) {
  for (const line of textOf(atBase(path))) before.add(line)
  for (const line of textOf(readFileSync(path, 'utf8'))) after.add(line)
}

const lost = [...before].filter((line) => !after.has(line))
const annotations = lost.filter((line) => ANNOTATION.test(line))

if (lost.length > 0) {
  console.log(
    `check-design-boards: ${lost.length} string(s) present in ${DIR} at ${base} are absent now.`,
  )
}

if (annotations.length === 0) {
  if (lost.length > 0) console.log('  None of them carries an annotation.')
  process.exit(0)
}

console.error(
  `\ncheck-design-boards: ${annotations.length} of those carry an annotation — a retirement, a supersession, or a pointer into README's ruling register:\n`,
)
for (const line of annotations.slice(0, 20)) {
  console.error(`  ${line.slice(0, 160)}`)
}
if (annotations.length > 20) {
  console.error(`  …and ${annotations.length - 20} more.`)
}
console.error(`
A board losing one of these is losing a decision. The usual cause is a
re-export from a canvas that never received the marks this repo applied by
hand — see this script's header.

If the retirement is deliberate, say so in the commit message and re-run with
the deletion explained. If it is not, take the marks onto the committed boards
rather than the other way round.
`)
process.exit(1)
