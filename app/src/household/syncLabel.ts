import type { SyncStatus } from './syncEngine'

/**
 * The one place the engine's status becomes words a Quartermaster reads.
 *
 * Sync state is **one quiet line**, never a blocking dialog
 * (`docs/design/README.md`, Interactions): offline is normal, and so is being
 * signed out — packing carries on either way. There is exactly one source of
 * truth behind these strings, and it is {@link SyncStatus}: never
 * `navigator.onLine`, which knows whether a radio is on and nothing at all
 * about whether the household can be reached.
 */

/**
 * The compact form, for a screen that already has a header of its own (the
 * gear detail's `● SYNCED`).
 */
export function syncLabel(status: SyncStatus): string {
  switch (status) {
    case 'syncing':
    case 'bootstrapping':
      return 'SYNCING'
    case 'offline':
      return 'OFFLINE'
    case 'signed-out':
      return 'SIGNED OUT'
    case 'idle':
      return 'SYNCED'
  }
}

/**
 * The shell's header line. Identical to {@link syncLabel} but for the
 * signed-out case, which carries its reassurance with it: a Device whose token
 * expired has lost nothing, and the line has to say so where the user is
 * looking — `SIGNED OUT · SAVED ON DEVICE`, no banner, no lock, no prompt
 * (`docs/design/README.md` §10, rule 8).
 */
export function syncLine(status: SyncStatus): string {
  return status === 'signed-out'
    ? 'SIGNED OUT · SAVED ON DEVICE'
    : syncLabel(status)
}

/** Sage while the household is reachable, amber while it is not — the dot is
 * the only colour the line carries. */
export function syncTone(status: SyncStatus): 'reachable' | 'unreachable' {
  return status === 'offline' || status === 'signed-out'
    ? 'unreachable'
    : 'reachable'
}
