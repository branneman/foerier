import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { InvitePreview } from '../auth/api'
import { Join } from './Join'

const IN_SIX_DAYS = new Date(Date.now() + 6 * 24 * 3600_000).toISOString()

function aPreview(overrides: Partial<InvitePreview> = {}): InvitePreview {
  return {
    household_name: 'Veldkamp',
    purpose: 'join',
    expires_at: IN_SIX_DAYS,
    person_id: '0f0000aa-0000-4000-8000-0000000000aa',
    person_recorded: true,
    ...overrides,
  }
}

const defaults = {
  deadEnd: null,
  onConfirm: () => Promise.resolve(),
  onOpenSignIn: () => {},
  onNoPasskey: () => {},
  onNameChange: () => {},
  signedIn: false,
  passkeySaved: true,
  onOpenDepot: () => {},
}

describe('the join screen', () => {
  it('names the household being joined', () => {
    render(<Join {...defaults} preview={aPreview()} />)

    expect(
      screen.getByRole('heading', { name: 'Join Veldkamp?' }),
    ).toBeInTheDocument()
  })

  it('says plainly that opening the link consumed nothing', () => {
    // The rule that makes link previews harmless, stated where the user is
    // deciding (auth-design.md §3.3).
    render(<Join {...defaults} preview={aPreview()} />)

    expect(
      screen.getByText('Opening this link changed nothing yet.'),
    ).toBeInTheDocument()
  })

  it('states single use and the time remaining', () => {
    render(<Join {...defaults} preview={aPreview()} />)

    expect(screen.getByText('Single use')).toBeInTheDocument()
    expect(screen.getByText('Expires in 6 d')).toBeInTheDocument()
  })

  it('marks an expiry under an hour as urgent', () => {
    render(
      <Join
        {...defaults}
        preview={aPreview({
          expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
        })}
      />,
    )

    const chip = screen.getByText(/Expires in \d+ min/)
    expect(chip).toHaveAttribute('data-urgent', 'true')
  })

  describe("a brand-new household's first login", () => {
    const firstLogin = aPreview({ person_recorded: false })

    it('asks the joiner to name themselves', () => {
      render(<Join {...defaults} preview={firstLogin} />)

      expect(
        screen.getByText(
          'This link starts a new household. Its first login is yours.',
        ),
      ).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(
        screen.getByText('Household and depot start empty.'),
      ).toBeInTheDocument()
    })

    it('will not continue without a name', async () => {
      render(<Join {...defaults} preview={firstLogin} />)

      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    })

    it('passes the typed name up, trimmed', async () => {
      const user = userEvent.setup()
      const onConfirm = vi.fn(() => Promise.resolve())
      render(<Join {...defaults} preview={firstLogin} onConfirm={onConfirm} />)

      await user.type(screen.getByRole('textbox'), '  Els  ')
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(onConfirm).toHaveBeenCalledWith('Els')
    })
  })

  describe('an invite for a person already recorded', () => {
    it('needs no name and joins directly', async () => {
      const user = userEvent.setup()
      const onConfirm = vi.fn(() => Promise.resolve())
      render(<Join {...defaults} preview={aPreview()} onConfirm={onConfirm} />)

      expect(screen.queryByRole('textbox')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Join Veldkamp' }))

      expect(onConfirm).toHaveBeenCalledWith(null)
    })

    it('offers the passkey-less path as a deliberate choice, not only a fallback', async () => {
      const onNoPasskey = vi.fn()
      render(
        <Join
          preview={aPreview()}
          deadEnd={null}
          onConfirm={vi.fn()}
          onOpenSignIn={vi.fn()}
          onNoPasskey={onNoPasskey}
          onNameChange={vi.fn()}
          signedIn={false}
          passkeySaved={false}
          onOpenDepot={vi.fn()}
        />,
      )

      await userEvent.click(
        screen.getByRole('button', { name: 'No passkey on this device?' }),
      )
      expect(onNoPasskey).toHaveBeenCalledTimes(1)
    })
  })

  describe('the dead end', () => {
    it('swaps only the fact line, keeping one constant title', () => {
      const { rerender } = render(
        <Join {...defaults} preview={null} deadEnd="expired" />,
      )
      expect(
        screen.getByRole('heading', { name: 'Invite not valid.' }),
      ).toBeInTheDocument()
      expect(screen.getByText(/expired/)).toBeInTheDocument()

      rerender(<Join {...defaults} preview={null} deadEnd="used" />)
      expect(
        screen.getByRole('heading', { name: 'Invite not valid.' }),
      ).toBeInTheDocument()
      expect(screen.getByText(/single-use/)).toBeInTheDocument()
    })

    it('reassures rather than alarms', () => {
      // No attention colour anywhere: the link is done, nothing of the user's
      // is wrong (docs/design/README.md §9).
      render(<Join {...defaults} preview={null} deadEnd="used" />)

      expect(
        screen.getByText(
          'Ask a household member for a new one. Nothing was used up by opening this.',
        ),
      ).toBeInTheDocument()
      expect(screen.queryByText(/▲/)).toBeNull()
    })

    it('offers a way out', () => {
      render(<Join {...defaults} preview={null} deadEnd="unknown" />)

      expect(
        screen.getByRole('button', { name: 'Open sign-in' }),
      ).toBeInTheDocument()
    })
  })

  describe('success', () => {
    it('confirms the passkey and does not wait for a first sync', async () => {
      const user = userEvent.setup()
      const onOpenDepot = vi.fn()
      render(
        <Join
          {...defaults}
          preview={aPreview()}
          signedIn
          onOpenDepot={onOpenDepot}
        />,
      )

      expect(
        screen.getByRole('heading', { name: 'Signed in.' }),
      ).toBeInTheDocument()
      expect(
        screen.getByText('Passkey saved on this device.'),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Open the depot' }))
      expect(onOpenDepot).toHaveBeenCalled()
    })

    it('never claims a passkey was saved on the claim path, which makes none', () => {
      // The same discipline that turned "This device cannot make one" into
      // "No passkey is made here" (`docs/design/README.md` §10): a Device
      // that signed in via `device/claim` created no credential, ever, so
      // the success frame right after must not say it did.
      render(
        <Join
          {...defaults}
          preview={aPreview()}
          signedIn
          passkeySaved={false}
        />,
      )

      expect(
        screen.getByRole('heading', { name: 'Signed in.' }),
      ).toBeInTheDocument()
      expect(
        screen.getByText('You stay signed in until you sign out.'),
      ).toBeInTheDocument()
      expect(screen.queryByText(/Passkey/)).toBeNull()
    })

    it('still credits the register path with the passkey it actually made', () => {
      render(<Join {...defaults} preview={aPreview()} signedIn passkeySaved />)

      expect(
        screen.getByText('Passkey saved on this device.'),
      ).toBeInTheDocument()
    })
  })
})
