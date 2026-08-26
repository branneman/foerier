import {
  findGear,
  whereabouts,
  type DepotState,
  type Match,
  type PathSegment,
  type WhereaboutsSlice,
} from '@foerier/shared'
import { Logo } from '@foerier/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'wouter'

import { useDepot } from '../depot/store'
import styles from './Find.module.css'

/**
 * Find — story 3, "I find things fast instead of searching through bags"
 * (`docs/design/README.md` §6). **Answer-first**: a result's whereabouts is
 * the payload, not a reason to tap through. Search runs entirely over
 * `findGear`/`whereabouts` (`@foerier/shared`), both pure folds of local
 * state — there is nothing here for the network to be in the way of, which
 * is why nothing on this screen reads the sync status.
 *
 * **Left to a later slice, deliberately, same as `whereabouts` itself:**
 * - the amber trip slice and the `▲ LAST SEEN` / `RESOLVE` unaccounted read —
 *   both need an unpack outcome and a trip residence, neither of which exist
 *   before S12/S9-10. `whereabouts` returns exactly one `home` slice today,
 *   and this screen renders exactly that — no placeholder.
 * - the per-person piece breakdown (§6's "Headlamp" card, one row per
 *   person) — pieces are a trip concept (`docs/ubiquitous-language.md`).
 *   The **structure** that card teaches — a header naming the gear apart
 *   from a list of whereabouts rows — is what `counted` gear borrows below,
 *   ahead of having more than one slice to show in it.
 */

const RECENT_LIMIT = 5

/** `4 MATCHES · ON-DEVICE INDEX` / `1 MATCH · ON-DEVICE INDEX` — the count
 * line search works to a query with. Present only while one is typed; there
 * is no "N GEAR" resting state here, unlike the Depot list search shares its
 * pattern with — Find has nothing to say before it is asked something. */
function matchLine(count: number): string {
  const noun = count === 1 ? 'MATCH' : 'MATCHES'
  return `${count} ${noun} · ON-DEVICE INDEX`
}

function pathText(path: readonly PathSegment[]): string {
  return path.map((segment) => segment.name).join(' ▸ ')
}

/** `⌂ HOME` for a slice with no containing path, else `⌂ <path>` — the
 * whereabouts line, mono 11, muted for home (`docs/design/README.md` §6). */
function sliceText(slice: WhereaboutsSlice): string {
  const text = pathText(slice.path)
  return text === '' ? '⌂ HOME' : `⌂ ${text}`
}

/**
 * The answer-first card for counted gear: a header naming the gear and its
 * owned count, then one row per {@link whereabouts} slice. S2b's
 * `whereabouts` always answers with exactly one `home` slice, so this card
 * shows one row today — the shape is what carries forward once story 11's
 * quantity split gives counted gear a second slice to add here.
 */
function CountedCard({ state, match }: { state: DepotState; match: Match }) {
  const name = match.gear.name?.value ?? ''
  const result = whereabouts(state, match.gear.id)
  const count = result.slices.reduce((sum, slice) => sum + slice.count, 0)
  const metaId = `find-card-meta-${match.gear.id}`
  const sliceIds = result.slices.map(
    (slice) => `find-card-slice-${match.gear.id}-${slice.kind}`,
  )

  return (
    <Link
      href={`/gear/${match.gear.id}`}
      className={styles['card']}
      aria-label={name}
      aria-describedby={[metaId, ...sliceIds].join(' ')}
    >
      <span className={styles['cardHeader']}>
        <span className={styles['name']}>{name}</span>
        <span id={metaId} className={styles['cardMeta']}>
          COUNTED · ×{count}
        </span>
      </span>
      <span className={styles['sliceList']}>
        {result.slices.map((slice, index) => (
          <span key={slice.kind} className={styles['sliceRow']}>
            <span id={sliceIds[index]} className={styles['sliceWhereabouts']}>
              {sliceText(slice)}
            </span>
          </span>
        ))}
      </span>
    </Link>
  )
}

/** The standard 2-line row for a plain match — a name, its full home path,
 * and a `⌂ HOME` mini status echoing the Depot list's own row. */
function PlainRow({ match }: { match: Match }) {
  const name = match.gear.name?.value ?? ''
  const text = pathText(match.path)
  const metaId = `find-row-meta-${match.gear.id}`
  const whereaboutsId = `find-row-whereabouts-${match.gear.id}`
  const describedBy = [text !== '' ? metaId : null, whereaboutsId]
    .filter((id) => id !== null)
    .join(' ')

  return (
    <Link
      href={`/gear/${match.gear.id}`}
      className={styles['row']}
      aria-label={name}
      aria-describedby={describedBy}
    >
      <span className={styles['rowMain']}>
        <span className={styles['name']}>{name}</span>
        {text !== '' && (
          <span id={metaId} className={styles['meta']} data-testid="meta">
            ⌂ {text}
          </span>
        )}
      </span>
      <span id={whereaboutsId} className={styles['whereabouts']}>
        ⌂ HOME
      </span>
    </Link>
  )
}

export function Find() {
  const state = useDepot((depot) => depot.state)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const previousQuery = useRef('')

  const trimmed = query.trim()
  const matches = useMemo(() => findGear(state, trimmed), [state, trimmed])

  // Recent searches are a per-viewer convenience, not a fact about the
  // household — nothing here is an op, so nothing here is folded, synced, or
  // even durable: it is React state, gone on reload, same as any other
  // scratch UI field. A query joins the list the moment it is cleared, which
  // reads as "the search that was just finished" without needing a submit
  // button this live-filtering field never had.
  useEffect(() => {
    if (trimmed === '' && previousQuery.current !== '') {
      const finished = previousQuery.current
      setRecent((current) =>
        [
          finished,
          ...current.filter(
            (entry) => entry.toLowerCase() !== finished.toLowerCase(),
          ),
        ].slice(0, RECENT_LIMIT),
      )
    }
    previousQuery.current = trimmed
  }, [trimmed])

  return (
    <div className={styles['screen']}>
      <header className={styles['header']}>
        <Logo size={28} title="foerier" />
      </header>

      <h1 className={styles['title']}>Find</h1>

      <input
        type="search"
        className={styles['search']}
        aria-label="Search gear"
        placeholder="Search gear"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {trimmed !== '' && (
        <p className={styles['countLine']}>{matchLine(matches.length)}</p>
      )}

      {trimmed !== '' && matches.length === 0 && (
        <p className={styles['empty']}>No matches.</p>
      )}

      {trimmed !== '' && matches.length > 0 && (
        <ul className={styles['list']}>
          {matches.map((match) => (
            <li key={match.gear.id}>
              {match.gear.kind?.value === 'counted' ? (
                <CountedCard state={state} match={match} />
              ) : (
                <PlainRow match={match} />
              )}
            </li>
          ))}
        </ul>
      )}

      {trimmed === '' && recent.length > 0 && (
        <div className={styles['recent']}>
          <span className={styles['recentLabel']}>RECENT</span>
          <ul className={styles['recentList']}>
            {recent.map((entry) => (
              <li key={entry}>
                <button
                  type="button"
                  className={styles['recentRow']}
                  onClick={() => setQuery(entry)}
                >
                  {entry}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
