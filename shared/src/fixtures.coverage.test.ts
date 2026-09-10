import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * **Every op type this build folds is pinned by a committed fixture, and
 * nothing said so until now.**
 *
 * The fixture shelf is the backward-compatibility tier
 * ([testing.md](../../docs/testing.md)): each `shared/fixtures/*.ops.json`
 * holds ops in the wire format a shipped build authored, replayed on every
 * push, so a slice that changes what an existing op type does to folded state
 * fails there first. [sync §5.4](../../docs/sync-protocol.md) is what makes
 * that binding — a shipped op type's format is frozen forever, because an
 * installed PWA may hold one queued offline against a previous version.
 *
 * **A per-slice suite cannot notice a slice that captured nothing**, and this
 * repo has already paid for that once. S4 shipped `person.renamed` and
 * `gear.ownership_set` under a spec sentence saying the fixture rule "applies
 * unchanged"; no file landed, and the two were pinned by nothing until S6
 * captured them a slice late. CLAUDE.md carries the general lesson — *a spec
 * sentence saying a standing rule applies produces no artefact, and no tier
 * notices its absence* — and this is that lesson made mechanical, on the
 * shape of `convergence.test.ts`'s own "generates every op type the reducer
 * folds".
 *
 * Coverage is complete as of the MVP's last slice: thirty-nine folded,
 * thirty-nine pinned. **The reason to write it down now is that the next op
 * type is the first one outside the MVP catalogue**, and it will arrive on a
 * branch where every per-slice fixture suite is green.
 *
 * `reduce.ts`'s dispatch table is the definition of *what this build folds*
 * and is deliberately not exported — "is this type known?" is the tolerant
 * reader's question, not a caller's — so this reads the table out of the
 * module's own source, the technique `convergence.test.ts` and
 * `drawnSizes.test.ts` already use for a fact that lives in a file rather
 * than in an export.
 */

const HERE = new URL('.', import.meta.url).pathname
const FIXTURES = join(HERE, '..', 'fixtures')

/** The op types `reduce.ts` has a handler for. */
function folded(): ReadonlySet<string> {
  const source = readFileSync(join(HERE, 'reduce.ts'), 'utf8')
  const table =
    /const handlers: Record<string, Handler> = \{\n([\s\S]*?)\n\}/.exec(
      source,
    )?.[1]
  expect(table).toBeDefined()
  return new Set(
    [...(table ?? '').matchAll(/^ {2}'([a-z_]+\.[a-z_]+)':/gm)].map(
      (match) => match[1]!,
    ),
  )
}

/** The op types the committed fixtures actually carry, by file. */
function captured(): ReadonlyMap<string, readonly string[]> {
  const byType = new Map<string, string[]>()
  for (const name of readdirSync(FIXTURES).filter((f) =>
    f.endsWith('.ops.json'),
  )) {
    const ops = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
      type: string
    }[]
    for (const op of ops) {
      byType.set(op.type, [...(byType.get(op.type) ?? []), name])
    }
  }
  return byType
}

describe('the fixture shelf', () => {
  it('pins every op type the reducer folds', () => {
    const unpinned = [...folded()].filter((type) => !captured().has(type))

    expect(unpinned).toEqual([])
  })

  /**
   * The mirror, and not symmetry for its own sake. A fixture carrying a type
   * no handler answers to means either a **retired** op type — which sync §5.2
   * forbids, a shipped type being frozen forever — or, far more likely, a
   * typo in a hand-edited capture, which would leave the type it *meant* to
   * pin silently unpinned while the file looks full.
   */
  it('carries no op type this build cannot fold', () => {
    const known = folded()
    const strays = [...captured().keys()].filter((type) => !known.has(type))

    expect(strays).toEqual([])
  })
})
