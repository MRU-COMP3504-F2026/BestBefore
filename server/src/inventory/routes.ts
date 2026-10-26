import express from 'express'
import { asc, eq } from 'drizzle-orm'
import { requireAuth } from '../auth/requireAuth.js'
import { db } from '../db/index.js'
import { inventoryItems } from '../db/schema.js'

export const inventoryRouter = express.Router()

// The signed-in user's items, soonest best-before first.
inventoryRouter.get('/', requireAuth, async (_req, res) => {
  try {
    const items = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        brand: inventoryItems.brand,
        barcode: inventoryItems.barcode,
        category: inventoryItems.category,
        quantity: inventoryItems.quantity,
        unit: inventoryItems.unit,
        purchaseDate: inventoryItems.purchaseDate,
        bestBefore: inventoryItems.bestBefore,
        createdAt: inventoryItems.createdAt,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.userId, res.locals.user!.id))
      .orderBy(asc(inventoryItems.bestBefore), asc(inventoryItems.id))

    res.json({ items })
  } catch (err) {
    // Drizzle's message is only the SQL; the Postgres reason is on `cause`.
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    console.error(`Inventory list failed: ${err instanceof Error ? err.message : err}${cause}`)
    res.status(500).json({ error: "Couldn't load your items. Please try again." })
  }
})
