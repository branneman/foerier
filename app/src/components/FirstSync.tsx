import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'

import { useDepotStore, type DepotStoreState } from '../depot/store'
import type { BootstrapProgress } from '../depot/syncEngine'
import styles from './FirstSync.module.css'

/**
 * The first-sync fold (`docs/design/README.md` §9, `sync-protocol.md` §7.6) —
 * **the app's only unavoidable loading screen**. A Device that has never
 * pulled folds the household's whole op log before it can show anything, and
 * that cost grows with the household, so §7.6 asks for exactly three things
 * and this is where they are kept:
 *
 * - **determinate, never a spinner** — ops folded over ops known, because
 *   `seq` is gapless and `household_seq` therefore *is* the household's op
 *   count (§6.4);
 * - **resumable** — the cursor is persisted per page, so a dropped connection
 *   continues from it. The paused frame says so, and `RETRY NOW` acts on it;
 * - **honest that this is one-time** — the copy says so in as many words.
 *
 * ## It keys off the progress object, never the status string
 *
 * `SyncStatus` cannot know a pull is a bootstrap until the first page comes
 * back, because that page is what carries `household_seq`. The engine's
 * {@link BootstrapProgress} can and does: it is reported the moment a pull
 * starts from cursor 0, with `total: 0` for "not known yet", which this
 * renders as `—`. A screen keyed off `sync === 'bootstrapping'` would show
 * nothing for the first round trip and let the CTA enable and then disable
 * under the user's finger.
 *
 * ## A paused fold is not an error
 *
 * Nothing of the user's is wrong and nothing is lost — the cursor is kept and
 * the ops already folded stay folded. So the paused frame carries **no `▲`**
 * (README's status grammar reserves the triangle for attention: missing,
 * lost, disagreement) and no attention colour. The offline dot in the header
 * is the only amber on the screen.
 *
 * ## Two surfaces, one component
 *
 * The fold is a state of the sync engine, not a property of the join screen:
 * it runs on the join success frame, on a freshly linked Device, and on a
 * sign-in after a local wipe. `variant="card"` composes it into the join
 * card with its gated CTA; `variant="screen"` renders it full-screen ahead of
 * the shell, where there is no CTA because there is nothing to open — the
 * shell simply appears when the fold completes.
 */

export interface FirstSyncProps {
  /**
   * `'card'` composes into the join screen's success frame; `'screen'`
   * renders the fold full-screen ahead of the app shell.
   */
  variant?: 'card' | 'screen'
  /** The join screen's gated CTA. Read by the `'card'` variant only. */
  onOpenDepot?: () => void
}

/** §9's mono counts are grouped — `OP 4,215 OF 11,562 FOLDED`. Grouped by
 * hand rather than by locale: this line is a ledger, and it must read the
 * same on every Device in the household. */
function grouped(count: number): string {
  return count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Floored, so the CTA never reads 100% while a page is still owed. */
function percentOf(progress: BootstrapProgress): number {
  if (progress.total <= 0) return 0
  return Math.min(100, Math.floor((progress.folded / progress.total) * 100))
}

const FOLDING_COPY =
  "This device folds the household's history once. After this it starts " +
  'instantly and works offline.'

export function FirstSync(props: FirstSyncProps) {
  const store = useDepotStore()
  // The join screen renders before its Device has a depot. No store is no
  // fold in progress, which is exactly what the ungated frame shows.
  if (store === null) return <FirstSyncFrame progress={null} {...props} />
  return <BoundFirstSync store={store} {...props} />
}

function BoundFirstSync({
  store,
  ...props
}: FirstSyncProps & { store: StoreApi<DepotStoreState> }) {
  const progress = useStore(store, (depot) => depot.bootstrap)
  return (
    <FirstSyncFrame
      progress={progress}
      onRetry={() => store.getState().retrySync()}
      {...props}
    />
  )
}

function FirstSyncFrame({
  progress,
  onRetry,
  variant = 'card',
  onOpenDepot,
}: FirstSyncProps & {
  progress: BootstrapProgress | null
  onRetry?: () => void
}) {
  if (progress === null) {
    if (onOpenDepot === undefined) return null
    return (
      <>
        {/* Pins the CTA to the thumb zone (§9), same as the folding case
            below — Join.tsx no longer carries a spacer of its own for this. */}
        <div className={styles['spacer']} />
        <button
          type="button"
          className={styles['primary']}
          onClick={onOpenDepot}
        >
          Open the depot
        </button>
      </>
    )
  }

  const percent = percentOf(progress)
  const folded = grouped(progress.folded)
  // `total: 0` is "not known yet" — `household_seq` arrives with the first
  // page — and a dash is the honest denominator until it does.
  const total = progress.total > 0 ? grouped(progress.total) : '—'

  const card = (
    <section className={styles['card']} aria-label="First sync">
      <p className={styles['label']}>
        {progress.paused ? (
          <>
            {/* The offline dot, and the only amber in this frame (§9). The
                label beside it already carries the fact, so the dot is
                decoration to a screen reader. */}
            <span className={styles['dot']} aria-hidden="true" />
            FIRST SYNC — PAUSED
          </>
        ) : (
          'FIRST SYNC — ONE-TIME'
        )}
      </p>

      <p className={styles['percent']}>{percent}%</p>

      <div
        className={styles['bar']}
        role="progressbar"
        aria-label="Ops folded"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        // The denominator is unknown for exactly one round trip (§6.4), and
        // `percent` reads `0` for that instant same as it would for genuine
        // zero progress — so a screen reader gets told rather than guessing.
        {...(progress.total <= 0 ? { 'aria-valuetext': 'Counting' } : {})}
      >
        <div className={styles['fill']} style={{ inlineSize: `${percent}%` }} />
      </div>

      <p className={styles['ops']}>
        {progress.paused
          ? `OP ${folded} OF ${total} · CURSOR KEPT`
          : `OP ${folded} OF ${total} FOLDED`}
      </p>

      {progress.paused ? (
        <>
          <button type="button" className={styles['retry']} onClick={onRetry}>
            RETRY NOW
          </button>
          <p className={styles['copy']}>
            {`Connection dropped. It continues from op ${folded} when the line returns — nothing restarts.`}
          </p>
        </>
      ) : (
        <p className={styles['copy']}>{FOLDING_COPY}</p>
      )}
    </section>
  )

  if (variant === 'screen') {
    return <div className={styles['screen']}>{card}</div>
  }

  return (
    <>
      {card}
      {onOpenDepot === undefined ? null : (
        <>
          {/* §9 puts the card in the body; only the CTA belongs in the thumb
              zone, so the spacer sits here — between the two — rather than
              above the card, which would flush both down together. */}
          <div className={styles['spacer']} />
          <button
            type="button"
            className={styles['primary']}
            onClick={onOpenDepot}
            disabled
          >
            {progress.paused
              ? `Open the depot — paused at ${percent}%`
              : `Open the depot — folding ${percent}%`}
          </button>
        </>
      )}
    </>
  )
}
