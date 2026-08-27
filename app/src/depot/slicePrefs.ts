import { EMPTY_SLICE, type GroupKey, type SortKey } from '@foerier/shared'

/**
 * The half of a slice that persists.
 *
 * > Sort and group persist per device; filter chips and search reset on a
 * > fresh start, but survive navigation.
 * > — `docs/design/README.md` §3
 *
 * ## Why `localStorage` and not the app's IndexedDB
 *
 * Everything else this app stores goes through `db.ts` — the session, the op
 * log, the sync cursors. This does not, and the reason is that
 * **`localStorage` is synchronous.** An async read from `META_STORE` would
 * paint the default sort on every mount of the app's most-visited screen and
 * then flip it, which is a visible flash for a preference worth one tap.
 *
 * It is also not household data and must never hold any: two enum values, no
 * sync, no merge, no clock. Losing it costs a tap, which is why every failure
 * mode below resolves to "use the defaults" rather than to an error.
 */
export interface SlicePrefs {
  sort: SortKey
  group: GroupKey
}

const KEY = 'foerier.slice'

/** `NAME A→Z`, ungrouped — `EMPTY_SLICE`'s own halves, so the resting state
 * is defined once, in `shared/`, rather than twice. */
export const DEFAULT_SLICE_PREFS: SlicePrefs = {
  sort: EMPTY_SLICE.sort,
  group: EMPTY_SLICE.group,
}

const SORTS: readonly SortKey[] = ['name-asc', 'name-desc', 'newest']
const GROUPS: readonly GroupKey[] = ['none', 'kind']

function readMember<T extends string>(
  known: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return known.includes(value as T) ? (value as T) : fallback
}

/**
 * The device's stored preference, or the defaults.
 *
 * Tolerant in the same spirit as the op-log reader, at a much smaller scale:
 * a value written by a later build naming a sort this one has never heard of
 * is **ignored per field**, not taken as a reason to discard the other field
 * or to render a list sorted by nothing. Storage that throws — a private
 * window, a browser set to block site data — resolves the same way.
 */
export function readSlicePrefs(storage: Storage = localStorage): SlicePrefs {
  let raw: string | null
  try {
    raw = storage.getItem(KEY)
  } catch {
    return DEFAULT_SLICE_PREFS
  }
  if (raw === null) return DEFAULT_SLICE_PREFS

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_SLICE_PREFS
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return DEFAULT_SLICE_PREFS
  }

  const record = parsed as Record<string, unknown>
  return {
    sort: readMember(SORTS, record['sort'], DEFAULT_SLICE_PREFS.sort),
    group: readMember(GROUPS, record['group'], DEFAULT_SLICE_PREFS.group),
  }
}

/** Best effort, always. A refused write loses a preference, never a screen. */
export function writeSlicePrefs(
  prefs: SlicePrefs,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Deliberately silent: there is nothing to tell the Quartermaster, and
    // nothing they could do about it.
  }
}
