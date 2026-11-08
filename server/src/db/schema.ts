import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
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

// Raw bytes. Both drivers take a Buffer as a bytea parameter (neon sends it as hex). Read back as a
// Buffer (neon), a Uint8Array (PGlite) or hex text, each turned into a Buffer.
const bytea = customType<{ data: Buffer; driverData: string | Uint8Array }>({
  dataType: () => 'bytea',
  toDriver: (value) => value,
  fromDriver: (value) =>
    typeof value === 'string' ? Buffer.from(value.replace(/^\\x/, ''), 'hex') : Buffer.from(value),
})

// Largest AI Vision photo an item keeps, in bytes. The client's still is far smaller.
export const MAX_ITEM_PHOTO_BYTES = 768 * 1024

// One row per food item in a user's inventory. An item has at most one picture: `image_url` is the
// product photo a barcode lookup returned (only ever linked, never downloaded), and `photo` is the
// user's own AI Vision still. The photo lives here, on the owner's row, and never in shared `items`.
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
    imageSource: text('image_source').$type<'product' | 'photo'>(),
    imageUrl: text('image_url'),
    photo: bytea('photo'),
    photoType: text('photo_type'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('inventory_items_user_id_best_before_idx').on(table.userId, table.bestBefore),
    // Either no picture, a product URL, or a bounded photo with its type. Never both.
    check(
      'inventory_items_image_check',
      sql`(${table.imageSource} is null and ${table.imageUrl} is null and ${table.photo} is null and ${table.photoType} is null)
        or (${table.imageSource} = 'product' and ${table.imageUrl} is not null and ${table.photo} is null and ${table.photoType} is null)
        or (${table.imageSource} = 'photo' and ${table.imageUrl} is null and ${table.photo} is not null and ${table.photoType} is not null
          and octet_length(${table.photo}) <= ${sql.raw(String(MAX_ITEM_PHOTO_BYTES))})`,
    ),
  ],
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
