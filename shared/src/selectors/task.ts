import { compareStamps } from '../hlc.ts'
import { stampOf } from '../registers.ts'
import type { TaskState, TripState } from '../state.ts'

/**
 * **The Pre-trip checklist's read side** (S13, story 15) — three answers the
 * `TASKS` panel needs, stated once here rather than at the panel.
 *
 * It is the smallest selector file in `shared/src/selectors/`, and
 * deliberately so: story 15 is tagged *"deliberately the last MVP story; first
 * to move to Later"*, and ruling I2 is what keeps that cheap — a missing panel
 * draws nothing, so if the story moves, this file and one child of
 * `TripPanels` go with it and nothing else changes.
 */

/** One drawable Task: the panel renders exactly this and reads no register. */
export interface TaskView {
  readonly id: string
  readonly text: string
  readonly ticked: boolean
}

/**
 * **An absent `ticked` register reads `false`**, and this is the only place
 * that says so — `ownerOf`'s rule again (`patterns.md` §1.2). Absent and an
 * explicit `false` stay different facts about the log: absent means no op has
 * ever addressed this Task's state, `false` means somebody unticked it. Every
 * reader treats them alike.
 *
 * Deliberately **not** `noteKeptOf`'s three-state shape one map over. A Note
 * is *unreviewed* until the unpack pass reaches it, and the surfaces draw
 * three things; a Task has no third thing to be, and offering `undefined`
 * here would invite a caller to invent one.
 */
export function taskTickedOf(task: TaskState): boolean {
  return task.ticked?.value ?? false
}

/**
 * Every drawable Task, **oldest first**.
 *
 * ## What ruling I24's "insertion order" has to mean
 *
 * `tasks` is a `Record`, and its key insertion order is the order *this
 * replica happened to receive ops in*. Two Devices holding identical registers
 * would draw two different checklists, and the failure has no symptom on one
 * Device — `order.ts`'s own reason for existing, one entity type over.
 *
 * So the order is the **`text` register's own stamp**, ties broken by task id
 * so it is total. That is I24 made true in the only sense a replicated log can
 * mean it: the order the tasks were written in, as the log records it, and the
 * same everywhere.
 *
 * **A tick therefore cannot move a row**, with no clause of its own:
 * `trip.task_ticked` writes `ticked` and never touches `text`, so the stamp
 * this reads is the one the add wrote and nothing later disturbs it. I24's
 * second half — *ticked rows do not sink* — falls out of the ordering rather
 * than being enforced beside it.
 *
 * The comparator is local rather than in `order.ts`, where a second copy of a
 * total order does not belong. S12's `notesOf` needs the identical one and is
 * being built in a parallel worktree, so lifting it now would put both slices
 * in one file for the sake of a shared four lines — the collision architecture
 * §8.6 promised these two would not have. Logged in `technical-debt.md`: the
 * lift takes both copies, once both have landed.
 *
 * **A Task with no `text` is folded, retained, and drawn nowhere.** A
 * `trip.task_ticked` can arrive ahead of the add that names the Task, and a
 * checklist line nobody has words for is not a line anybody can draw — S7's
 * sourceless Entry and S12's textless Note, one map over. {@link taskCounts}
 * drops it from both counts for the same reason, so the list and the band can
 * never disagree about what exists.
 */
export function tasksOf(trip: TripState): readonly TaskView[] {
  const drawable: { task: TaskState; text: string }[] = []
  for (const task of Object.values(trip.tasks ?? {})) {
    const text = task.text
    if (text === undefined) continue
    drawable.push({ task, text: text.value })
  }
  drawable.sort((a, b) => {
    const order = compareStamps(stampOf(a.task.text!), stampOf(b.task.text!))
    if (order !== 0) return order
    if (a.task.id === b.task.id) return 0
    return a.task.id < b.task.id ? -1 : 1
  })
  return drawable.map(({ task, text }) => ({
    id: task.id,
    text,
    ticked: taskTickedOf(task),
  }))
}

/**
 * The band's readout, `3/7 TICKED` (ruling I26).
 *
 * `total` counts what {@link tasksOf} lists — a textless Task is in neither,
 * which is what stops the band claiming a row the panel does not draw. The
 * fraction is legal at `0/7` (a fraction is not a zero segment, so ruling G3
 * does not reach it) and the whole segment is **absent** at `total === 0`
 * (ruling I3), which is the panel's business rather than this function's: it
 * reports the numbers and says nothing about whether they are drawn.
 */
export function taskCounts(trip: TripState): {
  readonly total: number
  readonly ticked: number
} {
  const tasks = tasksOf(trip)
  let ticked = 0
  for (const task of tasks) if (task.ticked) ticked += 1
  return { total: tasks.length, ticked }
}
