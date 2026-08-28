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
    expect(container.innerHTML).toContain('#F0EBDD')
  })
})
