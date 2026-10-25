import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RequireAuth from '../components/RequireAuth'
import { useAuthSession } from '../lib/authClient'

vi.mock('../lib/authClient', () => ({ useAuthSession: vi.fn() }))

type SessionState = ReturnType<typeof useAuthSession>

function renderProtected(session: { data: unknown; isPending: boolean }) {
  vi.mocked(useAuthSession).mockReturnValue(session as SessionState)
  render(
    <MemoryRouter initialEntries={['/items']}>
      <Routes>
        <Route
          path="/items"
          element={
            <RequireAuth>
              <p>Items</p>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<p>Login</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth', () => {
  it('redirects to login when signed out', () => {
    renderProtected({ data: null, isPending: false })

    expect(screen.getByText('Login')).toBeInTheDocument()
    expect(screen.queryByText('Items')).not.toBeInTheDocument()
  })

  it('renders nothing while the session is loading', () => {
    renderProtected({ data: null, isPending: true })

    expect(screen.queryByText('Login')).not.toBeInTheDocument()
    expect(screen.queryByText('Items')).not.toBeInTheDocument()
  })

  it('renders the page when signed in', () => {
    renderProtected({ data: { user: { id: 'u1' } }, isPending: false })

    expect(screen.getByText('Items')).toBeInTheDocument()
  })
})
