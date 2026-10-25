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

  it('applies on Vercel preview deployments', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    vi.stubEnv('VERCEL_ENV', 'preview')

    const response = await request(app).get('/api/me')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ user: DEV_USER })
  })

  it('is ignored on Vercel production', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const response = await request(app).get('/api/me')

    expect(response.status).toBe(401)
  })
})
