import { pgTable, serial, text, timestamp, date, uuid, pgSchema, index, integer, primaryKey } from 'drizzle-orm/pg-core';

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

// 1. Restore Neon Auth schema block
const neonAuth = pgSchema('neon_auth');
export const authUsers = neonAuth.table('user', {
  id: uuid('id').primaryKey(),
  name: text('name'),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }),
}, (table) => {
  return {
    emailIdx: index('user_email_idx').on(table.email),
    createdAtIdx: index('user_created_at_idx').on(table.createdAt),
  };
});

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


// Associative table with UUID userId referencing authUsers
export const householdMembers = pgTable('household_members', {
  householdId: uuid('household_id').notNull().references(() => households.householdId, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }), // Add reference here!
  role: text('role').notNull().default('member'),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.householdId, t.userId] }),
}));

