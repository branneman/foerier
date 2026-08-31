import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Stepper } from './Stepper'

/**
 * One control, two sizes (`docs/specs/2026-08-29-the-gear-list.md` §4.8):
 * h48 default (Add gear's Owned-count) and h32 dense (the gear list's
 * in-row Bring-count). `value` is the one source of truth — every assertion
 * here drives `Stepper` purely through `value`/`onChange`.
 */

function css(): string {
  return readFileSync(
    join(dirname(expect.getState().testPath ?? ''), 'Stepper.module.css'),
    'utf8',
  )
}

function tokens(): string {
  return readFileSync(
    join(
      dirname(expect.getState().testPath ?? ''),
      '..',
      'styles',
      'tokens.css',
    ),
    'utf8',
  )
}

function remToPx(rem: string): number {
  return Number.parseFloat(rem) * 16
}

describe('Stepper', () => {
  it('renders the value between a decrement and an increment', () => {
    const { container } = render(
      <Stepper value={3} onChange={() => {}} label="Owned count" />,
    )

    const well = screen.getByRole('textbox', { name: 'Owned count' })
    expect(well).toHaveValue('3')

    // Order, not just presence: the well sits between the two buttons.
    const controls = Array.from(
      container.querySelectorAll('button, input'),
    ).map((element) => element.getAttribute('aria-label'))
    expect(controls).toEqual([
      'Decrease Owned count',
      'Owned count',
      'Increase Owned count',
    ])
  })

  it('calls onChange with value + 1 on increment', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Stepper value={3} onChange={onChange} label="Owned count" />)

    await user.click(
      screen.getByRole('button', { name: 'Increase Owned count' }),
    )

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('calls onChange with value - 1 on decrement', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Stepper value={3} onChange={onChange} label="Owned count" />)

    await user.click(
      screen.getByRole('button', { name: 'Decrease Owned count' }),
    )

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('does not go below min, and min defaults to 0', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    // No `min` prop given at all: the only thing standing between this and
    // a negative Bring-count is the *default*, not an explicit floor a
    // caller remembered to pass — invariant 11's `min = 0` lives here.
    render(<Stepper value={0} onChange={onChange} label="Bring count" />)

    expect(
      screen.getByRole('button', { name: 'Decrease Bring count' }),
    ).toBeDisabled()

    // The well agrees: typing a value under the (unstated, default) floor
    // still clamps to 0, not to whatever a missing `min` would coerce to.
    const well = screen.getByRole('textbox', { name: 'Bring count' })
    await user.clear(well)
    await user.type(well, '0')
    await user.click(
      screen.getByRole('button', { name: 'Increase Bring count' }),
    )
    expect(onChange).toHaveBeenLastCalledWith(1)
  })

  it('clamps a typed value below a non-zero min to that min', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Stepper value={5} min={2} onChange={onChange} label="Owned count" />,
    )

    // The well clamps too, not just the button: typing a value under the
    // floor commits the floor rather than the literal digits typed. The
    // clamp happens at the commit (ruling K), so the blur is what asks for
    // it — while typing, the buffer holds exactly what was typed.
    const well = screen.getByRole('textbox', { name: 'Owned count' })
    await user.clear(well)
    await user.type(well, '1')
    await user.tab()

    expect(onChange).not.toHaveBeenCalledWith(1)
    expect(onChange).toHaveBeenLastCalledWith(2)
  })

  it('corrects the well to the clamped value even when the value the caller holds does not move', async () => {
    // The regression: `value` is already sitting at `min` (2), so typing
    // something below it clamps right back onto the value the caller
    // already held — `value` never changes, an effect keyed on `[value]`
    // never fires, and nothing else re-renders `Stepper`. The buffer has to
    // be corrected at the commit site, or the well is left showing the
    // rejected digits for the life of the mount.
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Stepper value={2} min={2} onChange={onChange} label="Owned count" />,
    )

    const well = screen.getByRole('textbox', { name: 'Owned count' })
    await user.clear(well)
    await user.type(well, '1')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith(2)
    expect(well).toHaveValue('2')
  })

  it('reports a cleared well as null rather than falling back to min', async () => {
    // `null` is "nothing chosen" — clamping a blank well to `min` instead
    // would commit a value nobody typed, the exact class of defect
    // invariant 11's `min = 0` exists to keep out of a different register.
    // `null` and `0` must never be confusable: `0` is a real Bring-count
    // that claims nothing but keeps the row (invariant 11); `null` is no
    // count at all.
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Stepper value={3} onChange={onChange} label="Owned count" />)

    await user.clear(screen.getByRole('textbox', { name: 'Owned count' }))
    await user.tab()

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(null)
    expect(onChange).not.toHaveBeenCalledWith(0)
  })

  it('strips non-digits rather than accepting a decimal, exponent or sign', () => {
    // `fireEvent`, not `user.type`: typing "2.5" keystroke by keystroke into
    // a controlled input that rewrites its own value on every change is a
    // testing-library cursor-tracking hazard unrelated to what this test is
    // pinning — the strip itself, applied once to a whole pasted-in string.
    const onChange = vi.fn()
    render(<Stepper value={2} onChange={onChange} label="Owned count" />)

    const well = screen.getByRole('textbox', { name: 'Owned count' })
    fireEvent.change(well, { target: { value: '2.5' } })

    // The strip is immediate — it is what the well will accept at all, not
    // what it will commit — so the buffer shows "25" before any commit.
    expect(well).toHaveValue('25')
    expect(onChange).not.toHaveBeenCalled()

    // "2.5" strips to "25" — never a fractional commit, and never the
    // silently-sanitised-to-empty behaviour a `type="number"` well gives
    // the same input (`AddGear.tsx`'s own reason for avoiding it).
    fireEvent.blur(well)
    expect(onChange).toHaveBeenLastCalledWith(25)
    expect(well).toHaveValue('25')

    fireEvent.change(well, { target: { value: '-1' } })
    fireEvent.blur(well)
    // A bare sign strips too — with `min` defaulting to `0`, there is no
    // typed spelling of a negative count at all, not even a clamp to reach.
    expect(onChange).toHaveBeenLastCalledWith(1)
    expect(well).toHaveValue('1')
  })

  it('disables decrement at min', () => {
    render(
      <Stepper value={0} min={0} onChange={() => {}} label="Bring count" />,
    )

    expect(
      screen.getByRole('button', { name: 'Decrease Bring count' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Increase Bring count' }),
    ).toBeEnabled()
  })

  it('re-enables decrement once above a non-zero min', () => {
    const { rerender } = render(
      <Stepper value={2} min={2} onChange={() => {}} label="Owned count" />,
    )
    expect(
      screen.getByRole('button', { name: 'Decrease Owned count' }),
    ).toBeDisabled()

    rerender(
      <Stepper value={3} min={2} onChange={() => {}} label="Owned count" />,
    )
    expect(
      screen.getByRole('button', { name: 'Decrease Owned count' }),
    ).toBeEnabled()
  })

  it('labels both controls for assistive technology using the label prop', () => {
    render(<Stepper value={1} onChange={() => {}} label="Bring count" />)

    expect(
      screen.getByRole('button', { name: 'Decrease Bring count' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Increase Bring count' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Bring count' }),
    ).toBeInTheDocument()
  })

  it('renders the default size with the max(3rem, 48px) floor', () => {
    const { container } = render(
      <Stepper value={1} onChange={() => {}} label="Owned count" />,
    )
    expect(container.firstElementChild?.className).toMatch(/default/)

    const text = css()
    const button = /\.default \.button\s*\{([^}]*)\}/.exec(text)?.[1] ?? ''
    const well = /\.default \.well\s*\{([^}]*)\}/.exec(text)?.[1] ?? ''
    expect(button).toMatch(/min-width:\s*max\(3rem,\s*48px\)/)
    expect(button).toMatch(/min-height:\s*max\(3rem,\s*48px\)/)
    expect(well).toMatch(/min-height:\s*max\(3rem,\s*48px\)/)
  })

  it('renders the dense size with a hit area of at least 44px', () => {
    const { container } = render(
      <Stepper
        value={1}
        onChange={() => {}}
        size="dense"
        label="Bring count"
      />,
    )
    expect(container.firstElementChild?.className).toMatch(/dense/)

    // jsdom computes no layout, so the *result* is what gets pinned, worked
    // out from the actual declared numbers rather than asserted as
    // literals — `--stroke-rule` widening would fail this the way it fails
    // nothing that just checks `width: 2rem` and `inset: -0.4375rem` stayed
    // put. `reset.css` makes every box `border-box`, so a bordered button's
    // painted *padding* box — what an absolutely positioned `::after` lays
    // out against — is narrower than its declared `width`.
    const text = css()
    const sharedButton = /\.button\s*\{([^}]*)\}/.exec(text)?.[1] ?? ''
    const denseButton = /\.dense \.button\s*\{([^}]*)\}/.exec(text)?.[1] ?? ''
    const denseAfter =
      /\.dense \.button::after\s*\{([^}]*)\}/.exec(text)?.[1] ?? ''

    const borderVar = /border:\s*var\((--[\w-]+)\)/.exec(sharedButton)?.[1]
    const widthRem = /width:\s*([0-9.]+)rem/.exec(denseButton)?.[1]
    const insetRem = /inset:\s*(-?[0-9.]+)rem/.exec(denseAfter)?.[1]
    expect(borderVar).toBeDefined()
    expect(widthRem).toBeDefined()
    expect(insetRem).toBeDefined()

    const borderPx = Number.parseFloat(
      new RegExp(`${borderVar}:\\s*([0-9.]+)px`).exec(tokens())?.[1] ?? '0',
    )
    const widthPx = remToPx(widthRem ?? '0')
    const insetPx = Math.abs(remToPx(insetRem ?? '0'))

    const paintedPaddingBoxSide = widthPx - 2 * borderPx
    const hitArea = paintedPaddingBoxSide + 2 * insetPx
    expect(hitArea).toBeGreaterThanOrEqual(44)
  })

  it('is driven by value alone — a caller that ignores onChange never moves via the buttons', async () => {
    // `Stepper` reflects `value` on every render; a caller that does not
    // update it (e.g. a Kind that no longer counts) leaves the well right
    // where the caller left it, not where the last tap requested. The
    // buttons never touch the text buffer at all, so this alone cannot
    // catch a buffer-desync regression — the next test does that.
    function Frozen() {
      const [count] = useState(5)
      return <Stepper value={count} onChange={() => {}} label="Owned count" />
    }
    const user = userEvent.setup()
    render(<Frozen />)

    await user.click(
      screen.getByRole('button', { name: 'Increase Owned count' }),
    )

    expect(screen.getByRole('textbox', { name: 'Owned count' })).toHaveValue(
      '5',
    )
  })

  /**
   * Amendment ruling K, and the defect it names. Committing per keystroke
   * made every intermediate spelling an op: editing `2` to `10` authored a
   * `1` first, so a count nobody ever chose entered the log permanently,
   * replicated to every Device, and — for a Bring-count — moved `recordedAt`
   * twice. The keystroke is not the statement; the finished number is.
   */
  it('commits a typed number once, with no phantom intermediate (K)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Stepper value={2} onChange={onChange} label="Bring count" />)

    const well = screen.getByRole('textbox', { name: 'Bring count' })
    await user.clear(well)
    await user.type(well, '10')

    // Nothing authored yet, and specifically not the `1` that `10` passes
    // through on its way to being typed.
    expect(onChange).not.toHaveBeenCalled()

    await user.tab()

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(10)
  })

  it('commits on Enter as well as on blur (K)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Stepper value={2} onChange={onChange} label="Bring count" />)

    const well = screen.getByRole('textbox', { name: 'Bring count' })
    await user.clear(well)
    await user.type(well, '10{Enter}')

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(10)
  })

  it('restores the committed value on Escape, authoring nothing (K)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Stepper value={7} onChange={onChange} label="Bring count" />)

    const well = screen.getByRole('textbox', { name: 'Bring count' })
    await user.clear(well)
    await user.type(well, '3{Escape}')

    // The edit is abandoned, not authored — and the well says so rather than
    // leaving a number on screen that the log does not hold.
    expect(well).toHaveValue('7')
    expect(onChange).not.toHaveBeenCalled()
  })

  /**
   * The taps are a different act from the typing, and ruling K keeps them
   * per-tap: each press of `+` is a finished statement on its own, so there
   * is no buffer to flush and nothing to defer.
   */
  it('keeps stepper taps per-tap, not deferred to blur (K)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Stepper value={2} onChange={onChange} label="Bring count" />)

    await user.click(
      screen.getByRole('button', { name: 'Increase Bring count' }),
    )

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('canonicalises a non-canonical spelling that parses to the value already held', async () => {
    // The buffer-desync regression F2's fix left open: no `min`, `value`
    // held fixed at 5 by a parent that never applies `onChange` (the
    // `Frozen` shape above). Retyping "05" parses to 5 — the value already
    // held — so `setState(5)` is a React `Object.is` bailout: no
    // re-render, `value` never changes, the `[value]` effect never
    // re-fires. Only a commit-site rewrite to the canonical spelling of
    // `next`, unconditionally, closes this rather than just the clamp case.
    function Frozen() {
      const [count] = useState(5)
      return <Stepper value={count} onChange={() => {}} label="Owned count" />
    }
    const user = userEvent.setup()
    render(<Frozen />)

    const well = screen.getByRole('textbox', { name: 'Owned count' })
    await user.clear(well)
    await user.type(well, '05')

    // While typing, the buffer holds what was typed — ruling K moved the
    // commit to blur, and a well that rewrote itself mid-edit could not be
    // typed into at all (`2` → `10` needs the intermediate `1` to survive).
    expect(well).toHaveValue('05')

    await user.tab()
    expect(well).toHaveValue('5')
  })
})
