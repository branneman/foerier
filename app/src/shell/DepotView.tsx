import { useRoute } from 'wouter'

import { Depot } from '../screens/Depot'
import { GearDetail } from '../screens/GearDetail'
import styles from './DepotView.module.css'
import { DESKTOP, SPLIT, useMediaQuery } from './useMediaQuery'

/**
 * **The two-pane unlock** — list + detail side by side, 832–1024
 * (`docs/design/README.md` §3a; [frontend-design §3.1](../../../docs/frontend-design.md)).
 *
 * ## Why this arrives at S3
 *
 * It was chartered to S0: [architecture §8.3](../../../docs/architecture-design.md)
 * asks that slice for "the app shell only — the five layout modes and nav
 * treatments of frontend-design §3.1", and §12.1 lists S0's deviations
 * without mentioning it, so the ladder was believed delivered. Half of it
 * was — `ui/styles/layout.css` has the em breakpoints, the gutter steps and
 * the nav's three treatments. What was never built is the **pane structure**
 * §3.1 also promises. S3 absorbs it because the board draws S3's own settled
 * tag chips inside the pane that was missing; shipping the slice bar into a
 * structure that does not exist would leave it half-drawn.
 *
 * ## Where the panes are, and where they are not
 *
 * | Mode | Shape |
 * | --- | --- |
 * | below Split | one column; gear detail is its own view |
 * | Split (52–64em) | icon rail · 308px list pane · detail pane |
 * | Desktop (≥64em) | labeled sidebar · the 8-column table |
 *
 * Desktop deliberately does **not** keep the detail pane: the board's 1024
 * frame spends that width on the table's eight columns instead, and a row
 * there opens gear detail as its own view. So the two-pane shape belongs to
 * Split alone, which is exactly where §3.1 says the unlock lives.
 *
 * A **media** query and not a container query, per §3.1: this decides which
 * panes exist. `GearRow`'s own fold stays a container query, per §3.2, which
 * is why the 308px list pane renders folded two-line rows at a viewport of
 * 900.
 */
export function DepotView() {
  const [onGear, params] = useRoute('/gear/:id')
  const isSplit = useMediaQuery(SPLIT)
  const isDesktop = useMediaQuery(DESKTOP)
  const twoPane = isSplit && !isDesktop

  if (!twoPane) {
    return onGear ? <GearDetail /> : <Depot />
  }

  return (
    <div className={styles['split']}>
      <div className={styles['list']}>
        <Depot {...(onGear ? { selectedId: params.id } : {})} />
      </div>
      <div className={styles['detail']}>
        {onGear ? (
          <GearDetail />
        ) : (
          // Not an error and not a prompt: the list is the screen, and the
          // pane is simply waiting. One quiet mono line, in the ledger voice.
          <p className={styles['idle']}>SELECT A ROW.</p>
        )}
      </div>
    </div>
  )
}
