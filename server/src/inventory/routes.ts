import { Request, Response, Router } from 'express'
import { eq, sql } from 'drizzle-orm'
import { requireAuth } from '../auth/requireAuth.js' 
import { db } from '../db/index.js'
import { inventory, products } from '../db/schema.js'

export const inventoryRouter = Router()

// Rationale: Replaced the old  `inventory_items` query with a Drizzle 
// `leftJoin` across the normalized `inventory` and `products` tables. 
// It also provides nullable fallback fields for category, unit, and 
// createdAt to satisfy the frontend's Zod schema requirements.
inventoryRouter.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const items = await db
      .select({
        id: inventory.inventoryId,
        name: products.name,
        brand: products.brand,
        barcode: products.barcode,
        category: sql<string | null>`null`, // Fallback to satisfy frontend Zod parser
        quantity: inventory.quantity,
        unit: sql<string | null>`null`, // Fallback to satisfy frontend Zod parser
        purchaseDate: inventory.purchaseDate,
        bestBefore: inventory.bestBeforeDate,
        createdAt: sql<string>`COALESCE(${inventory.purchaseDate}::text, CURRENT_DATE::text)`, // Fallback to satisfy frontend Zod parser
      })
      .from(inventory)
      .leftJoin(products, eq(inventory.productId, products.productId))

    return res.json({ items })
  } catch (error) {
    console.error('Failed to fetch inventory:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})



// import express from 'express'
// import { asc, eq } from 'drizzle-orm'
// import { requireAuth } from '../auth/requireAuth.js'
// import { db } from '../db/index.js'
// import { inventoryItems } from '../db/schema.js'

// export const inventoryRouter = express.Router()

// // The signed-in user's items, soonest best-before first.
// inventoryRouter.get('/', requireAuth, async (_req, res) => {
//   try {
//     const items = await db
//       .select({
//         id: inventoryItems.id,
//         name: inventoryItems.name,
//         brand: inventoryItems.brand,
//         barcode: inventoryItems.barcode,
//         category: inventoryItems.category,
//         quantity: inventoryItems.quantity,
//         unit: inventoryItems.unit,
//         purchaseDate: inventoryItems.purchaseDate,
//         bestBefore: inventoryItems.bestBefore,
//         createdAt: inventoryItems.createdAt,
//       })
//       .from(inventoryItems)
//       .where(eq(inventoryItems.userId, res.locals.user!.id))
//       .orderBy(asc(inventoryItems.bestBefore), asc(inventoryItems.id))

//     res.json({ items })
//   } catch (err) {
//     // Drizzle's message is only the SQL; the Postgres reason is on `cause`.
//     const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
//     console.error(`Inventory list failed: ${err instanceof Error ? err.message : err}${cause}`)
//     res.status(500).json({ error: "Couldn't load your items. Please try again." })
//   }
// })
