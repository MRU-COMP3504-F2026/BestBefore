// Tests for getApiToken (src/lib/authClient.ts) with auth turned on.
// The Neon Auth SDK is faked, so no real login or server is needed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getApiToken } from '../lib/authClient'
import { fetchInventory } from '../lib/inventoryApi'

const { getSession, token } = vi.hoisted(() => ({ getSession: vi.fn(), token: vi.fn() }))

vi.mock('@neondatabase/auth', () => ({
  createAuthClient: () => ({ getSession, token }),
}))
vi.mock('@neondatabase/auth/react/adapters', () => ({ BetterAuthReactAdapter: () => ({}) }))

// Make sure the dev bypass is off, whatever the local env says.
vi.mock('../lib/devAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/devAuth')>()),
  AUTH_DISABLED: false,
}))

// What the SDK hands back once useSession has filled its cache: the JWT lives on session.token
// and there is no top-level token. token() returns this same shape from the cache.
const cachedSession = {
  session: { id: 'session-1', userId: 'user-1', token: 'jwt-from-session' },
  user: { id: 'user-1', email: 'a@b.com', name: 'a' },
}

describe('getApiToken', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    token.mockResolvedValue({ data: cachedSession, error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns the JWT from the cached session', async () => {
    getSession.mockResolvedValue({ data: cachedSession, error: null })

    await expect(getApiToken()).resolves.toBe('jwt-from-session')
  })

  it('returns null when there is no session', async () => {
    getSession.mockResolvedValue({ data: null, error: null })

    await expect(getApiToken()).resolves.toBeNull()
  })

  it('returns null when the session lookup fails', async () => {
    getSession.mockResolvedValue({ data: null, error: { status: 401, message: 'Unauthorized' } })

    await expect(getApiToken()).resolves.toBeNull()
  })

  it('sends the session JWT as a bearer token when loading the inventory', async () => {
    getSession.mockResolvedValue({ data: cachedSession, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await fetchInventory()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/inventory')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-from-session' })
  })

  it('sends no Authorization header when signed out', async () => {
    getSession.mockResolvedValue({ data: null, error: null })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))

    await expect(fetchInventory()).rejects.toMatchObject({ status: 401 })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers).not.toHaveProperty('Authorization')
  })
})
