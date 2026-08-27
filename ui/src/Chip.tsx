import styles from './Chip.module.css'

/**
 * The settled chip.
 *
 * Two sizes, from two boards that now agree: **36px** in the slice bar
 * (Components §04 — "the chip is 36px everywhere; the 32/36/40 drift across
 * boards is settled here") and **32px** for gear detail's tag chips
 * (Components §06). Nothing else picks a size.
 *
 * Three appearances, and they are states rather than variants:
 *
 * - **plain** — bordered. A tag chip on a read screen.
 * - **selected** — filled. An active filter. Filter surfaces only; a tag chip
 *   on gear detail is never filled, because it is not a filter.
 * - **ghost** — dashed. An *add* affordance: `+ TAG` in the slice bar,
 *   `+ tag` on gear detail. Ghost add-chips are **dimension-only**; the old
 *   value-carrying ghost (`+ TAG: #WINTER`) is retired.
 *
 * The `#` a tag chip draws is **never stored** — callers pass it in the
 * label, because this component knows nothing about tags.
 *
 * `ui/` never imports the store (`frontend-design.md` §5): everything here is
 * props in, callbacks out.
 */
export interface ChipProps {
  label: string
  /** `filter` is 36px, `tag` is 32px. */
  size?: 'filter' | 'tag'
  /** Filled. Only meaningful on a filter surface. */
  selected?: boolean
  /** Dashed — an add affordance rather than a value. */
  ghost?: boolean
  onClick?: () => void
  /**
   * Renders the trailing ✕. Present only where removal belongs: the slice
   * bar's active chips. Gear detail's tag chips deliberately have none — ✕
   * lives in the picker, not on a read screen (Components §06).
   */
  onRemove?: () => void
}

export function Chip({
  label,
  size = 'filter',
  selected = false,
  ghost = false,
  onClick,
  onRemove,
}: ChipProps) {
  const className = [
    styles['chip'],
    styles[size],
    selected ? styles['selected'] : '',
    ghost ? styles['ghost'] : '',
  ]
    .filter((name) => name !== '')
    .join(' ')

  const body = <span className={styles['label']}>{label}</span>

  // A ghost chip opens a picker; it is not a two-state control, so it carries
  // no `aria-pressed`. Announcing "not pressed" on `+ TAG` would describe a
  // state it does not have.
  const pressed = ghost ? {} : { 'aria-pressed': selected }

  const inner =
    onClick === undefined ? (
      <span className={className}>{body}</span>
    ) : (
      <button
        type="button"
        className={className}
        onClick={onClick}
        {...pressed}
      >
        {body}
      </button>
    )

  if (onRemove === undefined) return inner

  return (
    <span className={styles['group']}>
      {inner}
      <button
        type="button"
        className={styles['remove']}
        aria-label={`Remove ${label}`}
        onClick={(event) => {
          // The ✕ sits inside the chip's own hit area on every board. Without
          // this, removing a filter would also re-fire whatever the chip does.
          event.stopPropagation()
          onRemove()
        }}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </span>
  )
}
