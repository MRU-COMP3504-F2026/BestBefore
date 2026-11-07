import express from 'express'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireAuth } from '../auth/requireAuth.js'
import { db } from '../db/index.js'
import { inventoryItems } from '../db/schema.js'

export const inventoryRouter = express.Router()

// What every route returns for an item. Never includes the owner.
const ITEM_COLUMNS = {
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
}

// A blank optional field is stored as null, not as an empty string.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null)

// The owner is never read from the body: it always comes from the session.
const newItemSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    brand: optionalText(200),
    barcode: optionalText(32),
    category: optionalText(100),
    // A count of items, not a package size such as "400 g".
    quantity: z.number().int().min(1).max(10_000),
    purchaseDate: z.iso.date(),
    bestBefore: z.iso.date(),
  })
  // ISO dates (YYYY-MM-DD) compare correctly as strings.
  .refine((item) => item.bestBefore >= item.purchaseDate, {
    message: 'Best before date is before the purchase date',
    path: ['bestBefore'],
  })

// The signed-in user's items, soonest best-before first.
inventoryRouter.get('/', requireAuth, async (_req, res) => {
  try {
    const items = await db
      .select(ITEM_COLUMNS)
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

// Adds one item for the signed-in user and returns the row that was actually saved.
inventoryRouter.post('/', requireAuth, async (req, res) => {
  const parsed = newItemSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "That item isn't valid. Check the details and try again." })
    return
  }

  try {
    const [item] = await db
      .insert(inventoryItems)
      .values({ ...parsed.data, userId: res.locals.user!.id })
      .returning(ITEM_COLUMNS)

    res.status(201).json({ item })
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    console.error(`Inventory add failed: ${err instanceof Error ? err.message : err}${cause}`)
    res.status(500).json({ error: "Couldn't save your item. Please try again." })
  }
})
