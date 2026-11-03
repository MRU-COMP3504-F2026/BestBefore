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
