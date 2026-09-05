# S2 — The Depot: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship foerier's operation log, its merge engine, `/sync`, and the Depot
screens — replacing the spreadsheet's inventory tab — as two commits.

**Architecture:** State is the deterministic fold of an append-only op log.
Merge is per-field last-writer-wins on `(hlc, device_id)`, one rule, no
overrides. `shared/` holds the pure engine (HLC, registers, reducer,
selectors); `app/` holds the IndexedDB log, a Zustand store, and the
outbox/pull client; `api/` is a thin op store with no op vocabulary at all.

**Tech Stack:** TypeScript 5.9.2 (strict + `exactOptionalPropertyTypes` +
`noUncheckedIndexedAccess`), Vitest, React 19 + Vite + wouter + Zustand,
`idb`, Hono + Kysely + Postgres 17, `fast-check`, Playwright.

**Spec:** [`docs/specs/2026-08-25-depot-slice.md`](2026-08-25-depot-slice.md) —
**read it before Task 1.** This plan argues from it and does not restate its
reasoning. Where the two disagree, the spec wins and the plan is wrong.

## Global Constraints

Every task's requirements implicitly include all of these.

- **Relative imports in `api/` and `shared/` carry an explicit `.ts`
  extension.** `app/` and `ui/` do not (Vite resolves them). Getting this
  wrong fails at runtime, not at type-check.
- **Ops mirror the wire: `snake_case`, never transformed.** Folded state,
  selectors, and UI props are ordinary camelCase. The reducer is the only
  place the two meet.
- **`exactOptionalPropertyTypes` is on.** `name?: Register<string>` means the
  key may be absent but never holds `undefined`. Build objects by conditional
  spread (`...(x === undefined ? {} : { name: x })`), never by assigning
  `undefined`.
- **`noUncheckedIndexedAccess` is on.** `state.gear[id]` is
  `GearState | undefined`. Always narrow.
- **Prettier:** no semicolons, single quotes, 80 columns. Markdown is excluded
  — hand-wrap prose at 80.
- **Unused locals and parameters are ESLint's job, not `tsc`'s.**
- **Boundaries get real in-memory fakes, never mocking-framework mocks.** Never
  `vi.mock`; never `vi.fn()` standing in for an interface.
- **Never mutate a stored op.** The log is append-only; corrections are new
  ops; a re-push is byte-identical.
- **Tier 0 green before every commit:** `npm run typecheck && npm run lint &&
  npm run format:check`. The Husky hook runs it full-repo anyway.
- **Never invent an op type** outside [`sync-protocol.md`](../sync-protocol.md)
  §4. If a task seems to need one, the domain is wrong, not the catalogue.
- **Voice, in every user-visible string:** terse, factual, numeric. Sentence
  case for text, CAPS mono for labels. `3 left.` · `Offline. Saved on device.`
  Never `Almost there!`, never an exclamation mark, never an emoji.

## How this plan is calibrated

Tasks 1–14 (`shared/` and `api/` — the merge engine and the op store) carry
**complete code**: these are the crown jewels, they are pure, and precision
here is cheap. Tasks 15–22 (`app/` — screens and wiring) carry **complete
interfaces, complete test lists, and code for anything non-obvious**, but not
every line of JSX and CSS; follow the existing `SignIn.tsx` /
`SignIn.module.css` pair as the pattern and the design boards for the values.
That asymmetry is deliberate, not an omission.

## File Structure

**Created in S2a**

| File | Responsibility |
| --- | --- |
| `shared/src/hlc.ts` | Hybrid Logical Clock: format, parse, issue, receive, compare |
| `shared/src/registers.ts` | The LWW register and the one write rule |
| `shared/src/state.ts` | Folded-state shape (camelCase) |
| `shared/src/payloads.ts` | Validating accessors — the tolerant half of the reader |
| `shared/src/authoring.ts` | Typed op builders (snake_case) — the strict half |
| `shared/src/reduce.ts` | `emptyState` · `applyOp` · `fold` |
| `shared/src/selectors/containment.ts` | Effective holder, cycle break, home path |
| `shared/src/selectors/depot.ts` | `visibleGear`, `looseGear`, counts |
| `shared/testUtils/factories.ts` | `aPlace` · `aGear` · `anOp` |
| `shared/testUtils/replica.ts` | In-memory replica for the convergence tier |
| `shared/fixtures/s2-depot.ops.json` | Backward-compatibility fixture |
| `api/migrations/0003_op.ts` | `op` table + `household.op_seq` |
| `api/src/sync/envelope.ts` | Envelope validation, the closed rejection set |
| `api/src/sync/service.ts` | Push (seq allocation) and pull |
| `api/src/sync/routes.ts` | `POST /sync/push` · `GET /sync/pull` |
| `api/test/server/sync.test.ts` | Tier 2s, UUID registry slot #4 |
| `app/src/household/opLog.ts` | IndexedDB op log + in-memory fake |
| `app/src/household/transport.ts` | HTTP transport + in-memory fake |
| `app/src/household/syncEngine.ts` | Outbox, pull cursor, backoff, dead-letter |
| `app/src/household/store.ts` | Zustand store; `emit` is the one authoring path |
| `app/src/screens/Depot.tsx` | The Depot list |
| `app/src/screens/AddGear.tsx` | F1 |
| `app/src/screens/GearDetail.tsx` | Identity + action bar (S2a); cards in S2b |
| `app/src/components/HomePicker.tsx` | Place/container picker; Place create·rename·remove |

**Modified in S2a:** `shared/src/index.ts`, `shared/package.json`,
`api/src/db/schema.ts`, `api/src/db/migrations.ts`, `api/src/app.ts`,
`api/test/server/householdIsolation.test.ts`, `app/src/App.tsx`,
`app/src/auth/pendingFirstPerson.ts`, root `package.json`, `docs/*`.

**Created in S2b:** `shared/src/selectors/find.ts`,
`shared/src/selectors/whereabouts.ts`, `app/src/screens/Find.tsx`,
`app/src/components/FirstSync.tsx`, `app/src/components/WhereaboutsCard.tsx`.

## Commit discipline

Each task ends in its own commit so a reviewer can reject one and keep its
neighbours. **S2a lands on `main` as one commit** and **S2b as one more**:
at Task 23 and Task 29 respectively, squash the branch with
`git rebase -i main`, then `git checkout main && git merge --ff-only`.
Never create a merge commit.

---

# Part A — S2a: the op log goes live

Delivers stories 1 and 2; advances 7 (the Kind register). Tasks 1–24.

**Calibration note for executors.** Tasks 1–3 are written at full density —
every test body, every line of implementation — because they set the idioms
the rest of the slice copies, and because getting `receiveAt` or the register
guard subtly wrong is not something a later test would catch cleanly. From
Task 4 on, test bodies are given in full only where the assertion is subtle;
routine cases are given as exact `it(...)` names, which together with the
interface block is enough to write them. **Write them all.** A named test left
unwritten is a plan failure, not a shortcut.

---

### Task 1: The Hybrid Logical Clock

**Files:**
- Create: `shared/src/hlc.ts`, `shared/src/hlc.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `Clock` from `shared/src/boundaries.ts`; `fakeClock` from `shared/testUtils/index.ts`
- Produces:
  - `interface HlcParts { readonly ms: number; readonly counter: number }`
  - `HLC_PATTERN: RegExp` · `HLC_COUNTER_MAX = 0xffff` · `DRIFT_BOUND_MS`
  - `formatHlc(parts: HlcParts): string`
  - `parseHlc(hlc: string): HlcParts | null`
  - `issueAt(state: HlcParts, now: number): HlcParts`
  - `receiveAt(state: HlcParts, remote: HlcParts, now: number): { next: HlcParts; driftExceeded: boolean }`
  - `interface Stamp { hlc: string; deviceId: string }`
  - `compareStamps(a: Stamp, b: Stamp): number`
  - `interface HlcClock { issue(): string; receive(remoteHlc: string): { driftExceeded: boolean }; state(): HlcParts }`
  - `createHlcClock(clock: Clock, initial?: HlcParts): HlcClock`

- [ ] **Step 1: Write the failing tests** — `shared/src/hlc.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import { fakeClock } from '../testUtils/index.ts'
import {
  compareStamps,
  createHlcClock,
  DRIFT_BOUND_MS,
  formatHlc,
  HLC_PATTERN,
  issueAt,
  parseHlc,
  receiveAt,
} from './hlc.ts'

const T = Date.UTC(2026, 7, 24, 10, 3, 11, 442)
const A = 'aaaaaaaa-0000-7000-8000-000000000001'
const B = 'bbbbbbbb-0000-7000-8000-000000000002'

describe('formatHlc / parseHlc', () => {
  it('renders the fixed-width sortable form of sync-protocol §2.2', () => {
    expect(formatHlc({ ms: T, counter: 7 })).toBe('2026-08-24T10:03:11.442Z-0007')
  })

  it('round-trips', () => {
    const parts = { ms: T, counter: 0xabcd }
    expect(parseHlc(formatHlc(parts))).toEqual(parts)
  })

  it('always emits three fractional digits and four lowercase hex', () => {
    const hlc = formatHlc({ ms: Date.UTC(2026, 0, 1), counter: 10 })
    expect(hlc).toBe('2026-01-01T00:00:00.000Z-000a')
    expect(HLC_PATTERN.test(hlc)).toBe(true)
  })

  it('sorts correctly as a plain string, which is the whole point', () => {
    const a = formatHlc({ ms: T, counter: 9 })
    const b = formatHlc({ ms: T, counter: 10 })
    const c = formatHlc({ ms: T + 1, counter: 0 })
    expect([c, b, a].sort()).toEqual([a, b, c])
  })

  it('rejects anything off-grammar rather than guessing', () => {
    expect(parseHlc('2026-08-24T10:03:11.44Z-0007')).toBeNull()
    expect(parseHlc('2026-08-24T10:03:11.442Z-7')).toBeNull()
    expect(parseHlc('2026-08-24T10:03:11.442Z-000G')).toBeNull()
    expect(parseHlc('2026-08-24T10:03:11.442+02:00-0007')).toBeNull()
    expect(parseHlc('')).toBeNull()
  })
})

describe('issueAt', () => {
  it('takes the wall clock when it has moved on', () => {
    expect(issueAt({ ms: T, counter: 4 }, T + 1)).toEqual({ ms: T + 1, counter: 0 })
  })

  it('increments the counter within one millisecond', () => {
    expect(issueAt({ ms: T, counter: 4 }, T)).toEqual({ ms: T, counter: 5 })
  })

  it('is unharmed by a wall clock that jumps backwards', () => {
    expect(issueAt({ ms: T, counter: 4 }, T - 60_000)).toEqual({ ms: T, counter: 5 })
  })

  it('carries into the next millisecond at counter overflow', () => {
    expect(issueAt({ ms: T, counter: 0xffff }, T)).toEqual({ ms: T + 1, counter: 0 })
  })
})

describe('receiveAt', () => {
  it('adopts a peer ahead of us, one past its counter', () => {
    const { next, driftExceeded } = receiveAt({ ms: T, counter: 2 }, { ms: T + 5, counter: 9 }, T)
    expect(next).toEqual({ ms: T + 5, counter: 10 })
    expect(driftExceeded).toBe(false)
  })

  it('takes the max counter when local, remote and now agree on the ms', () => {
    expect(receiveAt({ ms: T, counter: 2 }, { ms: T, counter: 9 }, T).next).toEqual({
      ms: T,
      counter: 10,
    })
  })

  it('resets the counter when the wall clock leads both', () => {
    expect(receiveAt({ ms: T, counter: 2 }, { ms: T, counter: 9 }, T + 5).next).toEqual({
      ms: T + 5,
      counter: 0,
    })
  })

  it('does not adopt a peer beyond the drift bound, but reports it', () => {
    const far = { ms: T + DRIFT_BOUND_MS + 1, counter: 0 }
    const { next, driftExceeded } = receiveAt({ ms: T, counter: 2 }, far, T)
    expect(driftExceeded).toBe(true)
    // The local clock moves on by its own rule only — never to the peer's
    // time. One phone with a mistyped year must not poison the household's
    // clock permanently (sync-protocol §2.6).
    expect(next).toEqual({ ms: T, counter: 3 })
  })

  it('adopts a peer exactly at the bound', () => {
    const edge = { ms: T + DRIFT_BOUND_MS, counter: 0 }
    const { next, driftExceeded } = receiveAt({ ms: T, counter: 2 }, edge, T)
    expect(driftExceeded).toBe(false)
    expect(next).toEqual({ ms: T + DRIFT_BOUND_MS, counter: 1 })
  })

  it('is unmoved by a peer behind us', () => {
    const { next } = receiveAt({ ms: T, counter: 2 }, { ms: T - 999, counter: 0 }, T - 1000)
    expect(next).toEqual({ ms: T, counter: 3 })
  })
})

describe('compareStamps', () => {
  const hlc = formatHlc({ ms: T, counter: 1 })
  const later = formatHlc({ ms: T, counter: 2 })

  it('orders by hlc first', () => {
    expect(compareStamps({ hlc, deviceId: B }, { hlc: later, deviceId: A })).toBeLessThan(0)
  })

  it('breaks an exact tie on device id', () => {
    expect(compareStamps({ hlc, deviceId: A }, { hlc, deviceId: B })).toBeLessThan(0)
  })

  it('is zero only for the same stamp from the same device', () => {
    expect(compareStamps({ hlc, deviceId: A }, { hlc, deviceId: A })).toBe(0)
  })
})

describe('createHlcClock', () => {
  it('never issues the same stamp twice, even with a frozen clock', () => {
    const clock = createHlcClock(fakeClock(T))
    const issued = Array.from({ length: 100 }, () => clock.issue())
    expect(new Set(issued).size).toBe(100)
    expect([...issued].sort()).toEqual(issued)
  })

  it('re-establishes monotonicity after its state is lost', () => {
    const restored = createHlcClock(fakeClock(T - 10_000))
    restored.receive(formatHlc({ ms: T, counter: 5 }))
    expect(restored.issue() > formatHlc({ ms: T, counter: 5 })).toBe(true)
  })

  it('ignores an unparseable peer hlc rather than throwing', () => {
    const clock = createHlcClock(fakeClock(T))
    expect(() => clock.receive('not-an-hlc')).not.toThrow()
    expect(clock.state()).toEqual({ ms: T, counter: 0 })
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run --project shared hlc`
Expected: FAIL — `Failed to resolve import "./hlc.ts"`.

- [ ] **Step 3: Implement `shared/src/hlc.ts`**

```ts
import type { Clock } from './boundaries.ts'

/**
 * The Hybrid Logical Clock of `docs/sync-protocol.md` §2, implemented with no
 * latitude. Every rule below is that section's, and the reasoning lives there.
 *
 * The pure core (`issueAt`, `receiveAt`) is separated from the stateful shell
 * (`createHlcClock`) so the rules can be tested as functions of
 * `(state, now)` rather than through a clock that has to be driven into
 * position first.
 */

export interface HlcParts {
  readonly ms: number
  readonly counter: number
}

export const HLC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z-[0-9a-f]{4}$/

/** 16 bits. 65,536 ops in one millisecond is unreachable; a spec says anyway. */
export const HLC_COUNTER_MAX = 0xffff

/**
 * Generous enough for a phone that has not NTP-synced recently, tight enough
 * to catch a wrong year, a wrong century, or an offset applied as if it were
 * UTC (§2.6).
 */
export const DRIFT_BOUND_MS = 5 * 60 * 1000

export function formatHlc(parts: HlcParts): string {
  const counter = parts.counter.toString(16).padStart(4, '0')
  return `${new Date(parts.ms).toISOString()}-${counter}`
}

export function parseHlc(hlc: string): HlcParts | null {
  if (!HLC_PATTERN.test(hlc)) return null
  const ms = Date.parse(hlc.slice(0, 24))
  if (Number.isNaN(ms)) return null
  return { ms, counter: Number.parseInt(hlc.slice(25), 16) }
}

/** §2.4. A wall clock that jumps backwards is harmless. */
export function issueAt(state: HlcParts, now: number): HlcParts {
  if (now > state.ms) return { ms: now, counter: 0 }
  return bump(state)
}

/** §2.7. Deterministic, and it never throws. */
function bump(state: HlcParts): HlcParts {
  if (state.counter >= HLC_COUNTER_MAX) return { ms: state.ms + 1, counter: 0 }
  return { ms: state.ms, counter: state.counter + 1 }
}

/**
 * §2.5, applied once per received op.
 *
 * Outside the drift bound the op is still applied by the caller — always —
 * but the local clock does not adopt the peer's physical time. There is no
 * path in this protocol where a clock disagreement costs a quartermaster
 * their work (§2.6).
 */
export function receiveAt(
  state: HlcParts,
  remote: HlcParts,
  now: number,
): { next: HlcParts; driftExceeded: boolean } {
  if (remote.ms - now > DRIFT_BOUND_MS) {
    const l = Math.max(state.ms, now)
    return {
      next: l === state.ms ? bump(state) : { ms: l, counter: 0 },
      driftExceeded: true,
    }
  }

  const l = Math.max(state.ms, remote.ms, now)
  let counter: number
  if (l === state.ms && l === remote.ms) {
    counter = Math.max(state.counter, remote.counter) + 1
  } else if (l === state.ms) {
    counter = state.counter + 1
  } else if (l === remote.ms) {
    counter = remote.counter + 1
  } else {
    counter = 0
  }

  const next =
    counter > HLC_COUNTER_MAX ? { ms: l + 1, counter: 0 } : { ms: l, counter }
  return { next, driftExceeded: false }
}

/**
 * The LWW comparator (§2.2). The classic HLC embeds the node id inside the
 * timestamp; ours does not, because `device_id` is already a required envelope
 * field. Same total order, no duplication, and the HLC stays a pure clock.
 */
export interface Stamp {
  hlc: string
  deviceId: string
}

export function compareStamps(a: Stamp, b: Stamp): number {
  if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1
  if (a.deviceId === b.deviceId) return 0
  return a.deviceId < b.deviceId ? -1 : 1
}

export interface HlcClock {
  issue(): string
  receive(remoteHlc: string): { driftExceeded: boolean }
  /** Persisted by the caller alongside the op log (§2.3). */
  state(): HlcParts
}

export function createHlcClock(
  clock: Clock,
  initial: HlcParts = { ms: 0, counter: 0 },
): HlcClock {
  let last = initial

  return {
    issue: () => {
      last = issueAt(last, clock.now())
      return formatHlc(last)
    },
    receive: (remoteHlc) => {
      const remote = parseHlc(remoteHlc)
      // An unparseable HLC is a malformed op, not a clock event. The reducer
      // still retains and folds what it can; it simply teaches us nothing.
      if (remote === null) return { driftExceeded: false }
      const { next, driftExceeded } = receiveAt(last, remote, clock.now())
      last = next
      return { driftExceeded }
    },
    state: () => last,
  }
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run --project shared hlc`
Expected: PASS, 21 tests.

- [ ] **Step 5: Export and commit**

Append to `shared/src/index.ts`:

```ts
export type { HlcClock, HlcParts, Stamp } from './hlc.ts'
export {
  compareStamps,
  createHlcClock,
  DRIFT_BOUND_MS,
  formatHlc,
  HLC_COUNTER_MAX,
  HLC_PATTERN,
  issueAt,
  parseHlc,
  receiveAt,
} from './hlc.ts'
```

Run Tier 0, then stage `shared/src/hlc.ts`, `shared/src/hlc.test.ts` and
`shared/src/index.ts` and commit as `Add the Hybrid Logical Clock`.

---

### Task 2: The LWW register

**Files:**
- Create: `shared/src/registers.ts`, `shared/src/registers.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `Stamp`, `compareStamps`, `formatHlc` (Task 1)
- Produces:
  - `interface Register<T> { readonly value: T; readonly hlc: string; readonly deviceId: string }`
  - `writeRegister<T>(current: Register<T> | undefined, value: T, stamp: Stamp): Register<T>`
  - `stampOf(register: Register<unknown>): Stamp`

- [ ] **Step 1: Write the failing tests** — `shared/src/registers.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import { formatHlc } from './hlc.ts'
import { stampOf, writeRegister, type Register } from './registers.ts'

const at = (counter: number) => formatHlc({ ms: 1_700_000_000_000, counter })
const A = 'aaaaaaaa-0000-7000-8000-000000000001'
const B = 'bbbbbbbb-0000-7000-8000-000000000002'

describe('writeRegister', () => {
  it('seeds an absent register', () => {
    expect(writeRegister(undefined, 'Tent', { hlc: at(1), deviceId: A })).toEqual({
      value: 'Tent',
      hlc: at(1),
      deviceId: A,
    })
  })

  it('takes a strictly later write', () => {
    const first = writeRegister(undefined, 'Tent', { hlc: at(1), deviceId: A })
    expect(writeRegister(first, 'Tarp', { hlc: at(2), deviceId: A }).value).toBe('Tarp')
  })

  it('ignores an earlier write and returns the identical object', () => {
    const first = writeRegister(undefined, 'Tent', { hlc: at(5), deviceId: A })
    // Identity, not merely equality: an unchanged register must not invalidate
    // a memo or re-render a row. A late-arriving older op loses at O(1).
    expect(writeRegister(first, 'Tarp', { hlc: at(2), deviceId: A })).toBe(first)
  })

  it('breaks an exact hlc tie on device id, whichever order it sees them', () => {
    const fromA = writeRegister(undefined, 'A', { hlc: at(3), deviceId: A })
    expect(writeRegister(fromA, 'B', { hlc: at(3), deviceId: B }).value).toBe('B')

    const fromB = writeRegister(undefined, 'B', { hlc: at(3), deviceId: B })
    expect(writeRegister(fromB, 'A', { hlc: at(3), deviceId: A }).value).toBe('B')
  })

  it('ignores a re-application of the very same op', () => {
    const first = writeRegister(undefined, 'Tent', { hlc: at(1), deviceId: A })
    expect(writeRegister(first, 'Tent', { hlc: at(1), deviceId: A })).toBe(first)
  })

  it('holds null as a value like any other', () => {
    const r: Register<string | null> = writeRegister<string | null>(undefined, null, {
      hlc: at(1),
      deviceId: A,
    })
    expect(r.value).toBeNull()
  })
})

describe('stampOf', () => {
  it('projects the comparable half of a register', () => {
    const r = writeRegister(undefined, 1, { hlc: at(1), deviceId: A })
    expect(stampOf(r)).toEqual({ hlc: at(1), deviceId: A })
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run --project shared registers`
Expected: FAIL — cannot resolve `./registers.ts`.

- [ ] **Step 3: Implement `shared/src/registers.ts`**

```ts
import { compareStamps, type Stamp } from './hlc.ts'

/**
 * The unit of last-writer-wins is neither the aggregate nor the record: it is
 * a **register**, keyed by `(aggregate_id, entity_path, field)`
 * (`docs/sync-protocol.md` §3.1). Editing a piece of gear's home and its tags
 * concurrently is not a conflict. The aggregate is the *sync* unit; the
 * register is the *merge* unit.
 */
export interface Register<T> {
  readonly value: T
  readonly hlc: string
  readonly deviceId: string
}

export function stampOf(register: Register<unknown>): Stamp {
  return { hlc: register.hlc, deviceId: register.deviceId }
}

/**
 * §3.2, in full. There is no second rule for any field.
 *
 * The strict-greater guard is what makes `apply` commutative, associative and
 * idempotent — precisely the property the convergence tier asserts. An older
 * op arriving late loses at O(1) and no re-fold is ever needed.
 *
 * Returns `current` — the same object — when the write loses, so an unchanged
 * register never invalidates a memo downstream.
 */
export function writeRegister<T>(
  current: Register<T> | undefined,
  value: T,
  stamp: Stamp,
): Register<T> {
  if (current !== undefined && compareStamps(stamp, stampOf(current)) <= 0) {
    return current
  }
  return { value, hlc: stamp.hlc, deviceId: stamp.deviceId }
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run --project shared registers`
Expected: PASS, 7 tests.

- [ ] **Step 5: Export and commit**

Append to `shared/src/index.ts`:

```ts
export type { Register } from './registers.ts'
export { stampOf, writeRegister } from './registers.ts'
```

Run Tier 0, then commit as `Add the last-writer-wins register`.

---

### Task 3: Folded-state shape and validating payload accessors

**Files:**
- Create: `shared/src/state.ts`, `shared/src/payloads.ts`, `shared/src/payloads.test.ts`
- Modify: `shared/src/index.ts`

`state.ts` is types only — no runtime code and no test of its own. It ships
with the accessors because they are what first give it meaning.

**Interfaces:**
- Consumes: `Register` (Task 2)
- Produces, from `state.ts`:
  - `type KindValue = 'single' | 'per_person' | 'counted' | (string & {})`
  - `type Residence = { in: 'place'; id: string } | { in: 'gear'; id: string } | { in: 'loose' }`
  - `type Owner = { type: 'shared' } | { type: 'person'; personId: string }`
  - `interface PlaceState { id: string; name?: Register<string | null>; removed?: Register<boolean> }`
  - `interface GearState { id: string; name?: Register<string | null>; container?: Register<boolean>; kind?: Register<KindValue>; residence?: Register<Residence>; ownedCount?: Register<number>; owner?: Register<Owner>; retired?: Register<boolean> }`
  - `interface PersonState { id: string; name?: Register<string | null> }`
  - `interface UnfoldedOps { readonly count: number; readonly types: Readonly<Record<string, number>> }`
  - `interface HouseholdState { readonly places: …; readonly gear: …; readonly people: …; readonly unfolded: UnfoldedOps }`
- Produces, from `payloads.ts`:
  - `type Read<T> = { kind: 'absent' } | { kind: 'null' } | { kind: 'value'; value: T }`
  - `readString` · `readOpen` · `readBoolean` · `readCount` · `readResidence` · `readOwner`, each `(p: Record<string, unknown>, key: string) => Read<…>`

**Note on `Register<string | null>`.** A name register is nullable because the
wire permits `{"name": null}` and a tolerant reader may not coerce it. No S2
builder emits one; Task 10's fixture proves the reducer handles it.

- [ ] **Step 1: Write `shared/src/state.ts`**

```ts
import type { Register } from './registers.ts'

/**
 * Folded state: the deterministic fold of the op log
 * (`docs/architecture-design.md` §2).
 *
 * **This side is camelCase.** Ops mirror the wire and keep its `snake_case`;
 * folded state, selectors and UI props are ordinary TypeScript. The reducer is
 * the one place the two meet (architecture §12).
 *
 * Every field is a {@link Register} — a value plus the `(hlc, device_id)` of
 * the op that last wrote it — because the merge unit is the field, not the
 * record. Every field is **optional**, and with `exactOptionalPropertyTypes`
 * that means the key is absent rather than holding `undefined`: an absent
 * register was never addressed by any op, which is a different fact from a
 * register holding `null`.
 */

/**
 * Deliberately open past the three known members. An unknown enum value is
 * stored verbatim and never coerced (`sync-protocol.md` §5.3, obligation 4) —
 * safe only because §3.3 removed the rank function from the merge.
 */
export type KindValue = 'single' | 'per_person' | 'counted' | (string & {})

export type Residence =
  | { in: 'place'; id: string }
  | { in: 'gear'; id: string }
  | { in: 'loose' }

export type Owner = { type: 'shared' } | { type: 'person'; personId: string }

export interface PlaceState {
  id: string
  name?: Register<string | null>
  /** A tombstone is an ordinary LWW field; an edit never writes it (§3.5). */
  removed?: Register<boolean>
}

export interface GearState {
  id: string
  name?: Register<string | null>
  /**
   * The containment trait, seeded at `gear.recorded`. There is deliberately no
   * mutation op for it (`sync-protocol.md` §4.3) — recorded there as an
   * omission, not smuggled in here.
   */
  container?: Register<boolean>
  kind?: Register<KindValue>
  /** The **home** residence. A trip never touches it (invariant 13). */
  residence?: Register<Residence>
  ownedCount?: Register<number>
  /** The register exists because `gear.recorded` may carry it; S4 writes it. */
  owner?: Register<Owner>
  retired?: Register<boolean>
}

export interface PersonState {
  id: string
  name?: Register<string | null>
}

/**
 * Ops this build could not fold, retained in the log and counted here.
 *
 * `sync-protocol.md` §5.3 obligation 1 says an unknown op type is retained,
 * not discarded. Counting it makes that **observable** rather than silently
 * honoured — and it is why the local snapshot is keyed by build SHA.
 */
export interface UnfoldedOps {
  readonly count: number
  readonly types: Readonly<Record<string, number>>
}

export interface HouseholdState {
  readonly places: Readonly<Record<string, PlaceState>>
  readonly gear: Readonly<Record<string, GearState>>
  readonly people: Readonly<Record<string, PersonState>>
  readonly unfolded: UnfoldedOps
}
```

- [ ] **Step 2: Write the failing tests** — `shared/src/payloads.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import {
  readBoolean,
  readCount,
  readOpen,
  readOwner,
  readResidence,
  readString,
} from './payloads.ts'

describe('the absent / null / value distinction', () => {
  it('reports an absent key as absent — the register keeps what it had', () => {
    expect(readString({}, 'name')).toEqual({ kind: 'absent' })
  })

  it('reports an explicit null as null — a clear is a write like any other', () => {
    expect(readString({ name: null }, 'name')).toEqual({ kind: 'null' })
  })

  it('reports a value as a value', () => {
    expect(readString({ name: 'Tent' }, 'name')).toEqual({ kind: 'value', value: 'Tent' })
  })

  it('treats an unreadable value as absent, never coercing it', () => {
    expect(readString({ name: 42 }, 'name')).toEqual({ kind: 'absent' })
    expect(readCount({ count: -1 }, 'count')).toEqual({ kind: 'absent' })
    expect(readCount({ count: 1.5 }, 'count')).toEqual({ kind: 'absent' })
    expect(readCount({ count: '3' }, 'count')).toEqual({ kind: 'absent' })
    expect(readBoolean({ container: 'yes' }, 'container')).toEqual({ kind: 'absent' })
  })

  it('does not read up the prototype chain', () => {
    expect(readString({}, 'toString')).toEqual({ kind: 'absent' })
  })
})

describe('readOpen', () => {
  it('keeps an unfamiliar enum member verbatim', () => {
    expect(readOpen({ kind: 'rented' }, 'kind')).toEqual({ kind: 'value', value: 'rented' })
  })
})

describe('readResidence', () => {
  it('reads the three shapes of sync-protocol §4', () => {
    expect(readResidence({ r: { in: 'loose' } }, 'r')).toEqual({
      kind: 'value',
      value: { in: 'loose' },
    })
    expect(readResidence({ r: { in: 'place', id: 'p1' } }, 'r')).toEqual({
      kind: 'value',
      value: { in: 'place', id: 'p1' },
    })
    expect(readResidence({ r: { in: 'gear', id: 'g1' } }, 'r')).toEqual({
      kind: 'value',
      value: { in: 'gear', id: 'g1' },
    })
  })

  it('ignores an unknown `in`, a missing id, and a non-object', () => {
    expect(readResidence({ r: { in: 'van', id: 'v' } }, 'r')).toEqual({ kind: 'absent' })
    expect(readResidence({ r: { in: 'place' } }, 'r')).toEqual({ kind: 'absent' })
    expect(readResidence({ r: 'loose' }, 'r')).toEqual({ kind: 'absent' })
    expect(readResidence({ r: ['loose'] }, 'r')).toEqual({ kind: 'absent' })
  })

  it('drops an unknown extra key but keeps the residence', () => {
    expect(readResidence({ r: { in: 'place', id: 'p1', slot: 'left top' } }, 'r')).toEqual({
      kind: 'value',
      value: { in: 'place', id: 'p1' },
    })
  })
})

describe('readOwner', () => {
  it("maps the wire's person_id onto state's personId", () => {
    expect(readOwner({ o: { type: 'shared' } }, 'o')).toEqual({
      kind: 'value',
      value: { type: 'shared' },
    })
    expect(readOwner({ o: { type: 'person', person_id: 'x' } }, 'o')).toEqual({
      kind: 'value',
      value: { type: 'person', personId: 'x' },
    })
  })

  it('ignores a person owner with no person_id', () => {
    expect(readOwner({ o: { type: 'person' } }, 'o')).toEqual({ kind: 'absent' })
  })
})
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run --project shared payloads`
Expected: FAIL — cannot resolve `./payloads.ts`.

- [ ] **Step 4: Implement `shared/src/payloads.ts`**

```ts
import type { Owner, Residence } from './state.ts'

/**
 * The **tolerant** half of the reader (`docs/sync-protocol.md` §5.3). Its
 * counterpart is `authoring.ts`, which is strict: foerier is strict about what
 * it emits and liberal in what it accepts, on the one interface that must stay
 * forward-compatible forever.
 *
 * Every payload field the reducer touches comes through here, and nothing
 * comes through a cast. A field this cannot read is reported `absent`, which
 * means the register is left exactly as it was — never coerced, never
 * defaulted, and never a reason to reject the op.
 *
 * ## Why three outcomes and not two
 *
 * Obligation 5: **absent is not null.** A field not addressed by an op leaves
 * its register alone; a field explicitly `null` *cleared* it, and that is a
 * write like any other. Collapsing the two silently destroys data. No op in
 * S2's catalogue is nullable — which is exactly why the distinction is built
 * and fixtured now, before `trip.dates_set` comes to depend on it.
 *
 * A malformed value reports `absent` rather than a fourth outcome: for the
 * fold the two carry the same instruction, and the op is retained verbatim in
 * the log either way, so nothing is lost.
 */
export type Read<T> =
  | { kind: 'absent' }
  | { kind: 'null' }
  | { kind: 'value'; value: T }

const ABSENT: Read<never> = { kind: 'absent' }
const NULL: Read<never> = { kind: 'null' }

function raw(p: Record<string, unknown>, key: string): Read<unknown> {
  // `hasOwn`, not `in`: a payload is parsed JSON, and reading up the prototype
  // chain would let a key like `toString` masquerade as a field.
  if (!Object.hasOwn(p, key)) return ABSENT
  const value = p[key]
  if (value === null) return NULL
  return { kind: 'value', value }
}

function refine<T>(
  p: Record<string, unknown>,
  key: string,
  parse: (value: unknown) => T | undefined,
): Read<T> {
  const r = raw(p, key)
  if (r.kind !== 'value') return r
  const parsed = parse(r.value)
  return parsed === undefined ? ABSENT : { kind: 'value', value: parsed }
}

export function readString(
  p: Record<string, unknown>,
  key: string,
): Read<string> {
  return refine(p, key, (v) => (typeof v === 'string' ? v : undefined))
}

/** Any string. An unknown enum member is a value, not an error (obligation 4). */
export const readOpen = readString

export function readBoolean(
  p: Record<string, unknown>,
  key: string,
): Read<boolean> {
  return refine(p, key, (v) => (typeof v === 'boolean' ? v : undefined))
}

/** `int ≥ 0` throughout the catalogue. */
export function readCount(
  p: Record<string, unknown>,
  key: string,
): Read<number> {
  return refine(p, key, (v) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined,
  )
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function readResidence(
  p: Record<string, unknown>,
  key: string,
): Read<Residence> {
  return refine(p, key, (v) => {
    if (!isRecord(v)) return undefined
    if (v['in'] === 'loose') return { in: 'loose' }
    if (v['in'] === 'place' || v['in'] === 'gear') {
      const id = v['id']
      return typeof id === 'string' ? { in: v['in'], id } : undefined
    }
    return undefined
  })
}

export function readOwner(p: Record<string, unknown>, key: string): Read<Owner> {
  return refine(p, key, (v) => {
    if (!isRecord(v)) return undefined
    if (v['type'] === 'shared') return { type: 'shared' }
    if (v['type'] === 'person') {
      // The wire is snake_case, state is camelCase, and this is one of the two
      // places the reducer boundary performs that mapping.
      const personId = v['person_id']
      return typeof personId === 'string'
        ? { type: 'person', personId }
        : undefined
    }
    return undefined
  })
}
```

- [ ] **Step 5: Run and watch it pass**

Run: `npx vitest run --project shared payloads`
Expected: PASS, 11 tests.

- [ ] **Step 6: Export and commit**

Append the `state.ts` and `payloads.ts` types and functions to
`shared/src/index.ts`. Run Tier 0, then commit as
`Add the folded-state shape and validating payload accessors`.
### Task 4: Typed op builders — the strict half of the reader

**Files:**
- Create: `shared/src/authoring.ts`, `shared/src/authoring.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `OpEnvelope` (`shared/src/ops.ts`), `Residence`, `Owner`, `KindValue` (Task 3), `HlcClock` (Task 1), `IdSource` (`boundaries.ts`)
- Produces:
  - `interface OpSpec { aggregate: Aggregate; aggregate_id: string; type: string; payload: Record<string, unknown> }`
  - `interface OpAuthor { household_id: string; device_id: string; ids: IdSource; hlc: HlcClock }`
  - `authorOp(author: OpAuthor, spec: OpSpec): OpEnvelope`
  - One builder per op type, each returning `OpSpec`:
    - `placeRecorded(id: string, name: string)`
    - `placeRenamed(id: string, name: string)`
    - `placeRemoved(id: string)`
    - `gearRecorded(id: string, fields: { name: string; container: boolean; kind: KindValue; residence?: Residence; owner?: Owner; owned_count?: number })`
    - `gearRenamed(id: string, name: string)`
    - `gearRehomed(id: string, residence: Residence)`
    - `gearKindSet(id: string, kind: KindValue)`
    - `gearOwnedCountSet(id: string, count: number)`
    - `gearRetired(id: string)`
    - `gearRestored(id: string)`
    - `personRecorded(id: string, name: string)`

**Design notes the implementer must not deviate from.**

- Builder **output is `snake_case`** — `owned_count`, `person_id` — because
  ops mirror the wire and are never transformed. The builder is where state's
  camelCase is translated *out*, exactly as the reducer translates it *in*.
- **Optional fields are omitted, never set to `undefined` or `null`.** Absent
  is not null (§1.3); a builder that emits `{ residence: undefined }` would
  serialise to a missing key by luck rather than by rule, and one that emits
  `null` would author a *clear*.
- `authorOp` stamps `id` from the `IdSource` and `hlc` from the `HlcClock`, in
  that order, and never regenerates either.
- **No builder for `gear.recorded`'s containment trait as a mutation.** There
  is no such op (§4.3). If a task asks for one, the task is wrong.

- [ ] **Step 1: Write the failing tests** — `shared/src/authoring.test.ts`

Full body for the two that carry the rules:

```ts
it('omits an absent optional field rather than writing undefined or null', () => {
  const spec = gearRecorded('g1', { name: 'Tent', container: false, kind: 'single' })
  expect(Object.hasOwn(spec.payload, 'residence')).toBe(false)
  expect(Object.hasOwn(spec.payload, 'owner')).toBe(false)
  expect(Object.hasOwn(spec.payload, 'owned_count')).toBe(false)
  // Absent is not null: an absent field leaves the register alone, a null
  // clears it, and a builder must never blur the two (sync-protocol §1.3).
  expect(JSON.parse(JSON.stringify(spec.payload))).toEqual({
    name: 'Tent',
    container: false,
    kind: 'single',
  })
})

it('emits the wire`s snake_case, never state`s camelCase', () => {
  const spec = gearRecorded('g1', {
    name: 'Chair',
    container: false,
    kind: 'counted',
    owned_count: 3,
    owner: { type: 'person', personId: 'p1' },
  })
  expect(spec.payload).toEqual({
    name: 'Chair',
    container: false,
    kind: 'counted',
    owned_count: 3,
    owner: { type: 'person', person_id: 'p1' },
  })
})
```

Remaining tests, by exact name:

- `'stamps a fresh id and a fresh hlc on every op'`
- `'takes household_id and device_id from the author, never from the spec'`
- `'issues strictly increasing hlcs for a burst authored in one millisecond'`
- `'builds each of the three place ops with the aggregate set to place'`
- `'builds each of the seven gear ops with the aggregate set to gear'`
- `'builds person.recorded with the aggregate set to person'`
- `'sets aggregate_id to the entity root for every builder'`
- `'emits an empty payload object for place.removed, gear.retired and gear.restored'` — `{}`, present and empty, never absent, never `null` (§1.1)

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run --project shared authoring`
Expected: FAIL — cannot resolve `./authoring.ts`.

- [ ] **Step 3: Implement `shared/src/authoring.ts`**

Shape:

```ts
export function authorOp(author: OpAuthor, spec: OpSpec): OpEnvelope {
  return {
    id: author.ids.next(),
    household_id: author.household_id,
    aggregate: spec.aggregate,
    aggregate_id: spec.aggregate_id,
    type: spec.type,
    hlc: author.hlc.issue(),
    device_id: author.device_id,
    payload: spec.payload,
  }
}

export function gearRecorded(
  id: string,
  fields: {
    name: string
    container: boolean
    kind: KindValue
    residence?: Residence
    owner?: Owner
    owned_count?: number
  },
): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.recorded',
    payload: {
      name: fields.name,
      container: fields.container,
      kind: fields.kind,
      ...(fields.residence === undefined ? {} : { residence: fields.residence }),
      ...(fields.owner === undefined ? {} : { owner: wireOwner(fields.owner) }),
      ...(fields.owned_count === undefined
        ? {}
        : { owned_count: fields.owned_count }),
    },
  }
}
```

`wireOwner` is the outbound half of `readOwner`:
`{ type: 'person', personId }` → `{ type: 'person', person_id: personId }`.

Every other builder follows the same three-line shape. Document each with its
catalogue row (`sync-protocol.md` §4.1–§4.3) in a doc comment.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run --project shared authoring`
Expected: PASS, 10 tests.

- [ ] **Step 5: Export from `shared/src/index.ts` and commit**

Commit message: `Add typed op builders`

---

### Task 5: The reducer — Place ops, the fold, and the tolerant reader

**Files:**
- Create: `shared/src/reduce.ts`, `shared/src/reduce.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `HouseholdState`, `PlaceState` (Task 3), `writeRegister`, `Register` (Task 2), `Read` accessors (Task 3), `OpEnvelope` (`ops.ts`)
- Produces:
  - `emptyState(): HouseholdState`
  - `applyOp(state: HouseholdState, op: OpEnvelope): HouseholdState`
  - `fold(ops: Iterable<OpEnvelope>, from?: HouseholdState): HouseholdState`

**Design notes.**

- `applyOp` is **pure**, with structural sharing: it copies the touched entity,
  the map that holds it, and the top-level `HouseholdState`. Nothing else. Purity
  is the property the convergence tier asserts, so a mutable fast path would
  make that tier prove something weaker than it claims.
- The op-type dispatch is a `Record<string, (state, op, stamp) => HouseholdState>`
  table, not a `switch`. A table makes "is this type known?" a lookup, which is
  exactly the question the tolerant reader asks.
- **Unknown type** → `unfolded.count + 1` and `unfolded.types[type] + 1`,
  everything else untouched. It is not an error, it is not logged as one, and
  the op stays in the caller's log.
- When a write **loses** the LWW comparison, `writeRegister` returns the
  identical register; `applyOp` must then return the identical `state` object.
  Cheap, and it keeps a late-arriving old op from re-rendering the whole app.

- [ ] **Step 1: Write the failing tests** — `shared/src/reduce.test.ts`

Full body for the three that carry the rules:

```ts
it('leaves state identical when a write loses the comparison', () => {
  const seeded = fold([placeOp('p1', 'Attic', at(5))])
  const stale = applyOp(seeded, placeRenameOp('p1', 'Loft', at(2)))
  // Not merely equal — the same object. A late-arriving older op must not
  // invalidate a memo or re-render a list.
  expect(stale).toBe(seeded)
})

it('retains an unknown op type without folding it and without rejecting it', () => {
  const state = fold([unknownOp('trip.entry_status_set'), unknownOp('gear.weighed')])
  expect(state.unfolded).toEqual({
    count: 2,
    types: { 'trip.entry_status_set': 1, 'gear.weighed': 1 },
  })
  // Ignore is not discard: nothing else moved, and the caller still holds the
  // ops in its log for a later build to fold (sync-protocol §5.3, obligation 1).
  expect(state.places).toEqual({})
  expect(state.gear).toEqual({})
})

it('does not mutate the state it is given', () => {
  const before = fold([placeOp('p1', 'Attic', at(1))])
  const frozen = JSON.stringify(before)
  applyOp(before, placeRenameOp('p1', 'Loft', at(2)))
  expect(JSON.stringify(before)).toBe(frozen)
})
```

Remaining tests, by exact name:

- `'emptyState has no places, no gear, no people, and nothing unfolded'`
- `'place.recorded creates the Place and seeds its name'`
- `'place.renamed sets the name'`
- `'place.renamed on a Place no op has yet created still creates the register'` — ops arrive out of authoring order (§8.2); a rename may land before its `recorded`. The Place must exist with a name and no crash.
- `'place.removed sets the tombstone'`
- `'a rename after a removal leaves the Place removed and renamed'` — the tombstone is an ordinary field and an edit never writes it (§3.5)
- `'ignores an unknown payload field and folds the rest'`
- `'ignores a malformed name rather than coercing it'`
- `'folding the whole log onto empty state reproduces the state exactly'` — §8.4, the property that makes the snapshot safely discardable
- `'fold is order-independent for two ops on different registers'`

- [ ] **Step 2: Run and watch it fail** — `npx vitest run --project shared reduce`

- [ ] **Step 3: Implement `shared/src/reduce.ts`**

```ts
type Handler = (state: HouseholdState, op: OpEnvelope, stamp: Stamp) => HouseholdState

const handlers: Record<string, Handler> = {
  'place.recorded': (s, op, st) =>
    writePlace(s, op.aggregate_id, st, (place, stamp) => {
      const name = readString(op.payload, 'name')
      return name.kind === 'value'
        ? { ...place, name: writeRegister(place.name, name.value, stamp) }
        : place
    }),
  // …
}

export function applyOp(state: HouseholdState, op: OpEnvelope): HouseholdState {
  const handler = handlers[op.type]
  if (handler === undefined) return noteUnfolded(state, op.type)
  return handler(state, op, { hlc: op.hlc, deviceId: op.device_id })
}
```

`writePlace(state, id, stamp, update)` reads or creates `PlaceState`, applies
`update`, and returns `state` unchanged if the result is reference-identical.
Write one such helper per aggregate map; Task 6 reuses the gear one.

- [ ] **Step 4: Run and watch it pass** — 13 tests

- [ ] **Step 5: Export and commit** — `Add the op-log fold and the Place ops`

---

### Task 6: The reducer — the seven Gear ops

**Files:**
- Modify: `shared/src/reduce.ts`, `shared/src/reduce.test.ts`

**Interfaces:** no new exports. Adds handlers for `gear.recorded`,
`gear.renamed`, `gear.rehomed`, `gear.kind_set`, `gear.owned_count_set`,
`gear.retired`, `gear.restored`.

**Design notes.**

- `gear.recorded` seeds **each present field as its own register**, all
  stamped with this op's clock (§4.3). A field absent from the payload leaves
  its register absent — it is not defaulted.
- `gear.owned_count_set` is **absolute, never a delta** (§4.3). A counter would
  be hazardous under replay and under two devices closing the same trip.
- `gear.retired` / `gear.restored` are an ordinary LWW pair on the `retired`
  register. `restored` clears it **only if strictly later**.
- Kind exclusivity is **structural** — one register, one value (invariant 5).
  There is nothing to enforce.

- [ ] **Step 1: Write the failing tests**

Full body for the one that carries the slice's headline merge property:

```ts
it('leaves gear retired AND renamed when a retire races a later rename', () => {
  // sync-protocol §3.5: a tombstone is an ordinary LWW field and an edit never
  // touches it, so "delete wins" needs no special rule. Device A retires at
  // hlc 100; device B renames at hlc 200. Both apply.
  const state = fold([
    gearRecordedOp('g1', { name: 'Tarp' }, at(1)),
    gearRetiredOp('g1', at(100)),
    gearRenamedOp('g1', 'Tarp, blue', at(200)),
  ])
  expect(state.gear['g1']?.retired?.value).toBe(true)
  expect(state.gear['g1']?.name?.value).toBe('Tarp, blue')
})
```

Remaining tests, by exact name:

- `'gear.recorded seeds every present field as its own register'`
- `'gear.recorded leaves an absent optional field absent, not defaulted'`
- `'gear.recorded stamps every seeded register with the same clock'`
- `'gear.renamed sets the name'`
- `'gear.rehomed sets the home residence and touches nothing else'`
- `'gear.kind_set replaces the kind, one register and one value'`
- `'gear.kind_set stores an unrecognised kind verbatim'` — obligation 4
- `'gear.owned_count_set sets the count absolutely, not by delta'`
- `'gear.owned_count_set applied twice with the same op is idempotent'`
- `'gear.retired sets the tombstone'`
- `'gear.restored clears the tombstone when strictly later'`
- `'gear.restored earlier than the retirement leaves it retired'`
- `'two concurrent rehomes resolve by plain LWW on (hlc, deviceId)'`
- `'the containment trait has no mutation op, so a later gear.recorded cannot flip it'` — a second `gear.recorded` for the same id is an ordinary LWW write on each register it carries; assert the *behaviour*, not a guard

- [ ] **Step 2–4:** fail → implement → pass (`npx vitest run --project shared reduce`, 28 tests total)

- [ ] **Step 5: Commit** — `Add the Gear ops to the reducer`

---

### Task 7: `person.recorded`, and the test factories

**Files:**
- Modify: `shared/src/reduce.ts`, `shared/src/reduce.test.ts`
- Create: `shared/testUtils/factories.ts`
- Modify: `shared/testUtils/index.ts`

**Interfaces:**
- Produces, from `factories.ts`:
  - `aPlace(overrides?: Partial<{ id: string; name: string }>): OpSpec[]`
  - `aGear(overrides?: Partial<{ id: string; name: string; container: boolean; kind: KindValue; residence: Residence; ownedCount: number }>): OpSpec[]`
  - `anOp(spec: OpSpec, at: { hlc: string; deviceId: string; householdId?: string; id?: string }): OpEnvelope`
  - `hlcAt(counter: number, ms?: number): string`

Factories return **op specs**, not folded entities. A test that wants a piece
of gear in a state folds the ops that would have produced it, so it exercises
the real path rather than a shortcut around it. `aGear({ kind: 'counted' })`
reads as exactly the field under test and nothing else.

**Design note.** `person.recorded` is here rather than in S4 because deferring
it would leave the household's log claiming the Person was created *after* the
gear they recorded, and story 33 derives history from those ops. See the spec
§2.

- [ ] **Step 1: Write the failing tests**

By exact name, in `reduce.test.ts`:

- `'person.recorded creates the Person and seeds the name'`
- `'person.recorded is idempotent under replay'`
- `'person.renamed is not folded in this slice and is counted as unfolded'` — it is an S4 op type; a device running a newer build may already emit it, and this build must retain it, not reject it

And in a new `shared/testUtils/factories.test.ts`:

- `'aGear defaults to a single, non-container piece of gear with a name'`
- `'aGear overrides exactly the fields given and no others'`
- `'anOp produces an envelope that round-trips through JSON unchanged'`

- [ ] **Step 2–4:** fail → implement → pass

- [ ] **Step 5: Commit** — `Add person.recorded and the test factories`

---

### Task 8: The containment selector — effective holder, cycle break, home path

**Files:**
- Create: `shared/src/selectors/containment.ts`, `shared/src/selectors/containment.test.ts`
- Create: `shared/src/selectors/depot.ts`, `shared/src/selectors/depot.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Produces, from `containment.ts`:
  - `type HolderRef = { kind: 'place'; id: string } | { kind: 'gear'; id: string } | { kind: 'loose' }`
  - `interface ContainmentView { holderOf(gearId: string): HolderRef; childrenOf(ref: HolderRef): readonly string[]; brokenEdges: ReadonlySet<string> }`
  - `containmentView(state: HouseholdState): ContainmentView`
  - `interface PathSegment { kind: 'place' | 'gear'; id: string; name: string }`
  - `homePath(state: HouseholdState, gearId: string, view?: ContainmentView): PathSegment[]` — outermost first, `[]` for loose
- Produces, from `depot.ts`:
  - `visibleGear(state: HouseholdState): readonly GearState[]` — not retired, sorted by name then id
  - `retiredGear(state: HouseholdState): readonly GearState[]`
  - `looseGear(state: HouseholdState): readonly GearState[]`
  - `visiblePlaces(state: HouseholdState): readonly PlaceState[]` — not removed
  - `depotCounts(state: HouseholdState): { gear: number; pieces: number }` — `pieces` sums `ownedCount ?? 1` over visible gear

**The four reasons a residence pointer does not lead where it says.** All of
them are the selector's job; the reducer never walks the tree and nothing is
ever cascaded (§3.5, invariant 4).

1. The Place it names is missing or `removed` → **loose**.
2. The Gear it names is missing or `retired` → **loose**.
3. The Gear it names is **not a container** → **loose** (invariant 2: only
   container-gear and places may be resided in).
4. The edge is part of a **cycle** and was the one broken → **loose**.

**The cycle break, precisely (§3.6).** Two devices can move crate X into Y and
Y into X concurrently; the ops target *different aggregates*, so per-field LWW
cannot prevent it and invariant 3 forbids the result. Within each cycle, the
edge whose residence register carries the **lowest `(hlc, deviceId)`** is
reported loose. Every replica holds identical registers, so every replica
breaks the same edge — the fold is untouched, convergence is untouched, and
every device displays the same thing.

**One hazard the implementer must not walk into.** Iterate gear ids in
**sorted order**, and break an all-equal-stamp tie on gear id. `Object.keys`
returns insertion order, which differs between replicas that received the same
ops in different orders.

*(Corrected after implementation, by experiment — the original rationale here
was wrong and is preserved as a caution. It claimed a DFS could discover
**overlapping cycles** differently and so break different edges. It cannot: the
residence graph is **functional**, out-degree ≤ 1, so cycles are
vertex-disjoint, every cycle is discovered exactly once whatever the start
order, and a minimum over a total order on a fixed set is start-independent.
`holderOf` and `brokenEdges` are already insertion-order independent. What
unsorted iteration actually perturbs is **`childrenOf`**, whose buckets are
filled in iteration order — and what protects `holderOf`/`brokenEdges` is the
**id tiebreak**, since `compareStamps` returns 0 on identical stamps and
"first seen wins" then resolves by walk-entry point. Both guards are needed,
for different outputs.)*

- [ ] **Step 1: Write the failing tests**

Full body for the cycle break:

```ts
it('breaks a cycle at its lowest-stamped edge, identically on every replica', () => {
  // Device A moves crate X into Y; device B moves Y into X. The ops target
  // different aggregates, so LWW cannot prevent the cycle (sync-protocol §3.6).
  const ops = [
    ...aGear({ id: 'x', name: 'Crate X', container: true }),
    ...aGear({ id: 'y', name: 'Crate Y', container: true }),
  ].map((s) => anOp(s, { hlc: hlcAt(1), deviceId: DEV_A }))

  const xIntoY = anOp(gearRehomed('x', { in: 'gear', id: 'y' }), {
    hlc: hlcAt(10),
    deviceId: DEV_A,
  })
  const yIntoX = anOp(gearRehomed('y', { in: 'gear', id: 'x' }), {
    hlc: hlcAt(11),
    deviceId: DEV_B,
  })

  const forwards = containmentView(fold([...ops, xIntoY, yIntoX]))
  const backwards = containmentView(fold([...ops, yIntoX, xIntoY]))

  // The lower-stamped edge is x → y, so x reads loose and y still holds x's
  // former place in the tree.
  expect(forwards.holderOf('x')).toEqual({ kind: 'loose' })
  expect(forwards.brokenEdges.has('x')).toBe(true)
  expect(backwards.holderOf('x')).toEqual(forwards.holderOf('x'))
  expect(backwards.holderOf('y')).toEqual(forwards.holderOf('y'))
})
```

Remaining tests, by exact name:

- `'holderOf reads the residence register for a well-formed pointer'`
- `'gear at a removed Place reads loose, and the Place is not cascaded'` — the residence register still points at the removed Place, so a restore would restore the arrangement
- `'gear inside a retired Container reads loose'`
- `'gear pointing at a non-container piece of gear reads loose'` — invariant 2
- `'gear pointing at a gear id that no op ever created reads loose'`
- `'homePath returns the segments outermost first'` — `ATTIC ▸ SHELF L-TOP ▸ CRATE B`
- `'homePath returns an empty path for loose gear'`
- `'homePath stops at the broken edge of a cycle rather than looping forever'`
- `'a three-node cycle breaks at exactly one edge'`
- `'two disjoint cycles each break independently'`
- `'childrenOf lists a container`s contents in sorted order'`
- `'visibleGear excludes retired gear and sorts by name'`
- `'depotCounts sums ownedCount for counted gear and 1 for everything else'`
- `'looseGear reports gear whose holder is gone as well as gear recorded loose'`

- [ ] **Step 2–4:** fail → implement → pass

- [ ] **Step 5: Commit** — `Add the containment tree, its cycle break, and the depot selectors`

---

### Task 9: The convergence tier

**Files:**
- Create: `shared/testUtils/replica.ts`
- Create: `shared/src/convergence.test.ts`
- Modify: root `package.json` (add `fast-check` to `devDependencies`)

**Interfaces:**
- Produces, from `replica.ts`:
  - `interface Replica { readonly deviceId: string; emit(spec: OpSpec): OpEnvelope; receive(ops: readonly OpEnvelope[]): void; log(): readonly OpEnvelope[]; state(): HouseholdState }`
  - `createReplica(opts: { deviceId: string; householdId: string; clock: FakeClock }): Replica`
  - `exchange(a: Replica, b: Replica): void` — each receives every op the other holds and it does not

A replica is a real in-memory client: a real `HlcClock` over a `FakeClock`, a
real log array, and the real reducer. `receive` dedupes by `op.id` before
folding, exactly as the app's log does, and calls `hlc.receive(op.hlc)` per op.

**Why `fast-check`.** An unshrunk failing interleaving of forty ops is not
debuggable; a hand-rolled seeded shuffle gives no shrinking. It is a
devDependency only and never reaches the bundle.

- [ ] **Step 1: Write the failing tests** — `shared/src/convergence.test.ts`

The property, in full:

```ts
it('converges to identical state regardless of arrival order', () => {
  fc.assert(
    fc.property(arbOpSets(), fc.integer(), (opsPerDevice, seed) => {
      const replicas = opsPerDevice.map((_, i) => createReplica({ ... }))
      opsPerDevice.forEach((specs, i) => specs.forEach((s) => replicas[i]!.emit(s)))

      // Every replica receives every op, each in its own random order. This is
      // the direct consequence of `apply` being commutative, associative and
      // idempotent (sync-protocol §3.2) — and pull ordering by `seq` is for
      // cursor correctness only, never for merge correctness (§8.2).
      const all = replicas.flatMap((r) => r.log())
      for (const r of replicas) r.receive(shuffle(all, seed + r.deviceId))

      const first = replicas[0]!.state()
      for (const r of replicas.slice(1)) expect(r.state()).toEqual(first)

      // Folded state is not enough. The cycle break lives in a SELECTOR,
      // downstream of the fold, so two replicas can hold byte-identical state
      // and still display different trees. Task 8 established the determinism;
      // this is where it is held.
      const view = containmentView(first)
      for (const r of replicas.slice(1)) {
        const other = containmentView(r.state())
        for (const id of Object.keys(first.gear)) {
          expect(other.holderOf(id)).toEqual(view.holderOf(id))
          expect(other.childrenOf({ kind: 'gear', id })).toEqual(
            view.childrenOf({ kind: 'gear', id }),
          )
        }
        expect(other.childrenOf({ kind: 'loose' })).toEqual(
          view.childrenOf({ kind: 'loose' }),
        )
        expect([...other.brokenEdges].sort()).toEqual([...view.brokenEdges].sort())
      }
    }),
    { numRuns: 200 },
  )
})
```

**Compare all three outputs** — Task 8 established which guard protects which,
by experiment rather than by argument:

- The residence graph is **functional** (out-degree ≤ 1), so cycles are
  vertex-disjoint, every cycle is discovered exactly once whatever the start
  order, and a minimum over a total order on a fixed set is start-independent.
  `holderOf` and `brokenEdges` are therefore *already* insertion-order
  independent, and comparing them alone would go green on the very bug this
  assertion exists to catch.
- What unsorted traversal actually perturbs is **`childrenOf`**, whose buckets
  are filled in iteration order.
- The `(hlc, deviceId)` tiebreak makes the choice among equal stamps
  **canonical** (lowest id) rather than traversal-derived. It is *not* what
  provides replica agreement — see below.

Compare all three outputs.

*(Corrected a second time, after Task 9. An earlier revision of this note said
the tiebreak "protects `holderOf`/`brokenEdges` — without it, an
all-equal-stamp cycle resolves by walk-entry point, i.e. by insertion order."
That is false, and it is the third wrong version of this reasoning: the sorted
traversal makes walk entry deterministic, so the cycle array is a pure function
of state **values** and the no-tiebreak fallback — "first in cycle-array order"
— is already replica-independent. The sort does all the work for agreement; the
tiebreak is defence-in-depth against a future traversal change. Equal stamps
are genuinely reachable, per §2.3's lost `last` and §8.6's restore, but
reachable does not imply divergent — that is the step three separate readings
got wrong.)*

`arbOpSets()` generates 2–4 devices × 0–15 ops drawn from all eleven builders,
over a small shared pool of ~5 gear ids and ~3 place ids so that collisions on
the same register are common rather than rare. **Deliver every op twice in half
the runs** — idempotence is part of the property, not a separate test.

Pinned scenarios beside the property, by exact name:

- `'a delete racing an edit converges to deleted and edited on both replicas'`
- `'two concurrent rehomes converge to the later stamp on both replicas'`
- `'place.removed racing a rehome into that place leaves the gear loose on both'`
- `'two devices forming a containment cycle break the same edge'`
- `'a replica that receives the same op twice is unchanged by the second'`
- `'a replica that receives an op it authored itself is unchanged'` — pull returns the device's own ops (§6.4)
- `'an unknown op type converges as an unfolded count, not as a divergence'`
- `'exchanging in three rounds converges no differently than in one'`

- [ ] **Step 2:** Run and watch it fail. Install first:
`npm install -D fast-check`

- [ ] **Step 3–4:** implement `replica.ts` → run → pass

- [ ] **Step 5: Commit** — `Add the convergence tier`

---

### Task 10: Op fixtures and the backward-compatibility replay

**Files:**
- Create: `shared/fixtures/s2-depot.ops.json`
- Create: `shared/src/fixtures.test.ts`
- Modify: `shared/package.json` (add `"./fixtures": "./fixtures/s2-depot.ops.json"` to `exports`)

**This task must land in the same commit as the op types it captures.** A
fixture written later is captured from a format that has already drifted and
proves nothing ([`testing.md`](../testing.md)). It is the guard that keeps
expand-contract honest as later slices ship.

**Fixture contents** — a JSON array of `StoredOp`, hand-written (not generated,
so a drift in the generator cannot silently move the fixture):

1. One op of **each of the eleven types**, with realistic payloads: a Place
   recorded, renamed and removed; gear recorded as an item and as a container,
   renamed, rehomed into a container, kind set to each of the three values,
   owned-count set, retired, restored; a Person recorded.
2. **Obligation 1** — an op of type `trip.entry_status_set`, an S6 op type this
   build has never heard of.
3. **Obligation 2** — a `gear.recorded` carrying an extra `weight_grams` field.
4. **Obligation 4** — a `gear.kind_set` carrying `"kind": "rented"`.
5. **Obligation 5** — a `gear.renamed` carrying `"name": null`, alongside a
   `gear.rehomed` that simply omits `residence`. The two must fold differently.

- [ ] **Step 1: Write the failing test** — `shared/src/fixtures.test.ts`

```ts
it('folds the S2 fixture to exactly the state it folded to when captured', () => {
  const state = fold(fixture as OpEnvelope[])
  expect(state).toMatchSnapshot()
})

it('retains the op types it cannot fold rather than rejecting them', () => {
  const state = fold(fixture as OpEnvelope[])
  expect(state.unfolded.types['trip.entry_status_set']).toBe(1)
})

it('never mutates the fixture it was given', () => {
  const before = JSON.stringify(fixture)
  fold(fixture as OpEnvelope[])
  expect(JSON.stringify(fixture)).toBe(before)
})

it('distinguishes an explicit null from an absent field', () => {
  const state = fold(fixture as OpEnvelope[])
  expect(state.gear[NULLED_NAME_GEAR]?.name?.value).toBeNull()
  expect(Object.hasOwn(state.gear[OMITTED_RESIDENCE_GEAR] ?? {}, 'residence')).toBe(false)
})
```

The `name` register holding `null` is why Task 3 declares it
`Register<string | null>` rather than `Register<string>`: the wire permits an
explicit clear, so the type must, even though no S2 builder emits one.

- [ ] **Step 2–4:** fail → write the fixture → pass, and commit the snapshot

- [ ] **Step 5: Commit** — `Capture the S2 op fixtures`
---

### Task 11: The `op` table and the household counter

**Files:**
- Create: `api/migrations/0003_op.ts`
- Modify: `api/src/db/migrations.ts`, `api/src/db/schema.ts`
- Test: `api/test/server/migrations.test.ts` (extend)

**Interfaces:**
- Produces, in `schema.ts`:
  - `interface OpTable { op_id: string; household_id: string; seq: ColumnType<number, number, never>; aggregate: string; aggregate_id: string; type: string; hlc: string; device_id: string; payload: ColumnType<Record<string, unknown>, string, never>; received_at: CreatedAt }`
  - `HouseholdTable` gains `op_seq: ColumnType<number, number | undefined, number>`
  - `Database` gains `op: OpTable`
  - `export type Op = Selectable<OpTable>`

**Design notes.**

- `type` is **`text`, never a Postgres enum.** An enum would make the server's
  op vocabulary a deploy-order dependency, which
  [sync §6.2](../sync-protocol.md) exists to avoid.
- `op_id` is the **primary key** — that is what makes a re-push idempotent.
- Unique `(household_id, seq)`; the pull index is `(household_id, seq)`.
- `seq` and `op_seq` are `bigint`. **Kysely returns `bigint` as a string from
  the driver.** `api/src/db/index.ts` already installs a type parser for the
  `sign_count` case; extend the same mechanism rather than parsing at each call
  site, and assert it in the migration test.
- `payload` is `jsonb`. Insert it as a JSON **string** and let Postgres cast;
  round-trip it in a test so nobody discovers double-encoding in production.

- [ ] **Step 1: Write the failing test** in `api/test/server/migrations.test.ts`

By exact name:

- `'creates the op table with op_id as its primary key'`
- `'rejects a second op with the same op_id'`
- `'rejects two ops sharing a seq within one household'`
- `'allows the same seq in two different households'`
- `'defaults household.op_seq to 0'`
- `'returns seq and op_seq as numbers, not strings'`
- `'round-trips a payload through jsonb without double-encoding'`
- `'down() drops the op table and the op_seq column'`

- [ ] **Step 2: Run and watch it fail** — `npm run test:server -- migrations`

- [ ] **Step 3: Write `api/migrations/0003_op.ts`**

Follow `0002_auth.ts` exactly for style: `import { type Kysely, sql } from 'kysely'`, an `up` and a `down`, a doc comment naming the spec section each
choice comes from. Register it in `db/migrations.ts` as `'0003_op'`. **Never
rename a migration key once deployed.**

- [ ] **Step 4: Run and watch it pass**

- [ ] **Step 5: Commit** — `Add the op table and the per-household sequence`

---

### Task 12: Envelope validation

**Files:**
- Create: `api/src/sync/envelope.ts`, `api/src/sync/envelope.test.ts`

**Interfaces:**
- Produces:
  - `type RejectionCode = 'envelope_invalid' | 'op_id_invalid' | 'hlc_invalid' | 'household_mismatch' | 'op_too_large'`
  - `type Validated = { ok: true; op: OpEnvelope } | { ok: false; code: RejectionCode }`
  - `validateOp(raw: unknown, householdId: string): Validated`
  - `isUuidV7(s: string): boolean`

**Design notes.**

- **The server validates the envelope and nothing else** (§6.2). It never
  inspects `type` beyond storing it, and never inspects `payload` beyond "is a
  JSON object". It has no op vocabulary, so it can never be out of date about
  one.
- The rejection set is **closed** (§6.3). Do not add a code.
- `household_mismatch` is **rejected outright, never rewritten.** Silence would
  hide a client bug that is indistinguishable from an attack
  ([auth §9.3](../auth-design.md)).
- `seq` or `received_at` present on a pushed op is `envelope_invalid` — they
  are the server's to assign (§6.1).
- `payload` may be `{}` — present and empty — but never absent and never
  `null`.
- Size is measured on the **serialised** op, 16 KB (`MAX_OP_BYTES`), by
  `Buffer.byteLength(JSON.stringify(op), 'utf8')` — bytes, not characters.

- [ ] **Step 1: Write the failing tests**, by exact name:

- `'accepts a well-formed op'`
- `'rejects a missing or non-string id as op_id_invalid'`
- `'rejects a UUIDv4 as op_id_invalid'` — the catalogue says UUIDv7
- `'rejects an hlc that does not match the §2.2 grammar as hlc_invalid'`
- `'rejects an hlc with the right shape but an impossible date as hlc_invalid'`
- `'rejects a household_id that is not the token`s as household_mismatch'`
- `'never rewrites a mismatched household_id'`
- `'rejects a missing aggregate, aggregate_id, type or device_id as envelope_invalid'`
- `'rejects an absent payload and a null payload as envelope_invalid'`
- `'accepts an empty payload object'`
- `'rejects a seq or received_at sent on push as envelope_invalid'`
- `'rejects an op over 16 KB serialised as op_too_large'`
- `'accepts an unknown aggregate and an unknown type — the server has no vocabulary'`
- `'preserves unknown envelope fields verbatim'`

- [ ] **Step 2–4:** fail → implement → pass (`npx vitest run --project api envelope`)

- [ ] **Step 5: Commit** — `Add op envelope validation`

---

### Task 13: The sync service — push and pull

**Files:**
- Create: `api/src/sync/service.ts`, `api/src/sync/service.test.ts`

**Interfaces:**
- Consumes: `Kysely<Database>` (Task 11), `validateOp` (Task 12), `Clock`
- Produces:
  - `interface PushOutcome { op_id: string; status: 'accepted' | 'duplicate' | 'rejected'; seq?: number; code?: RejectionCode }`
  - `interface PushResult { results: PushOutcome[]; household_seq: number }`
  - `pushOps(deps, householdId: string, raw: unknown[]): Promise<PushResult>`
  - `interface PullResult { ops: StoredOp[]; cursor: number; has_more: boolean; household_seq: number }`
  - `pullOps(deps, householdId: string, since: number, limit: number): Promise<PullResult>`
  - `createSyncService(deps: { db: Kysely<Database>; clock: Clock }): { push; pull }`

**The push transaction, in the order it must run.** This is the one place in
S2a where getting the *order* wrong produces a bug no test of the happy path
would catch.

```sql
SELECT op_seq FROM household WHERE id = $1 FOR UPDATE   -- serialise this household
SELECT op_id, seq FROM op WHERE household_id = $1 AND op_id = ANY($2)
UPDATE household SET op_seq = op_seq + <count of NEW valid ops> RETURNING op_seq
INSERT INTO op … VALUES …                                -- consecutive seqs, request order
```

**Why the lock comes first.** [Sync §6.6](../sync-protocol.md) rules out a
Postgres `SEQUENCE` because sequences are non-transactional and a client can
pull past a seq that has not committed yet. There is a second trap one level
down, and it is why the dedupe SELECT sits *inside* the lock: if you reserve
`n` seqs for `n` submitted ops and let `INSERT … ON CONFLICT (op_id) DO
NOTHING` swallow the re-pushes, every duplicate burns a seq that no row ever
occupies. Gaps are harmless for a cursor — it only ever asks "greater than" —
but the first-sync fold reads `household_seq` as the **op count**, so a gap
over-reports forever on the one screen whose whole promise is a determinate
number. Taking the row lock first makes the dedupe check authoritative: two
concurrent re-pushes of the same op cannot both observe it as absent.

**Other rules.**

- The whole push is **one transaction**: accepted ops commit together, so a
  client never sees half a batch. A **rejection does not roll back its
  neighbours** — the batch is atomic in the database and per-op in the
  response. This is what keeps one bad op from wedging the outbox forever.
- `results` has exactly one entry per submitted op, **in request order,
  always**.
- `duplicate` carries the seq the op **already had** — never a new one — and
  `received_at` is never updated. That is what makes an outbox retrying on an
  ambiguous timeout safe by construction.
- `pullOps` returns ops with `seq > since`, ordered by `seq` ascending, capped
  at `limit` (default 500, max 1000). `cursor` is the highest seq in the page,
  or the request's `since` when the page is empty. `has_more` is whether
  `limit` truncated it.
- **Pull returns the client's own ops too.** Filtering by device would save a
  little bandwidth and cost a device the ability to recover its own work after
  a local wipe.

- [ ] **Step 1: Write the failing tests** (Vitest against a real local
`foerier_test`, reusing `api/test/server/testDb.ts`), by exact name:

- `'assigns consecutive seqs in request order'`
- `'leaves no gap when a batch is entirely re-pushed'`
- `'leaves no gap when a batch mixes new ops and re-pushes'`
- `'returns the original seq for a duplicate, and does not update received_at'`
- `'commits accepted ops even when a neighbour is rejected'`
- `'stores nothing at all when every op in the batch is rejected'`
- `'returns one result per submitted op, in request order'`
- `'household_seq equals the number of ops stored for that household'`
- `'pull returns ops with seq strictly greater than since'`
- `'pull echoes since as the cursor when the page is empty'`
- `'pull sets has_more when the page is truncated by limit'`
- `'pull clamps limit to 1000'`
- `'pull returns the pushing device`s own ops'`
- `'pull returns an unknown op type unchanged'`

- [ ] **Step 2–4:** fail → implement → pass (`npm run test:server -- service`)

- [ ] **Step 5: Commit** — `Add the sync service: push, pull, and gapless seqs`

---

### Task 14: The `/sync` routes

**Files:**
- Create: `api/src/sync/routes.ts`
- Modify: `api/src/app.ts`

**Interfaces:**
- Produces: `createSyncRoutes(deps: { service; requireAuth: MiddlewareHandler; limiter }): Hono<{ Variables: AuthVariables }>`
- Mounted at `/sync` inside the existing `v1` base path, so the endpoints are
  `POST /api/v1/sync/push` and `GET /api/v1/sync/pull`.

**Design notes.**

- Both routes sit **behind `requireAuth`**. `householdId` comes from
  `c.get('auth')` and **never** from the body, the query string, or a header.
  This is the tenancy rule the sell-later story rests on.
- Batch-level errors use the one shape
  `{ error: { code, message, detail } }`, with the statuses of §6.3.
- **Both batch caps answer `413 payload_too_large`** — over 500 ops and over
  1 MB alike. §6.3 leaves the op-count cap's status open; 413 is taken because
  its documented client response is "halve the batch and retry", which is
  self-healing, while 400's is to dead-letter. A client that miscounts its own
  chunking should not cost a quartermaster their work.
- `/sync/*` gets its **own rate-limit bucket**, much higher than `/auth/*`: a
  returning offline client legitimately bursts. Make the limit injectable
  through `AppDeps` exactly as `rateLimit` already is.
- **New ops are deliberately not piggybacked onto the push response.** An
  extra `GET` on reconnect costs nothing, and one delivery path is worth more
  than one saved round trip.

- [ ] **Step 1: Write the failing tests** in `api/test/server/sync.test.ts` —
this is the Tier 2s class, and it **claims UUID registry slot #4**. Add the row
to [`testing.md`](../testing.md) in this task:

```
| 4 | `0f000004-…-000000000004` | `sync.test.ts` — push, pull, sequence assignment |
```

Two rules this class must follow, which the suite learned the hard way: scope
every query to its own household, and never clear a table it does not own.

Tests, by exact name:

- `'requires a bearer token on push and on pull'`
- `'takes household_id from the token, not from the body'`
- `'assigns seqs and returns them in request order'`
- `'returns 413 for a batch over 500 ops'`
- `'returns 413 for a body over 1 MB'`
- `'returns 400 bad_request for a malformed batch body'`
- `'returns 401 for a revoked device token'`
- `'pages a pull with has_more and an advancing cursor'`
- `'returns household_seq on pull as well as on push'`
- `'stores and returns an unknown op type opaquely'`
- `'rejects an op carrying seq or received_at'`

- [ ] **Step 2–4:** fail → implement → pass (`npm run test:server -- sync`)

- [ ] **Step 5: Commit** — `Add the /sync/push and /sync/pull endpoints`

---

### Task 15: Extend the multi-household isolation suite

**Files:**
- Modify: `api/test/server/householdIsolation.test.ts`

This is the half auth slice 1 could only assert at the middleware, because
`/sync` did not exist ([architecture §8.7](../architecture-design.md)). Story
31 is the boundary foerier would be sold along, and it is never provisionally
relaxed. Reuse the file's existing `joinHousehold` helper and its registered
household ids #2 and #3 — **do not claim new slots**.

- [ ] **Step 1: Write the failing tests**, by exact name:

- `'rejects an op carrying another household`s id, and stores nothing'` —
  assert `household_mismatch` **and** that `select count(*) from op where
  household_id = B` is unchanged. The rejection alone is not the property.
- `'never returns household B`s ops to household A at any cursor'` — push in
  B, then pull from A at `since=0` and assert the page is empty
- `'never advances household A`s op_seq when household B pushes'`
- `'gives each household its own seq space starting at 1'`
- `'ignores a household_id supplied in the pull query string'`

- [ ] **Step 2–4:** fail → (the code should already be correct; if a test
passes immediately, prove it can fail by temporarily breaking the scoping) →
pass

- [ ] **Step 5: Commit** — `Extend household isolation to the sync endpoints`

---

### Task 16: The local op log

**Files:**
- Create: `app/src/household/opLog.ts`, `app/src/household/opLog.test.ts`

**Interfaces:**
- Produces:
  - `interface LoggedOp { lsn: number; op: OpEnvelope; seq: number | null; deadLettered: boolean }`
  - `type MetaKey = 'cursor' | 'hlc' | 'snapshot' | 'deviceId'`
  - `interface OpLog { append(op): Promise<LoggedOp>; ingest(ops: readonly StoredOp[]): Promise<void>; since(lsn: number): Promise<LoggedOp[]>; all(): Promise<LoggedOp[]>; outbox(limit: number): Promise<LoggedOp[]>; markPushed(entries: readonly { opId: string; seq: number }[]): Promise<void>; deadLetter(entries: readonly { opId: string; code: string }[]): Promise<void>; deadLetters(): Promise<readonly { opId: string; code: string }[]>; readMeta<T>(key: MetaKey): Promise<T | null>; writeMeta(key: MetaKey, value: unknown): Promise<void> }`
  - `inMemoryOpLog(): OpLog` — a real fake, used by every test above Tier 3
  - `indexedDbOpLog(): OpLog`

**IndexedDB schema.** Database `foerier`, bumped from **version 1 to 2**. The
existing `auth` object store is carried through the upgrade untouched — the
session and the pending-first-person record both live there and must survive.

| Store | Key | Indexes |
| --- | --- | --- |
| `op` | autoincrement `lsn` | unique on `op.id`; on `seq` |
| `meta` | out-of-line string key | — |
| `deadLetter` | `opId` | — |

**Why `lsn` and not `seq`.** A locally-authored op has no `seq` until the
server assigns one, so `seq` can key neither the log nor the snapshot's
high-water mark. `lsn` is a purely local append counter: never sent, never
compared across devices, and meaningless beyond "written to this device's log
before that one".

**The outbox is a query, not a second structure**: every record with
`seq === null` and `deadLettered === false`, in `lsn` order. A record never
pushed and a record whose push response was lost are indistinguishable — which
is exactly right, because re-pushing is idempotent by `op_id`.

**Ingest updates by `op.id`; it does not insert blindly.** Pull returns the
device's own ops too, so an op already in the local log arrives again carrying
its server `seq`; ingest writes that `seq` onto the existing record rather than
creating a second one. That is what makes the lost-push-response case self-heal
with no special handling.

**A dead-lettered op stays in the log and stays folded.** It is local truth
that failed to *publish*; dropping it from the fold would make the device's own
state jump backwards under the user's hands.

- [ ] **Step 1: Write the failing tests** — run the **same suite against both
implementations** with a shared `describe.each`, so the fake is proved to
behave like the real one rather than merely resembling it. Use `fake-indexeddb`
for the IndexedDB side (add as a devDependency).

By exact name:

- `'assigns increasing lsns in append order'`
- `'appends a locally-authored op with a null seq'`
- `'lists an appended op in the outbox'`
- `'removes an op from the outbox once markPushed writes its seq'`
- `'removes an op from the outbox once ingest delivers it back with a seq'`
- `'ingest does not duplicate an op already in the log'`
- `'ingest is idempotent for a page delivered twice'`
- `'keeps a dead-lettered op in the log but out of the outbox'`
- `'since(lsn) returns only records appended after that lsn'`
- `'round-trips meta values, and returns null for an unset key'`
- `'never mutates a stored op'`
- `'preserves an unknown envelope field through a store and a read'`
- `'carries the auth store through the version 1 to 2 upgrade'` — IndexedDB
  implementation only; seed an `auth` record at v1, reopen at v2, assert it is
  still there

- [ ] **Step 2–4:** fail → implement → pass (`npx vitest run --project app opLog`)

- [ ] **Step 5: Commit** — `Add the local op log`

---

### Task 17: The transport

**Files:**
- Create: `app/src/household/transport.ts`, `app/src/household/transport.test.ts`

**Interfaces:**
- Produces:
  - `interface PushOutcome { op_id: string; status: 'accepted' | 'duplicate' | 'rejected'; seq?: number; code?: string }`
  - `interface PushBody { results: PushOutcome[]; household_seq: number }`
  - `interface PullBody { ops: StoredOp[]; cursor: number; has_more: boolean; household_seq: number }`
  - `type TransportResult<T> = { ok: true; body: T } | { ok: false; status: number; code: string; retryAfter?: number }`
  - `interface Transport { push(ops: readonly OpEnvelope[]): Promise<TransportResult<PushBody>>; pull(since: number, limit: number): Promise<TransportResult<PullBody>> }`
  - `createHttpTransport(deps: { baseUrl: string; token(): string | null }): Transport`
  - `fakeTransport(server?: FakeServer): Transport & { server: FakeServer }` — a real in-memory op store that assigns gapless seqs exactly as Task 13 does, so Tier 2 exercises the real protocol shape

Follow `app/src/auth/api.ts` for the fetch idioms, the `Authorization` header,
and error mapping. A network throw maps to
`{ ok: false, status: 0, code: 'network' }` — the same class as a 5xx.

- [ ] **Step 1: Write the failing tests**, by exact name:
`'sends the bearer token on push and on pull'` ·
`'maps a 401 to unauthorized'` · `'maps a 413 to payload_too_large'` ·
`'reads Retry-After from a 429'` · `'maps a network throw to the 5xx class'` ·
`'the fake assigns gapless seqs and returns duplicates with their original seq'`

- [ ] **Step 2–4:** fail → implement → pass

- [ ] **Step 5: Commit** — `Add the sync transport and its in-memory fake`

---

### Task 18: The sync engine — outbox, cursor, backoff, dead-letter

**Files:**
- Create: `app/src/household/syncEngine.ts`, `app/src/household/syncEngine.test.ts`

**Interfaces:**
- Consumes: `OpLog` (Task 16), `Transport` (Task 17), `Clock`, `HlcClock`
- Produces:
  - `type SyncStatus = 'idle' | 'syncing' | 'offline' | 'signed-out' | 'bootstrapping'`
  - `interface BootstrapProgress { folded: number; total: number; paused: boolean }`
  - `interface SyncEngine { flush(): Promise<void>; pull(): Promise<void>; start(): void; stop(): void; status(): SyncStatus; bootstrap(): BootstrapProgress | null }`
  - `createSyncEngine(deps: { log: OpLog; transport: Transport; clock: Clock; hlc: HlcClock; onOps(ops: readonly OpEnvelope[]): void; onStatus(s: SyncStatus): void; onBootstrap(p: BootstrapProgress | null): void }): SyncEngine`

**Rules, each of which is a test.**

- **Push** chunks the outbox to ≤ 500 ops and ≤ 1 MB, in `lsn` order.
  `accepted` and `duplicate` both write the returned `seq`; `rejected` moves
  the record to the dead-letter and leaves it folded.
- After a push, if `household_seq > cursor`, pull.
- **Pull** loops pages from `since = cursor`. For each page: fold, durably
  write, **then** advance the cursor. The reverse loses ops permanently,
  because the cursor is the only record of what has been seen. Call
  `hlc.receive(op.hlc)` for every op received, before or while folding it.
- **Errors:** 400 dead-letters the batch and does not retry · 401 freezes sync,
  **keeps the outbox intact** and reports `signed-out` · 413 halves the batch
  and retries · 429 honours `Retry-After` · 5xx and network back off
  exponentially with **full jitter**, base 1 s, cap 5 min, **indefinitely**.
- **Triggers:** `online`, `visibilitychange`, a 30-second interval, and after
  every `emit`. Never on a render path.
- **Bootstrap:** when the **cursor is 0** and `household_seq > 0`, report
  `{ folded, total }` per page. A failure mid-bootstrap sets `paused: true` and
  keeps the cursor — it resumes, it never restarts.

  *(Corrected after Task 18. This said "when the local log is empty", which is
  the wrong test: a device that joins, records gear **offline**, and only then
  first-syncs has a non-empty log at cursor 0, and would get no progress
  display while folding the household's entire history — the one screen whose
  whole promise is a determinate number. The cursor is what actually means "has
  never pulled"; the log's emptiness means "has never authored", which is a
  different question.)*

- [ ] **Step 1: Write the failing tests** — real fakes throughout, a
`fakeClock` driven by hand, and `vi.useFakeTimers()` only for the interval.
By exact name:

- `'pushes the outbox in lsn order'`
- `'chunks a 501-op outbox into two pushes'`
- `'chunks by byte size as well as by count'`
- `'writes the seq of an accepted op and clears it from the outbox'`
- `'treats a duplicate exactly as an accepted op'`
- `'dead-letters a rejected op but leaves it folded'`
- `'re-pushes the byte-identical op after a lost response'`
- `'pulls after a push when household_seq exceeds the cursor'`
- `'advances the cursor only after the page is folded and written'`
- `'does not advance the cursor when folding throws'`
- `'pages a pull until has_more is false'`
- `'backs off exponentially with jitter on a 5xx and retries indefinitely'`
- `'halves the batch on a 413'`
- `'honours Retry-After on a 429'`
- `'freezes on a 401 and keeps every queued op'`
- `'dead-letters the batch on a 400 and does not retry it'`
- `'reports determinate bootstrap progress across pages'`
- `'pauses rather than restarting when a bootstrap page fails'`
- `'feeds every received op`s hlc to the local clock'`

- [ ] **Step 2–4:** fail → implement → pass

- [ ] **Step 5: Commit** — `Add the sync engine: outbox, cursor, and dead-letter`

---

### Task 19: The depot store, and closing the pendingFirstPerson seam

**Files:**
- Create: `app/src/household/store.ts`, `app/src/household/store.test.ts`
- Modify: `app/src/auth/pendingFirstPerson.ts`, `app/package.json` (add `zustand`)

**Interfaces:**
- Produces:
  - `interface HouseholdStoreState { state: HouseholdState; status: 'loading' | 'bootstrapping' | 'ready'; sync: SyncStatus; bootstrap: BootstrapProgress | null; deadLetterCount: number; emit(spec: OpSpec): void }`
  - `createHouseholdStore(deps: { log: OpLog; engine: SyncEngine; author: OpAuthor }): StoreApi<HouseholdStoreState>`
  - `useHousehold` — the React hook bound to the app's store instance
- Modified in `pendingFirstPerson.ts`:
  - `flushPendingFirstPerson(pending: PendingFirstPerson | null, emit: (spec: OpSpec) => void, store: PendingStore): Promise<boolean>`

**`emit` is the one authoring path**, and its order is not negotiable:

```
stamp id · household_id · device_id · hlc
  → append to the local log        ← durable first
  → fold into memory               ← a crash between the two loses a render,
  → nudge the outbox                 not a fact (sync-protocol §8.5)
```

`emit` returns `void` and the UI never awaits it. Appends are serialised
through an internal promise queue so the HLC counter cannot race itself.

**Snapshot.** On load, read `meta.snapshot`. If `snapshot.sha` equals
`import.meta.env.VITE_GIT_SHA`, start from `snapshot.state` and fold records
with `lsn > snapshot.lsn`; otherwise **discard it and fold the whole log**. A
snapshot taken by a build that could not fold some op is *wrong* for a build
that can, and this is what makes the tolerant reader safe rather than merely
well-intentioned. Write the snapshot debounced, never on a render path.

**Closing the seam.** `flushPendingFirstPerson` emits
`personRecorded(pending.personId, pending.name)` — with the Invite's
**pre-bound id**, never a fresh one — and clears the pending record **only
after the op is durably appended**, never after a successful push. Rewrite the
module's SEAM banner into a plain doc comment recording that it is closed, and
say why the id must be the pre-bound one.

- [ ] **Step 1: Write the failing tests**, by exact name:

- `'emit appends to the log before folding into memory'`
- `'emit never awaits the network'`
- `'emit serialises concurrent calls so hlcs stay strictly increasing'`
- `'folds the whole log on load when there is no snapshot'`
- `'starts from a snapshot written by the same build sha'`
- `'discards a snapshot written by a different build sha and re-folds'`
- `'applies ops delivered by the engine without re-appending them'`
- `'reports the dead-letter count'`
- `'flushPendingFirstPerson emits person.recorded with the pre-bound id'`
- `'flushPendingFirstPerson clears the pending record only after the append'`
- `'flushPendingFirstPerson is a no-op when nothing is pending'`
- `'flushPendingFirstPerson does not emit a second op when run twice'`

- [ ] **Step 2–4:** `npm install -w app zustand` → fail → implement → pass

- [ ] **Step 5: Commit** — `Add the depot store and emit the household's first Person op`

---

### Task 20: The Depot list

**Files:**
- Create: `app/src/screens/Depot.tsx`, `app/src/screens/Depot.module.css`, `app/src/screens/Depot.test.tsx`
- Modify: `app/src/App.tsx` (replace the `/` empty state; add `/gear/:id` and `/add`)

**Design source:** `docs/design/README.md` §3 (phone), §2 (desktop), §3a
(roomy/split). Follow `SignIn.tsx` / `SignIn.module.css` for the CSS-module
pattern and `ui/styles/tokens.css` for every colour, radius and type step —
**no literal hex in a component**.

**What the screen shows.** Title `Depot`; count line
`128 GEAR · 214 PIECES` (mono 11, from `depotCounts`); a 48px search field
filtering by name; 2-line rows — name (16/600) with mono meta (home path from
`homePath`, `×N` for counted gear) and a right-hand `⌂ HOME` whereabouts chip
in `ink/muted`; `›` on container rows; a 56px FAB bottom-right, 74px above the
tab bar, with 76px bottom list clearance. **The Depot never shows packing
status.** Empty state: `Nothing recorded yet.`

- [ ] **Step 1: Write the failing Tier 3 tests** (`Depot.test.tsx`, React
Testing Library, a fake store seeded from the factories), by exact name:

- `'lists visible gear by name'`
- `'omits retired gear'`
- `'shows the full home path for gear inside a container'`
- `'shows nothing where a home path would be for loose gear'`
- `'shows the owned-count only for counted gear'`
- `'filters rows by the search field'`
- `'reports the match count when a filter is active'`
- `'renders the empty state before anything is recorded'`
- `'opens gear detail when a row is activated'`
- `'opens Add Gear from the FAB'`

- [ ] **Step 2–4:** fail → implement → pass

- [ ] **Step 5: Commit** — `Add the Depot list`

---

### Task 21: F1 Add Gear, and the Home picker

**Files:**
- Create: `app/src/screens/AddGear.tsx` + module CSS + test
- Create: `app/src/components/HomePicker.tsx` + module CSS + test

**Add Gear** — name · a container toggle · a Kind picker
(`SINGLE｜PER-PERSON｜COUNTED`) · an Owned-count field **shown only for
Counted** (invariant 6) · Home. Submitting emits a single `gear.recorded`
carrying every field the form holds, and navigates to the new gear's detail.

**The Home picker** is one sheet, used by Add Gear and by `MOVE` (Task 22).
It lists Places, the containers within them, and `Loose`; it creates a Place
inline; it renames and **removes** one.

**Removing a Place or a Container that still holds gear confronts the
quartermaster with that gear becoming loose** — story 1's last acceptance
criterion, and the only place in S2a where `place.removed` and invariant 4 are
visible. The confirmation names the count: `4 pieces of gear become loose.`
Nothing is cascaded and nothing is deleted; the residence registers keep
pointing at the removed holder, so a restore restores the arrangement.

- [ ] **Step 1: Write the failing Tier 3 tests**, by exact name:

`AddGear.test.tsx`:
- `'emits one gear.recorded carrying every field the form holds'`
- `'shows the owned-count field only when Counted is chosen'`
- `'omits owned_count from the payload for single and per-person gear'`
- `'defaults the kind to single'`
- `'records a container when the container toggle is on'`
- `'records gear as loose when no home is chosen'`
- `'refuses to submit without a name'`

`HomePicker.test.tsx`:
- `'lists places, their containers, and loose'`
- `'creates a Place inline and emits place.recorded'`
- `'renames a Place and emits place.renamed'`
- `'names the count of gear that becomes loose before removing a Place'`
- `'emits place.removed only after the confirmation'`
- `'emits nothing when the confirmation is dismissed'`
- `'does not offer a non-container piece of gear as a home'` — invariant 2
- `'does not offer a container as a home for itself or its own descendants'` —
  invariant 3, guarded in the UI as well as broken in the selector

- [ ] **Step 2–4:** fail → implement → pass

- [ ] **Step 5: Commit** — `Add F1 Add Gear and the home picker`

---

### Task 22: Gear detail — identity and action bar

**Files:**
- Create: `app/src/screens/GearDetail.tsx` + module CSS + test

**Design source:** `docs/design/README.md` §4. **S2a builds the top and the
bottom of this screen; S2b fills in the middle.** Header `‹ DEPOT` + the sync
line; the gear name as the title; the meta line `ITEM · SHARED · ×2` (the MVP
variant — no weight); tag chips are S3 and are not rendered. Action bar:
bordered 44px `MOVE` and `EDIT`, with **`RETIRE` right-aligned as
attention-coloured text, never a filled red button.**

`gear.restored` is **protocol-present and UI-deferred**: the op exists and its
merge behaviour is pinned by Task 6's tests, but managing Retired Gear as a
view is story 19, tagged Later. No Retired screen is built. A retired piece of
gear reached by URL renders struck-through and muted with `RETIRED`, and its
action bar offers nothing.

- [ ] **Step 1: Write the failing Tier 3 tests**, by exact name:

- `'shows the gear name and the MVP meta line'`
- `'shows ×N in the meta line only for counted gear'`
- `'MOVE opens the home picker and emits gear.rehomed'`
- `'EDIT renames and emits gear.renamed'`
- `'EDIT changes the owned-count and emits gear.owned_count_set'`
- `'EDIT changes the kind and emits gear.kind_set'`
- `'RETIRE emits gear.retired only after the confirmation'`
- `'gives RETIRE a class distinct from the bordered MOVE/EDIT buttons'`

  *(Renamed after implementation, from `'renders RETIRE as text, not as a
  filled button'`. jsdom does not wire CSS Module rules to computed style —
  `css: true` was tried and reverted — so no test here can see whether the
  button is filled. The original name promised coverage the tooling cannot
  provide. **The visual rule still holds and rests on review**, and the test
  file says so at the assertion.)*

- `'renders a retired piece of gear struck through, with no actions'`
- `'does not crash or show a false owned-count for an unrecognised kind'` —
  obligation 4, as far as this screen can carry it.

  *(Renamed after implementation. It read `'renders an unknown kind value
  verbatim rather than crashing'`, written before the meta line's first
  segment was settled as the **containment trait** rather than the Kind.
  Once Kind has no token on this line there is nothing for the screen to
  render verbatim, so the name asserted the opposite of what the test
  checks. Verbatim retention is the reducer's obligation and is tested
  there.)*

- [ ] **Step 2–4:** fail → implement → pass

- [ ] **Step 5: Commit** — `Add the gear detail screen`

---

### Task 23: Wire the app, extend Tier 5, amend the docs

**Files:**
- Modify: `app/src/App.tsx`, `app/src/main.tsx`
- Modify: `test/e2e/shell.spec.ts` (or add `test/e2e/depot.spec.ts`)
- Modify: `docs/architecture-design.md`, `docs/sync-protocol.md`,
  `docs/testing.md`, `CLAUDE.md`

**Wiring.** Construct the op log, the HLC clock (restoring `meta.hlc`), the
transport, the sync engine and the store once, from the session, and provide
them through a context. `AppShell`'s existing `syncLine` prop now carries the
engine's real status rather than `navigator.onLine`: sage dot `SYNCED`, amber
dot `OFFLINE`, and `SIGNED OUT · SAVED ON DEVICE` on a 401 — one quiet header
line, never a blocking dialog. Start the engine on sign-in; stop and clear on sign-out
— **`sign out this device` is the only auth action that clears the local log**,
and the design's confirm sheet already states the unsynced count, which now has
a real number behind it (`deadLetterCount` plus the outbox length).

**Tier 5.** Extend the golden path to sign in → add gear → see it in the Depot,
with the offline leg: `context.setOffline(true)`, add a piece of gear, go back
online, assert the outbox flushes and the gear survives a reload.

**Doc amendments** (all of them, in this commit):

| Document | Change |
| --- | --- |
| `architecture-design.md` §8.3 | S2 recorded as two commits, S2a and S2b; `person.recorded` promoted out of S4; the per-slice op tally re-summed so it still reaches 38 |
| `architecture-design.md` §12.3 | **New.** The consequences of this slice, in the register §12.1 and §12.2 use: the `lsn` key, the seq-allocation order, `household_seq` on pull, and `fast-check`/`zustand` |
| `sync-protocol.md` §4.2 | `person.recorded` attributed to S2, `person.renamed` to S4 |
| `sync-protocol.md` §6.4 | `household_seq` added to the pull response, with the reasoning from the spec's §3 |
| `sync-protocol.md` §6.3 | The op-count cap answers 413, and why |
| `testing.md` | UUID registry slot #4 |
| `CLAUDE.md` | Current status: S2a landed; what it delivers; what S2b still owes |

- [ ] **Step 1: Write the failing Tier 5 test**

- [ ] **Step 2: Run and watch it fail** — `npm run test:e2e`

- [ ] **Step 3: Wire the app**

- [ ] **Step 4: Run the whole pyramid**

```
npm run typecheck && npm run lint && npm run format:check
npm test
npm run test:server
npm run test:e2e
```

Every one must be green. **Do not proceed on a red tier**, and do not report
the slice as done without having seen this output.

- [ ] **Step 5: Amend the docs, squash, and merge**

Squash the branch to one commit with `git rebase -i main`, then
`git checkout main && git merge --ff-only s2a-depot`. Never a merge commit.
Commit message subject: `Add S2a: the op log, /sync, and the Depot`.
---

# Part B — S2b: find it

Delivers story 3's Home path and closes the first-sync fold architecture §12.2
records as owed. **Zero new op types, zero new endpoints** — purely additive
client read-side code. Branch `s2b-find` from `main` once S2a has landed.

---

### Task 24: Whereabouts and find selectors

**Files:**
- Create: `shared/src/selectors/whereabouts.ts`, `shared/src/selectors/find.ts`, and their tests
- Modify: `shared/src/index.ts`

**Interfaces:**
- Produces:
  - `type WhereaboutsSlice = { kind: 'home'; path: PathSegment[]; count: number }`
  - `interface Whereabouts { gearId: string; slices: WhereaboutsSlice[] }`
  - `whereabouts(state: HouseholdState, gearId: string, view?: ContainmentView): Whereabouts`
  - `interface Match { gear: GearState; path: PathSegment[] }`
  - `findGear(state: HouseholdState, query: string): readonly Match[]`

**Design notes.**

- **Whereabouts is derived on demand, never stored** (story 3, domain §4).
- In S2b it returns exactly one `home` slice, because trip residences do not
  exist yet. **The return type is a list of slices from the start**, because
  story 3's second and third clauses — the trip residence and the quantity
  split — are stories 9, 10 and 11, and a single-answer shape would have to be
  rewritten rather than extended. `count` is `ownedCount ?? 1`.
- Do **not** build the `unaccounted for` standing (story 3's last clause). It
  reads an unpack outcome, and outcomes arrive in S12. Leave a one-line comment
  naming the seam; do not stub it.
- `findGear` matches on name, case- and diacritic-insensitively
  (`localeCompare` with `sensitivity: 'base'`, or `normalize('NFD')` with
  combining marks stripped — a household with `Ölzeug` on the shelf must find
  it by typing `olzeug`). Retired gear is excluded. Results are sorted by name.

- [ ] **Step 1: Write the failing tests**, by exact name:

`whereabouts.test.ts`:
- `'reports one home slice with the full path'`
- `'reports a count of 1 for single and per-person gear'`
- `'reports the owned-count for counted gear'`
- `'reports an empty path for loose gear'`
- `'reports gear at a removed Place as loose without cascading'`

`find.test.ts`:
- `'matches on a substring of the name'`
- `'matches case-insensitively'`
- `'matches with diacritics folded'`
- `'excludes retired gear'`
- `'returns an empty list for an empty query'`
- `'sorts matches by name'`
- `'carries each match`s home path'`

- [ ] **Step 2–4:** fail → implement → pass

- [ ] **Step 5: Commit** — `Add the whereabouts and find selectors`

---

### Task 25: F2 Find

**Files:**
- Create: `app/src/screens/Find.tsx` + module CSS + test
- Modify: `app/src/App.tsx` (the `/find` route)

**Design source:** `docs/design/README.md` §6. A 48px search field with an
amber border and caret; a result count line `4 MATCHES · ON-DEVICE INDEX`;
answer-first result cards — a gear header row (name + `PER-PERSON · ×3`) then
one row per slice with its whereabouts in mono 11, muted for home; plain
matches render as standard 2-line rows. `RECENT` is mono 44px rows. The tab bar
has `FIND` active. The header carries the `OFFLINE` amber-dot state — search
works fully on-device and must be seen to.

- [ ] **Step 1: Write the failing Tier 3 tests**, by exact name:

- `'shows nothing until something is typed'`
- `'reports the match count'`
- `'shows the full home path for each match'`
- `'shows the split whereabouts card for counted gear'`
- `'says there are no matches rather than showing an empty list'`
- `'keeps working while offline'`
- `'opens gear detail from a match'`
- `'lists recent searches'`

- [ ] **Step 2–4:** fail → implement → pass

- [ ] **Step 5: Commit** — `Add F2 Find`

---

### Task 26: The gear detail's Whereabouts card and COUNT group

**Files:**
- Modify: `app/src/screens/GearDetail.tsx` + module CSS + test
- Create: `app/src/components/WhereaboutsCard.tsx` + module CSS + test

**Design source:** `docs/design/README.md` §4. The Whereabouts card is a
surface at radius 12 with stacked rows: `⌂ HOME SLOT` (label mono 8.5 faint,
path mono 12) with `×1 THERE`, and a footer hint
`SPLIT COUNT — BOTH TRUE AT ONCE. HOME SLOT IS KEPT WHILE OUT.` The `COUNT`
group carries `×2 OWNED` on the right, one split-whereabouts quantity line of
chips, and the hint `COUNTED GEAR HAS NO PER-UNIT IDENTITY — UNITS THAT DIFFER
ARE SEPARATE SINGLE GEAR.`

**No per-unit rows, no condition, no purchase year, anywhere.** That is a
vocabulary guard, not a layout preference: depot units of counted gear have no
identity and no name. The `LEDGER` group is **story 33, Later** — do not build
it, and do not leave a placeholder for it.

The `▸ ON TRIP` row and the `▲ UNACCOUNTED` variant are stories 9–11. Render
only the home slice; the component takes a `WhereaboutsSlice[]` so the others
slot in without a rewrite.

- [ ] **Step 1: Write the failing Tier 3 tests**, by exact name:

- `'shows the home slot with its full path'`
- `'shows the split-count hint'`
- `'shows the COUNT group only for counted gear'`
- `'shows ×N OWNED in the COUNT group'`
- `'renders no per-unit rows'`
- `'renders no LEDGER group'`
- `'shows an empty path as loose rather than as a blank row'`

- [ ] **Step 2–4:** fail → implement → pass

- [ ] **Step 5: Commit** — `Add the whereabouts card and the count group`

---

### Task 27: The first-sync fold

**Files:**
- Create: `app/src/components/FirstSync.tsx` + module CSS + test
- Modify: `app/src/screens/Join.tsx`, `app/src/App.tsx`

This is what [architecture §12.2](../architecture-design.md) records as owed by
S2, and it is the app's **only unavoidable loading screen**.

**Design source:** `docs/design/README.md` §9, exactly. Title `Signed in.`;
`Els · Veldkamp`; a `FIRST SYNC — ONE-TIME` card carrying a **determinate ops
fold, never a spinner**: `36%`, a 6px bar, mono `OP 4,215 OF 11,562 FOLDED`,
and the copy `This device folds the household's history once. After this it
starts instantly and works offline.` The CTA is **gated**: muted
`Open the depot — folding 36%` until the fold completes.

**Paused, not failed.** On a dropped connection: `FIRST SYNC — PAUSED` ·
`OP 4,215 OF 11,562 · CURSOR KEPT` · a quiet `RETRY NOW` · and
`Connection dropped. It continues from op 4,215 when the line returns —
nothing restarts.` **The offline dot is the only amber and there is no ▲.**
This is not an error state and must never read as one.

**Where it runs.** The bootstrap is a state of the sync engine, not a property
of the join screen: it runs whenever a signed-in device holds an empty local
log and `household_seq > 0` — the join success screen, a freshly linked device,
and a sign-in after a local wipe. `FirstSync` composes into the join card and
renders full-screen ahead of the shell everywhere else.

**The denominator arrives with the first page, not before it.** `household_seq`
comes back *in* the pull response, so the card reads `OP 0 OF —` for exactly
one round trip. That is accepted; the alternative is a round trip spent on
nothing but a number. A brand-new household has nothing to fold and the CTA is
enabled immediately — which is why today's ungated screen is correct as it
stands and only becomes wrong once a household has a history.

- [ ] **Step 1: Write the failing Tier 3 tests**, by exact name:

- `'gates the CTA until the fold completes'`
- `'shows the ops folded and the total'`
- `'shows a dash for the total before the first page arrives'`
- `'shows the percentage in the CTA label while folding'`
- `'enables the CTA immediately for a household with nothing to fold'`
- `'shows PAUSED with the cursor kept when a page fails'`
- `'renders no attention triangle in the paused state'`
- `'resumes from the kept cursor on RETRY NOW rather than restarting'`
- `'renders full-screen when a signed-in device has an empty log'`

- [ ] **Step 2–4:** fail → implement → pass

- [ ] **Step 5: Commit** — `Add the first-sync fold`

---

### Task 28: Finish S2b — Tier 5, docs, merge

**Files:**
- Modify: `test/e2e/depot.spec.ts`, `docs/architecture-design.md`, `CLAUDE.md`

- [ ] **Step 1: Extend the Tier 5 golden path** to sign in → add gear → **find
it** → open its detail, keeping the offline leg from Task 23.

- [ ] **Step 2: Run the whole pyramid**

```
npm run typecheck && npm run lint && npm run format:check
npm test
npm run test:server
npm run test:e2e
```

- [ ] **Step 3: Amend the docs**

- `architecture-design.md` §12.2 — mark "S2 owes the gated variant" **closed**,
  naming the commit.
- `architecture-design.md` §8.3 — S2b landed.
- `CLAUDE.md` — current status: the Depot is complete; the next slice is S3,
  Tags and the slicing engine.

- [ ] **Step 4: Squash and merge**

`git rebase -i main`, then `git checkout main && git merge --ff-only s2b-find`.
Subject: `Add S2b: Find, whereabouts, and the first-sync fold`.

- [ ] **Step 5: Confirm the slice's obligations were kept**

Not a formality — each of these is something a slice can pass its own tests
while breaking:

- Every one of the eleven op types has a **fixture captured in S2a's commit**.
- `householdIsolation.test.ts` covers **both** halves — reads and writes.
- No op type outside `sync-protocol.md` §4 was invented.
- Nothing in `docs/domain-model.md`, `docs/ubiquitous-language.md`,
  `docs/user-stories.md` or `examples/` acquired a table, a field, or a
  framework.
- `main` gained exactly **two** commits, and `git log --graph` is a straight
  line.
