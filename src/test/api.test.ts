// Tests for apiFetch (src/lib/api.ts), the helper that sends requests to our backend.
// We use fake versions of the login token and fetch, so no real server or login is needed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../lib/api'
import { getApiToken } from '../lib/authClient'

// Fake login token. Each test picks what it returns.
vi.mock('../lib/authClient', () => ({
  getApiToken: vi.fn(),
}))

const mockedGetApiToken = vi.mocked(getApiToken)

// Makes a fake server response.
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiFetch', () => {
  // Fake fetch. It remembers how it was called.
  const fetchMock = vi.fn()

  // Use the fake fetch in every test.
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  // Reset everything after each test.
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  // Logged in: adds /api, sends the token, and returns the data.
  it('prefixes the path with /api, sends the bearer token, and returns parsed JSON', async () => {
    mockedGetApiToken.mockResolvedValue('test-token')
    fetchMock.mockResolvedValue(jsonResponse({ items: [1, 2] }))

    const data = await apiFetch<{ items: number[] }>('/inventory')

    expect(data).toEqual({ items: [1, 2] })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Check what was sent to fetch.
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/inventory')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    })
  })

  // Not logged in: no Authorization header is sent.
  it('omits the Authorization header when there is no token', async () => {
    mockedGetApiToken.mockResolvedValue(null)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await apiFetch('/me')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  // Extra options (method, body, headers) get passed along.
  it('passes through request options and lets caller headers override defaults', async () => {
    mockedGetApiToken.mockResolvedValue('test-token')
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }))

    await apiFetch('/inventory', {
      method: 'POST',
      body: JSON.stringify({ name: 'Milk' }),
      headers: { 'Content-Type': 'text/plain' },
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"name":"Milk"}')
    expect(init.headers['Content-Type']).toBe('text/plain')
    expect(init.headers.Authorization).toBe('Bearer test-token')
  })

  // Server error: apiFetch throws an error.
  it('throws with the status code when the response is not ok', async () => {
    mockedGetApiToken.mockResolvedValue('test-token')
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 401))

    await expect(apiFetch('/inventory')).rejects.toThrow('API request failed: 401')
  })

  it('keeps the status and the server message on the error', async () => {
    mockedGetApiToken.mockResolvedValue('test-token')
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 429))

    await expect(apiFetch('/inventory')).rejects.toMatchObject({ status: 429, serverMessage: 'nope' })
  })

  it('still throws when the error body is not JSON', async () => {
    mockedGetApiToken.mockResolvedValue('test-token')
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }))

    await expect(apiFetch('/inventory')).rejects.toMatchObject({ status: 502, serverMessage: undefined })
  })
})