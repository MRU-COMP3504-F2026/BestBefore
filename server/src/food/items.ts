import { eq, sql } from 'drizzle-orm'
import type { FinalRecord } from '../../../testscripts/normalizer.js'
import { db } from '../db/index.js'
import { items } from '../db/schema.js'
import { appCategory, type ExpiryInput, type ShelfLife } from './expirySuggestion.js'

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
      return row ?? null
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
export function describesRecord(product: FinalRecord, input: ExpiryInput): boolean {
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
export async function rememberShelfLife(
  barcode: string,
  shelfLife: ShelfLife,
  timeoutMs: number = ITEM_DB_TIMEOUT_MS,
) {
  await bestEffort(
    `Shelf life save for ${barcode}`,
    () => db.update(items).set({ expirySuggestion: shelfLife }).where(eq(items.barcode, canonicalBarcode(barcode))),
    timeoutMs,
  )
}
