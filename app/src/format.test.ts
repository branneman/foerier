import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatDate, formatDateTime, isToday } from './format'

/**
 * These assertions only mean anything because `app/vitest.config.ts` pins
 * `TZ=Europe/Amsterdam`. Under `TZ=UTC` a local-time formatter and the
 * ISO-slicing one it replaced produce identical strings, so every case here
 * would pass against the bug it exists to catch.
 *
 * Amsterdam is the household's own zone and is offset in both halves of the
 * year — `+2` under CEST, `+1` under CET — which is what lets these cases
 * distinguish "converted to local" from "truncated a UTC string" in summer
 * and winter alike.
 */
describe('formatDateTime', () => {
  it('renders the reader’s local hour, not UTC', () => {
    // 17:04Z in August is 19:04 in Amsterdam — and 19:04 is what the board
    // draws for this row (Screens C §08's `LAST SEEN 2026-08-20 19:04`).
    expect(formatDateTime('2026-08-20T17:04:00.000Z')).toBe('2026-08-20 19:04')
  })

  it('converts under the winter offset too, not just summer', () => {
    // CET is +1, so a formatter that hardcoded +2 would fail here.
    expect(formatDateTime('2026-01-15T09:30:00.000Z')).toBe('2026-01-15 10:30')
  })

  it('carries the date across midnight with the time', () => {
    // 23:30Z on the 15th is 00:30 on the 16th locally. A formatter that
    // sliced the ISO date and converted only the clock would print
    // `2026-01-15 00:30` — the right time on the wrong day.
    expect(formatDateTime('2026-01-15T23:30:00.000Z')).toBe('2026-01-16 00:30')
  })

  it('pads single digits so the column stays a column', () => {
    expect(formatDateTime('2026-03-02T07:05:00.000Z')).toBe('2026-03-02 08:05')
  })
})

describe('formatDate', () => {
  /**
   * `formatDate` is the same instant truncated, never a second rule. While
   * `LAST SEEN` was local and `SIGNED IN` sliced the ISO string, one Devices
   * row could print a date from one calendar beside a time from another.
   */
  it('is the same instant as formatDateTime, truncated', () => {
    const iso = '2026-01-15T23:30:00.000Z'
    expect(formatDateTime(iso).startsWith(formatDate(iso))).toBe(true)
    expect(formatDate(iso)).toBe('2026-01-16')
  })
})

describe('isToday', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * The bug a UTC comparison carries: just after local midnight the two
   * calendars disagree, and `TODAY` never appears on the day it describes.
   */
  it('compares local calendar dates, not UTC ones', () => {
    vi.useFakeTimers()
    // 23:30Z on the 15th — already 00:30 on the 16th in Amsterdam.
    vi.setSystemTime(new Date('2026-01-15T23:30:00.000Z'))

    expect(isToday('2026-01-15T23:35:00.000Z')).toBe(true)
    // Earlier the same UTC day, but yesterday on the reader's calendar.
    expect(isToday('2026-01-15T09:00:00.000Z')).toBe(false)
  })
})
