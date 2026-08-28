import styles from './Icon.module.css'

/**
 * The navigation icon set, transcribed from the Split icon rail on
 * `Screens A` §04/§05.
 *
 * Inline SVG, never rasters — the same rule the logo follows
 * ([frontend-design §5](../../docs/frontend-design.md) assigns the `Icon` set
 * to `ui/`; `docs/design/README.md`, Assets: *"No raster assets… Icons (tab
 * bar, search, checks) are simple inline SVG strokes at 1.6–1.9px"*).
 *
 * Everything is `currentColor`, so an icon takes the colour of the row it
 * sits in and the active state is expressed once, by the parent, rather than
 * once per icon. Decorative by default: the rail's own link carries the
 * accessible name, and an icon announcing "depot" beside a link already
 * called Depot would say it twice.
 */
export interface IconProps {
  /** Rendered width and height in px. The rail draws 19 inside a 40 square. */
  size?: number
  /** Give one only where the icon stands alone with no text beside it. */
  title?: string
}

function frame(size: number, title: string | undefined) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    role: title === undefined ? ('presentation' as const) : ('img' as const),
    'aria-hidden': title === undefined,
    ...(title === undefined ? {} : { 'aria-label': title }),
    className: styles['icon'],
  }
}

/** Four panes, the last one solid — the depot as a grid of holdings. */
export function IconDepot({ size = 19, title }: IconProps = {}) {
  return (
    <svg {...frame(size, title)} data-testid="icon-depot">
      {title !== undefined && <title>{title}</title>}
      <rect
        x="3"
        y="3"
        width="8"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="13"
        y="3"
        width="8"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="3"
        y="13"
        width="8"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect x="13" y="13" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  )
}

/** A pennant on a pole — a trip is a flag planted, not a suitcase. */
export function IconTrips({ size = 19, title }: IconProps = {}) {
  return (
    <svg {...frame(size, title)} data-testid="icon-trips">
      {title !== undefined && <title>{title}</title>}
      <line
        x1="5.5"
        y1="3"
        x2="5.5"
        y2="21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <polygon points="5.5,4 19,7.5 5.5,11" fill="currentColor" />
    </svg>
  )
}

/** A magnifier. */
export function IconFind({ size = 19, title }: IconProps = {}) {
  return (
    <svg {...frame(size, title)} data-testid="icon-find">
      {title !== undefined && <title>{title}</title>}
      <circle
        cx="10.5"
        cy="10.5"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <line
        x1="15.5"
        y1="15.5"
        x2="21"
        y2="21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
