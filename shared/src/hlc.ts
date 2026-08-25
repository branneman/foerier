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
