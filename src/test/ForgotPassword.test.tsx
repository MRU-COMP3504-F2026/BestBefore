import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ForgotPassword from '../pages/ForgotPassword'
import { requestPasswordReset } from '../lib/authClient'

vi.mock('../lib/authClient', () => ({ requestPasswordReset: vi.fn() }))

function renderForgotPassword() {
  render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  )
}

describe('ForgotPassword', () => {
  beforeEach(() => {
    vi.mocked(requestPasswordReset).mockReset()
    vi.mocked(requestPasswordReset).mockResolvedValue({ ok: true })
  })

  it('shows an inline error when submitted empty', async () => {
    renderForgotPassword()

    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText('Email is required')).toBeInTheDocument()
    expect(requestPasswordReset).not.toHaveBeenCalled()
  })

  it('shows an inline error for an invalid email', async () => {
    renderForgotPassword()

    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument()
    expect(requestPasswordReset).not.toHaveBeenCalled()
  })

  it('sends the reset request with a redirect back to /reset-password on this origin', async () => {
    renderForgotPassword()

    await userEvent.type(screen.getByLabelText('Email'), 'you@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(requestPasswordReset).toHaveBeenCalledWith(
      'you@example.com',
      `${window.location.origin}/reset-password`,
    )
  })

  it('shows a pending state while submitting and then a confirmation', async () => {
    let finish: (value: { ok: true }) => void = () => {}
    vi.mocked(requestPasswordReset).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderForgotPassword()

    await userEvent.type(screen.getByLabelText('Email'), 'you@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled()

    finish({ ok: true })

    expect(await screen.findByRole('status')).toHaveTextContent(
      "If an account exists for you@example.com, you'll receive a reset link shortly.",
    )
    expect(screen.getByRole('link', { name: 'Back to log in' })).toBeInTheDocument()
  })

  it('shows the error and no confirmation when the request fails', async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue({
      ok: false,
      error: 'Too many attempts. Please try again later.',
    })
    renderForgotPassword()

    await userEvent.type(screen.getByLabelText('Email'), 'you@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please try again later.',
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
