import { useState } from 'react'

import type { TaskView } from '@foerier/shared'

import styles from './TasksPanel.module.css'

/**
 * **The `TASKS` panel** (S13, story 15) — design `README.md` §5l, rulings I21
 * through I27, in `TripPanels`' first slot (I1: `TASKS` before `NOTES`,
 * because a pre-trip list is read at Draft and Pack-out while the gear list
 * is being built beneath it).
 *
 * **Props-in** (`patterns.md` §5.2). `Trip` already holds the fold, so this
 * component's store read would not be load-bearing and it does not take one.
 * It renders `tasksOf`'s order verbatim and never sorts: the order is a
 * convergence property decided in `shared/src/selectors/task.ts`, and a
 * second opinion about it here is exactly how two Devices start drawing
 * different checklists.
 *
 * **The band is spelled here, and that is the third copy of one anatomy** —
 * `Trip.module.css`'s `gearListBand` and `NotesPanel`'s are the others. The
 * board's §08 lists a shared band component among what the shell commit
 * lands and the shell that landed is `TripPanels` alone; extracting it now
 * would mean landing onto `main` mid-flight and asking the S12 worktree to
 * adopt it, which is the coordination architecture §8.6's float exists to
 * avoid. `technical-debt.md` carries it, and the lift takes all three.
 */
export interface TasksPanelProps {
  /** `tasksOf`'s order, rendered verbatim. */
  readonly tasks: readonly TaskView[]
  /** `taskCounts` — the band's `3/7 TICKED`. */
  readonly counts: { readonly total: number; readonly ticked: number }
  /** The trimmed, non-empty line. The panel never emits a blank one. */
  readonly onAdd: (text: string) => void
  /**
   * Always the flipped value. The row's only gesture flips, so an op equal
   * to the current one is unreachable and `patterns.md` §2.3 needs no guard
   * here — see `tripTaskTicked`.
   */
  readonly onToggle: (taskId: string, ticked: boolean) => void
}

export function TasksPanel({
  tasks,
  counts,
  onAdd,
  onToggle,
}: TasksPanelProps) {
  return (
    <section className={styles['panel']} aria-labelledby="tasks-band">
      <div className={styles['band']}>
        <span className={styles['label']} id="tasks-band">
          TASKS
        </span>
        {/* I3: absent at N = 0 — which is what makes the empty panel I27's
            band and composer and nothing else. `0/7` is legal and drawn,
            because a fraction is not a zero segment (ruling G3 does not
            reach it); `0 of nothing` is not a fraction at all. */}
        {counts.total > 0 && (
          <span className={styles['count']}>
            {counts.ticked}/{counts.total} TICKED
          </span>
        )}
      </div>

      {tasks.length > 0 && (
        <ul className={styles['list']}>
          {tasks.map((task) => (
            <li key={task.id}>
              <TaskRow task={task} onToggle={onToggle} />
            </li>
          ))}
        </ul>
      )}

      <Composer onAdd={onAdd} />
    </section>
  )
}

/**
 * Ruling I22: **the whole row ticks and the square is the readout**, never a
 * second target. One `<button>`, and the square is a `<span>` inside it.
 *
 * **Not `role="checkbox"`**, deliberately. The board gives the accessible
 * name as `Charge the devices, ticked`, so the state is in the name; a
 * checkbox would carry `aria-checked` as well and announce it twice. One
 * channel is the point, and the board chose which.
 *
 * The glyph is a square (I23) — shape and fill only, no status colour, so the
 * parchment theme has nothing to collapse. `○ ◐ ●` is packing progress and
 * `▲` is attention; reusing either is S5's trap, where an encoding inherited
 * as meaningless becomes load-bearing the moment a slice gives it meaning.
 */
function TaskRow({
  task,
  onToggle,
}: {
  task: TaskView
  onToggle: TasksPanelProps['onToggle']
}) {
  return (
    <button
      type="button"
      className={styles['row']}
      data-ticked={task.ticked ? 'yes' : 'no'}
      aria-label={`${task.text}, ${task.ticked ? 'ticked' : 'not ticked'}`}
      onClick={() => onToggle(task.id, !task.ticked)}
    >
      <span className={styles['text']}>{task.text}</span>
      <span className={styles['square']} aria-hidden="true">
        {task.ticked ? '✓' : ''}
      </span>
    </button>
  )
}

/**
 * Ruling I21: **the composer is the checklist's end-of-list row** — the
 * trip-only Entry's dashed row, one panel down, reused whole. Verb, then the
 * permanent fact; tap turns it into a 48px well with **no placeholder**,
 * because the hint carries what a placeholder would and stays visible while
 * typing.
 *
 * **Return commits and keeps focus** — Add gear's type → return → type batch
 * loop. **Blur with text commits** (the Stepper's rule, §5b K). **Empty
 * commits nothing**, on both paths, and whitespace is empty: the trimmed
 * string is what reaches the payload, so no op ever carries a blank line.
 *
 * **Escape discards the draft and returns to the dashed row.** No board
 * reaches it; §5b K rules Escape as *restore the committed value* for a typed
 * Bring-count, and a composer has no committed value to restore, so
 * discarding is that rule read onto a field whose committed state is *not
 * open*. Code-authored, and recorded in `design/README.md` rather than only
 * in the slice's spec — S9 round 4's lesson.
 *
 * **No optimistic set**, unlike `DepotPicker`'s `IN LIST ✓`. `emit` is
 * durable-first, so the folded row arrives a queue-turn after the commit
 * (`patterns.md` §2.2) — but the list is *above* the well, focus never
 * leaves, and the next keystroke goes into an empty field either way. A
 * union of local ids would buy a frame nobody is looking at and add a second
 * source for a fact the fold already holds.
 */
function Composer({ onAdd }: { onAdd: TasksPanelProps['onAdd'] }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  /** The one gate: whitespace is empty, and the trim is what commits. */
  function commit(): boolean {
    const text = draft.trim()
    if (text === '') return false
    onAdd(text)
    setDraft('')
    return true
  }

  if (!open) {
    return (
      <button
        type="button"
        className={styles['composer']}
        onClick={() => setOpen(true)}
      >
        + TASK — NOT GEAR. GEAR GOES ON THE GEAR LIST.
      </button>
    )
  }

  return (
    <div className={styles['composing']}>
      <input
        type="text"
        className={styles['well']}
        aria-label="Add a pre-trip task"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            // Stays open and focused whether or not anything committed: an
            // empty Return is a no-op, not a way out of the loop.
            commit()
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setDraft('')
            setOpen(false)
          }
        }}
        onBlur={() => {
          commit()
          setOpen(false)
        }}
      />
      <p className={styles['hint']}>
        RETURN ADDS AND KEEPS TYPING · EMPTY ADDS NOTHING
      </p>
    </div>
  )
}
