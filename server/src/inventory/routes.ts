import { Request, Response, Router } from 'express'
import { eq, asc } from 'drizzle-orm'
import { requireAuth } from '../auth/requireAuth.js' 
import { db } from '../db/index.js'
import { inventory, products, householdMembers } from '../db/schema.js'

export const inventoryRouter = Router()

// Rationale: Replaced the old  `inventory_items` query with a Drizzle 
// `leftJoin` across the normalized `inventory` and `products` tables. 
// It also provides nullable fallback fields for category, unit, and 
// createdAt to satisfy the frontend's Zod schema requirements.
inventoryRouter.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const items = await db
      .select({
        inventoryId: inventory.inventoryId,
        householdId: inventory.householdId,
        quantity: inventory.quantity,
        purchaseDate: inventory.purchaseDate,
        bestBeforeDate: inventory.bestBeforeDate,
        product: {
          productId: products.productId,
          name: products.name,
          brand: products.brand,
          barcode: products.barcode,
      },
      })
      .from(inventory)
      .leftJoin(products, eq(inventory.productId, products.productId))
      .innerJoin(householdMembers, eq(householdMembers.householdId, inventory.householdId))
      .where(eq(householdMembers.userId, res.locals.user!.id))
      .orderBy(asc(inventory.bestBeforeDate), asc(inventory.inventoryId));

    return res.json({ items })
  } catch (err) {
    // Drizzle's message is only the SQL; the Postgres reason is on `cause`.
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    console.error(`Inventory list failed: ${err instanceof Error ? err.message : err}${cause}`)
    res.status(500).json({ error: "Couldn't load your items. Please try again." })
  }
})

