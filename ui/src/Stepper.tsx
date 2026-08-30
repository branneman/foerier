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
 * number — a field mid-clear — stays on screen: a well with no buffer at all
 * would have React's controlled-input machinery snap the digits straight
 * back to `value` the instant a keystroke fails to parse, because nothing
 * called its setter. The buffer never outlives `value`'s own say — it
 * resyncs to `value` whenever `value` changes from outside, exactly the way
 * a picker's own draft resyncs to its record on open.
 *
 * **The well is `type="text"` with a digit strip, not `type="number"`** —
 * `AddGear.tsx`'s own reference well, folded in here rather than reinvented.
 * A number input reports an empty string for anything *it* considers
 * invalid, which makes "opens empty" and "holds nonsense" indistinguishable,
 * and admits `2.5`, `1e3` and a bare `-` besides. Stripping to `[0-9]` and
 * parsing ourselves is what makes the well reliably editable *and* reliably
 * clampable.
 *
 * **A cleared well reports `onChange(NaN)`.** `number` already includes
 * `NaN` — nothing new is added to the signature — and it is the one value
 * that means "nothing chosen" rather than "chosen, and it's `min`": a caller
 * that clamped a blank well to `min` instead would write a value nobody
 * typed, the exact defect invariant 11's `min = 0` exists to avoid one
 * register over. A caller that has no "opens empty" state of its own simply
 * guards with `Number.isFinite` before it emits.
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
  const [text, setText] = useState(() =>
    Number.isNaN(value) ? '' : String(value),
  )

  useEffect(() => {
    setText(Number.isNaN(value) ? '' : String(value))
  }, [value])

  function handleWellChange(event: ChangeEvent<HTMLInputElement>) {
    const digits = event.target.value.replace(/[^0-9]/g, '')
    setText(digits)

    if (digits === '') {
      // Nothing typed yet — not `min`, which would be a value nobody chose.
      onChange(Number.NaN)
      return
    }

    const parsed = Number.parseInt(digits, 10)
    if (!Number.isSafeInteger(parsed)) return
    const next = Math.max(min, parsed)
    // A clamp that lands back on `value` itself would otherwise leave the
    // well showing the rejected digits for the life of the mount — nothing
    // re-renders it, because `value` never changed for the effect above to
    // resync from. Correct the buffer at the commit site instead.
    if (next !== parsed) setText(String(next))
    onChange(next)
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
        type="text"
        inputMode="numeric"
        className={styles['well']}
        aria-label={label}
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
