// Seeds mock inventory for one user: `npm run db:seed [-- <neon user id>]`.
// Defaults to the dev user. Replaces that user's existing items, so it is safe to re-run.
// Dates are relative to today so expired / expiring-soon items stay that way.
import { DEV_USER } from '../auth/devAuth.js'
import { db } from './index.js'
import { inventory, products } from './schema.js'

const DAY_MS = 24 * 60 * 60 * 1000

// YYYY-MM-DD, `days` from today in local time (toISOString would use UTC and can be a day off).
function dayOffset(days: number): string {
  const date = new Date(Date.now() + days * DAY_MS)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export async function seedDatabase(userId: string = DEV_USER.id) {
  console.log(`Seeding products and inventory for user ID: ${userId}...`)

  // 1. Seed catalog products
  const [milk] = await db
    .insert(products)
    .values({
      name: 'Milk 2%',
      brand: 'Dairyland',
      barcode: '0068700011016',
    })
    .returning()

  const [bread] = await db
    .insert(products)
    .values({
      name: 'Whole Wheat Bread',
      brand: 'Wonder',
      barcode: '0061000010011',
    })
    .returning()

  const [apples] = await db
    .insert(products)
    .values({
      name: 'Gala Apples',
      brand: 'Produce',
      barcode: '0000000004131',
    })
    .returning()

  // 2. Insert inventory linked to the products
  await db.insert(inventory).values([
    {
      productId: milk.productId,
      quantity: 1,
      purchaseDate: dayOffset(-3),
      bestBeforeDate: dayOffset(4),
    },
    {
      productId: bread.productId,
      quantity: 2,
      purchaseDate: dayOffset(-1),
      bestBeforeDate: dayOffset(2),
    },
    {
      productId: apples.productId,
      quantity: 5,
      purchaseDate: dayOffset(-5),
      bestBeforeDate: dayOffset(-1),
    },
  ])

  console.log('Database seeded successfully!')
}

// Allow direct CLI execution
if (process.argv[1]?.includes('seed')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}



// // Seeds mock inventory for one user: `npm run db:seed [-- <neon user id>]`.
// // Defaults to the dev user. Replaces that user's existing items, so it is safe to re-run.
// // Dates are relative to today so expired / expiring-soon items stay that way.
// import { eq } from 'drizzle-orm'
// import { DEV_USER } from '../auth/devAuth.js'
// import { db } from './index.js'
// import { inventoryItems } from './schema.js'

// const DAY_MS = 24 * 60 * 60 * 1000

// // YYYY-MM-DD, `days` from today in local time (toISOString would use UTC and can be a day off).
// function dayOffset(days: number): string {
//   const date = new Date(Date.now() + days * DAY_MS)
//   const month = String(date.getMonth() + 1).padStart(2, '0')
//   const day = String(date.getDate()).padStart(2, '0')
//   return `${date.getFullYear()}-${month}-${day}`
// }

// function daysAgo(days: number): Date {
//   return new Date(Date.now() - days * DAY_MS)
// }

// type SeedItem = Omit<typeof inventoryItems.$inferInsert, 'id' | 'userId'>

// const SEED_ITEMS: SeedItem[] = [
//   // Expired
//   {
//     name: 'Milk 2%',
//     brand: 'Dairyland',
//     barcode: '0068700011016',
//     category: 'Dairy',
//     quantity: 1,
//     unit: 'L',
//     purchaseDate: dayOffset(-9),
//     bestBefore: dayOffset(-2),
//     createdAt: daysAgo(9),
//   },
//   // Expires today
//   {
//     name: 'Baby Spinach',
//     brand: 'Earthbound Farm',
//     barcode: '0032601025090',
//     category: 'Produce',
//     quantity: 1,
//     unit: 'bag',
//     purchaseDate: dayOffset(-4),
//     bestBefore: dayOffset(0),
//     createdAt: daysAgo(4),
//   },
//   // Expiring soon
//   {
//     name: 'Large Eggs',
//     brand: 'Burnbrae Farms',
//     barcode: '0062987001125',
//     category: 'Dairy',
//     quantity: 12,
//     unit: 'eggs',
//     purchaseDate: dayOffset(-10),
//     bestBefore: dayOffset(3),
//     createdAt: daysAgo(10),
//   },
//   {
//     name: 'Greek Yogurt',
//     brand: 'Oikos',
//     barcode: '0056800098631',
//     category: 'Dairy',
//     quantity: 4,
//     unit: 'cups',
//     purchaseDate: dayOffset(-2),
//     bestBefore: dayOffset(6),
//     createdAt: daysAgo(2),
//   },
//   // Fresh
//   {
//     name: 'Old Cheddar',
//     brand: 'Black Diamond',
//     barcode: '0064200116459',
//     category: 'Dairy',
//     quantity: 400,
//     unit: 'g',
//     purchaseDate: dayOffset(-1),
//     bestBefore: dayOffset(21),
//     createdAt: daysAgo(1),
//   },
//   // Long shelf life, no barcode (added by hand)
//   {
//     name: 'Diced Tomatoes',
//     brand: null,
//     barcode: null,
//     category: 'Pantry',
//     quantity: 3,
//     unit: 'cans',
//     purchaseDate: dayOffset(-30),
//     bestBefore: dayOffset(365),
//     createdAt: daysAgo(30),
//   },
// ]

// const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// async function main() {
//   if (process.env.VERCEL_ENV === 'production') {
//     throw new Error('Refusing to seed in production.')
//   }

//   const userId = process.argv[2] ?? DEV_USER.id
//   if (!UUID_RE.test(userId)) {
//     throw new Error(`Not a Neon Auth user id: ${userId}`)
//   }

//   await db.delete(inventoryItems).where(eq(inventoryItems.userId, userId))
//   const inserted = await db
//     .insert(inventoryItems)
//     .values(SEED_ITEMS.map((item) => ({ ...item, userId })))
//     .returning({ id: inventoryItems.id, name: inventoryItems.name, bestBefore: inventoryItems.bestBefore })

//   console.log(`Seeded ${inserted.length} items for ${userId}:`)
//   console.table(inserted)
// }

// main().catch((error: unknown) => {
//   console.error(error instanceof Error ? error.message : error)
//   process.exit(1)
// })
