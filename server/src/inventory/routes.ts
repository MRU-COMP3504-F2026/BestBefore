import express from 'express'
import { and, asc, eq, isNotNull, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { withFoodName } from '../../../testscripts/normalizer.js'
import { requireAuth } from '../auth/requireAuth.js'
import { db } from '../db/index.js'
import { inventoryItems } from '../db/schema.js'
import { appCategory, suggestionFromShelfLife, type ExpirySuggestion } from '../food/expirySuggestion.js'
import { describesRecord, findItem, rememberPhotoItem } from '../food/items.js'
import { isShareableText, isValidGtin, photoProduct, verifyPhotoProvenance } from '../food/photoItems.js'
import { ItemImageError, itemImageColumns, MAX_IMAGE_URL_LENGTH, MAX_PHOTO_DATA_URL_LENGTH } from './itemImages.js'

export const inventoryRouter = express.Router()

// What every route returns for an item. Never includes the owner, or the photo's bytes: those are
// only sent by GET /:id/photo.
const ITEM_COLUMNS = {
  id: inventoryItems.id,
  name: inventoryItems.name,
  brand: inventoryItems.brand,
  barcode: inventoryItems.barcode,
  category: inventoryItems.category,
  quantity: inventoryItems.quantity,
  unit: inventoryItems.unit,
  purchaseDate: inventoryItems.purchaseDate,
  bestBefore: inventoryItems.bestBefore,
  imageSource: inventoryItems.imageSource,
  imageUrl: inventoryItems.imageUrl,
  createdAt: inventoryItems.createdAt,
}

// A blank optional field is stored as null, not as an empty string.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null)

// The owner is never read from the body: it always comes from the session.
const newItemSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    brand: optionalText(200),
    barcode: optionalText(32),
    category: optionalText(100),
    // A count of items, not a package size such as "400 g".
    quantity: z.number().int().min(1).max(10_000),
    purchaseDate: z.iso.date(),
    bestBefore: z.iso.date(),
    // From POST /api/food/identify, sent only by an add form AI Vision filled. Never stored.
    photoToken: z.string().max(1000).optional(),
    // The product image the barcode lookup returned, or the AI Vision still as a JPEG data URL.
    // Checked and turned into columns by itemImageColumns, never stored as sent.
    imageUrl: z.string().max(MAX_IMAGE_URL_LENGTH).nullish(),
    photo: z.string().max(MAX_PHOTO_DATA_URL_LENGTH).nullish(),
  })
  // ISO dates (YYYY-MM-DD) compare correctly as strings.
  .refine((item) => item.bestBefore >= item.purchaseDate, {
    message: 'Best before date is before the purchase date',
    path: ['bestBefore'],
  })
  .refine((item) => !(item.imageUrl && item.photo), { message: 'An item has one picture', path: ['photo'] })

// What an edit may change. Only the user's own copy: barcode and picture stay as saved, and the
// shared items row is never touched. Unknown keys, the owner and id among them, are dropped.
const editItemSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    brand: optionalText(200),
    category: optionalText(100),
    quantity: z.number().int().min(1).max(10_000),
    purchaseDate: z.iso.date(),
    bestBefore: z.iso.date(),
  })
  .refine((item) => item.bestBefore >= item.purchaseDate, {
    message: 'Best before date is before the purchase date',
    path: ['bestBefore'],
  })

// A route id, or null for anything that can't be one.
function itemId(raw: unknown): number | null {
  const id = Number(raw)
  return Number.isSafeInteger(id) && id >= 1 ? id : null
}

const NO_SAVED_SHELF_LIFE = 'No saved suggestion for this item. Check the package and enter the date.'

// The signed-in user's items, soonest best-before first.
inventoryRouter.get('/', requireAuth, async (_req, res) => {
  try {
    const items = await db
      .select(ITEM_COLUMNS)
      .from(inventoryItems)
      .where(eq(inventoryItems.userId, res.locals.user!.id))
      .orderBy(asc(inventoryItems.bestBefore), asc(inventoryItems.id))

    res.json({ items })
  } catch (err) {
    // Drizzle's message is only the SQL; the Postgres reason is on `cause`.
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    console.error(`Inventory list failed: ${err instanceof Error ? err.message : err}${cause}`)
    res.status(500).json({ error: "Couldn't load your items. Please try again." })
  }
})

// What happened to the shared product for a save AI Vision filled. 'saved' and 'exists' mean the
// items table has it; the others mean nothing was written. 'bad-barcode' is a code that fails its
// check digit, 'private-text' a name or brand that may be the user's own note.
type PhotoCatalog = 'saved' | 'exists' | 'unverified' | 'bad-barcode' | 'private-text' | 'failed'

// Adds one item for the signed-in user and returns the row that was actually saved.
// A save AI Vision filled may also share the product: under the barcode the user typed, so the next
// scan of that code finds it, or with no barcode under its name, brand and category, so a later photo
// can offer it (see photoItems.ts). That only ever happens after this user's own row is saved, and
// never fails it: the neon-http driver has no interactive transactions, so the two writes are
// ordered, and a failed share is reported as `catalog` on the 201 instead.
inventoryRouter.post('/', requireAuth, async (req, res) => {
  const parsed = newItemSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "That item isn't valid. Check the details and try again." })
    return
  }
  const { photoToken, imageUrl, photo, ...values } = parsed.data
  const userId = res.locals.user!.id

  let image
  try {
    image = await itemImageColumns(values.barcode, { imageUrl, photo })
  } catch (err) {
    if (!(err instanceof ItemImageError)) throw err
    res.status(400).json({ error: `${err.message} Try again without it.` })
    return
  }

  let item
  try {
    // One insert, so a failed save never leaves a picture behind.
    ;[item] = await db
      .insert(inventoryItems)
      .values({ ...values, ...image, userId })
      .returning(ITEM_COLUMNS)
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    console.error(`Inventory add failed: ${err instanceof Error ? err.message : err}${cause}`)
    res.status(500).json({ error: "Couldn't save your item. Please try again." })
    return
  }

  if (photoToken === undefined) {
    res.status(201).json({ item })
    return
  }

  // Built from the row as saved, so it holds only what the user confirmed, and only product facts.
  const provenance = verifyPhotoProvenance(photoToken, userId)
  let catalog: PhotoCatalog
  if (!provenance) catalog = 'unverified'
  else if (item.barcode !== null && !isValidGtin(item.barcode)) catalog = 'bad-barcode'
  else if (!isShareableText(item.name) || !isShareableText(item.brand)) catalog = 'private-text'
  else catalog = (await rememberPhotoItem(photoProduct(item.barcode, item), provenance.alias)) ?? 'failed'

  res.status(201).json({ item, catalog })
})

// The AI Vision still saved with one of the signed-in user's items. 404 for anyone else's item, as
// for a missing one, so ids can't be probed.
inventoryRouter.get('/:id/photo', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(404).json({ error: 'No photo for this item.' })
    return
  }

  try {
    const [row] = await db
      .select({ photo: inventoryItems.photo, photoType: inventoryItems.photoType })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, id),
          eq(inventoryItems.userId, res.locals.user!.id),
          isNotNull(inventoryItems.photo),
        ),
      )

    if (!row?.photo || !row.photoType) {
      res.status(404).json({ error: 'No photo for this item.' })
      return
    }
    res
      .status(200)
      .set({
        'Content-Type': row.photoType,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(row.photo)
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    console.error(`Inventory photo read failed: ${err instanceof Error ? err.message : err}${cause}`)
    res.status(500).json({ error: "Couldn't load this photo." })
  }
})

// Saves the signed-in user's edits to one of their own items and returns the row as stored. Only
// inventory_items is written, and only the row this user owns: 404 for anyone else's, as for a
// missing one, so ids can't be probed.
inventoryRouter.patch('/:id', requireAuth, async (req, res) => {
  const id = itemId(req.params.id)
  const parsed = editItemSchema.safeParse(req.body)
  if (id === null) {
    res.status(404).json({ error: 'Item not found.' })
    return
  }
  if (!parsed.success) {
    res.status(400).json({ error: "That item isn't valid. Check the details and try again." })
    return
  }

  try {
    const [item] = await db
      .update(inventoryItems)
      .set(parsed.data)
      .where(and(eq(inventoryItems.id, id), eq(inventoryItems.userId, res.locals.user!.id)))
      .returning(ITEM_COLUMNS)

    if (!item) {
      res.status(404).json({ error: 'Item not found.' })
      return
    }
    res.json({ item })
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    console.error(`Inventory edit failed: ${err instanceof Error ? err.message : err}${cause}`)
    res.status(500).json({ error: "Couldn't save your changes. Please try again." })
  }
})

// Deletes one of the signed-in user's items. Only inventory_items is written, and only the row this
// user owns: the shared items row stays for everyone else's scans. 404 for anyone else's item, as
// for a missing one, so ids can't be probed.
inventoryRouter.delete('/:id', requireAuth, async (req, res) => {
  const id = itemId(req.params.id)
  if (id === null) {
    res.status(404).json({ error: 'Item not found.' })
    return
  }

  try {
    const [item] = await db
      .delete(inventoryItems)
      .where(and(eq(inventoryItems.id, id), eq(inventoryItems.userId, res.locals.user!.id)))
      .returning({ id: inventoryItems.id })

    if (!item) {
      res.status(404).json({ error: 'Item not found.' })
      return
    }
    res.json({ id: item.id })
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    console.error(`Inventory delete failed: ${err instanceof Error ? err.message : err}${cause}`)
    res.status(500).json({ error: "Couldn't delete your item. Please try again." })
  }
})


// Most items one request may remove.
const MAX_BULK_DELETE = 500

// A list of item ids. The upper id bound is the largest value a Postgres integer holds, so an
// oversized number is a 400 here rather than a database error.
const bulkDeleteSchema = z.object({
  ids: z.array(z.number().int().min(1).max(2_147_483_647)).min(1).max(MAX_BULK_DELETE),
})

// Deletes several of the signed-in user's items in one statement and returns the ids actually
// removed. Ids that are missing or belong to someone else are skipped, not an error, so they
// can't be probed. Only inventory_items is written, as for a single delete.
inventoryRouter.delete('/', requireAuth, async (req, res) => {
  const parsed = bulkDeleteSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose at least one item to remove.' })
    return
  }
  const ids = [...new Set(parsed.data.ids)]

  try {
    const removed = await db
      .delete(inventoryItems)
      .where(and(inArray(inventoryItems.id, ids), eq(inventoryItems.userId, res.locals.user!.id)))
      .returning({ id: inventoryItems.id })

    res.json({ ids: removed.map((row) => row.id) })
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    console.error(`Inventory bulk delete failed: ${err instanceof Error ? err.message : err}${cause}`)
    res.status(500).json({ error: "Couldn't remove your items. Please try again." })
  }
})

// A best-before suggestion for one of the signed-in user's items bought on ?purchaseDate, from the
// shelf life already saved for its barcode. Read only: no engine, no Gemini and no write, so an edit
// never changes the shared row. No saved shelf life, or one the item no longer describes, is an
// honest 'none' rather than a fresh guess.
inventoryRouter.get('/:id/expiry-suggestion', requireAuth, async (req, res) => {
  const id = itemId(req.params.id)
  const purchaseDate = z.iso.date().safeParse(req.query.purchaseDate)
  if (id === null) {
    res.status(404).json({ error: 'Item not found.' })
    return
  }
  if (!purchaseDate.success) {
    res.status(400).json({ error: 'Send the date bought as YYYY-MM-DD.' })
    return
  }

  try {
    const [item] = await db
      .select({
        name: inventoryItems.name,
        brand: inventoryItems.brand,
        barcode: inventoryItems.barcode,
        category: inventoryItems.category,
      })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, id), eq(inventoryItems.userId, res.locals.user!.id)))

    if (!item) {
      res.status(404).json({ error: 'Item not found.' })
      return
    }

    const none: ExpirySuggestion = { status: 'none', message: NO_SAVED_SHELF_LIFE }
    const saved = item.barcode ? await findItem(item.barcode) : null
    if (!saved?.expirySuggestion) {
      res.json(none)
      return
    }

    const input = {
      name: item.name,
      brand: item.brand,
      barcode: item.barcode,
      // Our label as the user saved it, else the one the record's own category maps to.
      category: item.category ?? appCategory(saved.payload.category),
      productCategory: saved.payload.category,
      categoryTags: saved.payload.categoryTags ?? null,
      ingredients: saved.payload.ingredients ?? null,
      purchaseDate: purchaseDate.data,
    }
    // Same rule as the add form: only an item that still describes the saved product reuses it.
    const describes = describesRecord(withFoodName(saved.payload), input) || describesRecord(saved.payload, input)
    res.json((describes && suggestionFromShelfLife(input, saved.expirySuggestion)) || none)
  } catch (err) {
    console.error(`Inventory expiry suggestion failed: ${err instanceof Error ? err.message : err}`)
    res.status(500).json({ error: "Couldn't get a suggested date." })
  }
})
