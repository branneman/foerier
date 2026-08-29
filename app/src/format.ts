/**
 * The one place a server timestamp becomes a string a Quartermaster reads.
 *
 * **Local time, no zone suffix** (Screens C §08, "DECISIONS DRAWN AFTER THE
 * FACT — S5"). Three screens showed these dates and each sliced the ISO
 * string, which renders UTC — and UTC is false for every reader of a
 * one-timezone household: `19:04Z` is 21:04 on the phone in their hand. The
 * suffix is omitted for the same reason it would be noise: there is one
 * household, in one place, and it never sees a second zone.
 *
 * A **relative** form (`5 DAYS AGO`) was the other candidate and was refused:
 * it fights a ledger that writes dates as data, which is what the account
 * surfaces are.
 *
 * `formatDate` is the same instant truncated, not a different rule — so a row
 * cannot print a date from one calendar and a time from another, which is
 * exactly what happened while `LAST SEEN` was local and `SIGNED IN` was not.
 *
 * These are deliberately not `Intl.DateTimeFormat`: the boards draw
 * `2026-08-20 19:04`, an ISO-shaped ledger value, and a locale-aware
 * formatter would render it `20/08/2026` or `8/20/2026` depending on the
 * browser — a fact about the reader's machine leaking into a column of data.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `2026-08-20` in the reader's own zone. */
export function formatDate(iso: string | Date): string {
  const at = typeof iso === 'string' ? new Date(iso) : iso
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/** `2026-08-20 19:04` in the reader's own zone. */
export function formatDateTime(iso: string | Date): string {
  const at = typeof iso === 'string' ? new Date(iso) : iso
  return `${formatDate(at)} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Compared as **local** calendar dates, which is the whole point: against UTC,
 * a passkey added at 00:30 in Amsterdam reads `ADDED 2026-08-19` while the
 * reader's calendar says the 20th, and `TODAY` never appears on the day it
 * describes.
 */
export function isToday(iso: string | Date): boolean {
  return formatDate(iso) === formatDate(new Date())
}
