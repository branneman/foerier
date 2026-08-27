import type { AnchorHTMLAttributes, MouseEvent } from 'react'

import styles from './GearRow.module.css'

/**
 * **One `GearRow`, three renders** — Components §03's variant map, which is
 * the canonical one. Extracted into `ui/` at S3, as
 * [frontend-design §5](../../docs/frontend-design.md) and
 * [architecture §12.4](../../docs/architecture-design.md) both name: `Find`'s
 * `PlainRow` had become a second copy of `Depot`'s row JSX, and a second copy
 * is what makes an extraction worth doing.
 *
 * | Render | Where | Anatomy |
 * | --- | --- | --- |
 * | `2-LINE` | pane narrower than the fold | name + trailing whereabouts; meta line beneath |
 * | `1-LINE` | pane wider than the fold | meta moves inline |
 * | `TABLE-44` | the desktop table | the 8-column row |
 *
 * ## Why the table is a prop and the fold is a container query
 *
 * Components §03 says all three are "picked by `@container`, never by
 * viewport", and for `2-LINE` ↔ `1-LINE` that is exactly what happens: same
 * DOM, same content, the meta line moving inline at `--fold` — which is why
 * Split 900's 308px list pane renders the folded row even though the viewport
 * is 900.
 *
 * `TABLE-44` is a **prop**, deliberately. It is a different DOM — eight cells
 * on a shared grid template, a checkbox slot, a `KIND` cell and a `TAGS`
 * cell that no folding row has — so picking it in CSS would mean rendering
 * both sets of content and hiding one, which puts every fact in the
 * accessibility tree twice. And the container widths do not separate cleanly:
 * Roomy's widest container is ~672px against Desktop's narrowest table at
 * ~760px, a 24px margin that would produce a broken layout at one viewport
 * nobody thinks to test. The table is only ever rendered by a parent that
 * knows it is a table, so that parent says so.
 *
 * ## Rules that travel with the row
 *
 * - **Containment is the name's `N INSIDE` suffix and a chevron, never a fake
 *   Kind.** `KIND` in UI always means the glossary Kind
 *   (`SINGLE · PER-PERSON · COUNTED`); `ITEM`/`CONTAINER` are meta-line words.
 * - **Rows never show tags.** A tag filter changes *which rows appear*, not
 *   the rows. Tags live in the table's own column — plain mono, ellipsis —
 *   and on gear detail, one tap away.
 * - **Find's plain match is this row with the meta slot swapped** to the `⌂`
 *   path. Answer-first is a meta-slot choice, not a new component.
 * - **The builder's 40px row is a different component** — trailing action, no
 *   whereabouts — and is S6's, not this.
 *
 * `ui/` never imports the store or a router (`frontend-design.md` §5). The
 * root is an `<a>` carrying `href` and `onClick`, so `app/` can wrap it in
 * wouter's `<Link asChild>`.
 */
export interface GearRowProps {
  name: string
  href: string
  /** `⌂ HOME` · `▸ ALPS · CAR` · `▲ ×1 TESSIN 2025` · `RETIRED`. */
  whereabouts: string
  /** Which world the whereabouts names — muted, amber, or attention. */
  tone?: 'home' | 'trip' | 'attention'
  /** How much gear sits inside this container, at any depth. */
  insideCount?: number
  /** The **glossary** Kind, already formatted. Table column only. */
  kind?: string
  /** `SHARED`, or the owning Person. Meta line and table column. */
  owner?: string
  /** `ATTIC ▸ SHELF L-TOP ▸ CRATE B`. Meta line and table column. */
  path?: string
  /** `×N`, for counted gear only. Meta line and table column. */
  qty?: string
  /** Table column only — never drawn in a folding row. */
  tags?: readonly string[]
  retired?: boolean
  /** `row` folds by `@container`; `table` is the desktop 8-column row. */
  layout?: 'row' | 'table'
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  /** Everything else wouter's `Link asChild` hands down. */
  anchorProps?: AnchorHTMLAttributes<HTMLAnchorElement>
}

/** `PERSONAL E · SLAAPKAMER ▸ KAST · ×2` — whichever parts exist. */
function metaLine(props: GearRowProps): string {
  return [props.owner, props.path, props.qty]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ')
}

/** `#winter #sleep` — the table's TAGS column is plain mono text that
 * ellipsis-truncates, deliberately: at 44px density chips would dominate the
 * row, and the full set lives on gear detail. */
function tagText(tags: readonly string[] | undefined): string {
  return (tags ?? []).map((tag) => `#${tag}`).join(' ')
}

export function GearRow(props: GearRowProps) {
  const {
    name,
    href,
    whereabouts,
    tone = 'home',
    insideCount,
    kind,
    owner,
    path,
    qty,
    tags,
    retired = false,
    layout = 'row',
    onClick,
    anchorProps,
  } = props

  const rowId = href.replace(/[^\w-]/g, '-')
  const metaId = `gear-row-meta-${rowId}`
  const whereaboutsId = `gear-row-where-${rowId}`
  const meta = layout === 'table' ? '' : metaLine(props)

  const className = [
    styles['row'],
    layout === 'table' ? styles['table'] : styles['folding'],
    retired ? styles['retired'] : '',
  ]
    .filter((part) => part !== '')
    .join(' ')

  const nameCell = (
    <span className={styles['nameCell']} data-testid="gear-row-name">
      <span className={styles['name']}>{retired ? <s>{name}</s> : name}</span>
      {insideCount !== undefined && (
        <span className={styles['inside']} data-testid="gear-row-inside">
          {insideCount} INSIDE
        </span>
      )}
    </span>
  )

  const whereaboutsCell = (
    <span
      id={whereaboutsId}
      className={`${styles['whereabouts']} ${styles[tone] ?? ''}`}
      data-testid="gear-row-whereabouts"
    >
      {whereabouts}
    </span>
  )

  return (
    <a
      {...anchorProps}
      href={href}
      className={className}
      // The row's accessible name stays the gear's name — it is what you
      // would say the row *is*. The path and whereabouts are real content, so
      // a screen reader still reaches them, through `describedby` rather than
      // through a name nobody would read aloud.
      aria-label={name}
      aria-describedby={[meta === '' ? null : metaId, whereaboutsId]
        .filter((id) => id !== null)
        .join(' ')}
      {...(onClick === undefined ? {} : { onClick })}
    >
      {layout === 'table' ? (
        <>
          {nameCell}
          <span className={styles['cell']} data-testid="gear-row-kind">
            {kind ?? '—'}
          </span>
          <span className={styles['cell']} data-testid="gear-row-owner">
            {owner ?? '—'}
          </span>
          <span className={styles['cell']} data-testid="gear-row-home">
            {path ?? '—'}
          </span>
          <span className={styles['tags']} data-testid="gear-row-tags">
            {tagText(tags)}
          </span>
          <span className={styles['cell']} data-testid="gear-row-qty">
            {qty ?? '—'}
          </span>
          {whereaboutsCell}
        </>
      ) : (
        <>
          <span className={styles['main']}>
            {nameCell}
            {meta !== '' && (
              <span
                id={metaId}
                className={styles['meta']}
                data-testid="gear-row-meta"
              >
                {meta}
              </span>
            )}
          </span>
          <span className={styles['side']}>
            {whereaboutsCell}
            {insideCount !== undefined && (
              <span
                className={styles['chevron']}
                data-testid="gear-row-chevron"
                aria-hidden="true"
              >
                ›
              </span>
            )}
          </span>
        </>
      )}
    </a>
  )
}
