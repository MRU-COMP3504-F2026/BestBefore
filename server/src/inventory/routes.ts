import express from 'express'
import { asc, eq } from 'drizzle-orm'
import { requireAuth } from '../auth/requireAuth.js'
import { db } from '../db/index.js'
import { inventoryItems } from '../db/schema.js'
import { z } from 'zod'

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

// Same fields as the Add Item form. The server decides userId, never the client.
const newItemSchema = z.object({
  name: z.string().trim().min(1).max(255),
  brand: z.string().trim().max(255).optional(),
  barcode: z.string().trim().max(64).optional(),
  quantity: z.number().int().min(1),
  purchaseDate: z.string().date(), // YYYY-MM-DD
  bestBeforeDate: z.string().date(), // the form calls this bestBefore; the API sends bestBeforeDate
})

// Saves one item for the signed-in user.
inventoryRouter.post('/', requireAuth, async (req, res) => {
  // Validate again on the server: never trust what the browser sends.
  const parsed = newItemSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid item.' })
  }
  const input = parsed.data

  try {
    const [item] = await db
      .insert(inventoryItems)
      .values({
        userId: res.locals.user!.id, // from the verified JWT, not the request body
        name: input.name,
        brand: input.brand ?? null,
        barcode: input.barcode ?? null,
        quantity: input.quantity,
        purchaseDate: input.purchaseDate,
        bestBefore: input.bestBeforeDate, // map the API name to the column name
      })
      .returning({ id: inventoryItems.id })

    res.status(201).json({ id: item.id })
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    console.error(`Inventory create failed: ${err instanceof Error ? err.message : err}${cause}`)
    res.status(500).json({ error: "Couldn't save your item. Please try again." })
  }
})