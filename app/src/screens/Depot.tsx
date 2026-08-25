import {
  containmentView,
  depotCounts,
  homePath,
  visibleGear,
  type ContainmentView,
  type DepotState,
  type GearState,
} from '@foerier/shared'
import { Logo } from '@foerier/ui'
import { useMemo, useState } from 'react'
import { Link } from 'wouter'

import { useDepot } from '../depot/store'
import styles from './Depot.module.css'

/**
 * The Depot list — the first screen a Quartermaster sees
 * (`docs/design/README.md` §3). It never shows packing status: that belongs
 * to a Trip, and this is the year-round, at-home inventory.
 */

/**
 * `home path · ×N` — a row's mono meta line, under its name. Empty for loose,
 * non-counted gear, in which case the caller renders nothing at all rather
 * than an empty span.
 */
function metaFor(
  state: DepotState,
  gear: GearState,
  view: ContainmentView,
): string {
  const path = homePath(state, gear.id, view)
  const pathText = path.map((segment) => segment.name).join(' ▸ ')
  const ownedCount = gear.ownedCount?.value
  const countText =
    gear.kind?.value === 'counted' && ownedCount !== undefined
      ? `×${ownedCount}`
      : ''
  return [pathText, countText].filter((part) => part !== '').join(' · ')
}

/** `1 MATCH` / `4 MATCHES` — the count line while the search field narrows
 * the list, in place of the household-wide `N GEAR · M PIECES` headline. */
function matchLine(count: number): string {
  return count === 1 ? '1 MATCH' : `${count} MATCHES`
}

export function Depot() {
  const state = useDepot((depot) => depot.state)
  const [query, setQuery] = useState('')

  const view = useMemo(() => containmentView(state), [state])
  const gear = useMemo(() => visibleGear(state), [state])
  const counts = useMemo(() => depotCounts(state), [state])

  const trimmed = query.trim().toLowerCase()
  const filtered =
    trimmed === ''
      ? gear
      : gear.filter((item) =>
          (item.name?.value ?? '').toLowerCase().includes(trimmed),
        )

  const countLine =
    trimmed === ''
      ? `${counts.gear} GEAR · ${counts.pieces} PIECES`
      : matchLine(filtered.length)

  return (
    <div className={styles['screen']}>
      <header className={styles['header']}>
        <Logo size={28} title="foerier" />
      </header>

      <h1 className={styles['title']}>Depot</h1>

      <input
        type="search"
        className={styles['search']}
        aria-label="Search gear"
        placeholder="Search gear"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <p className={styles['countLine']}>{countLine}</p>

      {gear.length === 0 ? (
        <p className={styles['empty']}>Nothing recorded yet.</p>
      ) : filtered.length === 0 ? (
        <p className={styles['empty']}>No matches.</p>
      ) : (
        <ul className={styles['list']}>
          {filtered.map((item) => {
            const name = item.name?.value ?? ''
            const meta = metaFor(state, item, view)
            const isContainer = item.container?.value === true
            const metaId = `depot-row-meta-${item.id}`
            const whereaboutsId = `depot-row-whereabouts-${item.id}`
            // The row's accessible name stays just the gear's name (rows are
            // queried by it in tests, and it's what you'd say the row *is*),
            // but the home path and whereabouts are real content — the
            // answer to "where is it" — so a screen-reader activating the
            // row still hears them, via `aria-describedby` rather than
            // folding them into the name.
            const describedBy = [meta !== '' ? metaId : null, whereaboutsId]
              .filter((id) => id !== null)
              .join(' ')

            return (
              <li key={item.id}>
                <Link
                  href={`/gear/${item.id}`}
                  className={styles['row']}
                  aria-label={name}
                  aria-describedby={describedBy}
                >
                  <span className={styles['rowMain']}>
                    <span className={styles['name']}>{name}</span>
                    {meta !== '' && (
                      <span
                        id={metaId}
                        className={styles['meta']}
                        data-testid="meta"
                      >
                        {meta}
                      </span>
                    )}
                  </span>
                  <span className={styles['rowSide']}>
                    <span id={whereaboutsId} className={styles['whereabouts']}>
                      ⌂ HOME
                    </span>
                    {isContainer && (
                      <span className={styles['chevron']} aria-hidden="true">
                        ›
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <Link href="/add" className={styles['fab']} aria-label="Add gear">
        +
      </Link>
    </div>
  )
}
