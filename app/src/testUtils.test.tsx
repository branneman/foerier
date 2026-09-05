import { gearRecorded, parseHlc } from '@foerier/shared'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useHousehold } from './household/store'
import {
  anAuthor,
  countingIds,
  noopEngine,
  renderWithStore,
  seededStore,
} from './testUtils'

/**
 * The Tier 3 scaffolding, which thirty suites used to carry a copy of. The
 * suites themselves are what prove it works; these tests pin the three
 * promises that are easy to break silently while every one of them still
 * passes.
 */

describe('seededStore', () => {
  it('has already folded the seed by the time it resolves', async () => {
    // `emit` is durable-first: the fold arrives a queue-turn after the call,
    // so a helper that skipped `drained()` would hand back an empty state and
    // every suite would race it.
    const store = await seededStore([
      gearRecorded('g1', {
        name: 'Zeltbahn',
        container: false,
        kind: 'single',
      }),
    ])

    expect(store.getState().state.gear['g1']?.name?.value).toBe('Zeltbahn')
  })

  it('seeds through the real authoring path, so each op gets its own clock', async () => {
    const { gear } = (
      await seededStore([
        gearRecorded('g1', {
          name: 'Zeltbahn',
          container: false,
          kind: 'single',
        }),
        gearRecorded('g2', {
          name: 'Feldflasche',
          container: false,
          kind: 'single',
        }),
      ])
    ).getState().state

    const first = parseHlc(gear['g1']!.name!.hlc)!
    const second = parseHlc(gear['g2']!.name!.hlc)!

    expect(second.counter).toBeGreaterThan(first.counter)
  })
})

describe('countingIds', () => {
  it('gives each source its own sequence, so two suites never collide', () => {
    const a = countingIds()
    const b = countingIds('dddddddd')

    expect(a.next()).not.toBe(b.next())
    expect(a.next()).not.toBe(a.next())
  })
})

describe('noopEngine', () => {
  it('reports idle and never leaves the device', () => {
    const engine = noopEngine({
      onOps: () => {},
      onStatus: () => {},
      onBootstrap: () => {},
    })

    expect(engine.status()).toBe('idle')
    expect(engine.bootstrap()).toBeNull()
  })
})

describe('renderWithStore', () => {
  it('puts the store where useHousehold can read it', async () => {
    const store = await seededStore([
      gearRecorded('g1', {
        name: 'Zeltbahn',
        container: false,
        kind: 'single',
      }),
    ])

    function Probe() {
      const name = useHousehold((s) => s.state.gear['g1']?.name?.value)
      return <p>{name}</p>
    }

    renderWithStore(<Probe />, store)

    expect(screen.getByText('Zeltbahn')).toBeVisible()
  })
})

describe('anAuthor', () => {
  it('takes the household and device a suite names, and defaults the rest', () => {
    const author = anAuthor({ householdId: 'h-other' })

    expect(author.household_id).toBe('h-other')
    expect(typeof author.device_id).toBe('string')
    expect(typeof author.ids.next()).toBe('string')
  })
})
