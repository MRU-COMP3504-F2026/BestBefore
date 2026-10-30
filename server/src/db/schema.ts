import { pgTable, serial, text, date, integer, index, timestamp } from 'drizzle-orm/pg-core'

// Neon Auth owns users and sessions in the `neon_auth` schema. App tables live in
// `public` and should reference users by `neon_auth.user.id` only.

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

// Stores application users
// Changed from inventory items to match the core legacy user table 
// in the Neon database.
export const users = pgTable('users', {
  userId: serial('user_id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  password: text('password').notNull(),
})

// Stores household groups
// Added to support household group mapping from the legacy SENG specification.
export const households = pgTable('households', {
  householdId: serial('household_id').primaryKey(),
  name: text('name').notNull(),
})

// Stores catalog product details
// Added to normalize catalog product information (name, brand, barcode) 
// separate from individual inventory instances.
export const products = pgTable('products', {
  productId: serial('product_id').primaryKey(),
  name: text('name').notNull(),
  barcode: text('barcode'),
  brand: text('brand'),
})

// Stores individual inventory records linked to products and households
// Replaced the old `inventory_items` table to reference normalized 
// products and households via foreign keys (productId, householdId).
export const inventory = pgTable('inventory', {
  inventoryId: serial('inventory_id').primaryKey(),
  productId: integer('product_id').references(() => products.productId),
  householdId: integer('household_id').references(() => households.householdId),
  quantity: integer('quantity').notNull().default(1),
  purchaseDate: date('purchase_date'),
  bestBeforeDate: date('best_before_date'),
})




// import { date, index, integer, pgSchema, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// // Neon Auth owns users and sessions in the `neon_auth` schema. App tables live in
// // `public` and should reference users by `neon_auth.user.id` only.

// // Only declared so foreign keys can point at it. Not exported, so drizzle-kit never
// // tries to create or migrate it.
// const authUsers = pgSchema('neon_auth').table('user', {
//   id: uuid('id').primaryKey(),
// })

// // Sign-ups allowed by the Neon Auth `user.before_create` webhook, for per-IP rate limiting.
// export const signupAttempts = pgTable(
//   'signup_attempts',
//   {
//     id: serial('id').primaryKey(),
//     ipHash: text('ip_hash').notNull(),
//     createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
//   },
//   (table) => [index('signup_attempts_ip_hash_created_at_idx').on(table.ipHash, table.createdAt)],
// )

// // One row per food item in a user's inventory.
// export const inventoryItems = pgTable(
//   'inventory_items',
//   {
//     id: serial('id').primaryKey(),
//     userId: uuid('user_id')
//       .notNull()
//       .references(() => authUsers.id, { onDelete: 'cascade' }),
//     name: text('name').notNull(),
//     brand: text('brand'),
//     barcode: text('barcode'),
//     category: text('category'),
//     quantity: integer('quantity').notNull().default(1),
//     unit: text('unit'),
//     purchaseDate: date('purchase_date').notNull(),
//     bestBefore: date('best_before').notNull(),
//     createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
//   },
//   (table) => [index('inventory_items_user_id_best_before_idx').on(table.userId, table.bestBefore)],
// )
