import {
  useEffect,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'

import styles from './Stepper.module.css'

/**
 * The stepper — one control, two sizes (`docs/design/README.md` §5, ruled
 * against `Components` §01 and §06 disagreeing on size): **h48**, the
 * standalone control gear detail's and Add gear's Owned-count draw, and
 * **h32 dense**, the gear list's in-row Bring-count control (S7). Three
 * callers, since Add gear's own well folded in.
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
 * **`value` and `onChange` are `number | null`, and `null` means the well is
 * blank** — "nothing chosen" rather than "chosen, and it's `min`". A caller
 * that clamped a blank well to `min` instead would write a value nobody
 * typed, the exact defect invariant 11's `min = 0` exists to avoid one
 * register over. `null` and `0` are never interchangeable: `0` is a real
 * Bring-count that claims nothing but keeps the row (invariant 11); `null` is
 * no count at all. A caller with no "opens empty" state of its own simply
 * guards with `!== null` before it emits.
 *
 * **This channel is what made Add gear a third caller.** A blank well became
 * expressible before the gear list existed: `3c0788b` (this component's own
 * review round) reported it as `onChange(NaN)`, driven by the `type="text"`
 * well and by giving gear detail's Save guard something to check, and
 * `d12e89a` converted that to `onChange(null)` — NaN typechecked but made
 * "blank" a fact every caller had to know to guard against. Add gear's
 * hand-rolled well predates both and went unrevisited for four slices after
 * the channel existed, which is how one control came to answer to two
 * accessible names: `Fewer` / `More` there, `Decrease {label}` /
 * `Increase {label}` here. It kept three things of its own on folding in —
 * the visible label, the `OPENS EMPTY — GATES THE CTA` fact line, and a CTA
 * gate that reads `null`.
 *
 * **What the fold cost that screen, and why it is safe.** Its well used to
 * commit per keystroke, so typing a digit enabled the CTA immediately; here
 * the commit is the blur (ruling K), and the CTA is `disabled` until the
 * count is chosen. A Quartermaster who types `8` and goes straight for
 * `Add gear` is therefore relying on a tap over a **disabled** button still
 * blurring the well. Measured before the fold rather than assumed: it does,
 * in both Chromium and WebKit. `KEYBOARD-PASS.md` carries the measurement,
 * because no tier in this repo can hold it.
 *
 * `min` defaults to **`0`**, not `1`. A Bring-count of zero is expressible on
 * the wire (`{entry_id, count: int ≥ 0}`) and is not the same as removing the
 * Entry — invariant 11's whole point. A zero-count Entry claims nothing,
 * lists nothing, and the row stays; `Stepper` must be able to sit at zero
 * without refusing to.
 *
 * **`max` is optional and undefined by default — most callers have no
 * ceiling — but the clamp lives here, not at a caller, once one exists**
 * (S10 task 12 review, ruling R21, this component's own second caller with a
 * real ceiling). A caller-side clamp — decide whether to call `onChange` by
 * comparing an already-clamped value to what it holds — leaves `commit()`'s
 * own `setText(String(next))` uncapped: typing past the ceiling sets the
 * buffer to the literal digits typed, and if the clamped-and-compared value
 * the caller *would* emit happens to equal the value it already holds, the
 * caller's own needless-write guard skips the `onChange` that would
 * otherwise change `value` and re-fire the `[value]` effect above — so nothing
 * ever corrects the buffer, and the well is left showing a number nobody
 * chose for the rest of the mount. Passing `max` in means `commit()` and both
 * buttons clamp to `[min, max]` and canonicalise the buffer themselves,
 * before `onChange` is ever called, exactly as they already do for `min`.
 *
 * `ui/` never imports the store or a router (`frontend-design.md` §5):
 * props in, callbacks out.
 */
export interface StepperProps {
  /** `null` means the well is blank — see above. */
  value: number | null
  /** Floors both the decrement button and the well. Defaults to `0`. */
  min?: number
  /** Ceilings both the increment button and the well. Undefined by default —
   * most callers have no ceiling; a caller with one must pass it here rather
   * than clamping `onChange`'s own result (see this file's docstring, ruling
   * R21). */
  max?: number
  onChange: (next: number | null) => void
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
  max,
  onChange,
  size = 'default',
  label,
}: StepperProps) {
  const atMin = value !== null && value <= min
  const atMax = value !== null && max !== undefined && value >= max
  const [text, setText] = useState(() => (value === null ? '' : String(value)))

  useEffect(() => {
    setText(value === null ? '' : String(value))
  }, [value])

  /**
   * Typing edits the **buffer only** — amendment ruling K. Committing per
   * keystroke made every intermediate spelling an op: editing `2` to `10`
   * authored `1` and then `10`, so a count nobody ever chose entered the log
   * permanently, replicated to every Device, and — for a Bring-count — moved
   * `recordedAt` twice. The keystroke is not the statement; the finished
   * number is.
   */
  function handleWellChange(event: ChangeEvent<HTMLInputElement>) {
    setText(event.target.value.replace(/[^0-9]/g, ''))
  }

  /**
   * The finished number, on blur or Enter. Ruling K again: `2 → 10` is one
   * op, and the phantom `1` never reaches the log.
   *
   * The buffer is rewritten to the canonical spelling of what was committed,
   * unconditionally, because the `[value]` effect above cannot be relied on to
   * do it: `05` parses to the same 5 a plain `5` would, so a caller already
   * sitting at 5 sees no change, does not re-render, and the effect never
   * fires to correct `05` in the well. A clamp is one way a commit can land on
   * the value already held; it is not the only one.
   */
  function commit() {
    const digits = text.replace(/[^0-9]/g, '')

    if (digits === '') {
      // Nothing typed — not `min`, which would be a value nobody chose.
      setText('')
      onChange(null)
      return
    }

    const parsed = Number.parseInt(digits, 10)
    if (!Number.isSafeInteger(parsed)) {
      // Unrepresentable: keep what is committed rather than author a number
      // the reader did not get to see.
      setText(value === null ? '' : String(value))
      return
    }

    const next =
      max === undefined
        ? Math.max(min, parsed)
        : Math.min(Math.max(min, parsed), max)
    setText(String(next))
    onChange(next)
  }

  function handleWellKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      // A Stepper is not in a form here, but Enter must not submit one if a
      // caller ever puts it in a form either.
      event.preventDefault()
      commit()
      return
    }
    if (event.key === 'Escape') {
      // Restores the committed value — the edit is abandoned, not authored.
      setText(value === null ? '' : String(value))
    }
  }

  return (
    <span className={`${styles['stepper']} ${styles[size]}`}>
      <button
        type="button"
        className={styles['button']}
        aria-label={`Decrease ${label}`}
        disabled={atMin}
        onClick={() => onChange(Math.max(min, (value ?? min) - 1))}
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
        onBlur={commit}
        onKeyDown={handleWellKeyDown}
      />
      <button
        type="button"
        className={styles['button']}
        aria-label={`Increase ${label}`}
        disabled={atMax}
        onClick={() => {
          const next = (value ?? min) + 1
          onChange(max === undefined ? next : Math.min(next, max))
        }}
      >
        +
      </button>
    </span>
  )
}
