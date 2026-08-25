#!/usr/bin/env node

/**
 * Assert that every `@foerier/*` workspace is linked inside *this* working
 * tree.
 *
 * ## The failure this exists to make loud
 *
 * `git worktree add` creates a checkout with no `node_modules`. Node's
 * resolver then walks *up* from the worktree until it finds one — which, for a
 * worktree under `.claude/worktrees/`, is the main checkout's. There
 * `node_modules/@foerier/shared` is a symlink to `../../shared`, resolving to
 * the **main checkout's** source.
 *
 * So a worktree with no install of its own compiles, tests, and runs against
 * the wrong source tree. It does not error. `shared/src/index.ts` is edited in
 * the worktree, `api/` and `app/` import the main checkout's copy, and every
 * green test is green about code nobody changed. An export added in the
 * worktree appears missing; behaviour changed in the worktree appears not to
 * have changed. Both read as ordinary bugs, and the hours go into the wrong
 * file.
 *
 * There is no way to make npm workspaces link into a worktree without
 * installing there, so this cannot prevent the mistake — it converts a silent
 * wrong answer into an immediate one that names its own fix. It runs in
 * Tier 0, before anything expensive, in the pre-commit hook and in CI.
 *
 * It checks the **link**, not importability: `api` and `app` are private
 * packages with no `exports` field, so `require.resolve` throws for them even
 * when they are linked perfectly.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Canonicalised, because the comparison below is against `realpathSync` of a
 * symlink and the two must be canonicalised the same way. A checkout reached
 * through a symlink anywhere in its path — macOS `/tmp` → `/private/tmp`, a
 * symlinked home directory, some CI layouts — would otherwise compare unequal
 * to itself, and this guard would block every commit with a message saying
 * the opposite of what was wrong.
 */
const root = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..'),
)

const { workspaces } = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
)

const problems = []

for (const workspace of workspaces) {
  const manifest = resolve(root, workspace, 'package.json')
  if (!existsSync(manifest)) continue

  const { name } = JSON.parse(readFileSync(manifest, 'utf8'))
  const link = resolve(root, 'node_modules', name)

  if (!existsSync(link)) {
    problems.push(
      `  ${name} — not linked here; Node will walk up and find another checkout`,
    )
    continue
  }

  // One comparison covers every way this can be wrong. `expected` is by
  // construction inside this tree, so anything the link actually points at —
  // another checkout, a stale copy, the wrong workspace — fails here, and the
  // message names where it went.
  const target = realpathSync(link)
  const expected = resolve(root, workspace)
  if (target !== expected) {
    problems.push(`  ${name} → ${target}`)
  }
}

if (problems.length > 0) {
  process.stderr.write(
    [
      '',
      `Workspace packages are not linked inside this working tree:`,
      `  ${root}`,
      '',
      ...problems,
      '',
      "Everything here would compile and test against another checkout's",
      'source instead of this one, silently.',
      '',
      'Fix: run `npm ci` in this directory.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}
