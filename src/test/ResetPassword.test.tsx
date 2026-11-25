import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ResetPassword from '../pages/ResetPassword'
import { resetPassword } from '../lib/authClient'

vi.mock('../lib/authClient', () => ({ resetPassword: vi.fn() }))

function renderResetPassword(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/forgot-password" element={<p>Forgot password page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.mocked(resetPassword).mockReset()
    vi.mocked(resetPassword).mockResolvedValue({ ok: true })
  })

  it('shows an invalid-link message with a way to request a new one when there is no token', () => {
    renderResetPassword('/reset-password')

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This reset link is invalid or has expired. Request a new one.',
    )
    expect(screen.queryByRole('button', { name: 'Set new password' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('shows the invalid-link message when Neon Auth reports INVALID_TOKEN', () => {
    renderResetPassword('/reset-password?error=INVALID_TOKEN')

    expect(screen.getByRole('alert')).toHaveTextContent('This reset link is invalid or has expired')
    expect(screen.queryByRole('button', { name: 'Set new password' })).not.toBeInTheDocument()
  })

  it('shows an inline error when the two passwords differ', async () => {
    renderResetPassword('/reset-password?token=abc')

    await userEvent.type(screen.getByLabelText('New password'), 'new-password-1')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'new-password-2')
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('shows an inline error when the password is too short', async () => {
    renderResetPassword('/reset-password?token=abc')

    await userEvent.type(screen.getByLabelText('New password'), 'short')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('submits the token and new password, then confirms', async () => {
    renderResetPassword('/reset-password?token=abc123')

    await userEvent.type(screen.getByLabelText('New password'), 'correct-horse-1')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'correct-horse-1')
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(resetPassword).toHaveBeenCalledWith('abc123', 'correct-horse-1')
    expect(await screen.findByRole('status')).toHaveTextContent('Your password has been reset')
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  })

  it('shows the error and keeps the form when the reset fails', async () => {
    vi.mocked(resetPassword).mockResolvedValue({
      ok: false,
      error: 'This reset link is invalid or has expired. Request a new one.',
    })
    renderResetPassword('/reset-password?token=stale')

    await userEvent.type(screen.getByLabelText('New password'), 'correct-horse-1')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'correct-horse-1')
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This reset link is invalid or has expired. Request a new one.',
    )
    expect(screen.getByRole('button', { name: 'Set new password' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
