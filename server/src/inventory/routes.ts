import express from 'express'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { requireAuth } from '../auth/requireAuth.js'
import { db } from '../db/index.js'
import { inventoryItems } from '../db/schema.js'
import { rememberPhotoItem } from '../food/items.js'
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
