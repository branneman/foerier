import { describe, expect, it } from 'vitest'

import { formatHlc } from './hlc.ts'
import { stampOf, writeRegister, type Register } from './registers.ts'

const at = (counter: number) => formatHlc({ ms: 1_700_000_000_000, counter })
const A = 'aaaaaaaa-0000-7000-8000-000000000001'
const B = 'bbbbbbbb-0000-7000-8000-000000000002'

describe('writeRegister', () => {
  it('seeds an absent register', () => {
    expect(
      writeRegister(undefined, 'Tent', { hlc: at(1), deviceId: A }),
    ).toEqual({
      value: 'Tent',
      hlc: at(1),
      deviceId: A,
    })
  })

  it('takes a strictly later write', () => {
    const first = writeRegister(undefined, 'Tent', { hlc: at(1), deviceId: A })
    expect(
      writeRegister(first, 'Tarp', { hlc: at(2), deviceId: A }).value,
    ).toBe('Tarp')
  })

  it('ignores an earlier write and returns the identical object', () => {
    const first = writeRegister(undefined, 'Tent', { hlc: at(5), deviceId: A })
    // Identity, not merely equality: an unchanged register must not invalidate
    // a memo or re-render a row. A late-arriving older op loses at O(1).
    expect(writeRegister(first, 'Tarp', { hlc: at(2), deviceId: A })).toBe(
      first,
    )
  })

  it('breaks an exact hlc tie on device id, whichever order it sees them', () => {
    const fromA = writeRegister(undefined, 'A', { hlc: at(3), deviceId: A })
    expect(writeRegister(fromA, 'B', { hlc: at(3), deviceId: B }).value).toBe(
      'B',
    )

    const fromB = writeRegister(undefined, 'B', { hlc: at(3), deviceId: B })
    expect(writeRegister(fromB, 'A', { hlc: at(3), deviceId: A }).value).toBe(
      'B',
    )
  })

  it('ignores a re-application of the very same op', () => {
    const first = writeRegister(undefined, 'Tent', { hlc: at(1), deviceId: A })
    expect(writeRegister(first, 'Tent', { hlc: at(1), deviceId: A })).toBe(
      first,
    )
  })

  it('holds null as a value like any other', () => {
    const r: Register<string | null> = writeRegister<string | null>(
      undefined,
      null,
      {
        hlc: at(1),
        deviceId: A,
      },
    )
    expect(r.value).toBeNull()
  })
})

describe('stampOf', () => {
  it('projects the comparable half of a register', () => {
    const r = writeRegister(undefined, 1, { hlc: at(1), deviceId: A })
    expect(stampOf(r)).toEqual({ hlc: at(1), deviceId: A })
  })
})
