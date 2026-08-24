/**
 * The duffel mark and the wordmark.
 *
 * Geometry is transcribed exactly from the Assets section of
 * `docs/design/README.md`; `Logo Round 4 - Radius Sweep.dc.html` is the current
 * visual reference. There are no raster assets anywhere in foerier — the mark
 * is inline SVG so it inherits colour and scales with text.
 */

import styles from './Logo.module.css'

const DUFFEL_OUTLINE =
  'M8,6 L20,6 Q25.5,6.5 25.5,13 Q25.5,19.5 20,20 L8,20 Q2.5,19.5 2.5,13 Q2.5,6.5 8,6 Z'
const HANDLE_ARC = 'M11,5.6 Q14,1.6 17,5.6'

/** Below this rendered width the seams are noise rather than detail. */
const SEAM_THRESHOLD_PX = 20

export interface MarkProps {
  /** Rendered width in px. Height follows the 28×22 viewBox. */
  size?: number
  title?: string
}

export function Mark({ size = 28, title }: MarkProps) {
  const showSeams = size > SEAM_THRESHOLD_PX

  return (
    <svg
      width={size}
      height={(size * 22) / 28}
      viewBox="0 0 28 22"
      fill="none"
      role={title === undefined ? 'presentation' : 'img'}
      aria-hidden={title === undefined}
      aria-label={title}
      data-testid="foerier-mark"
    >
      {title !== undefined && <title>{title}</title>}
      <path
        d={DUFFEL_OUTLINE}
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      {showSeams && (
        <g stroke="currentColor" strokeWidth={1.3} data-testid="mark-seams">
          <line x1="10" y1="6" x2="10" y2="20" />
          <line x1="18" y1="6" x2="18" y2="20" />
        </g>
      )}
      <path
        d={HANDLE_ARC}
        stroke="var(--color-brand-amber)"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}

export interface LogoProps extends MarkProps {
  /** Hide the wordmark and render the mark alone. */
  markOnly?: boolean
}

export function Logo({ size = 28, markOnly = false, title }: LogoProps) {
  return (
    <span className={styles['logo']} data-testid="foerier-logo">
      <Mark size={size} {...(title === undefined ? {} : { title })} />
      {!markOnly && <span className={styles['wordmark']}>foerier</span>}
    </span>
  )
}
