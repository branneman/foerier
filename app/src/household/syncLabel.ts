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
 * **A refused write is this line's third state** (`docs/design/README.md` §5n
 * K24), and it **outranks** the other two.
 *
 * The line is already the channel for how this Device is doing, so a refusal
 * needs no surface of its own: sage `SYNCED` · amber `OFFLINE` · attention
 * `▲ 1 NOT SAVED`. Rank rather than merge, because the two facts are not the
 * same kind of thing — being offline is normal and reversible and the app
 * says so on purpose, while a lost write is neither, and a Device that is
 * both has exactly one thing worth a reader's attention.
 *
 * The count is always drawn, `1` included (§5b M pins each of these at N=1),
 * and it counts **refusals, not ops**: a gesture refused whole is one thing
 * the Quartermaster did and one line in the sheet.
 *
 * **The ▲ is not in here.** It is the *marker*, drawn in the dot's own slot by
 * whichever surface draws the marker — so a label carrying one too renders
 * `▲ ▲ 1 NOT SAVED`, which is what shipped for about an hour and is what a
 * browser catches and no jsdom assertion did. It also keeps the glyph out of
 * the accessible name, exactly as the dot is `aria-hidden` beside its words.
 */
function refusedLabel(refused: number): string {
  return `${refused} NOT SAVED`
}

/**
 * The compact form, for a screen that already has a header of its own (the
 * gear detail's `● SYNCED`).
 */
export function syncLabel(status: SyncStatus, refused = 0): string {
  if (refused > 0) return refusedLabel(refused)
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
export function syncLine(status: SyncStatus, refused = 0): string {
  if (refused > 0) return refusedLabel(refused)
  return status === 'signed-out'
    ? 'SIGNED OUT · SAVED ON DEVICE'
    : syncLabel(status)
}

/**
 * Sage while the household is reachable, amber while it is not, **attention
 * while a write was refused** — the marker is the only colour the line
 * carries.
 *
 * `attention` is the app's mark for an act that discards unsynced work, which
 * until §5n K24 only signing this device out could do; a refusal discards
 * exactly that, so the ▲ is earned rather than borrowed. It takes the dot's
 * own slot, which is what keeps K10's two-row foot aligned across all three
 * states.
 */
export function syncTone(
  status: SyncStatus,
  refused = 0,
): 'reachable' | 'unreachable' | 'attention' {
  if (refused > 0) return 'attention'
  return status === 'offline' || status === 'signed-out'
    ? 'unreachable'
    : 'reachable'
}
