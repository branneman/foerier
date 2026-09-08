import { Children, type ReactNode } from 'react'

import styles from './TripPanels.module.css'

/**
 * **The Trip screen's panel row** — design `README.md` §5l, rulings I1, I2 and
 * I7. It holds `TASKS` (S13) and `NOTES` (S12), in that order, between the
 * over-claim band and the `GEAR LIST` band at every width: bounded panels
 * above the one unbounded region, which is I1's whole argument (a panel below
 * fifty-eight gear rows is the dead end `EDIT LIST ›` was added to close).
 *
 * **It exists because two slices are built in parallel and neither may invent
 * it.** Architecture §8.6 grants S12 and S13 the float on one condition — *the
 * shell is settled first* — and I7's `1fr 1fr` is that condition's code
 * consequence: side by side means a real parent element. So this lands on
 * `main` before either branch, holding no panel of its own, and each slice
 * adds exactly one child.
 *
 * **Rendering `null` with no children is ruling I2 held structurally.** "A
 * missing panel draws nothing — no band, no gap" is a property of the shell,
 * not an agreement between two branches to behave: between this commit and
 * S12's next, the Trip screen draws exactly what it drew before, and that is
 * also the proof I2 holds. `Children.toArray` drops `null`, `undefined` and
 * booleans, so the ordinary `{condition && <Panel/>}` at the call site
 * collapses the row rather than leaving a bordered empty card behind.
 *
 * It counts *elements*, not what they render: a child that returns `null`
 * itself still holds its column. No panel does — I6 keeps both bands drawn in
 * every state, empty included, because they carry a label and a composer or a
 * link — but a future one that could must return nothing from *here*, by not
 * being passed, rather than from inside itself.
 *
 * Layout is the row's own container query rather than the caller's: `Trip`'s
 * `.screen` declares no container, and a component that queries a container
 * its parent may or may not provide is `GearRow`'s standing trap
 * (`Find.module.css` carries the note). The wrapper is the container and the
 * row is what responds — an element is never its own container.
 */
export function TripPanels({ children }: { children?: ReactNode }) {
  if (Children.toArray(children).length === 0) return null

  return (
    <div className={styles['panels']}>
      <div className={styles['row']}>{children}</div>
    </div>
  )
}
