import { describe, expect, it } from 'vitest'

import type { SyncStatus } from './syncEngine'
import { syncLabel, syncLine, syncTone } from './syncLabel'

/**
 * The design's register, pinned as a table (`docs/design/README.md` §10). The
 * `signed-out` row matters most and is the hardest to see in a running app:
 * the shell shows it only for the moment between the engine freezing and
 * `App` routing to `/signin` (`auth-design.md` §7.2), so nothing above this
 * tier can assert it without racing.
 */

const CASES: readonly {
  status: SyncStatus
  label: string
  line: string
  tone: 'reachable' | 'unreachable'
}[] = [
  { status: 'idle', label: 'SYNCED', line: 'SYNCED', tone: 'reachable' },
  { status: 'syncing', label: 'SYNCING', line: 'SYNCING', tone: 'reachable' },
  {
    status: 'bootstrapping',
    label: 'SYNCING',
    line: 'SYNCING',
    tone: 'reachable',
  },
  { status: 'offline', label: 'OFFLINE', line: 'OFFLINE', tone: 'unreachable' },
  {
    status: 'signed-out',
    label: 'SIGNED OUT',
    line: 'SIGNED OUT · SAVED ON DEVICE',
    tone: 'unreachable',
  },
]

describe('the sync register', () => {
  it.each(CASES)('reads $status as $line', ({ status, label, line, tone }) => {
    expect(syncLabel(status)).toBe(label)
    expect(syncLine(status)).toBe(line)
    expect(syncTone(status)).toBe(tone)
  })

  it('never says anything alarming about being unreachable', () => {
    // Offline is normal and signing out costs nothing: neither line may read
    // as data loss (docs/design/README.md §15).
    for (const { line } of CASES) {
      expect(line).not.toMatch(/error|fail|lost|▲/i)
    }
  })
})
