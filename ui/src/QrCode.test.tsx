import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { QrCode } from './QrCode'

describe('QrCode', () => {
  it('renders an SVG that encodes the value', () => {
    render(
      <QrCode
        value="https://app.foerier.app/join#abc"
        size={126}
        title="Device link"
      />,
    )
    const image = screen.getByRole('img', { name: 'Device link' })
    expect(image.querySelector('svg')).not.toBeNull()
  })

  it('encodes a full-length invite link without throwing', () => {
    const secret = 'kJ2nQ7xWpL0aZ4vRtY8sMc1BdF6hGjNe3UiOkPqXwSb'
    expect(() =>
      render(
        <QrCode
          value={`https://app.foerier.app/join#${secret}`}
          size={126}
          title="Device link"
        />,
      ),
    ).not.toThrow()
  })

  it("carries the board's light tile rather than the page background", () => {
    const { container } = render(
      <QrCode value="x" size={126} title="Device link" />,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()

    // The light tile is the <rect> background fill
    const rect = svg!.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#F0EBDD')

    // The modules are the <path> fill
    const path = svg!.querySelector('path')
    expect(path?.getAttribute('fill')).toBe('#151A15')
  })

  it('adds a quiet zone with the border', () => {
    const { container } = render(
      <QrCode value="x" size={126} title="Device link" />,
    )
    const span = container.querySelector('span[role="img"]')
    expect(span).not.toBeNull()

    const svg = span?.querySelector('svg')
    expect(svg).not.toBeNull()

    // The quiet zone (border: 1) expands the viewBox from 21×21 to 23×23
    // Extract viewBox via innerHTML to handle the rendered SVG string
    const svgHtml = svg?.outerHTML || ''
    const viewBoxMatch = svgHtml.match(/viewBox="([^"]+)"/)
    const viewBoxStr = viewBoxMatch?.[1] || ''

    const parts = viewBoxStr.trim().split(/\s+/)
    const width = parts.length >= 3 ? parseInt(parts[2]!, 10) : 0
    const height = parts.length >= 4 ? parseInt(parts[3]!, 10) : 0

    // With border: 1, the viewBox reflects the expanded size; without border: 0 it's smaller
    expect(width).toBeGreaterThan(220)
    expect(height).toBeGreaterThan(220)
  })
})
