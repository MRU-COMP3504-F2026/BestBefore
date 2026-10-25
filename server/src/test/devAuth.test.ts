import request from 'supertest'
import { app } from '../app.js'
import { DEV_USER } from '../auth/devAuth.js'

describe('GET /api/me with VITE_DISABLE_AUTH', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the dev user without a token', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')

    const response = await request(app).get('/api/me')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ user: DEV_USER })
  })

  it('is ignored in production', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const response = await request(app).get('/api/me')

    expect(response.status).toBe(401)
  })

  it('is ignored on Vercel', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    vi.stubEnv('VERCEL', '1')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const response = await request(app).get('/api/me')

    expect(response.status).toBe(401)
  })
})
