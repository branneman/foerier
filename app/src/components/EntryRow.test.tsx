import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { EntryRow, type EntryRowPiece, type EntryRowProps } from './EntryRow'

/** Every editable Kind gets the same remove-control assertion (promoted
 * review fix: the rule is "every editable row ends in ✕", and only Single
 * was exercised). `pieces` is read only by `per_person` (`EntryRow`'s own
 * docstring); the other three Kinds carry an empty array because nothing
 * reads it there. */
const KINDS: readonly {
  label: string
  kind: EntryRowProps['kind']
  bringCount: number | null
  pieceCount: number
  pieces: readonly EntryRowPiece[]
}[] = [
  {
    label: 'Tent, tunnel 4p',
    kind: 'counted',
    bringCount: 2,
    pieceCount: 2,
    pieces: [],
  },
  {
    label: 'Trekking pole',
    kind: 'per_person',
    bringCount: null,
    pieceCount: 3,
    pieces: [
      { personId: 'p1', label: 'Bran', included: true },
      { personId: 'p2', label: 'Els', included: true },
      { personId: 'p3', label: 'Mark', included: true },
    ],
  },
  {
    label: 'Headlamp',
    kind: 'single',
    bringCount: null,
    pieceCount: 1,
    pieces: [],
  },
  {
    label: 'Passports',
    kind: 'trip_only',
    bringCount: null,
    pieceCount: 1,
    pieces: [],
  },
]

/** Rulings A–D's own fixture: three Participants, one excluded — "2 of 3
 * bring one" is `docs/design/README.md` §5d ruling B's own accessible-name
 * example, verbatim, and this is what produces it against the default
 * `label: 'Headlamp'` `renderRow` below carries. */
const THREE_PIECES: readonly EntryRowPiece[] = [
  { personId: 'p1', label: 'Bran', included: true },
  { personId: 'p2', label: 'Els', included: true },
  { personId: 'p3', label: 'Mark', included: false },
]

/** Ruling D's fixture: the same three Participants, every Piece removed. */
const THREE_ALL_EXCLUDED: readonly EntryRowPiece[] = THREE_PIECES.map(
  (piece) => ({ ...piece, included: false }),
)

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
          pieces={[]}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
        />,
      )
      expect(
        screen.getByRole('button', { name: /increase bring-count/i }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('textbox', { name: /bring-count for tent/i }),
      ).toHaveValue('2')
    })

    it('draws the cluster + ×N control on a per-person Entry, no Stepper and no badge', () => {
      render(
        <EntryRow
          label="Trekking pole"
          kind="per_person"
          bringCount={null}
          pieceCount={3}
          pieces={[
            { personId: 'p1', label: 'Bran', included: true },
            { personId: 'p2', label: 'Els', included: true },
            { personId: 'p3', label: 'Mark', included: true },
          ]}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×3')
      expect(
        screen.getByRole('button', {
          name: 'Who brings one — Trekking pole, 3 of 3 bring one',
        }),
      ).toBeInTheDocument()
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
          pieces={[]}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
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
          pieces={[]}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-badge')).toHaveTextContent(
        'TRIP-ONLY',
      )
      // Board order (review round F1): name, badge, spacer, ✕ — no trailing
      // content of its own for a trip-only row in editable mode.
      expect(screen.queryByTestId('entry-row-count')).toBeNull()
    })

    /**
     * `PackingRow` carries the identical note beside its own two spans: the
     * flex `gap` between the name and the badge separates them on screen,
     * but a gap is not a character. Without a real space the row's text
     * content — everything a screen reader reads out as it crosses the
     * row — glues the two into `PassportsTRIP-ONLY`.
     *
     * Asserted as the **whole** row's text content, and with the glued
     * spelling named on its own line, because the two `toHaveTextContent`
     * calls above match each span in isolation and a substring match cannot
     * see a missing separator between them. That is exactly how this defect
     * survived S7: the assertion that was supposed to pin the name matched
     * the suffix as a substring.
     */
    it('separates the label from the badge, so the row does not announce PassportsTRIP-ONLY', () => {
      render(
        <EntryRow
          label="Passports"
          kind="trip_only"
          bringCount={null}
          pieceCount={1}
          pieces={[]}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
        />,
      )
      const row = screen.getByTestId('entry-row')
      expect(row.textContent).toContain('Passports TRIP-ONLY')
      expect(row.textContent).not.toContain('PassportsTRIP-ONLY')
    })
  })

  describe('editable rows end in a remove control, on every Kind', () => {
    it.each(KINDS)(
      'renders ✕ for $kind and calls onRemove without a confirm',
      async ({ label, kind, bringCount, pieceCount, pieces }) => {
        const user = userEvent.setup()
        const onRemove = vi.fn()
        render(
          <EntryRow
            label={label}
            kind={kind}
            bringCount={bringCount}
            pieceCount={pieceCount}
            pieces={pieces}
            editable
            onBringCountChange={vi.fn()}
            onRemove={onRemove}
            onOpenPiecePicker={vi.fn()}
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
      ({ label, kind, bringCount, pieceCount, pieces }) => {
        render(
          <EntryRow
            label={label}
            kind={kind}
            bringCount={bringCount}
            pieceCount={pieceCount}
            pieces={pieces}
            editable={false}
            onBringCountChange={vi.fn()}
            onRemove={vi.fn()}
            onOpenPiecePicker={vi.fn()}
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
          pieces={[]}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×4')
      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('reads ×N from bringCount, not pieceCount, for a Counted container Entry (fix round F3)', () => {
      // `container` and `kind` are orthogonal registers — a Counted Entry can
      // be a container. `pieceCountOf` reads `0` for one (ruling A5), but
      // `×N` on a row answers "how many of this thing there are", which is
      // `bringCountOf`'s question — so the two props diverge here on purpose,
      // and the row must follow `bringCount`.
      render(
        <EntryRow
          label="Ammo crate"
          kind="counted"
          bringCount={3}
          pieceCount={0}
          pieces={[]}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×3')
    })

    it("draws the cluster + ×N for a per-person Entry too — ruling A's amendment to the — rule", () => {
      render(
        <EntryRow
          label="Trekking pole"
          kind="per_person"
          bringCount={null}
          pieceCount={2}
          pieces={THREE_PIECES}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×2')
      // Not a control here — `role="img"`, not `"button"` — but the same
      // fact, stated the same way.
      expect(
        screen.getByRole('img', {
          name: 'Who brings one — Trekking pole, 2 of 3 bring one',
        }),
      ).toBeVisible()
    })

    it('reads — in the trailing slot for a trip-only Entry, but still draws the badge', () => {
      render(
        <EntryRow
          label="Passports"
          kind="trip_only"
          bringCount={null}
          pieceCount={1}
          pieces={[]}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
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
          pieces={[]}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
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
          pieces={[]}
          editable
          onBringCountChange={onBringCountChange}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
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
          pieces={[]}
          editable
          onBringCountChange={onBringCountChange}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
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
          pieces={[]}
          editable
          onBringCountChange={onBringCountChange}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
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
          pieces={[]}
          editable
          onBringCountChange={onBringCountChange}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
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
          pieces={[]}
          editable
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
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
          pieces={[]}
          editable={false}
          onBringCountChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenPiecePicker={vi.fn()}
        />,
      )
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×0')
    })
  })

  /**
   * `docs/design/README.md` §5d — rulings A, B, C's empty case and D, all on
   * the one anatomy `EntryRow.tsx`'s docstring argues for. `renderRow`
   * derives `pieceCount` from `pieces` unless a test overrides it, matching
   * how `GearListSection` actually wires the two (`pieceCountOf` sums the
   * included Pieces `pieceInclusion` names) — so a test only ever states the
   * roster once.
   */
  describe("per-person Pieces (rulings A, B, C's empty case, D)", () => {
    function renderRow(overrides: Partial<EntryRowProps> = {}) {
      const pieces = overrides.pieces ?? THREE_PIECES
      const pieceCount =
        overrides.pieceCount ?? pieces.filter((piece) => piece.included).length
      const props: EntryRowProps = {
        label: 'Headlamp',
        kind: 'per_person',
        bringCount: null,
        editable: true,
        onBringCountChange: vi.fn(),
        onRemove: vi.fn(),
        onOpenPiecePicker: vi.fn(),
        ...overrides,
        pieces,
        pieceCount,
      }
      render(<EntryRow {...props} />)
      return props
    }

    it('draws the cluster and ×N in both modes', () => {
      const editableProps: EntryRowProps = {
        label: 'Headlamp',
        kind: 'per_person',
        bringCount: null,
        pieceCount: 2,
        pieces: THREE_PIECES,
        editable: true,
        onBringCountChange: vi.fn(),
        onRemove: vi.fn(),
        onOpenPiecePicker: vi.fn(),
      }
      const editableRender = render(<EntryRow {...editableProps} />)
      expect(
        screen.getByRole('button', {
          name: 'Who brings one — Headlamp, 2 of 3 bring one',
        }),
      ).toHaveTextContent('×2')
      // `screen` queries the whole document, so the first row is unmounted
      // before the second is mounted, or both would answer every query
      // below.
      editableRender.unmount()

      render(<EntryRow {...editableProps} editable={false} />)
      // The `role="img"` element is `PersonCluster`'s own root and covers
      // only the circles — `×N` is its sibling inside `.pieceDisplay`, not
      // its descendant, exactly as `×N` sits beside the hidden cluster in
      // the editable button rather than duplicating its label. So this
      // reads the display wrapper's text and the image's name separately.
      expect(screen.getByTestId('entry-row-pieces')).toHaveTextContent('×2')
      expect(
        screen.getByRole('img', {
          name: 'Who brings one — Headlamp, 2 of 3 bring one',
        }),
      ).toBeVisible()
    })

    it('makes the cluster and ×N one control, never the circles', async () => {
      renderRow({ editable: true })
      const control = screen.getByRole('button', {
        name: 'Who brings one — Headlamp, 2 of 3 bring one',
      })
      expect(control).toBeInTheDocument()
      // The circles inside are not targets. Queried structurally, not via
      // `within(control).queryAllByRole('button')` — that call defaults to
      // `hidden: false`, and dom-testing-library's accessibility-tree walk
      // excludes anything under `aria-hidden="true"` (`.clusterWrap`, which
      // wraps every circle here) regardless of its own role. So the very
      // regression this test exists to catch — a `PersonCircle` turned into
      // a real `<button>` — would still return `[]` from that query and the
      // test would keep passing. `querySelectorAll` reads the DOM directly,
      // aria-hidden or not.
      expect(control.querySelectorAll('button, [role="button"]')).toHaveLength(
        0,
      )
    })

    it('is inert above Split', () => {
      renderRow({ editable: false })
      expect(
        screen.queryByRole('button', { name: /who brings one/i }),
      ).not.toBeInTheDocument()
      // Still stated, just not a control — `role="img"`, the read pane's
      // own anatomy for the identical fact.
      expect(
        screen.getByRole('img', { name: /who brings one/i }),
      ).toBeInTheDocument()
    })

    it('reads NO PARTICIPANTS with an empty roster, and mounts no control', () => {
      renderRow({ editable: true, pieces: [] })
      expect(screen.getByText('NO PARTICIPANTS')).toBeInTheDocument()
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×0')
      expect(
        screen.queryByRole('button', { name: /who brings one/i }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('img', { name: /who brings one/i }),
      ).not.toBeInTheDocument()
    })

    // Review finding F1: `NO PARTICIPANTS` and `×0` used to land as two bare
    // sibling spans directly inside `.trailing`, which declares no `gap` —
    // it never needed one, since every other branch has a single child — so
    // the DOM text read as one run-on token, `NO PARTICIPANTS×0`, with
    // `getByText('NO PARTICIPANTS')` still passing regardless (each span is
    // its own element). No tier here can see the *visual* gap
    // (`vitest.config.ts` runs `css: false`, jsdom computes no layout — the
    // same limitation `drawnSizes.test.ts`'s own docstring names), but this
    // at least pins the two under one `.pieceDisplay` container rather than
    // as bare `.trailing` children, so a regression back to two loose spans
    // fails this even though `getByText` alone would not catch it.
    it('draws NO PARTICIPANTS and ×0 inside one flex container, not as two bare spans', () => {
      renderRow({ editable: true, pieces: [] })
      const container = screen.getByTestId('entry-row-pieces')
      expect(within(container).getByText('NO PARTICIPANTS')).toBeInTheDocument()
      expect(
        within(container).getByTestId('entry-row-count'),
      ).toHaveTextContent('×0')
    })

    it('says ×0 silently when every Piece is removed', () => {
      renderRow({ editable: true, pieces: THREE_ALL_EXCLUDED })
      expect(screen.getByTestId('entry-row-count')).toHaveTextContent('×0')
      expect(screen.queryByText(/nobody/i)).not.toBeInTheDocument()
      // Not an empty roster — the two draw differently (ruling D): the
      // control still mounts, over an all-dashed cluster.
      expect(
        screen.getByRole('button', {
          name: 'Who brings one — Headlamp, 0 of 3 bring one',
        }),
      ).toBeInTheDocument()
    })

    it('opens the picker from the control and from nowhere else', async () => {
      const user = userEvent.setup()
      const onOpenPiecePicker = vi.fn()
      renderRow({ onOpenPiecePicker })
      expect(onOpenPiecePicker).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: /who brings one/i }))
      expect(onOpenPiecePicker).toHaveBeenCalledOnce()
    })

    // Whole-branch review I1: no test anywhere wired `piece.included` to
    // `tone`, so the two calls `EntryRow` and `PiecePicker` each make into
    // that mapping could invert — dashed drawn for who *is* bringing one,
    // the opposite of story 8's whole visual claim — and every existing
    // assertion (including `PersonCluster.test.tsx`'s own dashed-first
    // ordering proof) still passed, because `includedCount` is derived
    // independently of `tone` and the ordering test only ever fed
    // `PersonCluster` its own already-correct props. This is the one test
    // that reads the mapping from the source of truth (`THREE_PIECES`:
    // Mark alone excluded) through to the rendered circles, so an
    // inversion at `EntryRow.tsx:327` fails here even though nothing else
    // in the suite notices.
    it('draws the excluded Person dashed, sorted ahead of the included ones', () => {
      renderRow({ editable: true })
      const control = screen.getByRole('button', {
        name: 'Who brings one — Headlamp, 2 of 3 bring one',
      })
      const circles = within(control).getAllByTestId('person-circle')
      expect(circles).toHaveLength(3)
      // Mark (`THREE_PIECES`'s only `included: false`) sorts first —
      // `PersonCluster`'s ruling-E job — and carries the dashed tone;
      // Bran and Els, both included, carry no tone override and so fall
      // back to `PersonCircle`'s default, `control`.
      expect(circles[0]).toHaveAttribute('data-tone', 'dashed')
      expect(circles[1]).toHaveAttribute('data-tone', 'control')
      expect(circles[2]).toHaveAttribute('data-tone', 'control')
    })
  })
})
