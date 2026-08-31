import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { EntryRow, type EntryRowProps } from './EntryRow'

/** Every editable Kind gets the same remove-control assertion (promoted
 * review fix: the rule is "every editable row ends in ✕", and only Single
 * was exercised). */
const KINDS: readonly {
  label: string
  kind: EntryRowProps['kind']
  bringCount: number | null
  pieceCount: number
}[] = [
  { label: 'Tent, tunnel 4p', kind: 'counted', bringCount: 2, pieceCount: 2 },
  {
    label: 'Trekking pole',
    kind: 'per_person',
    bringCount: null,
    pieceCount: 3,
  },
  { label: 'Headlamp', kind: 'single', bringCount: null, pieceCount: 1 },
  { label: 'Passports', kind: 'trip_only', bringCount: null, pieceCount: 1 },
]

/** These files' own docstrings are dense with backticked CSS-shaped prose
 * (e.g. `.row`'s comment names `min-height: 48px` in running text) — stripped
 * before any parsing below, or a comment's prose could be mistaken for a
 * declaration. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function entryRowCss(): string {
  return stripComments(
    readFileSync(
      join(dirname(expect.getState().testPath ?? ''), 'EntryRow.module.css'),
      'utf8',
    ),
  )
}

/** All lengths in this file are `rem` or `px`; `1rem` is always `16px`
 * (`frontend-design.md` §2.1 — no `62.5%` trick). Returns the *largest* of
 * every length token found, so a `max(2rem, 32px)` declaration resolves the
 * same way a browser would. */
function maxPx(declaration: string | undefined): number | undefined {
  if (declaration === undefined) return undefined
  const tokens = declaration.match(/-?[0-9.]+(?:rem|px)/g) ?? []
  if (tokens.length === 0) return undefined
  return Math.max(
    ...tokens.map((token) =>
      token.endsWith('rem')
        ? Number.parseFloat(token) * 16
        : Number.parseFloat(token),
    ),
  )
}

/** Finds the `{ … }` body of the first rule whose selector is exactly
 * `selector` (no trailing `,` — a comma-joined selector list never matches
 * this way on purpose, since a partial match on one name in the list would
 * silently read the wrong rule). */
function ruleBody(css: string, selector: string): string | undefined {
  const escaped = selector.replace(/[.[\]']/g, '\\$&')
  return new RegExp(`(?:^|[\\s{}])${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
}

function declaration(body: string | undefined, property: string) {
  if (body === undefined) return undefined
  return new RegExp(`${property}:\\s*([^;]+);`).exec(body)?.[1]
}

describe('EntryRow', () => {
  describe("the .remove hit area (regression: overlap into the next row's ✕)", () => {
    // The defect this pins: `.remove` sets `height: 2rem` with no
    // `min-height` of its own, so `ui/styles/base.css`'s global
    // `button { min-height: max(3rem, 48px); }` — a lower cascade layer, but
    // `min-height` beats `height` regardless of layer order — still floors
    // the real box to 48px. `.remove::after` then grows a 46×62px hit area
    // (32 + 2×7 wide, 48 + 2×7 tall) inside a 48px-tall `.row`, and two
    // consecutive rows' hit areas overlap by 13px: a tap meant for one row's
    // ✕ lands on the next row's Entry instead, and ✕ is deliberately
    // unconfirmed (this file's own docstring, `EntryRow.tsx:64`). This test
    // derives the geometry from the declared CSS values themselves (jsdom
    // computes no layout, and `toHaveStyle` passes unconditionally here —
    // `vitest.config.ts` runs `css: false`), so reverting `.remove`'s
    // `min-height` fails it the same way it fails in a real browser.
    it('never overlaps the ✕ hit area into the next row', () => {
      const css = entryRowCss()

      const rowBody = ruleBody(css, '.row')
      const removeBody = ruleBody(css, '.remove')
      const afterBody = ruleBody(css, '.remove::after')
      expect(rowBody).toBeDefined()
      expect(removeBody).toBeDefined()
      expect(afterBody).toBeDefined()

      const rowHeight = maxPx(declaration(rowBody, 'min-height'))
      const declaredHeight = maxPx(declaration(removeBody, 'height'))
      const declaredMinHeight = maxPx(declaration(removeBody, 'min-height'))
      const insetToken = declaration(afterBody, 'inset')?.trim().split(/\s+/)[0]
      const insetPx =
        insetToken === undefined ? undefined : Math.abs(maxPx(insetToken) ?? 0)

      expect(rowHeight).toBeDefined()
      expect(declaredHeight).toBeDefined()
      expect(insetPx).toBeDefined()

      // Same used-value rule the browser applies: a `min-height` wins over a
      // smaller `height`. There is no longer a global floor standing behind
      // this — amendment ruling O retired it, so a control paints at the size
      // it declares and nothing else supplies one. That is precisely why
      // `.remove` must keep its own `min-height`: without it the paint would
      // now *shrink* rather than silently grow, and the geometry below would
      // be measuring a box the browser never draws.
      const paintedHeight = Math.max(
        declaredHeight ?? 0,
        declaredMinHeight ?? 0,
      )

      // `.remove` is centred (`align-items: center`) inside `.row`; the
      // margin above/below it is what the hit area is allowed to grow into
      // before it reaches a neighbouring row.
      const margin = ((rowHeight ?? 0) - paintedHeight) / 2

      expect(margin).toBeGreaterThanOrEqual(insetPx ?? Number.POSITIVE_INFINITY)
    })
  })

  describe('editable anatomy, by Kind', () => {
    it('draws a dense Stepper on a Counted Entry', () => {
      render(
        <EntryRow
          label="Tent, tunnel 4p"
          kind="counted"
          bringCount={2}
          pieceCount={2}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(
        screen.getByRole('button', { name: /increase bring-count/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('textbox', { name: /bring-count for tent/i }),
      ).toHaveValue('2')
    })

    it('draws ×N mono on a per-person Entry, no Stepper and no badge', () => {
      render(
        <EntryRow
          label="Trekking pole"
          kind="per_person"
          bringCount={null}
          pieceCount={3}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×3')
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(screen.queryByTestId('entry-row-badge')).toBeNull()
    })

    it('draws nothing in the trailing slot on a Single Entry', () => {
      render(
        <EntryRow
          label="Headlamp"
          kind="single"
          bringCount={null}
          pieceCount={1}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.queryByTestId('entry-row-count')).toBeNull()
      expect(screen.queryByTestId('entry-row-badge')).toBeNull()
      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('draws the amber TRIP-ONLY badge beside the label, not in the trailing slot', () => {
      render(
        <EntryRow
          label="Passports"
          kind="trip_only"
          bringCount={null}
          pieceCount={1}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-badge')).toHaveTextContent(
        'TRIP-ONLY',
      )
      // Board order (review round F1): name, badge, spacer, ✕ — no trailing
      // content of its own for a trip-only row in editable mode.
      expect(screen.queryByTestId('entry-row-count')).toBeNull()
    })
  })

  describe('editable rows end in a remove control, on every Kind', () => {
    it.each(KINDS)(
      'renders ✕ for $kind and calls onRemove without a confirm',
      async ({ label, kind, bringCount, pieceCount }) => {
        const user = userEvent.setup()
        const onRemove = vi.fn()
        render(
          <EntryRow
            label={label}
            kind={kind}
            bringCount={bringCount}
            pieceCount={pieceCount}
            editable
            onBringCountChange={vi.fn()}
            onRemove={onRemove}
          />,
        )
        await user.click(
          screen.getByRole('button', { name: `Remove ${label}` }),
        )
        expect(onRemove).toHaveBeenCalledTimes(1)
      },
    )
  })

  describe('read-only mode (editable={false})', () => {
    it.each(KINDS)(
      'renders no remove control for $kind',
      ({ label, kind, bringCount, pieceCount }) => {
        render(
          <EntryRow
            label={label}
            kind={kind}
            bringCount={bringCount}
            pieceCount={pieceCount}
            editable={false}
            onBringCountChange={vi.fn()}
            onRemove={vi.fn()}
          />,
        )
        expect(screen.queryByTestId('entry-row-remove')).toBeNull()
      },
    )

    it('reads ×N for a Counted Entry, with no Stepper', () => {
      render(
        <EntryRow
          label="Tent, tunnel 4p"
          kind="counted"
          bringCount={4}
          pieceCount={4}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×4')
      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('reads — for a per-person Entry, not ×N', () => {
      render(
        <EntryRow
          label="Trekking pole"
          kind="per_person"
          bringCount={null}
          pieceCount={3}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('—')
    })

    it('reads — in the trailing slot for a trip-only Entry, but still draws the badge', () => {
      render(
        <EntryRow
          label="Passports"
          kind="trip_only"
          bringCount={null}
          pieceCount={1}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      // Review round F1: the badge is a name adjunct, not trailing-column
      // content, so it survives into read-only mode even though the
      // trailing slot's own rule (`×N` for Counted, `—` otherwise) does not
      // change for trip-only.
      expect(screen.getByTestId('entry-row-badge')).toHaveTextContent(
        'TRIP-ONLY',
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('—')
    })

    it('reads — for a Single Entry', () => {
      render(
        <EntryRow
          label="Headlamp"
          kind="single"
          bringCount={null}
          pieceCount={1}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('—')
    })
  })

  describe('the needless-write guard (spec §4.9, decision 2)', () => {
    it('does not call onBringCountChange when the stepper reports the current value', async () => {
      const user = userEvent.setup()
      const onBringCountChange = vi.fn()
      render(
        <EntryRow
          label="Tent, tunnel 4p"
          kind="counted"
          bringCount={2}
          pieceCount={2}
          editable
          onBringCountChange={onBringCountChange}
          onRemove={vi.fn()}
        />,
      )
      const well = screen.getByRole('textbox', {
        name: /bring-count for tent/i,
      })
      // Clear and retype the same digits — Stepper's own docstring names
      // this exact case as one where onChange still fires.
      await user.clear(well)
      await user.type(well, '2')
      expect(onBringCountChange).not.toHaveBeenCalled()
    })

    it('does not call onBringCountChange when the well is cleared to blank', async () => {
      const user = userEvent.setup()
      const onBringCountChange = vi.fn()
      render(
        <EntryRow
          label="Tent, tunnel 4p"
          kind="counted"
          bringCount={2}
          pieceCount={2}
          editable
          onBringCountChange={onBringCountChange}
          onRemove={vi.fn()}
        />,
      )
      const well = screen.getByRole('textbox', {
        name: /bring-count for tent/i,
      })
      await user.clear(well)
      expect(onBringCountChange).not.toHaveBeenCalled()
    })

    it('calls onBringCountChange with the new value on a genuine change', async () => {
      const user = userEvent.setup()
      const onBringCountChange = vi.fn()
      render(
        <EntryRow
          label="Tent, tunnel 4p"
          kind="counted"
          bringCount={2}
          pieceCount={2}
          editable
          onBringCountChange={onBringCountChange}
          onRemove={vi.fn()}
        />,
      )
      await user.click(
        screen.getByRole('button', { name: /increase bring-count/i }),
      )
      expect(onBringCountChange).toHaveBeenCalledOnce()
      expect(onBringCountChange).toHaveBeenCalledWith(3)
    })

    it('forwards a decrement to 0 — review round F6: not the same as a blank well', async () => {
      const user = userEvent.setup()
      const onBringCountChange = vi.fn()
      render(
        <EntryRow
          label="Tent stake"
          kind="counted"
          bringCount={1}
          pieceCount={1}
          editable
          onBringCountChange={onBringCountChange}
          onRemove={vi.fn()}
        />,
      )
      await user.click(
        screen.getByRole('button', { name: /decrease bring-count/i }),
      )
      // The exact refactor this guards against: `if (!next) return` reads as
      // the same guard as `if (next === null) return` and silently is not —
      // `0` is falsy, `null` is not `0` (invariant 11).
      expect(onBringCountChange).toHaveBeenCalledOnce()
      expect(onBringCountChange).toHaveBeenCalledWith(0)
    })

    it('reads a 0 Bring-count in the well without treating it as blank', () => {
      render(
        <EntryRow
          label="Tent stake"
          kind="counted"
          bringCount={0}
          pieceCount={0}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(
        screen.getByRole('textbox', { name: /bring-count for tent stake/i }),
      ).toHaveValue('0')
      // The decrement button is disabled at `min` (Stepper's own floor), the
      // observable proof that `0` registered as a real value and not a
      // blank well.
      expect(
        screen.getByRole('button', { name: /decrease bring-count/i }),
      ).toBeDisabled()
    })

    it('reads ×0 in read-only mode for a 0-count Counted Entry', () => {
      render(
        <EntryRow
          label="Tent stake"
          kind="counted"
          bringCount={0}
          pieceCount={0}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×0')
    })
  })
})
