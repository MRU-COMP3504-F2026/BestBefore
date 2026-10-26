import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProfilePage from '../pages/ProfilePage'
import { signOut } from '../lib/authClient'

const devAuth = vi.hoisted(() => ({ AUTH_DISABLED: false }))

vi.mock('../lib/devAuth', () => ({
  get AUTH_DISABLED() {
    return devAuth.AUTH_DISABLED
  },
}))

vi.mock('../lib/authClient', () => ({
  useAuthSession: () => ({
    data: { user: { name: 'Your Name', email: 'you@example.com' } },
    isPending: false,
  }),
  signOut: vi.fn(async () => ({ ok: true })),
}))

function renderProfile() {
  render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/login" element={<p>Login</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProfilePage', () => {
  afterEach(() => {
    devAuth.AUTH_DISABLED = false
  })

  it('renders the user details, household row and log out', () => {
    renderProfile()

    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/')
    expect(screen.getByText('Your Name')).toBeInTheDocument()
    expect(screen.getByText('you@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Household/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument()
  })

  it('signs out and returns to login', async () => {
    renderProfile()

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))

    expect(signOut).toHaveBeenCalled()
    expect(await screen.findByText('Login')).toBeInTheDocument()
  })

  it('disables log out while auth is disabled', () => {
    devAuth.AUTH_DISABLED = true
    renderProfile()

    expect(screen.getByRole('button', { name: 'Log out' })).toBeDisabled()
  })
})
