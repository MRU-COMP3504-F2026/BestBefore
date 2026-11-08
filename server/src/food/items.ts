import { and, eq, isNull, sql } from 'drizzle-orm'
import type { FinalRecord } from '../../../testscripts/normalizer.js'
import { db } from '../db/index.js'
import { items } from '../db/schema.js'
import { appCategory, type ExpiryInput, type ShelfLife } from './expirySuggestion.js'
import { isPhotoRecord, PHOTO_SOURCE, photoKey, type PhotoProduct } from './photoItems.js'

// How long a request waits for this table. The scan can always go on without it.
export const ITEM_DB_TIMEOUT_MS = 2000

// The one key for a product however it was scanned: 012345678905 (UPC-A), 0012345678905 (EAN-13)
// and 00012345678905 (GTIN-14) are the same code. Only padding, the way GS1 stores GTINs, so a
// real leading digit stays significant. GS1 keeps UPC prefixes clear of padded EAN-8 codes, so
// those can't collide either.
export function canonicalBarcode(barcode: string): string {
  return barcode.padStart(14, '0')
}

// Never throws: the user still gets their product or date if the table is down or slow. Awaited by
// the routes because a serverless function can stop as soon as it has responded.
async function bestEffort<T>(what: string, work: () => Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)
  })

  try {
    return await Promise.race([work(), timeout])
  } catch (err) {
    // Drizzle's message repeats the whole record; the Postgres reason is on `cause`.
    const reason = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : err
    console.error(`${what} failed: ${reason}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// The saved row for a barcode. Null both for a miss and when the table can't answer, since the
// caller does the same for each: it falls back to the product databases or the engine.
export async function findItem(barcode: string, timeoutMs: number = ITEM_DB_TIMEOUT_MS) {
  return bestEffort(
    `Item read for ${barcode}`,
    async () => {
      const [row] = await db.select().from(items).where(eq(items.barcode, canonicalBarcode(barcode)))
      // Found by its barcode, so it has one.
      return row && row.barcode !== null ? { ...row, barcode: row.barcode } : null
    },
    timeoutMs,
  )
}

// Stores the record as it is. Keyed by the scanned code, because a single-source record's own
// `barcode` is that source's rewrite of it. A lookup where a database failed may be missing data,
// so it only fills an empty slot, never replacing what a complete lookup saved. Neither path
// touches a saved shelf life.
export async function saveItem(barcode: string, product: FinalRecord, complete: boolean) {
  const insert = db.insert(items).values({ barcode: canonicalBarcode(barcode), payload: product })

  await (complete
    ? insert.onConflictDoUpdate({
        target: items.barcode,
        set: { payload: sql`excluded.payload`, updatedAt: sql`now()` },
      })
    : insert.onConflictDoNothing({ target: items.barcode }))
}

export async function rememberItem(
  barcode: string,
  product: FinalRecord,
  complete: boolean,
  timeoutMs: number = ITEM_DB_TIMEOUT_MS,
) {
  await bestEffort(`Item save for ${barcode}`, () => saveItem(barcode, product, complete), timeoutMs)
}

// True when an add-form request is about the saved product itself. The form can be edited and the
// body is the client's, so anything else is one user's own item and stays out of the shared row.
export function describesRecord(product: FinalRecord | PhotoProduct, input: ExpiryInput): boolean {
  return (
    input.name === product.name &&
    input.brand === product.brand &&
    input.productCategory === product.category &&
    input.category === appCategory(product.category)
  )
}

// The shared row outlives this request and answers every other user, so a guess stays out of it.
// A low or tied match can only come from Gemini, and is still shown to the user who asked.
export function isShareable(shelfLife: ShelfLife): boolean {
  return shelfLife.confidence === 'high' || shelfLife.confidence === 'medium'
}

// Keeps how long the product lasts on its row. No row means nothing is written, because there is
// no FINAL record to attach it to. updated_at stays about the payload.
// previous is the value this request read and found missing or unusable. The write only lands while
// the row still holds it, so a refresh never replaces a shelf life another request saved meanwhile.
// Only this one row is ever touched: old rows are refreshed one at a time, as they are asked about.
export async function rememberShelfLife(
  barcode: string,
  shelfLife: ShelfLife,
  previous: unknown = null,
  timeoutMs: number = ITEM_DB_TIMEOUT_MS,
) {
  const unchanged =
    previous === null || previous === undefined
      ? isNull(items.expirySuggestion)
      : sql`${items.expirySuggestion} = ${JSON.stringify(previous)}::jsonb`

  await bestEffort(
    `Shelf life save for ${barcode}`,
    () =>
      db
        .update(items)
        .set({ expirySuggestion: shelfLife })
        .where(and(eq(items.barcode, canonicalBarcode(barcode)), unchanged)),
    timeoutMs,
  )
}

// Shares a product a user confirmed from a photo and has already saved to their inventory, under its
// barcode when it has one, else under its photoKey. Only adds a row: whatever is saved under that key,
// from a database or another photo, is kept. 'saved' when this request wrote it, 'exists' when the
// key was already there, null when the table couldn't answer. Retrying is safe, and the user's own
// item is saved either way. alias is the verified name Gemini gave the photo.
export async function rememberPhotoItem(
  product: PhotoProduct,
  alias: string,
  timeoutMs: number = ITEM_DB_TIMEOUT_MS,
): Promise<'saved' | 'exists' | null> {
  const barcode = product.barcode === null ? null : canonicalBarcode(product.barcode)
  const key = barcode ?? photoKey(product)
  return bestEffort(
    `Photo item save for ${key}`,
    async () => {
      const insert = db.insert(items).values(
        barcode
          ? { barcode, photoAlias: alias, payload: { ...product, barcode } }
          : { photoKey: key, photoAlias: alias, payload: product },
      )
      const written = await insert
        .onConflictDoNothing({ target: barcode ? items.barcode : items.photoKey })
        .returning({ id: items.id })
      return written.length > 0 ? 'saved' : 'exists'
    },
    timeoutMs,
  )
}

// What someone confirmed for a photo Gemini named the same way, for the user to choose or ignore.
// Only barcode-less rows, since a barcode belongs to one package, and only when exactly one product
// was confirmed for this alias: two different answers mean nobody can say which this is.
export async function findPhotoMatch(alias: string, timeoutMs: number = ITEM_DB_TIMEOUT_MS) {
  return bestEffort(
    `Photo match read`,
    async () => {
      const rows = await db
        .select({ payload: items.payload })
        .from(items)
        .where(and(eq(items.photoAlias, alias), isNull(items.barcode)))
        .limit(2)
      return rows.length === 1 && isPhotoRecord(rows[0].payload) ? rows[0].payload : null
    },
    timeoutMs,
  )
}

// A product database's record replaces one a user confirmed from a photo. The shelf life is cleared
// with it, since it was worked out from the photo's name. Only lands while the row is still the
// photo's, so a lookup saved meanwhile is never overwritten.
export async function replacePhotoItem(
  barcode: string,
  product: FinalRecord,
  timeoutMs: number = ITEM_DB_TIMEOUT_MS,
) {
  await bestEffort(
    `Photo item replace for ${barcode}`,
    () =>
      db
        .update(items)
        .set({ payload: product, expirySuggestion: null, updatedAt: sql`now()` })
        .where(and(eq(items.barcode, canonicalBarcode(barcode)), sql`${items.payload}->>'source' = ${PHOTO_SOURCE}`)),
    timeoutMs,
  )
}
