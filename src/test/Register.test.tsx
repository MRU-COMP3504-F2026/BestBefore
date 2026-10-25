import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Register from '../pages/Register'
import { signUp } from '../lib/authClient'

vi.mock('../lib/authClient', () => ({ signUp: vi.fn() }))

const TAKEN_EMAIL = 'taken@example.com'

function renderRegister() {
  render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<p>Home</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function fillForm(email: string, password: string, confirmPassword: string) {
  await userEvent.type(screen.getByLabelText('Email'), email)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.type(screen.getByLabelText('Confirm password'), confirmPassword)
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('Register', () => {
  beforeEach(() => {
    vi.mocked(signUp).mockReset()
    vi.mocked(signUp).mockImplementation(async (email) => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return email === TAKEN_EMAIL
        ? { ok: false, error: 'An account with this email already exists' }
        : { ok: true }
    })
  })

  it('shows inline errors when submitted empty', async () => {
    renderRegister()

    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Email is required')).toBeInTheDocument()
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(screen.getByText('Please confirm your password')).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('shows an inline error when passwords do not match', async () => {
    renderRegister()

    await fillForm('you@example.com', 'password123', 'password456')

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
  })

  it('shows a pending state while submitting and then navigates home', async () => {
    renderRegister()

    await fillForm('you@example.com', 'password123', 'password123')

    expect(await screen.findByRole('button', { name: 'Creating account…' })).toBeDisabled()
    expect(await screen.findByText('Home')).toBeInTheDocument()
    expect(signUp).toHaveBeenCalledWith('you@example.com', 'password123')
  })

  it('shows the auth error response', async () => {
    renderRegister()

    await fillForm(TAKEN_EMAIL, 'password123', 'password123')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email already exists',
    )
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })
})
