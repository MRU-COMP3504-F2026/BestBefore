import request from 'supertest'
import { app } from '../app.js'

describe('GET /api/me', () => {
  it('rejects requests without a token', async () => {
    const response = await request(app).get('/api/me')

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ error: 'Unauthorized' })
  })

  it('rejects a malformed token', async () => {
    const response = await request(app).get('/api/me').set('Authorization', 'Bearer not-a-jwt')

    expect(response.status).toBe(401)
  })
})

describe('POST /api/webhooks/neon-auth', () => {
  it('rejects unsigned webhooks', async () => {
    const response = await request(app)
      .post('/api/webhooks/neon-auth')
      .set('Content-Type', 'application/json')
      .send({ event_type: 'user.before_create', event_data: { ip_address: '192.0.2.1' } })

    expect(response.status).toBe(401)
  })
})
