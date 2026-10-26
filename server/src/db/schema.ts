import { date, index, integer, pgSchema, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// Neon Auth owns users and sessions in the `neon_auth` schema. App tables live in
// `public` and should reference users by `neon_auth.user.id` only.

// Only declared so foreign keys can point at it. Not exported, so drizzle-kit never
// tries to create or migrate it.
const authUsers = pgSchema('neon_auth').table('user', {
  id: uuid('id').primaryKey(),
})

// Sign-ups allowed by the Neon Auth `user.before_create` webhook, for per-IP rate limiting.
export const signupAttempts = pgTable(
  'signup_attempts',
  {
    id: serial('id').primaryKey(),
    ipHash: text('ip_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('signup_attempts_ip_hash_created_at_idx').on(table.ipHash, table.createdAt)],
)

// One row per food item in a user's inventory.
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    brand: text('brand'),
    barcode: text('barcode'),
    category: text('category'),
    quantity: integer('quantity').notNull().default(1),
    unit: text('unit'),
    purchaseDate: date('purchase_date').notNull(),
    bestBefore: date('best_before').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('inventory_items_user_id_best_before_idx').on(table.userId, table.bestBefore)],
)
