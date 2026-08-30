import { useEffect, useState, type ChangeEvent } from 'react'

import styles from './Stepper.module.css'

/**
 * The stepper — one control, two sizes (`docs/design/README.md` §5, ruled
 * against `Components` §01 and §06 disagreeing on size): **h48**, the
 * standalone control Add gear's Owned-count draws, and **h32 dense**, the
 * gear list's in-row Bring-count control (S7).
 *
 * **`value` is the one source of truth; nothing here is business state.**
 * `Stepper` never decides what the count *is* — it only ever asks the
 * caller, through `onChange`, to make it something else. The well keeps a
 * local text buffer purely so a keystroke that has not yet resolved to a
 * number — a field mid-clear, a bare `-` — stays on screen: a well with no
 * buffer at all would have React's controlled-input machinery snap the
 * digits straight back to `value` the instant a keystroke fails to parse,
 * because nothing called its setter. The buffer never outlives `value`'s own
 * say — it resyncs to `String(value)` whenever `value` changes from outside,
 * exactly the way a picker's own draft resyncs to its record on open.
 *
 * `min` defaults to **`0`**, not `1`. A Bring-count of zero is expressible on
 * the wire (`{entry_id, count: int ≥ 0}`) and is not the same as removing the
 * Entry — invariant 11's whole point. A zero-count Entry claims nothing,
 * lists nothing, and the row stays; `Stepper` must be able to sit at zero
 * without refusing to.
 *
 * `ui/` never imports the store or a router (`frontend-design.md` §5):
 * props in, callbacks out.
 */
export interface StepperProps {
  value: number
  /** Floors both the decrement button and the well. Defaults to `0`. */
  min?: number
  onChange: (next: number) => void
  /** `default` is h48; `dense` is h32, for a row. */
  size?: 'default' | 'dense'
  /**
   * What the count is of — never shown, only spoken. Names both buttons
   * (`Decrease {label}` / `Increase {label}`) and the well itself, so two
   * Steppers on one screen announce distinctly.
   */
  label: string
}

export function Stepper({
  value,
  min = 0,
  onChange,
  size = 'default',
  label,
}: StepperProps) {
  const atMin = value <= min
  const [text, setText] = useState(() => String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  function handleWellChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value
    setText(raw)
    const parsed = Number.parseInt(raw, 10)
    // A blank or non-numeric well parses to `NaN` — nothing to commit yet,
    // and `raw` above is already what keeps it on screen meanwhile.
    if (!Number.isSafeInteger(parsed)) return
    onChange(Math.max(min, parsed))
  }

  return (
    <span className={`${styles['stepper']} ${styles[size]}`}>
      <button
        type="button"
        className={styles['button']}
        aria-label={`Decrease ${label}`}
        disabled={atMin}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        className={styles['well']}
        aria-label={label}
        min={min}
        value={text}
        onChange={handleWellChange}
      />
      <button
        type="button"
        className={styles['button']}
        aria-label={`Increase ${label}`}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </span>
  )
}
