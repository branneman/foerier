# S4 — People and Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship story 4 — People are recorded and renamed, Gear is marked Personal-to-a-Person or Shared, and the Depot narrows to either — delivered through S3's slicing engine rather than beside it.

**Architecture:** Two op types and two reducer handlers in `shared/`; one new selector module (`ownerLabel`); two new rows in S3's dimension table plus a grouping table beside it; one new screen (`People`), one new sheet (`OwnerPicker`), and edits to five existing screens in `app/`. **No endpoints, no migration, no server change** — a domain slice adds no HTTP surface.

**Tech Stack:** TypeScript · React 19 · wouter · Zustand · CSS Modules · Radix (`ui/`'s `Sheet`) · Vitest · Testing Library

**Spec:** [`docs/specs/2026-08-29-people-and-ownership.md`](2026-08-29-people-and-ownership.md) — read it alongside this plan. Where they disagree, **the spec wins**; where the spec and `docs/design/*.dc.html` disagree, **the boards win**.

## Global Constraints

- **Relative imports in `shared/` need an explicit `.ts` extension.** `app/` and `ui/` are the exception — Vite resolves, so no extension there.
- **Ops mirror the wire — `snake_case`, never transformed.** Folded state, selectors and React props are ordinary `camelCase`. `authoring.ts` and `payloads.ts` are the only two places the boundary is crossed.
- **`null` clears a nullable register; an absent field leaves it alone.** [sync §1.3](../sync-protocol.md) is the authority — *not* §5.3 obligation 5, which runs the other way only.
- **A register whose declared type includes `null` takes an explicit `null` as a clear; one whose type does not treats `null` as malformed and ignores it.** `PersonState.name` is `Register<string | null>`, so `person.renamed` goes through `writeNullableIfPresent`. `GearState.owner` is `Register<Owner>`, so `gear.ownership_set` goes through `writeRegister` behind a `kind !== 'value'` guard.
- **Every handler propagates identity on a lost write.** If `writeRegister` returns the register it was given, the handler returns the *identical* entity object and `writeGear`/`writePerson` return the identical `HouseholdState`. A spread on a lost write invalidates a memo downstream for nothing.
- **An absent `owner` register reads `SHARED`** (spec §1.3). Read it through `ownerOf`, never by re-deriving `gear.owner?.value ?? …` at a call site.
- **A media query decides which elements *exist*; a container query decides how what exists *lays out*** ([frontend-design §3.2](../frontend-design.md)).
- **Tier 0 runs on every commit** (pre-commit: `tsc --noEmit` across workspaces, ESLint, Prettier). A commit that fails it is not a commit.
- **Vocabulary is law.** Person · Personal · Shared · Owner · Depot · Gear · Quartermaster. Never "user", never "profile", and never "owner" for a Login-holder.
- **Known-flaky neighbour:** `api/test/server/sync.test.ts` fails nondeterministically in the full suite and passes alone. This slice touches no `api/` file; if it fails, re-run it alone to confirm the known flake.
- **Commands.** `npm test -w @foerier/shared`, `npm test -w @foerier/app`, `npm test` (all), `npm run typecheck`.

---

## File Structure

**`shared/` — the fold and the engine**

| Path | Responsibility |
| --- | --- |
| `shared/src/authoring.ts` | Modify: add `personRenamed`, `gearOwnershipSet` |
| `shared/src/reduce.ts` | Modify: `personRecorded` → `setPersonName` under two keys; add the `gear.ownership_set` handler |
| `shared/src/selectors/owner.ts` | **Create**: `ownerOf`, `ownerLabel`, `personLabel` — the one place absence means Shared |
| `shared/src/selectors/slice.ts` | Modify: two dimension rows; `format` gains `state`; the grouping table; `groupGear` generalised |
| `shared/src/index.ts` | Modify: the new exports |
| `shared/testUtils/factories.ts` | Modify: `aGear` gains an `owner` override; add `aPerson` |

**`shared/` tests**

| Path | Responsibility |
| --- | --- |
| `shared/src/reduce.test.ts` | Modify: `person.renamed`, `gear.ownership_set` folds |
| `shared/src/selectors/owner.test.ts` | **Create**: the `ownerLabel` cases |
| `shared/src/selectors/slice.test.ts` | Modify: the two dimensions, story 4's narrowings, the empty pair, grouping by owner |
| `shared/src/convergence.test.ts` | Modify: two Tier 2 scenarios |

**`app/` — the screens**

| Path | Responsibility |
| --- | --- |
| `app/src/components/OwnerPicker.tsx` (+ `.module.css`) | **Create**: the sheet both callers open |
| `app/src/screens/People.tsx` (+ `.module.css`) | **Create**: the People screen, EDIT mode, `+ NEW PERSON` |
| `app/src/components/SliceBar.tsx` | Modify: `formatFor` prop; `groupLabel` from `shared/` |
| `app/src/components/SortGroupSheet.tsx` | Modify: `GROUPS` derived from `GROUP_KEYS` |
| `app/src/household/slicePrefs.ts` | Modify: `GROUPS` ← `GROUP_KEYS` |
| `app/src/screens/AddGear.tsx` (+ `.module.css`) | Modify: the `OWNER` row after `HOME`, carrying over |
| `app/src/screens/GearDetail.tsx` | Modify: `ownerLabel` from `shared/`; `OWNER` row in the Edit sheet |
| `app/src/screens/Depot.tsx` | Modify: owner in the meta line and the table column; `formatFor` |
| `app/src/screens/Account.tsx` | Modify: the `PEOPLE` section, phone summary + desktop inline |
| `app/src/App.tsx` | Modify: the `/account/people` route and its Desktop redirect |

**Docs**

| Path | Responsibility |
| --- | --- |
| `docs/sync-protocol.md` | §4.2 — `person.renamed` typed `{name: string｜null}`; the deferral note retires |
| `docs/architecture-design.md` | §12.10; §8.3's S4 entry marked landed |
| `docs/design/README.md` | §2, §3b, §13 — the two departures and the three S5 obligations |
| `CLAUDE.md` | Status |

---

## Task 1: The two ops fold

**Files:**
- Modify: `shared/src/authoring.ts`
- Modify: `shared/src/reduce.ts` (the `personRecorded` handler and the dispatch table)
- Modify: `shared/testUtils/factories.ts`, `shared/src/index.ts`
- Test: `shared/src/reduce.test.ts`

**Interfaces:**
- Consumes: `writeNullableIfPresent`, `writeRegister`, `writePerson`, `writeGear`, `readOwner`, `readString` — all already in `reduce.ts`/`payloads.ts`.
- Produces: `personRenamed(id: string, name: string | null): OpSpec`; `gearOwnershipSet(id: string, owner: Owner): OpSpec`; factory `aPerson(overrides?: {id?, name?}): OpSpec[]`; `aGear`'s new `owner?: Owner` override.

- [ ] **Step 1: Write the failing tests**

Append to `shared/src/reduce.test.ts`, matching the file's existing `describe`/`it` style and extending its import block with `personRenamed`, `gearOwnershipSet`, `gearRetired`, `aGear`, `aPerson`:

```ts
describe('person.renamed', () => {
  it('sets the name', () => {
    const state = fold(emptyState(), [
      anOp(personRecorded('p1', 'Els'), { hlc: hlcAt(1), deviceId: 'a' }),
      anOp(personRenamed('p1', 'Elsje'), { hlc: hlcAt(2), deviceId: 'a' }),
    ])
    expect(state.people['p1']?.name?.value).toBe('Elsje')
  })

  it('takes an explicit null as a clear', () => {
    const state = fold(emptyState(), [
      anOp(personRecorded('p1', 'Els'), { hlc: hlcAt(1), deviceId: 'a' }),
      anOp(personRenamed('p1', null), { hlc: hlcAt(2), deviceId: 'a' }),
    ])
    expect(state.people['p1']?.name?.value).toBeNull()
  })

  it('leaves the name alone when the field is absent', () => {
    const before = fold(emptyState(), [
      anOp(personRecorded('p1', 'Els'), { hlc: hlcAt(1), deviceId: 'a' }),
    ])
    const after = applyOp(before, {
      ...anOp(personRenamed('p1', 'ignored'), { hlc: hlcAt(2), deviceId: 'a' }),
      payload: {},
    })
    expect(after).toBe(before)
  })

  it('creates the Person when it arrives out of authoring order', () => {
    const state = fold(emptyState(), [
      anOp(personRenamed('p1', 'Els'), { hlc: hlcAt(2), deviceId: 'a' }),
    ])
    expect(state.people['p1']?.name?.value).toBe('Els')
  })

  it('loses to a later rename and propagates identity', () => {
    const seeded = fold(emptyState(), [
      anOp(personRecorded('p1', 'Els'), { hlc: hlcAt(1), deviceId: 'a' }),
      anOp(personRenamed('p1', 'Late'), { hlc: hlcAt(9), deviceId: 'b' }),
    ])
    const after = applyOp(
      seeded,
      anOp(personRenamed('p1', 'Early'), { hlc: hlcAt(5), deviceId: 'a' }),
    )
    expect(after).toBe(seeded)
  })
})

describe('gear.ownership_set', () => {
  /** `aGear` returns specs; this folds them at consecutive stamps. */
  function seedGear(id: string) {
    return aGear({ id }).map((spec, i) =>
      anOp(spec, { hlc: hlcAt(i + 1), deviceId: 'a' }),
    )
  }

  it('sets a personal owner', () => {
    const state = fold(emptyState(), [
      ...seedGear('g1'),
      anOp(gearOwnershipSet('g1', { type: 'person', personId: 'p1' }), {
        hlc: hlcAt(5),
        deviceId: 'a',
      }),
    ])
    expect(state.gear['g1']?.owner?.value).toEqual({
      type: 'person',
      personId: 'p1',
    })
  })

  it('sets shared back over a personal owner', () => {
    const state = fold(emptyState(), [
      ...seedGear('g1'),
      anOp(gearOwnershipSet('g1', { type: 'person', personId: 'p1' }), {
        hlc: hlcAt(5),
        deviceId: 'a',
      }),
      anOp(gearOwnershipSet('g1', { type: 'shared' }), {
        hlc: hlcAt(6),
        deviceId: 'a',
      }),
    ])
    expect(state.gear['g1']?.owner?.value).toEqual({ type: 'shared' })
  })

  it('ignores a malformed owner and returns the identical state', () => {
    const before = fold(emptyState(), seedGear('g1'))
    const after = applyOp(before, {
      ...anOp(gearOwnershipSet('g1', { type: 'shared' }), {
        hlc: hlcAt(5),
        deviceId: 'a',
      }),
      payload: { owner: { type: 'nonsense' } },
    })
    expect(after).toBe(before)
  })

  it('loses to a later write and propagates identity', () => {
    const seeded = fold(emptyState(), [
      ...seedGear('g1'),
      anOp(gearOwnershipSet('g1', { type: 'person', personId: 'late' }), {
        hlc: hlcAt(9),
        deviceId: 'b',
      }),
    ])
    const after = applyOp(
      seeded,
      anOp(gearOwnershipSet('g1', { type: 'person', personId: 'early' }), {
        hlc: hlcAt(5),
        deviceId: 'a',
      }),
    )
    expect(after).toBe(seeded)
  })

  it('never touches the tombstone', () => {
    const state = fold(emptyState(), [
      ...seedGear('g1'),
      anOp(gearRetired('g1'), { hlc: hlcAt(5), deviceId: 'a' }),
      anOp(gearOwnershipSet('g1', { type: 'person', personId: 'p1' }), {
        hlc: hlcAt(6),
        deviceId: 'a',
      }),
    ])
    expect(state.gear['g1']?.retired?.value).toBe(true)
    expect(state.gear['g1']?.owner?.value).toEqual({
      type: 'person',
      personId: 'p1',
    })
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test -w @foerier/shared -- reduce`
Expected: FAIL — `personRenamed` and `gearOwnershipSet` are not exported from `authoring.ts`.

- [ ] **Step 3: Add the two authoring functions**

Append to `shared/src/authoring.ts`, after `personRecorded`. `Owner` is already imported by this file (for `gearRecorded`'s `fields.owner`) — confirm rather than re-adding it.

```ts
/**
 * `sync-protocol.md` §4.2: sets `name`.
 *
 * **`string | null`, settled by this slice.** §4.2 typed the row `{name}` and
 * said in as many words that the slice which folds it settles the question.
 * `PersonState.name` is `Register<string | null>`, so an explicit `null` is a
 * clear like any other write and an absent field leaves the register alone
 * (§1.3). No carve-out: this is the rule the four other name registers already
 * follow.
 *
 * `personRecorded` above keeps its `string` parameter. Its only callers — the
 * join screen and the People screen's `+ NEW PERSON` — have a name in hand,
 * and a Person recorded with no name is not a state any screen can author.
 */
export function personRenamed(id: string, name: string | null): OpSpec {
  return {
    aggregate: 'person',
    aggregate_id: id,
    type: 'person.renamed',
    payload: { name },
  }
}

/**
 * `sync-protocol.md` §4.3: sets `owner`.
 *
 * The cheapest op in the catalogue after the tag pair — `wireOwner` already
 * existed, because `gear.recorded` may carry `owner?` and S2 wired the mapping
 * for it.
 */
export function gearOwnershipSet(id: string, owner: Owner): OpSpec {
  return {
    aggregate: 'gear',
    aggregate_id: id,
    type: 'gear.ownership_set',
    payload: { owner: wireOwner(owner) },
  }
}
```

- [ ] **Step 4: Fold the two ops**

In `shared/src/reduce.ts`, rename the `personRecorded` handler to `setPersonName` and replace its doc comment:

```ts
/**
 * `person.recorded` and `person.renamed` both just set `name`
 * (`sync-protocol.md` §4.2) — the entity itself is created by `writePerson`
 * either way, out of authoring order or not (§8.2). The same shape
 * `setPlaceName` above already has, for the same reason.
 *
 * **`person.renamed` joined this handler at S4**, and settled §4.2's deferred
 * question by doing so: `PersonState.name` is `Register<string | null>`, so
 * `writeNullableIfPresent`'s rule applies unchanged and an explicit `null`
 * clears. §4.2's "left as `{name}` until the slice that folds it" note retires
 * with this line.
 */
const setPersonName: Handler = (state, op, stamp) =>
  writePerson(state, op.aggregate_id, stamp, (person, st) => {
    const next = writeNullableIfPresent(
      person.name,
      readString(op.payload, 'name'),
      st,
    )
    if (next === person.name) return person
    return next === undefined ? person : { ...person, name: next }
  })

/**
 * `gear.ownership_set` (§4.3): sets `owner`. One register, one value — the
 * domain's "personal to one person, **or** shared" is structural, so there is
 * nothing to guard.
 *
 * An **absent** register is not the same fact as `{type:'shared'}`, and this
 * handler never conflates them: it writes only what arrived. That the two
 * *read* alike is `selectors/owner.ts`'s decision, made once, on the way out.
 */
const gearOwnershipSet: Handler = (state, op, stamp) =>
  writeGear(state, op.aggregate_id, stamp, (gear, st) => {
    const owner = readOwner(op.payload, 'owner')
    if (owner.kind !== 'value') return gear
    const next = writeRegister(gear.owner, owner.value, st)
    return next === gear.owner ? gear : { ...gear, owner: next }
  })
```

In the `handlers` table, add `'gear.ownership_set': gearOwnershipSet,` with the other `gear.*` rows (above `gear.tag_applied`), and replace `'person.recorded': personRecorded,` with:

```ts
  'person.recorded': setPersonName,
  'person.renamed': setPersonName,
```

Delete the stale "Task 7 extends this table with Person" sentence from the table's doc comment.

- [ ] **Step 5: Extend the factories**

In `shared/testUtils/factories.ts`, add `Owner` to the `state.ts` type import and `personRecorded` to the `authoring.ts` import, then:

```ts
export function aGear(
  overrides: Partial<{
    id: string
    name: string
    container: boolean
    kind: KindValue
    residence: Residence
    ownedCount: number
    owner: Owner
  }> = {},
): OpSpec[] {
  const id = overrides.id ?? freshId('20000000')
  return [
    gearRecorded(id, {
      name: overrides.name ?? 'Tent',
      container: overrides.container ?? false,
      kind: overrides.kind ?? 'single',
      ...(overrides.residence === undefined
        ? {}
        : { residence: overrides.residence }),
      ...(overrides.ownedCount === undefined
        ? {}
        : { owned_count: overrides.ownedCount }),
      ...(overrides.owner === undefined ? {} : { owner: overrides.owner }),
    }),
  ]
}

/**
 * The ops that record one Person: just `person.recorded`. A Person is an id
 * and a name and nothing else, so unlike `aGear` there is nothing to leave
 * deliberately absent.
 */
export function aPerson(
  overrides: Partial<{ id: string; name: string }> = {},
): OpSpec[] {
  const id = overrides.id ?? freshId('40000000')
  return [personRecorded(id, overrides.name ?? 'Els')]
}
```

`40000000` is a fresh prefix: `10000000` is Place, `20000000` Gear, `30000000` op ids.

- [ ] **Step 6: Export the new surface**

In `shared/src/index.ts`, add `gearOwnershipSet` (after `gearOwnedCountSet`) and `personRenamed` (after `personRecorded`) to the `authoring.ts` export block. Add `aPerson` beside `aGear` in `shared/testUtils/index.ts`.

- [ ] **Step 7: Run the tests**

Run: `npm test -w @foerier/shared`
Expected: PASS, with the pre-existing `person.recorded` tests unchanged.

- [ ] **Step 8: Commit**

Stage `shared/src/authoring.ts`, `shared/src/reduce.ts`, `shared/src/index.ts`, `shared/testUtils/factories.ts`, `shared/testUtils/index.ts`, `shared/src/reduce.test.ts`.

Message: *Fold the two ops S4 owes, and answer a question §4.2 deferred* — `person.renamed` joins `person.recorded` in one handler because both only set `name`, and typing it `string | null` is the answer sync-protocol §4.2 explicitly left to this slice.

---

## Task 2: `ownerLabel` — the one place absence means Shared

**Files:**
- Create: `shared/src/selectors/owner.ts`, `shared/src/selectors/owner.test.ts`
- Modify: `shared/src/index.ts`, `app/src/screens/GearDetail.tsx` (delete the private copy)

**Interfaces:**
- Consumes: `HouseholdState`, `GearState`, `Owner` from `state.ts`; the factories from Task 1.
- Produces: `ownerOf(gear: GearState): Owner`; `ownerLabel(state: HouseholdState, gear: GearState): string`; `personLabel(state: HouseholdState, personId: string): string`.

- [ ] **Step 1: Write the failing test**

Create `shared/src/selectors/owner.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { anOp, aGear, aPerson, hlcAt } from '../../testUtils/index.ts'
import type { OpSpec } from '../authoring.ts'
import { emptyState, fold } from '../reduce.ts'
import { ownerLabel, ownerOf, personLabel } from './owner.ts'

function depot(...specs: OpSpec[][]) {
  return fold(
    emptyState(),
    specs
      .flat()
      .map((spec, i) => anOp(spec, { hlc: hlcAt(i + 1), deviceId: 'a' })),
  )
}

describe('ownerOf', () => {
  it('reads an absent register as shared', () => {
    const state = depot(aGear({ id: 'g1' }))
    expect(ownerOf(state.gear['g1']!)).toEqual({ type: 'shared' })
  })

  it('reads a written register as written', () => {
    const state = depot(
      aGear({ id: 'g1', owner: { type: 'person', personId: 'p1' } }),
    )
    expect(ownerOf(state.gear['g1']!)).toEqual({
      type: 'person',
      personId: 'p1',
    })
  })
})

describe('ownerLabel', () => {
  it('reads SHARED for an absent register', () => {
    const state = depot(aGear({ id: 'g1' }))
    expect(ownerLabel(state, state.gear['g1']!)).toBe('SHARED')
  })

  it('reads SHARED for an explicit shared owner', () => {
    const state = depot(aGear({ id: 'g1', owner: { type: 'shared' } }))
    expect(ownerLabel(state, state.gear['g1']!)).toBe('SHARED')
  })

  it('reads PERSONAL plus the initial for a personal owner', () => {
    const state = depot(
      aPerson({ id: 'p1', name: 'Els' }),
      aGear({ id: 'g1', owner: { type: 'person', personId: 'p1' } }),
    )
    expect(ownerLabel(state, state.gear['g1']!)).toBe('PERSONAL E')
  })

  it('reads PERSONAL alone when there is no name to take an initial from', () => {
    const state = depot(
      aGear({ id: 'g1', owner: { type: 'person', personId: 'ghost' } }),
    )
    expect(ownerLabel(state, state.gear['g1']!)).toBe('PERSONAL')
  })
})

describe('personLabel', () => {
  it('reads the name as recorded, not upper-cased', () => {
    const state = depot(aPerson({ id: 'p1', name: 'Els' }))
    expect(personLabel(state, 'p1')).toBe('Els')
  })

  it('reads an em dash for a Person no op has named', () => {
    const state = depot(aGear({ id: 'g1' }))
    expect(personLabel(state, 'ghost')).toBe('—')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -w @foerier/shared -- selectors/owner`
Expected: FAIL — `./owner.ts` does not exist.

- [ ] **Step 3: Write the selector**

Create `shared/src/selectors/owner.ts`:

```ts
import type { HouseholdState, GearState, Owner } from '../state.ts'

/**
 * **Ownership on the way out** — the one module that decides what an ownership
 * register *reads* as, so no screen decides it twice.
 *
 * The register is `{type:'shared'} | {type:'person', personId}`
 * (`sync-protocol.md` §4.3) and is **optional**: gear recorded before S4, or
 * recorded by a screen that does not ask, carries no `owner` at all.
 *
 * ## An absent register reads SHARED
 *
 * No board draws an unowned state. Every Depot table row the boards draw reads
 * `SHARED` in the OWNER column — including `Tent, 2p (old)`, whose HOME column
 * reads `—`, so the boards plainly *can* draw "not recorded" for a field and
 * choose not to for this one.
 *
 * It matters more than a rendering convenience, which is why it lives here and
 * not at a call site: the Ownership dimension derives its values from this
 * function (`slice.ts`), so a filter disagreeing with a readout would be a bug
 * a Quartermaster can see — narrow to `OWNERSHIP: SHARED` and watch a row
 * labelled `SHARED` vanish.
 *
 * The **fold** conflates nothing: `reduce.ts` writes only what arrived, and an
 * absent register stays absent. The equivalence is stated once, here.
 */

const SHARED: Owner = { type: 'shared' }

/** The gear's owner, with an absent register read as shared. */
export function ownerOf(gear: GearState): Owner {
  return gear.owner?.value ?? SHARED
}

/**
 * `SHARED` or `PERSONAL E` — the Depot row's meta slot, the Depot table's
 * OWNER column and gear detail's meta line, which must agree.
 *
 * **The initial, not the name**, matching the person circle's own convention
 * everywhere else in the app. The boards spell it two ways — `PERSONAL E` on
 * Depot rows and `PERSONAL · E` on Packing rows — and this resolves to the
 * Depot's, because the Depot is what S4 ships and Packing's `·` is that
 * screen's separator between owner and count (`PERSONAL · E · ×2`), not a
 * different vocabulary. S9 inherits this function rather than re-deciding.
 *
 * A Person with no folded name yields **`PERSONAL`** alone: there is no
 * initial to draw, and inventing one would be a fact the app does not have.
 * That is `AppShell`'s `AccountAvatar` rule — "`null` draws an empty circle
 * rather than a placeholder letter" — applied to text.
 */
export function ownerLabel(state: HouseholdState, gear: GearState): string {
  const owner = ownerOf(gear)
  if (owner.type === 'shared') return 'SHARED'
  const initial = (state.people[owner.personId]?.name?.value ?? '')
    .trim()
    .charAt(0)
    .toUpperCase()
  return initial === '' ? 'PERSONAL' : `PERSONAL ${initial}`
}

/**
 * A Person's name for a chip, a picker row or a group header — sentence case,
 * as recorded, never upper-cased here (CAPS is a CSS transform where a surface
 * wants it, matching the rest of this codebase).
 *
 * An unnamed or unknown Person reads `—`, the same glyph the ungrouped bucket
 * uses. A chip with an empty label would look broken and a raw UUID would look
 * worse; `—` is selectable, countable, and honest.
 */
export function personLabel(state: HouseholdState, personId: string): string {
  const name = state.people[personId]?.name?.value ?? ''
  return name.trim() === '' ? '—' : name
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -w @foerier/shared -- selectors/owner`
Expected: PASS (8 tests).

- [ ] **Step 5: Export it, and delete the private copy**

In `shared/src/index.ts`, beside the other selector exports:

```ts
export { ownerLabel, ownerOf, personLabel } from './selectors/owner.ts'
```

In `app/src/screens/GearDetail.tsx`, delete the local `ownerLabel` function and its doc comment, and add `ownerLabel` to the existing `@foerier/shared` import. The `metaLine` call site is unchanged — the signature is identical.

- [ ] **Step 6: Run the tests**

Run: `npm test -w @foerier/app -- GearDetail` and `npm run typecheck`
Expected: PASS. `GearDetail` rendered `SHARED` before and renders `SHARED` now; only the string's origin changed.

- [ ] **Step 7: Commit**

Stage `shared/src/selectors/owner.ts`, `shared/src/selectors/owner.test.ts`, `shared/src/index.ts`, `app/src/screens/GearDetail.tsx`.

Message: *Say once what an absent owner means* — three surfaces need the answer at S4, and a filter disagreeing with a readout is a bug you can see.

---

## Task 3: Two rows in the dimension table

**Files:**
- Modify: `shared/src/selectors/slice.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/selectors/slice.test.ts`

**Interfaces:**
- Consumes: `ownerOf`, `personLabel` from Task 2.
- Produces: `DimensionId` widened to `'tag' | 'kind' | 'ownership' | 'person'`; `Dimension.format(value: string, state: HouseholdState): string` — **a signature change every caller must follow**.

- [ ] **Step 1: Write the failing tests**

Append to `shared/src/selectors/slice.test.ts`, following the file's existing helpers for building a depot and calling `sliceDepot`:

```ts
describe('the ownership dimension', () => {
  it('reads gear with no owner register as shared', () => {
    const state = depotOf(aGear({ id: 'g1' }))
    expect(dimension('ownership').valuesOf(state.gear['g1']!, state)).toEqual([
      'shared',
    ])
  })

  it('reads gear with a personal owner as personal', () => {
    const state = depotOf(
      aGear({ id: 'g1', owner: { type: 'person', personId: 'p1' } }),
    )
    expect(dimension('ownership').valuesOf(state.gear['g1']!, state)).toEqual([
      'personal',
    ])
  })

  it('offers both values with their counts', () => {
    const state = depotOf(
      aPerson({ id: 'p1', name: 'Els' }),
      aGear({ id: 'g1' }),
      aGear({ id: 'g2' }),
      aGear({ id: 'g3', owner: { type: 'person', personId: 'p1' } }),
    )
    expect(dimensionValues(state, 'ownership')).toEqual([
      { value: 'shared', count: 2 },
      { value: 'personal', count: 1 },
    ])
  })
})

describe('the person dimension', () => {
  it('carries no value for shared gear', () => {
    const state = depotOf(aGear({ id: 'g1' }))
    expect(dimension('person').valuesOf(state.gear['g1']!, state)).toEqual([])
  })

  it('formats a person id as the recorded name', () => {
    const state = depotOf(aPerson({ id: 'p1', name: 'Els' }))
    expect(dimension('person').format('p1', state)).toBe('Els')
  })

  it('omits a Person who owns nothing, because the vocabulary is derived', () => {
    const state = depotOf(
      aPerson({ id: 'p1', name: 'Els' }),
      aPerson({ id: 'p2', name: 'Kees' }),
      aGear({ id: 'g1', owner: { type: 'person', personId: 'p1' } }),
    )
    expect(dimensionValues(state, 'person')).toEqual([{ value: 'p1', count: 1 }])
  })
})

describe("story 4's two narrowings", () => {
  function household() {
    return depotOf(
      aPerson({ id: 'els', name: 'Els' }),
      aPerson({ id: 'mark', name: 'Mark' }),
      aGear({ id: 'tent', name: 'Tent' }),
      aGear({ id: 'stove', name: 'Stove' }),
      aGear({
        id: 'jacket',
        name: 'Down jacket',
        owner: { type: 'person', personId: 'els' },
      }),
      aGear({
        id: 'boots',
        name: 'Winter boots',
        owner: { type: 'person', personId: 'mark' },
      }),
    )
  }

  it('narrows to one Person’s Personal gear', () => {
    const result = sliceDepot(household(), {
      ...EMPTY_SLICE,
      filters: { person: ['els'] },
    })
    expect(result.shown).toBe(1)
    expect(result.groups[0]?.gear.map((g) => g.id)).toEqual(['jacket'])
  })

  it('narrows to Shared gear only, including gear with no owner register', () => {
    const result = sliceDepot(household(), {
      ...EMPTY_SLICE,
      filters: { ownership: ['shared'] },
    })
    expect(result.shown).toBe(2)
    expect(result.groups[0]?.gear.map((g) => g.id).sort()).toEqual([
      'stove',
      'tent',
    ])
  })

  it('narrows to all Personal gear, whoever’s', () => {
    const result = sliceDepot(household(), {
      ...EMPTY_SLICE,
      filters: { ownership: ['personal'] },
    })
    expect(result.shown).toBe(2)
  })

  it('returns nothing for the structurally contradictory pair, and counts it', () => {
    const result = sliceDepot(household(), {
      ...EMPTY_SLICE,
      filters: { ownership: ['shared'], person: ['els'] },
    })
    expect(result.shown).toBe(0)
    expect(result.total).toBe(4)
    expect(result.active).toBe(2)
    expect(result.groups).toEqual([])
  })
})
```

If `slice.test.ts` has no `depotOf` helper of this shape, add one modelled on `owner.test.ts`'s, and import `aPerson` and `dimensionValues`.

- [ ] **Step 2: Run and watch fail**

Run: `npm test -w @foerier/shared -- selectors/slice`
Expected: FAIL — `dimension('ownership')` is not a valid `DimensionId`.

- [ ] **Step 3: Widen `DimensionId` and give `format` the state**

In `shared/src/selectors/slice.ts`, import `ownerOf` and `personLabel` from `./owner.ts`, then:

```ts
export type DimensionId = 'tag' | 'kind' | 'ownership' | 'person'
```

Update the file's header table so it shows S4's row as landed rather than pending, and change the `format` member of `Dimension`:

```ts
  /**
   * How one value is drawn. Sentence case and the `#` a tag chip draws but
   * never stores; CAPS is a CSS transform where a surface wants it, matching
   * how the rest of this codebase renders label text.
   *
   * **`state` is here because a value is not always self-describing.** S3
   * anticipated this and put the parameter one function along, on `valuesOf`,
   * reasoning that "S4's Ownership resolves a `personId` to a Person" — the
   * anticipation was right and the placement was off by one. `valuesOf`
   * returns the id; it is `format` that has to turn it into a name.
   */
  format(value: string, state: HouseholdState): string
```

Give `tag` and `kind` the new signature (both ignore `state`), and add the two rows to `DIMENSION_TABLE` after `kind`:

```ts
  /**
   * **Personal or Shared** — the coarse projection of the one `owner`
   * register, and the only dimension whose `valuesOf` returns exactly one
   * value for every piece of gear in the depot. An absent register reads
   * shared (`selectors/owner.ts`), which is what makes this dimension agree
   * with what the row beside it draws.
   */
  ownership: {
    id: 'ownership',
    label: 'OWNERSHIP',
    arity: 'single',
    valuesOf: (gear) => [
      ownerOf(gear).type === 'shared' ? 'shared' : 'personal',
    ],
    format: (value) =>
      value === 'shared' ? 'Shared' : value === 'personal' ? 'Personal' : value,
  },
  /**
   * **Whose** — the fine projection of the same register. Shared gear carries
   * no value at all rather than a sentinel, so it simply never matches, and a
   * Person who owns nothing never appears in the picker: the vocabulary is
   * derived from the visible depot, the same rule that lets an unrecognised
   * Kind appear and that makes the Tag vocabulary work with no Tag entity.
   *
   * `OWNERSHIP: SHARED` + `PERSON: ELS` is therefore reachable and always
   * empty. Deliberately not guarded — see {@link passesFilters}.
   */
  person: {
    id: 'person',
    label: 'PERSON',
    arity: 'single',
    valuesOf: (gear) => {
      const owner = ownerOf(gear)
      return owner.type === 'person' ? [owner.personId] : []
    },
    format: (value, state) => personLabel(state, value),
  },
```

- [ ] **Step 4: Record the always-empty pair where the rule lives**

Extend `passesFilters`'s doc comment with a fourth consequence:

```
 * - **Two dimensions over one register can contradict.** `OWNERSHIP: SHARED`
 *   plus `PERSON: ELS` is reachable and structurally empty, and nothing here
 *   stops it. That is the same shape as `KIND: COUNTED` plus a tag no counted
 *   gear carries — the count line reads `0 OF 128`, which is the honest
 *   answer, and `CLEAR (2)` is story 13's undo one tap away. The only fix
 *   would be a second combinator between dimensions, and there is deliberately
 *   exactly one rule here.
```

- [ ] **Step 5: Fix the internal `format` call**

`groupGear` calls `dimension('kind').format(key)`. Task 4 rewrites that function; for now pass `state` through so the file compiles.

- [ ] **Step 6: Run**

Run: `npm test -w @foerier/shared -- selectors/slice` then `npm run typecheck`
Expected: the shared tests PASS. `typecheck` FAILS in `app/` at `SliceBar.tsx` and `Depot.tsx`, which call `format` with one argument — Task 6 fixes those. Note the failures and continue; do **not** patch `app/` here.

- [ ] **Step 7: Commit**

Stage `shared/src/selectors/slice.ts` and `shared/src/selectors/slice.test.ts`. Commit with `--no-verify` **only if** the pre-commit typecheck blocks on the `app/` call sites; otherwise commit normally. If you must use `--no-verify`, Task 6 restores green and no other commit may skip the hook.

Message: *Two dimensions over one register, because the boards drew two chips* — say that a single merged `OWNER` dimension would have expressed both narrowings with one chip, that Components §04's dashed ladder draws `PERSON · S4` and `OWNERSHIP · S4`, and that the contradictory pair is recorded rather than guarded.

---

## Task 4: A grouping table beside the dimension table

**Files:**
- Modify: `shared/src/selectors/slice.ts`, `shared/src/index.ts`
- Test: `shared/src/selectors/slice.test.ts`

**Interfaces:**
- Produces: `GroupKey` widened to `'none' | 'kind' | 'owner'`; `GROUP_KEYS: readonly GroupKey[]`; `groupLabel(key: GroupKey): string`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('grouping by owner', () => {
  function household() {
    return depotOf(
      aPerson({ id: 'els', name: 'Els' }),
      aPerson({ id: 'mark', name: 'Mark' }),
      aGear({ id: 'tent', name: 'Tent' }),
      aGear({ id: 'stove', name: 'Stove', owner: { type: 'shared' } }),
      aGear({
        id: 'jacket',
        name: 'Down jacket',
        owner: { type: 'person', personId: 'els' },
      }),
      aGear({
        id: 'boots',
        name: 'Winter boots',
        owner: { type: 'person', personId: 'mark' },
      }),
    )
  }

  it('files shared gear together, whether the register is written or absent', () => {
    const result = sliceDepot(household(), { ...EMPTY_SLICE, group: 'owner' })
    const shared = result.groups.find((g) => g.key === 'shared')
    expect(shared?.gear.map((g) => g.id).sort()).toEqual(['stove', 'tent'])
  })

  it('puts Shared first and then people alphabetically', () => {
    const result = sliceDepot(household(), { ...EMPTY_SLICE, group: 'owner' })
    expect(result.groups.map((g) => g.label)).toEqual(['Shared', 'Els', 'Mark'])
  })

  it('labels a person group with the recorded name', () => {
    const result = sliceDepot(household(), { ...EMPTY_SLICE, group: 'owner' })
    expect(result.groups.find((g) => g.key === 'els')?.label).toBe('Els')
  })

  it('never produces the ungrouped bucket, because absence means shared', () => {
    const result = sliceDepot(household(), { ...EMPTY_SLICE, group: 'owner' })
    expect(result.groups.some((g) => g.key === '')).toBe(false)
  })

  it('groups what survived the filters, not the whole depot', () => {
    const result = sliceDepot(household(), {
      ...EMPTY_SLICE,
      group: 'owner',
      filters: { ownership: ['personal'] },
    })
    expect(result.groups.map((g) => g.label)).toEqual(['Els', 'Mark'])
  })
})

describe('grouping by kind is unchanged', () => {
  it('still orders alphabetically by label with the em-dash bucket last', () => {
    const state = depotOf(
      aGear({ id: 'g1', kind: 'single' }),
      aGear({ id: 'g2', kind: 'counted' }),
    )
    const result = sliceDepot(state, { ...EMPTY_SLICE, group: 'kind' })
    expect(result.groups.map((g) => g.label)).toEqual(['Counted', 'Single'])
  })
})

describe('groupLabel', () => {
  it('names every offered key', () => {
    expect(GROUP_KEYS.map(groupLabel)).toEqual(['NONE', 'KIND', 'OWNER'])
  })
})
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -w @foerier/shared -- selectors/slice`
Expected: FAIL — `'owner'` is not assignable to `GroupKey`.

- [ ] **Step 3: Replace `GroupKey` and add the table**

In `shared/src/selectors/slice.ts`, replace the `GroupKey` type and its comment:

```ts
/**
 * `NONE · KIND · OWNER`, and **never TAG** — deliberate, and a domain fact
 * rather than a UI preference: tags are multi-valued, so a three-tag piece of
 * gear would land in three groups and the groups would not partition the list.
 * Slicing by tag is the filter's job.
 *
 * That rule used to be prose beside a hardcoded branch. It is now structural:
 * a grouping needs a {@link Grouping.keyOf}, which is exactly "the one value
 * this gear has in this respect", and Tag has none — so Tag has no row.
 */
export type GroupKey = 'none' | 'kind' | 'owner'
```

Then, above `groupGear`:

```ts
/**
 * **A grouping is a row in a table too** — but a different table from
 * {@link Dimension}, and the difference is load-bearing.
 *
 * A dimension answers *which values does this gear carry*, and may answer
 * "several" (Tag) or "none" (Person, for shared gear). A grouping answers
 * *which single bucket does this gear fall into*, which is a partition.
 *
 * S4's `owner` is why the two tables are not one. It groups by the `owner`
 * **register**, which neither of S4's filter dimensions does alone: grouping
 * by `person` would file every shared piece of gear into the `—` bucket, and
 * grouping by `ownership` would give two coarse groups and never name a
 * Person. The partition the boards' segmented control wants is the register's.
 */
interface Grouping {
  id: Exclude<GroupKey, 'none'>
  /** The segmented control's label: `KIND`, `OWNER`. */
  label: string
  /** This gear's single bucket, or `undefined` for the `—` bucket. */
  keyOf(gear: GearState, state: HouseholdState): string | undefined
  /** The group header's text. */
  format(key: string, state: HouseholdState): string
  /**
   * A key that sorts before every other group regardless of its label.
   *
   * `owner` pins `shared`, because `Shared` is not a name: filing it between
   * `Mark` and `Zoe` reads as a bug rather than as an ordering. Same reasoning
   * that pins `Loose` to the top of the Home picker's rows — the pseudo-value
   * meaning "belongs to no one in particular" is the list's spine, not an
   * entry in it. The order stays **total**, which is what stops two devices
   * with identical state drawing the list differently.
   */
  pinned?: string
}

const GROUPING_TABLE: Readonly<Record<Exclude<GroupKey, 'none'>, Grouping>> = {
  kind: {
    id: 'kind',
    label: 'KIND',
    keyOf: (gear) => gear.kind?.value,
    format: (key, state) => dimension('kind').format(key, state),
  },
  owner: {
    id: 'owner',
    label: 'OWNER',
    // Never `undefined`: an absent register reads shared, so every piece of
    // gear has a bucket and the `—` group is unreachable here.
    keyOf: (gear) => {
      const owner = ownerOf(gear)
      return owner.type === 'shared' ? 'shared' : owner.personId
    },
    format: (key, state) =>
      key === 'shared' ? 'Shared' : personLabel(state, key),
    pinned: 'shared',
  },
}

/** What `GROUP BY` offers, in the order it draws them. */
export const GROUP_KEYS: readonly GroupKey[] = ['none', 'kind', 'owner']

/** The segmented control's label for one key. `NONE` has no table row. */
export function groupLabel(key: GroupKey): string {
  return key === 'none' ? 'NONE' : GROUPING_TABLE[key].label
}
```

- [ ] **Step 4: Generalise `groupGear`**

```ts
function groupGear(
  gear: readonly GearState[],
  state: HouseholdState,
  group: GroupKey,
): readonly SliceGroup[] {
  if (gear.length === 0) return []
  if (group === 'none') return [{ key: '', label: '', gear }]

  const of = GROUPING_TABLE[group]
  const buckets = new Map<string, GearState[]>()
  const ungrouped: GearState[] = []
  for (const item of gear) {
    const key = of.keyOf(item, state)
    if (key === undefined) {
      ungrouped.push(item)
      continue
    }
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [item])
    else bucket.push(item)
  }

  const groups = [...buckets]
    .map(([key, items]) => ({
      key,
      label: of.format(key, state),
      gear: items,
    }))
    // The pinned key first; then alphabetically by **label**, which for Kind
    // is `Counted · Per-person · Single` — what the board's grouped frame
    // draws, and not the enum's order. Case-insensitive so an unrecognised
    // lowercase value files sensibly rather than after every recognised one.
    .sort((a, b) => {
      if (a.key === of.pinned) return b.key === of.pinned ? 0 : -1
      if (b.key === of.pinned) return 1
      const al = a.label.toLowerCase()
      const bl = b.label.toLowerCase()
      if (al !== bl) return al < bl ? -1 : 1
      return a.key < b.key ? -1 : 1
    })

  return ungrouped.length === 0
    ? groups
    : [...groups, { key: '', label: UNGROUPED_LABEL, gear: ungrouped }]
}
```

Update `UNGROUPED_LABEL`'s comment: it is now "the group gear with no value in the grouping dimension falls into", reachable for `kind` only.

In `sliceDepot`, the call becomes `groupGear(sortGear(shown, spec.sort), state, spec.group)`.

- [ ] **Step 5: Export**

In `shared/src/index.ts`, add `GROUP_KEYS` and `groupLabel` to the `selectors/slice.ts` export block.

- [ ] **Step 6: Run**

Run: `npm test -w @foerier/shared`
Expected: PASS, including every pre-existing grouping test.

- [ ] **Step 7: Commit**

Stage `shared/src/selectors/slice.ts`, `shared/src/selectors/slice.test.ts`, `shared/src/index.ts`.

Message: *Group by the register, and turn a special case into a missing row* — "GROUP BY never offers TAG" stops being prose beside a hardcoded branch and becomes the fact that Tag has no `keyOf`.

---

## Task 5: The convergence tier

**Files:**
- Test: `shared/src/convergence.test.ts`

**Interfaces:**
- Consumes: `Replica` from `testUtils/replica.ts`; `gearOwnershipSet`, `personRenamed`, `personRecorded` from Task 1.

- [ ] **Step 1: Write the tests**

Append to `shared/src/convergence.test.ts`, following the file's existing two-replica pattern (`a`, `b`, emit, cross-`receive`, assert both states):

```ts
it('two concurrent ownership sets converge to the later stamp on both replicas', () => {
  const [a, b] = twoReplicas()
  const gear = 'g1'
  a.emit(
    gearRecorded(gear, { name: 'Down jacket', container: false, kind: 'single' }),
  )
  a.emit(personRecorded('els', 'Els'))
  a.emit(personRecorded('mark', 'Mark'))
  b.receive(a.log())

  a.emit(gearOwnershipSet(gear, { type: 'person', personId: 'els' }))
  const later = b.emit(gearOwnershipSet(gear, { type: 'person', personId: 'mark' }))

  a.receive(b.log())
  b.receive(a.log())

  expect(a.state()).toEqual(b.state())
  // Whichever stamp won, both agree, and the winner is the one the HLC says.
  expect(a.state().gear[gear]?.owner?.stamp.hlc).toBe(later.hlc)
  expect(a.state().gear[gear]?.owner?.value).toEqual({
    type: 'person',
    personId: 'mark',
  })
})

it('a rename racing an ownership set leaves both writes standing', () => {
  const [a, b] = twoReplicas()
  const gear = 'g1'
  a.emit(personRecorded('els', 'Els'))
  a.emit(
    gearRecorded(gear, { name: 'Down jacket', container: false, kind: 'single' }),
  )
  b.receive(a.log())

  // Different aggregates, different registers: neither is contested.
  a.emit(personRenamed('els', 'Elsje'))
  b.emit(gearOwnershipSet(gear, { type: 'person', personId: 'els' }))

  a.receive(b.log())
  b.receive(a.log())

  expect(a.state()).toEqual(b.state())
  expect(a.state().people['els']?.name?.value).toBe('Elsje')
  expect(a.state().gear[gear]?.owner?.value).toEqual({
    type: 'person',
    personId: 'els',
  })
})
```

Adapt `twoReplicas()`, `later.hlc` and the `stamp` accessor to whatever the file already uses — read the neighbouring `two concurrent rehomes converge to the later stamp on both replicas` test and mirror it exactly rather than inventing helpers.

Also add `gear.ownership_set` and `person.renamed` specs to the file's existing **arrival-order permutation** test (`converges to identical state regardless of arrival order`), so the two new op types are covered by the property test and not only by the two scenarios.

- [ ] **Step 2: Run**

Run: `npm test -w @foerier/shared -- convergence`
Expected: PASS. If either fails, the bug is in Task 1's handler, not here — `writeRegister` is unchanged and already proven.

- [ ] **Step 3: Commit**

Stage `shared/src/convergence.test.ts`.

Message: *Prove the two new registers converge* — the ownership race is §8.3's named scenario; the rename-versus-ownership race is free and proves the two aggregates do not interfere.

---

## Task 6: The slice bar carries four dimensions and three groupings

**Files:**
- Modify: `app/src/components/SliceBar.tsx`, `app/src/components/SortGroupSheet.tsx`, `app/src/household/slicePrefs.ts`, `app/src/screens/Depot.tsx`
- Test: `app/src/components/SliceBar.test.tsx`, `app/src/household/slicePrefs.test.ts`

**Interfaces:**
- Consumes: `GROUP_KEYS`, `groupLabel`, `DimensionId`, `dimension` from Tasks 3–4.
- Produces: `SliceBarProps` gains `formatFor: (id: DimensionId, value: string) => string`.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/components/SliceBar.test.tsx`, matching its existing render helper:

```ts
it('draws a ghost add-chip for every dimension', () => {
  renderBar({ spec: EMPTY_SLICE })
  expect(screen.getByText('+ TAG')).toBeInTheDocument()
  expect(screen.getByText('+ KIND')).toBeInTheDocument()
  expect(screen.getByText('+ OWNERSHIP')).toBeInTheDocument()
  expect(screen.getByText('+ PERSON')).toBeInTheDocument()
})

it('labels a selected person chip with the name, not the id', () => {
  renderBar({
    spec: { ...EMPTY_SLICE, filters: { person: ['els'] } },
    formatFor: (id, value) => (id === 'person' && value === 'els' ? 'Els' : value),
  })
  expect(screen.getByText('PERSON: Els')).toBeInTheDocument()
})

it('hides a single-arity ghost while that dimension is active', () => {
  renderBar({ spec: { ...EMPTY_SLICE, filters: { ownership: ['shared'] } } })
  expect(screen.queryByText('+ OWNERSHIP')).not.toBeInTheDocument()
  // TAG is multi-arity, so its ghost survives.
  expect(screen.getByText('+ TAG')).toBeInTheDocument()
})

it('reads OWNER in the arrange readout when grouped by owner', () => {
  renderBar({ spec: { ...EMPTY_SLICE, group: 'owner' } })
  expect(screen.getByTestId('arrange-readout')).toHaveTextContent(
    'OWNER · NAME A→Z',
  )
})
```

Append to `app/src/household/slicePrefs.test.ts`:

```ts
it('round-trips a group of owner', () => {
  writeSlicePrefs({ sort: 'name-asc', group: 'owner' })
  expect(readSlicePrefs().group).toBe('owner')
})
```

(Use the module's own exported names; read the file first.)

- [ ] **Step 2: Run and watch fail**

Run: `npm test -w @foerier/app -- SliceBar slicePrefs`
Expected: FAIL — the two new ghosts are missing, `formatFor` is not a prop, and `slicePrefs` falls back to `none` for `owner`.

- [ ] **Step 3: Give `SliceBar` `formatFor`**

In `app/src/components/SliceBar.tsx`:

- Add to `SliceBarProps`, beside `valuesFor`:

```ts
  /**
   * How one value of one dimension is drawn — `dimension(id).format(value,
   * state)`, bound to the state the screen holds.
   *
   * Injected rather than called here for the same reason `valuesFor` is: a
   * dimension's label is not always intrinsic to its value. S4's `PERSON`
   * carries person ids and draws names, so formatting needs the depot; this
   * component does not, and threading the whole `HouseholdState` through a
   * presentational component to reach one lookup would be the wrong seam.
   */
  formatFor: (id: DimensionId, value: string) => string
```

- Destructure `formatFor` and use it in the selected-chip label: `` label={`${of.label}: ${formatFor(of.id, value)}`} ``.
- Pass it into `ValueMenu`'s `format` prop: `format={(value) => formatFor(picking, value)}` (inside the branch where `picking` is non-null).
- Delete the local `GROUP_LABELS` map and import `groupLabel` from `@foerier/shared`; `arrangeReadout` becomes:

```ts
function arrangeReadout(spec: SliceSpec): string {
  const sort = SORT_LABELS[spec.sort]
  return spec.group === 'none' ? sort : `${groupLabel(spec.group)} · ${sort}`
}
```

- [ ] **Step 4: Derive the GROUP BY options**

In `app/src/components/SortGroupSheet.tsx`, replace the hand-written `GROUPS` array with one derived from `shared/`:

```ts
const GROUPS: readonly { key: GroupKey; label: string }[] = GROUP_KEYS.map(
  (key) => ({ key, label: groupLabel(key) }),
)
```

Update the module's doc comment: `GROUP BY` now offers `NONE · KIND · OWNER`, and the reason it never offers TAG is that a grouping needs a `keyOf` and Tag has none — point at `slice.ts`'s `Grouping` rather than restating the rule.

In `app/src/household/slicePrefs.ts`, replace `const GROUPS: readonly GroupKey[] = ['none', 'kind']` with `GROUP_KEYS` imported from `@foerier/shared`, and delete the now-redundant local constant. This is the whole of the persistence change: a previously-stored `owner` was already rejected by `readMember` and fell back to `none`, so nothing migrates.

- [ ] **Step 5: Supply `formatFor` from `Depot.tsx`**

Beside the existing `valuesFor` memo:

```ts
  const formatFor = useMemo(
    () => (id: DimensionId, value: string) =>
      dimension(id).format(value, state),
    [state],
  )
```

and pass `formatFor={formatFor}` to `<SliceBar>`. Do the same anywhere else `SliceBar` is rendered (grep for `<SliceBar`).

- [ ] **Step 6: Run**

Run: `npm test -w @foerier/app -- SliceBar slicePrefs SortGroup Depot` then `npm run typecheck`
Expected: PASS, and typecheck now clean across all four workspaces (this closes Task 3's deliberate breakage).

- [ ] **Step 7: Commit**

Stage the four modified source files and the two test files.

Message: *Bind the formatter where the state is, and derive GROUP BY from one list* — three copies of the group vocabulary (`SliceBar`, `SortGroupSheet`, `slicePrefs`) become one, so the next slice that adds a grouping adds a row and nothing else.

---

## Task 7: The owner picker

**Files:**
- Create: `app/src/components/OwnerPicker.tsx`, `app/src/components/OwnerPicker.module.css`, `app/src/components/OwnerPicker.test.tsx`

**Interfaces:**
- Consumes: `ui/`'s `Sheet`; `useHousehold`; `personRecorded`, `personLabel`, `systemIdSource` from `@foerier/shared`.
- Produces:

```ts
export interface OwnerPickerProps {
  /** The owner the caller currently holds — the row drawn as chosen. */
  value: Owner
  onSelect: (owner: Owner) => void
  onClose: () => void
}
export function OwnerPicker(props: OwnerPickerProps): JSX.Element
```

- [ ] **Step 1: Write the failing test**

Create `app/src/components/OwnerPicker.test.tsx`. Model the setup on `HomePicker.test.tsx` — it already seeds a depot into the store and renders a sheet.

```ts
it('lists Shared first, then every recorded Person alphabetically', () => {
  seedPeople([
    { id: 'mark', name: 'Mark' },
    { id: 'els', name: 'Els' },
  ])
  render(<OwnerPicker value={{ type: 'shared' }} onSelect={vi.fn()} onClose={vi.fn()} />)
  const rows = screen.getAllByTestId('owner-row').map((r) => r.textContent)
  expect(rows).toEqual(['Shared', 'Els', 'Mark'])
})

it('marks the held owner as chosen', () => {
  seedPeople([{ id: 'els', name: 'Els' }])
  render(
    <OwnerPicker
      value={{ type: 'person', personId: 'els' }}
      onSelect={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: /Els/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

it('selects Shared', async () => {
  const onSelect = vi.fn()
  seedPeople([])
  render(
    <OwnerPicker
      value={{ type: 'person', personId: 'els' }}
      onSelect={onSelect}
      onClose={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Shared' }))
  expect(onSelect).toHaveBeenCalledWith({ type: 'shared' })
})

it('records a new Person and selects them in one step', async () => {
  const onSelect = vi.fn()
  const emitted: unknown[] = []
  seedPeople([], { onEmit: (spec) => emitted.push(spec) })
  render(<OwnerPicker value={{ type: 'shared' }} onSelect={onSelect} onClose={vi.fn()} />)

  await userEvent.click(screen.getByRole('button', { name: '+ New person' }))
  await userEvent.type(screen.getByLabelText('New person name'), 'Kees')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))

  expect(emitted).toHaveLength(1)
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'person' }),
  )
})

it('will not record a Person with a blank name', async () => {
  seedPeople([])
  render(<OwnerPicker value={{ type: 'shared' }} onSelect={vi.fn()} onClose={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: '+ New person' }))
  expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
})
```

Adapt `seedPeople` to whatever `HomePicker.test.tsx` actually does to populate the store and observe emissions; do not invent a new harness.

- [ ] **Step 2: Run and watch fail**

Run: `npm test -w @foerier/app -- OwnerPicker`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the component**

Create `app/src/components/OwnerPicker.tsx`:

```tsx
import {
  personLabel,
  personRecorded,
  systemIdSource,
  type Owner,
} from '@foerier/shared'
import { Sheet } from '@foerier/ui'
import { useState } from 'react'

import { useHousehold } from '../household/store'
import styles from './OwnerPicker.module.css'

/**
 * **Who a piece of gear belongs to** — `Shared`, or one recorded Person.
 * Opened from Add gear's `OWNER` row and from gear detail's Edit sheet, which
 * are the only two places ownership is decided.
 *
 * ## Shared is a row, not a clear
 *
 * The domain has exactly two states — "personal to one person, **or** shared"
 * — and shared is one of them, not the absence of the other. So `Shared` is
 * the first row and is drawn chosen like any other, rather than being a
 * `CLEAR` affordance at the bottom. It sits first for the same reason `Loose`
 * sits first in the Home picker: the pseudo-value that means "belongs to no
 * one in particular" is the list's spine.
 *
 * ## It can record a Person
 *
 * The Home picker can create a Place while picking, and "a place created while
 * picking is **selected**". The same is true here, for the same reason: Add
 * gear carries the owner over between records precisely so a shelf's worth of
 * one person's gear goes in one sitting, and discovering mid-sitting that the
 * Person was never recorded would otherwise mean leaving the screen.
 *
 * Recording is `person.recorded` — S2's op, not one of S4's two. The People
 * screen is the other caller.
 */
export interface OwnerPickerProps {
  /** The owner the caller currently holds. */
  value: Owner
  onSelect: (owner: Owner) => void
  onClose: () => void
}

export function OwnerPicker({ value, onSelect, onClose }: OwnerPickerProps) {
  const state = useHousehold((depot) => depot.state)
  const emit = useHousehold((depot) => depot.emit)

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  // Alphabetical by the label a row actually draws, so an unnamed Person's
  // `—` files consistently rather than by an id nobody can see.
  const people = Object.values(state.people)
    .map((person) => ({ id: person.id, label: personLabel(state, person.id) }))
    .sort((a, b) => {
      const al = a.label.toLowerCase()
      const bl = b.label.toLowerCase()
      if (al !== bl) return al < bl ? -1 : 1
      return a.id < b.id ? -1 : 1
    })

  function addPerson() {
    const trimmed = newName.trim()
    if (trimmed === '') return
    const id = systemIdSource.next()
    emit(personRecorded(id, trimmed))
    // Created while picking is selected — the Home picker's rule.
    onSelect({ type: 'person', personId: id })
  }

  return (
    <Sheet title="Owner" onClose={onClose} desktopCard>
      <ul className={styles['rows']}>
        <li>
          <button
            type="button"
            className={styles['row']}
            data-testid="owner-row"
            aria-pressed={value.type === 'shared'}
            onClick={() => onSelect({ type: 'shared' })}
          >
            Shared
          </button>
        </li>
        {people.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              className={styles['row']}
              data-testid="owner-row"
              aria-pressed={
                value.type === 'person' && value.personId === person.id
              }
              onClick={() =>
                onSelect({ type: 'person', personId: person.id })
              }
            >
              {person.label}
            </button>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className={styles['addRow']}>
          <input
            className={styles['addInput']}
            aria-label="New person name"
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addPerson()
              }
            }}
          />
          <button
            type="button"
            className={styles['addButton']}
            disabled={newName.trim() === ''}
            onClick={addPerson}
          >
            Add
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles['newRow']}
          onClick={() => setAdding(true)}
        >
          + New person
        </button>
      )}
    </Sheet>
  )
}
```

- [ ] **Step 4: Style it**

Create `app/src/components/OwnerPicker.module.css` by copying the row, rename-row and dashed-new-row rules from `HomePicker.module.css` — the anatomy is deliberately the same (rows ≥40px, the dashed create row last). Do **not** import `HomePicker.module.css`: CSS Modules compose by duplication here, and the two files diverge as soon as the Home picker gains its tree affordances back.

- [ ] **Step 5: Run**

Run: `npm test -w @foerier/app -- OwnerPicker`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

Stage the three new files.

Message: *One sheet decides an owner, and can record the Person it needs* — the Home picker's precedent, applied where Add gear's carry-over makes a dead end most likely.

---

## Task 8: Add gear's `OWNER` row

**Files:**
- Modify: `app/src/screens/AddGear.tsx`, `app/src/screens/AddGear.module.css`
- Test: `app/src/screens/AddGear.test.tsx`

**Interfaces:**
- Consumes: `OwnerPicker` (Task 7), `personLabel` (Task 2), `Owner`.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/screens/AddGear.test.tsx`:

```ts
it('defaults the owner to Shared and records no owner field when untouched', async () => {
  const emitted = renderAddGear()
  await userEvent.type(screen.getByLabelText('Name'), 'Tent')
  await userEvent.click(screen.getByRole('button', { name: 'Add gear' }))
  expect(emitted[0].payload).not.toHaveProperty('owner')
})

it('records the chosen owner on the one gear.recorded op', async () => {
  const emitted = renderAddGear({ people: [{ id: 'els', name: 'Els' }] })
  await userEvent.type(screen.getByLabelText('Name'), 'Down jacket')
  await userEvent.click(screen.getByRole('button', { name: /Owner/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Els' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add gear' }))

  expect(emitted).toHaveLength(1)
  expect(emitted[0].payload).toMatchObject({
    owner: { type: 'person', person_id: 'els' },
  })
})

it('carries the owner over to the next record in the sitting', async () => {
  const emitted = renderAddGear({ people: [{ id: 'els', name: 'Els' }] })
  await userEvent.type(screen.getByLabelText('Name'), 'Down jacket')
  await userEvent.click(screen.getByRole('button', { name: /Owner/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Els' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add gear' }))

  // The row still reads Els, and the second record carries it without a
  // second visit to the picker — the whole point of the departure.
  expect(screen.getByRole('button', { name: /Owner/ })).toHaveTextContent('Els')
  await userEvent.type(screen.getByLabelText('Name'), 'Rain jacket')
  await userEvent.click(screen.getByRole('button', { name: 'Add gear' }))
  expect(emitted[1].payload).toMatchObject({
    owner: { type: 'person', person_id: 'els' },
  })
})

it('resets kind and the trait but not the owner', async () => {
  renderAddGear({ people: [{ id: 'els', name: 'Els' }] })
  await userEvent.type(screen.getByLabelText('Name'), 'Down jacket')
  await userEvent.click(screen.getByRole('button', { name: /Owner/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Els' }))
  await userEvent.click(screen.getByLabelText('Container'))
  await userEvent.click(screen.getByRole('button', { name: 'Add gear' }))

  expect(screen.getByLabelText('Item')).toBeChecked()
  expect(screen.getByRole('button', { name: /Owner/ })).toHaveTextContent('Els')
})
```

Adapt `renderAddGear` and its `people` seeding to the file's existing harness.

- [ ] **Step 2: Run and watch fail**

Run: `npm test -w @foerier/app -- AddGear`
Expected: FAIL — there is no `Owner` row.

- [ ] **Step 3: Add the row**

In `app/src/screens/AddGear.tsx`:

- Import `OwnerPicker`, and `personLabel` / `type Owner` from `@foerier/shared`.
- Add state beside `home`:

```ts
  const [owner, setOwner] = useState<Owner>({ type: 'shared' })
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
```

- In `submit`, add the field to the op — and **only when it is personal**:

```ts
        ...(owner.type === 'shared' ? {} : { owner }),
```

  Why the guard: an untouched form must not write an ownership register at all.
  Absence already reads `SHARED` (`selectors/owner.ts`), so writing
  `{type:'shared'}` on every record would add a register with no new fact in it
  and make `NEWEST FIRST`'s `recordedAt` depend on a field nobody set. The row
  still *draws* `Shared`, because that is what absence means.

- In the reset block, leave `owner` alone and extend the comment:

```ts
    // Home and owner persist; everything else returns to its default. A depot
    // is recorded shelf by shelf, and a shelf in a bedroom is one person's.
```

- Add the JSX row immediately after the `homeRow` button and before the
  `Recorded as` fieldset:

```tsx
      <button
        type="button"
        className={styles['homeRow']}
        aria-label="Owner"
        onClick={() => setOwnerPickerOpen(true)}
      >
        <span className={styles['label']}>Owner</span>
        <span className={styles['homeValue']}>
          {owner.type === 'shared' ? 'Shared' : personLabel(state, owner.personId)}{' '}
          <span aria-hidden="true">›</span>
        </span>
      </button>
```

  It reuses `homeRow`/`homeValue` deliberately — the two rows are the same
  48px bordered control and the board draws them identically. Rename neither
  class; a third caller is when to generalise the name.

- Add the sheet beside the existing `pickerOpen` block:

```tsx
      {ownerPickerOpen && (
        <OwnerPicker
          value={owner}
          onSelect={(next) => {
            setOwner(next)
            setOwnerPickerOpen(false)
          }}
          onClose={() => setOwnerPickerOpen(false)}
        />
      )}
```

- [ ] **Step 4: Record the departure in the file's own doc comment**

Extend the `AddGear` doc comment. The "Order = the ledger line being written"
section becomes `NAME · KIND (+ count) · HOME · OWNER · RECORDED AS`, and the
existing "The one departure from the board" section becomes **two**:

```
 * ## The second departure from the board
 *
 * **`OWNER` is not on the board's F1.** Its order is settled and reasoned —
 * `NAME · KIND · [count] · HOME · RECORDED AS`, the irreversible trait last —
 * and it carries no owner.
 *
 * Taken anyway, because without it S4's only route to attributing gear is one
 * gear-detail visit per item and the Depot's bulk `SET OWNER` band is story
 * 35, tagged Later. A household attributing a two-hundred-item depot would
 * make two hundred screen visits, and the slice's own test — "personal gear
 * stops being everyone's problem" — would fail on the first day of real use.
 *
 * It sits **after HOME** because the two behave identically: both carry over
 * between records, and the board's own argument for HOME doing so is that "a
 * depot is recorded shelf by shelf". A shelf in a bedroom is one person's.
 * Owner is also one of the five shared attributes the domain model lists
 * (home, owner, kind, tags, weight), and the only one F1 omitted.
```

- [ ] **Step 5: Run**

Run: `npm test -w @foerier/app -- AddGear`
Expected: PASS, with every pre-existing Add gear test unchanged.

- [ ] **Step 6: Commit**

Stage `app/src/screens/AddGear.tsx` and the test file.

Message: *Let a sitting record whose gear it is* — the departure and its price, and why the row carries over.

---

## Task 9: Owner on gear detail

**Files:**
- Modify: `app/src/screens/GearDetail.tsx`
- Test: `app/src/screens/GearDetail.test.tsx`

**Interfaces:**
- Consumes: `OwnerPicker` (Task 7), `gearOwnershipSet` (Task 1), `ownerLabel` (Task 2, already imported in Task 2 Step 5).

- [ ] **Step 1: Write the failing tests**

```ts
it('reads PERSONAL plus the initial in the meta line', () => {
  renderDetail({
    people: [{ id: 'els', name: 'Els' }],
    gear: { id: 'g1', name: 'Down jacket', owner: { type: 'person', personId: 'els' } },
  })
  expect(screen.getByTestId('meta-line')).toHaveTextContent('PERSONAL E')
})

it('emits gear.ownership_set when the owner changed', async () => {
  const emitted = renderDetail({
    people: [{ id: 'els', name: 'Els' }],
    gear: { id: 'g1', name: 'Down jacket' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  await userEvent.click(screen.getByRole('button', { name: /Owner/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Els' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(emitted.map((op) => op.type)).toEqual(['gear.ownership_set'])
  expect(emitted[0].payload).toEqual({
    owner: { type: 'person', person_id: 'els' },
  })
})

it('emits nothing when the owner was not touched', async () => {
  const emitted = renderDetail({ gear: { id: 'g1', name: 'Tent' } })
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(emitted).toEqual([])
})

it('emits shared when an owner is cleared back to the pool', async () => {
  const emitted = renderDetail({
    people: [{ id: 'els', name: 'Els' }],
    gear: { id: 'g1', name: 'Down jacket', owner: { type: 'person', personId: 'els' } },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  await userEvent.click(screen.getByRole('button', { name: /Owner/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Shared' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(emitted[0].payload).toEqual({ owner: { type: 'shared' } })
})
```

Match the existing harness's names for the Edit and Save buttons and the meta-line test id; read the file first.

- [ ] **Step 2: Run and watch fail**

Run: `npm test -w @foerier/app -- GearDetail`
Expected: FAIL — the Edit sheet has no `Owner` row.

- [ ] **Step 3: Add the row and the emit**

In `app/src/screens/GearDetail.tsx`:

- Import `OwnerPicker`, `gearOwnershipSet`, `ownerOf`, `type Owner`.
- Add drafts beside `kindDraft`:

```ts
  const [ownerDraft, setOwnerDraft] = useState<Owner>({ type: 'shared' })
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
```

- In `openEdit`, seed it: `setOwnerDraft(ownerOf(current))`. Reading through
  `ownerOf` rather than `current.owner?.value` is what makes an untouched
  absent register compare equal to the drawn `Shared` in the next step.
- In `submitEdit`, after the kind/count block:

```ts
    // Only when it changed — the sheet's discipline for every other field.
    // `ownerOf` on both sides, so an absent register and an explicit
    // `{type:'shared'}` compare equal and a no-op Save writes nothing.
    const currentOwner = ownerOf(current)
    if (
      ownerDraft.type !== currentOwner.type ||
      (ownerDraft.type === 'person' &&
        currentOwner.type === 'person' &&
        ownerDraft.personId !== currentOwner.personId)
    ) {
      emit(gearOwnershipSet(id, ownerDraft))
    }
```

- Add an `Owner` row inside the Edit sheet, after the kind fieldset and before
  the count field, drawn as the same bordered 48px row Add gear uses, opening
  `OwnerPicker` with `value={ownerDraft}`. The picker stacks on the sheet, which
  is what `ui/`'s `Sheet` already supports (`HomePicker` stacks on Add gear the
  same way).
- Mount the picker inside the sheet's JSX, gated on `ownerPickerOpen`.

- [ ] **Step 4: Run**

Run: `npm test -w @foerier/app -- GearDetail`
Expected: PASS.

- [ ] **Step 5: Commit**

Stage `app/src/screens/GearDetail.tsx` and its test.

Message: *Set an owner where every other intrinsic attribute is set* — and emit only on a change, because a Save that writes an unchanged register moves the gear's `recordedAt` for nothing.

---

## Task 10: Owner on the Depot's rows and table

**Files:**
- Modify: `app/src/screens/Depot.tsx`, `ui/src/GearRow.tsx` (one comment)
- Test: `app/src/screens/Depot.test.tsx`

**Interfaces:**
- Consumes: `ownerLabel` (Task 2).

- [ ] **Step 1: Write the failing tests**

```ts
it('leads the row meta with the owner', () => {
  renderDepot({
    people: [{ id: 'els', name: 'Els' }],
    places: [{ id: 'kast', name: 'Kast' }],
    gear: [
      {
        id: 'g1',
        name: 'Down jacket',
        owner: { type: 'person', personId: 'els' },
        residence: { in: 'place', id: 'kast' },
      },
    ],
  })
  expect(screen.getByTestId('gear-row-meta')).toHaveTextContent(
    'PERSONAL E · Kast',
  )
})

it('fills the table OWNER column instead of an em dash', () => {
  renderDepot({
    layout: 'table',
    gear: [{ id: 'g1', name: 'Tent' }],
  })
  expect(screen.getByTestId('gear-row-owner')).toHaveTextContent('SHARED')
})
```

Use the file's own render helper and its layout switch; read it first for the
meta-slot test id (`GearRow` exposes `gear-row-owner` already).

- [ ] **Step 2: Run and watch fail**

Run: `npm test -w @foerier/app -- Depot`
Expected: FAIL — the meta line has no owner and the column reads `—`.

- [ ] **Step 3: Fill both**

In `app/src/screens/Depot.tsx`:

- Import `ownerLabel`.
- `metaFor` leads with the owner, and its comment loses its promissory note:

```ts
/** `PERSONAL E · ATTIC ▸ CRATE B · ×2` — the row's meta slot. */
function metaFor(
  state: HouseholdState,
  gear: GearState,
  view: ContainmentView,
): string | undefined {
  const owner = ownerLabel(state, gear)
  const path = homePath(state, gear.id, view)
    .map((segment) => segment.name)
    .join(' ▸ ')
  const count =
    gear.kind?.value === 'counted' && gear.ownedCount?.value !== undefined
      ? `×${gear.ownedCount.value}`
      : ''
  const meta = [owner, path, count].filter((part) => part !== '').join(' · ')
  return meta === '' ? undefined : meta
}
```

  The owner is never empty, so the row's meta slot now always exists — which is
  the board's own reading (`PERSONAL E · SLAAPKAMER ▸ KAST`, `SHARED · ⌂ KELDER
  ▸ SHELF 2`), and why the `undefined` branch survives only for a shape the
  reducer cannot produce.

- In `Row`, pass `owner={ownerLabel(state, gear)}` in the `table` branch of the
  props spread, beside `kind` and `path`.

In `ui/src/GearRow.tsx`, update the `owner` prop's doc comment: it no longer
says "**S4 fills it**; until then the table's OWNER column reads `—`". Replace
with a note that `—` remains the fallback for a caller that does not supply
one, and that `shared/`'s `ownerLabel` is what every caller should pass.

- [ ] **Step 4: Run**

Run: `npm test -w @foerier/app -- Depot` and `npm test -w @foerier/ui`
Expected: PASS.

- [ ] **Step 5: Commit**

Stage `app/src/screens/Depot.tsx`, `ui/src/GearRow.tsx`, the Depot test.

Message: *Fill the slot that has been reading an em dash since S3* — `GearRow`'s `owner` prop finally has a caller.

---

## Task 11: The People screen — the milestone task

**Files:**
- Create: `app/src/screens/People.tsx`, `app/src/screens/People.module.css`, `app/src/screens/People.test.tsx`
- Modify: `app/src/App.tsx`, `app/src/screens/Account.tsx`, `app/src/screens/Account.test.tsx`

**Interfaces:**
- Consumes: `personRecorded`, `personRenamed`, `personLabel`, `systemIdSource`, `useHousehold`, `useMediaQuery`'s Desktop predicate (read `Account.tsx` for the existing hook name).
- Produces:

```ts
export interface PeopleProps {
  /** The signed-in Login's Person, for the `YOU` badge. */
  personId: string
  /** `list` is the pushed screen; `inline` is Account's Desktop card. */
  variant?: 'list' | 'inline'
}
export function People(props: PeopleProps): JSX.Element
```

- [ ] **Step 1: Write the failing tests**

Create `app/src/screens/People.test.tsx`:

```ts
it('lists people alphabetically with a YOU badge on the signed-in Person', () => {
  renderPeople({
    personId: 'mark',
    people: [
      { id: 'mark', name: 'Mark' },
      { id: 'els', name: 'Els' },
      { id: 'kees', name: 'Kees' },
    ],
  })
  expect(screen.getAllByTestId('person-name').map((n) => n.textContent)).toEqual(
    ['Els', 'Kees', 'Mark'],
  )
  expect(screen.getByTestId('person-row-mark')).toHaveTextContent('YOU')
  expect(screen.getByTestId('person-row-els')).not.toHaveTextContent('YOU')
})

it('counts the household', () => {
  renderPeople({ personId: 'mark', people: [{ id: 'mark', name: 'Mark' }] })
  expect(screen.getByTestId('people-count')).toHaveTextContent('1 person.')
})

it('records a new Person', async () => {
  const emitted = renderPeople({ personId: 'mark', people: [] })
  await userEvent.click(screen.getByRole('button', { name: '+ NEW PERSON' }))
  await userEvent.type(screen.getByLabelText('New person name'), 'Kees')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(emitted).toHaveLength(1)
  expect(emitted[0].type).toBe('person.recorded')
  expect(emitted[0].payload).toEqual({ name: 'Kees' })
})

it('renames a Person from EDIT mode', async () => {
  const emitted = renderPeople({
    personId: 'mark',
    people: [{ id: 'els', name: 'Els' }],
  })
  await userEvent.click(screen.getByRole('button', { name: 'EDIT' }))
  await userEvent.click(screen.getByRole('button', { name: 'RENAME' }))
  const field = screen.getByLabelText('New name')
  await userEvent.clear(field)
  await userEvent.type(field, 'Elsje')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(emitted[0].type).toBe('person.renamed')
  expect(emitted[0].payload).toEqual({ name: 'Elsje' })
})

it('offers no way to remove a Person, in EDIT mode or out of it', async () => {
  renderPeople({ personId: 'mark', people: [{ id: 'els', name: 'Els' }] })
  expect(screen.queryByRole('button', { name: 'REMOVE' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'EDIT' }))
  expect(screen.queryByRole('button', { name: 'REMOVE' })).not.toBeInTheDocument()
})

it('draws no login state, because it cannot know any', () => {
  renderPeople({ personId: 'mark', people: [{ id: 'els', name: 'Els' }] })
  expect(screen.queryByText(/LOGIN/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/INVITE/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/DEVICE LINK/i)).not.toBeInTheDocument()
})

it('draws an initial circle, and an empty one for a Person with no name', () => {
  renderPeople({
    personId: 'mark',
    people: [{ id: 'els', name: 'Els' }, { id: 'ghost', name: '' }],
  })
  expect(screen.getByTestId('person-initial-els')).toHaveTextContent('E')
  expect(screen.getByTestId('person-initial-ghost')).toBeEmptyDOMElement()
})
```

Append to `app/src/screens/Account.test.tsx`:

```ts
it('links to People below phone Desktop', () => {
  renderAccount({ isDesktop: false })
  expect(screen.getByRole('link', { name: /People/ })).toHaveAttribute(
    'href',
    '/account/people',
  )
})

it('unfolds People inline at Desktop instead of linking', () => {
  renderAccount({ isDesktop: true, people: [{ id: 'els', name: 'Els' }] })
  expect(screen.queryByRole('link', { name: /People/ })).not.toBeInTheDocument()
  expect(screen.getByTestId('person-row-els')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch fail**

Run: `npm test -w @foerier/app -- People Account`
Expected: FAIL — `People.tsx` does not exist and Account has no section.

- [ ] **Step 3: Write the screen**

Create `app/src/screens/People.tsx`. The full doc comment is the point of this
task and must be written, not summarised:

```tsx
/**
 * **People** — the board's Screens C §08 (`docs/design/README.md` §13), minus
 * its entire login half.
 *
 * The fourth thing reachable from Account, and the screen story 4 needs before
 * gear can belong to anybody. `+ NEW PERSON` authors `person.recorded` (S2's
 * op, given a second caller here); EDIT mode authors `person.renamed` (S4's).
 *
 * ## Why the row is so thin
 *
 * The board's person row carries a meta line and a right column, and **every
 * line in both is login state** — `SIGNED IN · 2 DEVICES`, `NO LOGIN · JOINS
 * TRIPS AS PARTICIPANT`, `INVITE OUT · SINGLE USE`, `INVITE ›`, `DEVICE LINK
 * ›`, `REVOKE`. `GET /auth/logins` is S5's endpoint (story 28), so at S4 none
 * of it is knowable and none of it is drawn. This is Find's `S8 · PIECES`
 * pattern: the element is designed final and falls through to a simpler
 * variant until its slice lands.
 *
 * **The circle carries no login encoding either.** The board's rule is accent
 * border = holds a Login, control border = none. Drawing every circle with the
 * control border would render the joiner — who demonstrably holds one — as
 * having none, so the circle draws the control border with no meaning attached
 * and S5 lights it. Stating something false is worse than stating less.
 *
 * The three obligations this hands to S5 are written down in
 * `docs/specs/2026-08-29-people-and-ownership.md` §7, so they are a debt
 * rather than a gap somebody has to notice.
 *
 * ## EDIT mode, and only one verb in it
 *
 * Renaming lives behind the same quiet mono `EDIT` toggle the Home picker
 * settled on (`docs/design/README.md` §3c, R2: "RENAME / REMOVE moved off the
 * pick rows into an EDIT mode"), because a rename affordance on every resting
 * row is a wall of controls around a list you mostly read.
 *
 * **`RENAME` only, never `REMOVE`.** A Person is never removed — gear
 * ownership and past trips reference them, and the domain gives no removal
 * operation (`sync-protocol.md` §4.2). The Home picker's second verb has no
 * counterpart here, and its absence is the design rather than an omission.
 *
 * ## Two renders, one component
 *
 * `variant="list"` is the pushed screen below Desktop; `variant="inline"` is
 * the card Account unfolds at Desktop, where the boards draw "all three people
 * inline". Which one exists is a **media query** — it decides what exists, not
 * how it lays out (`frontend-design.md` §3.2) — and `/account/people`
 * redirects to `/account` at Desktop for exactly the reason
 * `/account/devices` already does.
 */
```

The component body:

- `const state = useHousehold((depot) => depot.state)` and `emit` likewise.
- People sorted by `personLabel(state, id)`, case-insensitive, id as tiebreak —
  the same comparator `OwnerPicker` uses. Extract it into
  `app/src/household/people.ts` as `sortedPeople(state)` and have `OwnerPicker`
  import it, so the two lists cannot drift.
- `editing`, `renamingId`, `renameValue`, `adding`, `newName` — the same five
  pieces of state `HomePicker` holds, and for the same reason: mount resets
  them, so closing and reopening starts clean (`ui/`'s `Sheet` has no `open`
  prop; mounted is open — the Radix conversion's rule).
- The count line: `` `${people.length} ${people.length === 1 ? 'person' : 'people'}.` ``
  with `data-testid="people-count"`.
- A row per Person: circle (`data-testid={`person-initial-${id}`}`, holding the
  upper-cased first character or **nothing** when there is no name — `aria-hidden`,
  matching `AccountAvatar`), the name (`data-testid="person-name"`), the `YOU`
  badge when `person.id === personId`, and — only while `editing` — a `RENAME`
  button. Wrap each row in `data-testid={`person-row-${id}`}`.
- The dashed `+ NEW PERSON` row at the bottom, expanding into a name field and
  an `Add` button disabled on a blank name — the same anatomy `OwnerPicker`
  draws, so copy that JSX rather than re-deciding it.
- The rename form: a field labelled `New name`, seeded with the current name, a
  `Save` disabled while blank, emitting `personRenamed(id, trimmed)`.
- `variant="list"` renders the `‹ ACCOUNT` back link, the sync line and the
  title; `variant="inline"` renders neither and no title, because Account's own
  section head supplies them.

- [ ] **Step 4: Style it**

Create `app/src/screens/People.module.css`. Reuse `Account.module.css`'s row,
`rowTitle`, `sectionHead` and `bordered` measurements and `HomePicker.module.css`'s
dashed create row and rename row. The circle is 30px with `border: var(--stroke-rule)
solid var(--color-rule-control)` — the board's control border, and the comment
above it must say that the accent variant is S5's.

- [ ] **Step 5: Route it**

In `app/src/App.tsx`, beside the `/account/devices` route:

```tsx
              <Route path="/account/people">
                {isDesktop ? (
                  // Account unfolds the list into its own card at Desktop
                  // (boards §11), so the pushed screen has nowhere to be —
                  // the same redirect `/account/devices` already takes.
                  <Redirect to="/account" />
                ) : (
                  <People personId={session.personId} />
                )}
              </Route>
```

- [ ] **Step 6: Give Account its section**

In `app/src/screens/Account.tsx`, replace the `PEOPLE & LOGINS lands with S5`
comment with a real section, after `DEVICES` and before the footer, following
the `DEVICES` section's exact shape:

```tsx
        <section className={isDesktop ? styles['card'] : styles['section']}>
          <div className={styles['sectionHead']}>
            <span className={styles['sectionLabel']}>PEOPLE</span>
          </div>

          {isDesktop ? (
            <People personId={personId} variant="inline" />
          ) : (
            <Link href="/account/people" className={styles['row']}>
              <div>
                <div className={styles['rowTitle']}>People</div>
                <div className={styles['rowMeta']}>
                  {peopleCount} {peopleCount === 1 ? 'PERSON' : 'PEOPLE'}
                </div>
              </div>
              <span className={styles['chevron']} aria-hidden="true">
                ›
              </span>
            </Link>
          )}
        </section>
```

with `const peopleCount = useHousehold((depot) => Object.keys(depot.state.people).length)`.

Rewrite the `PEOPLE & LOGINS is omitted outright` paragraph in the `Account`
doc comment. It now reads that the section is titled **`PEOPLE`** because that
is all it can hold, that S5 renames it to `PEOPLE & LOGINS` and adds the right
column, and that the rule which kept it out at S3.5 — "an affordance that leads
nowhere is worse than a missing one" — now argues the other way, because it
leads somewhere real. Also add `PEOPLE` to the section-order sentence.

- [ ] **Step 7: Run**

Run: `npm test -w @foerier/app` then `npm run typecheck`
Expected: PASS across the workspace.

- [ ] **Step 8: Commit**

Stage the three new files, `App.tsx`, `Account.tsx`, `OwnerPicker.tsx` (for the
extracted comparator), `app/src/household/people.ts`, and both test files.

Message: *Record the household, and draw only what S4 can know* — the screen is
the board's minus its login half, and the three things left empty are S5's,
written down rather than left to be noticed.

---

## Task 12: The doc pass

**Files:**
- Modify: `docs/sync-protocol.md`, `docs/architecture-design.md`, `docs/design/README.md`, `CLAUDE.md`

- [ ] **Step 1: `sync-protocol.md` §4.2**

- Retype the `person.renamed` row: `` `{name: string｜null}` `` with the effect column reading "Sets `name`. `null` clears; absent ≠ null (§1.3)", matching `place.renamed`'s wording exactly.
- Delete the trailing paragraph in §4.3 that begins "`person.renamed` is not yet implemented by any reducer" — S4 folded it. Keep the rest of that paragraph (the `name` nullability history and the obligation-5 correction) intact.
- In §4.2's slice note, change "`person.renamed` and the People UI stay in S4" to past tense and cross-reference the S4 spec.

- [ ] **Step 2: `architecture-design.md`**

- §8.3: mark S4 landed in the same voice S3.5's entry uses.
- Add **§12.10, Consequences of S4: People and ownership**, covering: the two dimensions over one register and why the boards outrank the tidier merge; the grouping table and why it is not the dimension table; `ownerLabel` as the one place absence means Shared; the Add gear departure and its price; and the three obligations handed to S5.
- §8.5's ladder row for S4 needs no change — it was followed, not departed from. Say so in §12.10 explicitly, because S3's entry recorded departures and a reader will look for one here.

- [ ] **Step 3: `docs/design/README.md`**

- **§2** (Depot desktop): `GROUP BY` now reads `NONE · KIND · OWNER`; the OWNER column is filled; the owner spelling is `PERSONAL E`, resolving the boards' own two forms. Note that the S4 rung of the dashed future-dimension ladder is now live and the ladder is down to four.
- **§3b** (Add gear): the `OWNER` row after `HOME`, carrying over — recorded as a departure in the same voice §3b already uses for `UNDO`.
- **§13** (People & logins): what S4 ships and what it does not, and the three S5 obligations verbatim from the spec's §7.

- [ ] **Step 4: `CLAUDE.md`**

Add S4 to the status section in the established voice, and the three things
worth knowing before touching People or ownership:

1. **Two dimensions, one register** — and the always-empty chip pair is
   recorded, not guarded.
2. **Absence means Shared, and only `selectors/owner.ts` says so** — the fold
   conflates nothing; a call site that re-derives it will drift from the filter.
3. **The People screen is the board's minus its login half**, and the three
   things it leaves empty are S5's stated debt, not a gap.

Also update the "next slice" pointer from S4 to **S5 — Auth 2** and note that
S4 unblocked it.

- [ ] **Step 5: Run everything**

Run: `npm test` and `npm run typecheck`
Expected: PASS. Note the known `api/test/server/sync.test.ts` flake; re-run it
alone if it fails.

- [ ] **Step 6: Commit**

Stage the four docs.

Message: *Record what S4 settled, and what it owes S5.*

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: §1.1 → Task 1;
§1.2 → Task 1; §1.3 → Tasks 1–2; §1.4 → Task 2; §2 → no task needed (nothing is
added to the state shape, which the plan's Task 1 confirms by not touching
`state.ts`); §3.1–3.3 → Task 3; §3.4–3.5 → Task 4; §4.1 → Task 11; §4.2 → Task
7; §4.3 → Task 8; §4.4 → Task 9; §4.5 → Task 10; §5.1 → Tasks 1–4; §5.2 → Task
5; §5.3 → Tasks 6–11; §6 → Tasks 8 and 4 plus §12.10 and §3b/§2 in Task 12;
§7 → Task 11 plus Task 12; §8 → nothing to build, by definition; §9 → Task 12.

**Type consistency.** `ownerOf`/`ownerLabel`/`personLabel` keep one signature
from Task 2 through Task 11. `Dimension.format(value, state)` changes once, in
Task 3, and every caller is fixed in Task 6 — Task 3's step 6 says so
explicitly rather than leaving a red build unexplained. `GroupKey` widens once,
in Task 4, and `GROUP_KEYS`/`groupLabel` are the only new exports it needs.
`OwnerPicker`'s props are identical in Tasks 7, 8 and 9. `sortedPeople(state)`
is introduced in Task 11 and retro-fitted into `OwnerPicker` in the same task,
which is the only place two files could have drifted.

**Deliberate red build.** Task 3 leaves `app/` failing `typecheck` and Task 6
fixes it. This is the one place the plan permits it, and it is called out in
both tasks. Every other task ends green.
