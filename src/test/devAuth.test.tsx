import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RequireAuth from '../components/RequireAuth'
import { getApiToken, signIn, signOut, signUp, useAuthSession } from '../lib/authClient'
import { DEV_USER } from '../lib/devAuth'

vi.mock('../lib/devAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/devAuth')>()),
  AUTH_DISABLED: true,
}))

describe('auth disabled for local dev', () => {
  it('lets protected routes render without signing in', () => {
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

    expect(screen.getByText('Items')).toBeInTheDocument()
  })

  it('reports the dev user as signed in', () => {
    expect(useAuthSession()).toEqual({ data: { user: DEV_USER }, isPending: false })
  })

  it('short-circuits sign in, sign up, sign out and tokens', async () => {
    await expect(signIn('a@b.com', 'pw')).resolves.toEqual({ ok: true })
    await expect(signUp('a@b.com', 'pw')).resolves.toEqual({ ok: true })
    await expect(signOut()).resolves.toEqual({ ok: true })
    await expect(getApiToken()).resolves.toBeNull()
  })
})
