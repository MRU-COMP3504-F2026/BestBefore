import './env.js'
import express from 'express'
import cors from 'cors'
import { requireAuth } from './auth/requireAuth.js'
import { neonAuthWebhook } from './auth/webhook.js'
import { photoRouter } from './food/photoRoutes.js'
import { foodRouter } from './food/routes.js'
import { inventoryRouter } from './inventory/routes.js'
import { MAX_PHOTO_DATA_URL_LENGTH } from './inventory/itemImages.js'

// The photo plus the rest of the item.
const INVENTORY_BODY_LIMIT = MAX_PHOTO_DATA_URL_LENGTH + 16 * 1024

export const app = express()

app.use(cors())

// Before express.json(): webhook signatures are verified against the raw body.
app.post('/api/webhooks/neon-auth', express.raw({ type: '*/*' }), neonAuthWebhook)

// An add-item save can carry an AI Vision still, so it gets a larger limit than everything else.
app.use('/api/inventory', express.json({ limit: INVENTORY_BODY_LIMIT }))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
  })
})

app.get('/api/me', requireAuth, (_req, res) => {
  res.json({ user: res.locals.user })
})

app.use('/api/food/photo', photoRouter)
app.use('/api/food', foodRouter)
app.use('/api/inventory', inventoryRouter)
