import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Login from '../pages/Login'
import { signIn } from '../lib/authClient'

vi.mock('../lib/authClient', () => ({ signIn: vi.fn() }))

const INVALID_EMAIL = 'wrong@example.com'

function renderLogin(initialEntry: string | { pathname: string; state: unknown } = '/login') {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<p>Home</p>} />
        <Route path="/items" element={<p>Items</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Login', () => {
  beforeEach(() => {
    vi.mocked(signIn).mockReset()
    vi.mocked(signIn).mockImplementation(async (email) => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return email === INVALID_EMAIL
        ? { ok: false, error: 'Invalid email or password' }
        : { ok: true }
    })
  })

  it('shows inline errors when submitted empty', async () => {
    renderLogin()

    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Email is required')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('shows an inline error for an invalid email', async () => {
    renderLogin()

    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email')
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument()
  })

  it('shows a pending state while submitting and then navigates home', async () => {
    renderLogin()

    await userEvent.type(screen.getByLabelText('Email'), 'you@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('button', { name: 'Logging in…' })).toBeDisabled()
    expect(await screen.findByText('Home')).toBeInTheDocument()
    expect(signIn).toHaveBeenCalledWith('you@example.com', 'password123')
  })

  it('returns to the page the user was redirected from', async () => {
    renderLogin({ pathname: '/login', state: { from: '/items' } })

    await userEvent.type(screen.getByLabelText('Email'), 'you@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Items')).toBeInTheDocument()
  })

  it('shows the auth error response', async () => {
    renderLogin()

    await userEvent.type(screen.getByLabelText('Email'), INVALID_EMAIL)
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled()
  })
})
