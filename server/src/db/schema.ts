import { sql } from 'drizzle-orm'
import { check, date, index, integer, jsonb, pgSchema, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { FinalRecord } from '../../../testscripts/normalizer.js'
import type { ShelfLife } from '../food/expirySuggestion.js'
import type { PhotoProduct } from '../food/photoItems.js'

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

// One row per shared product, used by every user, so it holds no owner. `payload` is the
// normalizer's FINAL record, never flattened, or a product a user confirmed from an AI Vision photo
// (source 'AI Vision'). Each row has exactly one key: `barcode`, the GTIN-14 form from
// canonicalBarcode, or for a photo saved without a barcode, `photo_key`, the confirmed name, brand
// and category folded together (photoKey in food/photoItems.ts). `photo_alias` is the folded name
// Gemini gave the photo, so a later photo of the same food can find what someone confirmed.
// `expiry_suggestion` is how long the product keeps, never a date, and null until the engine finds
// a real match.
export const items = pgTable(
  'items',
  {
    id: serial('id').primaryKey(),
    barcode: text('barcode').unique('items_barcode_unique'),
    photoKey: text('photo_key').unique('items_photo_key_unique'),
    photoAlias: text('photo_alias'),
    payload: jsonb('payload').$type<FinalRecord | PhotoProduct>().notNull(),
    expirySuggestion: jsonb('expiry_suggestion').$type<ShelfLife>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('items_barcode_gtin14_check', sql`${table.barcode} ~ '^[0-9]{14}$'`),
    check('items_one_key_check', sql`(${table.barcode} IS NULL) <> (${table.photoKey} IS NULL)`),
    index('items_photo_alias_idx').on(table.photoAlias),
  ],
)
