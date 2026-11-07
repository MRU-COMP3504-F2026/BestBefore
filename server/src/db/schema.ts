import { sql } from 'drizzle-orm'
import { check, date, index, integer, jsonb, pgSchema, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { FinalRecord } from '../../../testscripts/normalizer.js'
import type { ShelfLife } from '../food/expirySuggestion.js'

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

// One row per looked-up product, shared by every user, so it holds no owner. `payload` is the
// normalizer's FINAL record, never flattened. `barcode` is the GTIN-14 form from canonicalBarcode.
// `expiry_suggestion` is how long the product keeps, never a date, and null until the engine finds
// a real match.
export const items = pgTable(
  'items',
  {
    barcode: text('barcode').primaryKey(),
    payload: jsonb('payload').$type<FinalRecord>().notNull(),
    expirySuggestion: jsonb('expiry_suggestion').$type<ShelfLife>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('items_barcode_gtin14_check', sql`${table.barcode} ~ '^[0-9]{14}$'`)],
)
