import { renderSVG } from 'uqr'

export interface QrCodeProps {
  /** The link to encode. */
  value: string
  /** Rendered edge length in px; the board draws 126 including the quiet zone. */
  size: number
  /** The accessible name. A QR with no name is an image nobody can identify. */
  title: string
}

/**
 * A QR code as inline SVG (`docs/design/README.md` §14).
 *
 * `uqr` was chosen by measurement: 4.3 KB gzipped against 8.5 and 9.7 for the
 * nearest alternatives, and the only candidate with no runtime dependencies.
 * It returns an SVG **string** with a `viewBox`, so the tile scales without a
 * canvas, without a `data:` URI, and without anything the CSP has to be
 * widened for.
 *
 * The light tile is not decoration: scanners want a light quiet zone, and the
 * app's own background is near-black. `border: 1` is the 10px quiet zone at
 * this scale.
 *
 * This is the only module in the repo that imports `uqr`
 * ([frontend-design §5](../../docs/frontend-design.md)).
 */
export function QrCode({ value, size, title }: QrCodeProps) {
  const svg = renderSVG(value, {
    border: 1,
    whiteColor: '#F0EBDD',
    blackColor: '#151A15',
  })

  return (
    <span
      role="img"
      aria-label={title}
      style={{ display: 'inline-block', width: size, height: size }}
      // The SVG is generated here from a value this component was handed; no
      // markup from the value reaches the output, because `uqr` emits only
      // rects and paths from a bit matrix.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
