import './env.js'
import express from 'express'
import cors from 'cors'
import { requireAuth } from './auth/requireAuth.js'
import { neonAuthWebhook } from './auth/webhook.js'
import { foodRouter } from './food/routes.js'
import { inventoryRouter } from './inventory/routes.js'
import { productRouter } from './products/routes.js'

export const app = express()

app.use(cors())

// Before express.json(): webhook signatures are verified against the raw body.
app.post('/api/webhooks/neon-auth', express.raw({ type: '*/*' }), neonAuthWebhook)

app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
  })
})

app.get('/api/me', requireAuth, (_req, res) => {
  res.json({ user: res.locals.user })
})

app.use('/api/food', foodRouter)
app.use('/api/inventory', inventoryRouter)

app.use('/api/products', productRouter)