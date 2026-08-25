import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SignIn } from './SignIn'

const defaults = {
  onSignIn: () => Promise.resolve(),
  online: true,
  buildSha: '7c39f2abcdef',
}

describe('the signed-out shell', () => {
  it('offers one button and no fields at all', async () => {
    // No username, no password, no email. Discoverable credentials mean the
    // authenticator already knows which credential belongs to foerier.app —
    // a text field here would be a design regression, not a feature.
    render(<SignIn {...defaults} />)

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })

  it('states the terms without cheerleading', () => {
    render(<SignIn {...defaults} />)

    expect(
      screen.getByText('Sign-in is a passkey. No passwords, no email.'),
    ).toBeInTheDocument()
  })

  it('shows the build so a bug report can name it', () => {
    render(<SignIn {...defaults} />)

    expect(screen.getByText('BUILD 7C39F2A')).toBeInTheDocument()
  })

  describe('offline', () => {
    it('says so, and disables only the thing that needs a network', async () => {
      render(<SignIn {...defaults} online={false} />)

      expect(screen.getByText('Offline')).toBeInTheDocument()
      expect(
        screen.getByText('Offline. Sign-in needs a connection.'),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()

      // The explainer needs no network, so it stays available — it is the one
      // useful thing left to someone stuck offline on a device with no passkey.
      expect(
        screen.getByRole('button', { name: 'No passkey on this device?' }),
      ).toBeEnabled()
    })
  })

  describe('when the ceremony fails', () => {
    it('says nothing changed, and returns the button to idle', async () => {
      const user = userEvent.setup()
      render(
        <SignIn
          {...defaults}
          onSignIn={() => Promise.reject(new Error('nope'))}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(
        await screen.findByText('▲ Sign-in did not complete. Nothing changed.'),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'Try again, or ask a household member for a device link.',
        ),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    })
  })

  describe('during the ceremony', () => {
    it('disables the button and recreates nothing of the OS sheet', async () => {
      const user = userEvent.setup()
      let release = () => {}
      const onSignIn = vi.fn(
        () => new Promise<void>((resolve) => (release = resolve)),
      )

      render(<SignIn {...defaults} onSignIn={onSignIn} />)
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
      // The OS passkey sheet is an external surface. There must be no spinner
      // screen standing in for it (docs/design/README.md §8).
      expect(screen.queryByRole('progressbar')).toBeNull()

      release()
    })
  })

  describe('session lost', () => {
    it('reads as a fact, never as data loss', async () => {
      // No ▲, no attention colour, no modal, no banner. The work is on the
      // device and flushes after the next sign-in (design README §15).
      render(<SignIn {...defaults} sessionLost={{ unsyncedCount: 12 }} />)

      const line = screen.getByText(
        /Signed out on this device\. 12 changes saved here and not yet synced\./,
      )
      expect(line).toBeInTheDocument()
      expect(line.textContent).not.toContain('▲')
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
  })

  describe('the explainer', () => {
    it('opens, and names the maintainer only as a last resort', async () => {
      const user = userEvent.setup()
      render(<SignIn {...defaults} />)

      await user.click(
        screen.getByRole('button', { name: 'No passkey on this device?' }),
      )

      const sheet = await screen.findByRole('dialog')
      expect(sheet).toHaveTextContent('Ask a signed-in household member')
      // The only place in the product where whoever runs the server is named,
      // and only for the one case that genuinely leaves it.
      expect(sheet).toHaveTextContent('whoever runs your server')
    })

    it('closes on Escape', async () => {
      const user = userEvent.setup()
      render(<SignIn {...defaults} />)

      await user.click(
        screen.getByRole('button', { name: 'No passkey on this device?' }),
      )
      expect(await screen.findByRole('dialog')).toBeInTheDocument()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
