import {
  containmentView,
  findGear,
  whereabouts,
  type ContainmentView,
  type DepotState,
  type Match,
  type PathSegment,
  type WhereaboutsSlice,
} from '@foerier/shared'
import { GearRow, Logo } from '@foerier/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'wouter'

import { useDepot } from '../depot/store'
import { DESKTOP, useMediaQuery } from '../shell/useMediaQuery'
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
 * - `per_person` gear falls through to {@link PlainRow} below, same as
 *   `single`, and that is a deferred seam, not an oversight: story 3 groups
 *   Counted **and** Per-person gear under the quantity-split treatment, but
 *   the two splits are different mechanisms. Counted's is an arithmetic
 *   home/trip *count* split — exactly what `WhereaboutsSlice[]` already
 *   models, which is why {@link CountedCard} can map over `result.slices`
 *   generically today and needs no restructuring once story 11 lands a
 *   second slice. Per-person's is a per-**Piece** breakdown (one row per
 *   participant, `docs/ubiquitous-language.md`), a shape `WhereaboutsSlice`
 *   does not represent at all — routing it through `CountedCard` now would
 *   hard-code a wrong `COUNTED` label and commit to the wrong row semantics
 *   ahead of Pieces existing. It waits for Pieces, rather than being
 *   approximated.
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

/** `⌂ LOOSE` for a slice with no containing path, else `⌂ <path>` — the
 * whereabouts line, mono 11, muted for home (`docs/design/README.md` §6).
 * `LOOSE` is the ubiquitous-language term for gear with no residence
 * (`docs/ubiquitous-language.md`) and matches `WhereaboutsCard.pathText` and
 * `GearDetail.chipLocation`'s fallback for the identical condition. */
function sliceText(slice: WhereaboutsSlice): string {
  const text = pathText(slice.path)
  return text === '' ? '⌂ LOOSE' : `⌂ ${text}`
}

/**
 * The answer-first card for counted gear: a header naming the gear and its
 * owned count, then one row per {@link whereabouts} slice. S2b's
 * `whereabouts` always answers with exactly one `home` slice, so this card
 * shows one row today — the shape is what carries forward once story 11's
 * quantity split gives counted gear a second slice to add here.
 *
 * `view` is hoisted once for the whole screen (the way `Depot.tsx` hoists
 * its own) and handed in, rather than left to `whereabouts`' default
 * parameter — which would build a fresh `containmentView`, an O(n log n)
 * sort over the whole depot, once per counted match, on every keystroke.
 */
function CountedCard({
  state,
  match,
  view,
}: {
  state: DepotState
  match: Match
  view: ContainmentView
}) {
  const name = match.gear.name?.value ?? ''
  const result = whereabouts(state, match.gear.id, view)
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

/**
 * The standard 2-line row for a plain match — **the same `GearRow` the Depot
 * list uses**, with the meta slot swapped to the `⌂` path.
 *
 * "Answer-first is a meta-slot choice, not a new component" (Components §03).
 * Until S3 this screen carried its own copy of the Depot's row JSX, and
 * `Find.module.css` and `Depot.module.css` shared nine byte-identical blocks
 * — the duplication [architecture §12.4](../../../docs/architecture-design.md)
 * named as the reason to extract at this slice.
 */
function PlainRow({ match }: { match: Match }) {
  const text = pathText(match.path)
  return (
    <Link href={`/gear/${match.gear.id}`} asChild>
      <GearRow
        name={match.gear.name?.value ?? ''}
        href={`/gear/${match.gear.id}`}
        whereabouts="⌂ HOME"
        {...(text === '' ? {} : { path: `⌂ ${text}` })}
      />
    </Link>
  )
}

export function Find() {
  const state = useDepot((depot) => depot.state)
  const isDesktop = useMediaQuery(DESKTOP)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const previousQuery = useRef('')

  const trimmed = query.trim()
  const matches = useMemo(() => findGear(state, trimmed), [state, trimmed])
  const view = useMemo(() => containmentView(state), [state])

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
      {/* The phone shell's logo header, withheld at Desktop exactly as Depot
          withholds it: the sidebar there already carries the logo. */}
      {!isDesktop && (
        <header className={styles['header']}>
          <Logo size={28} title="foerier" />
        </header>
      )}

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
                <CountedCard state={state} match={match} view={view} />
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
