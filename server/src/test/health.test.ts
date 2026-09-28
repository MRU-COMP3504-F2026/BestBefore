import request from 'supertest'
import { app } from '../app.js'

describe('GET /api/health', () => {
  it('returns API health status', async () => {
    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      status: 'ok',
    })
  })
})
