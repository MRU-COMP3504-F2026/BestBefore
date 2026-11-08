import { z } from 'zod'
import { shelfLifeSchema, type ExpiryRequest, type ExpirySuggestion, type ShelfLife } from './foodApi'
import { datesFromLength } from './shelfLifeDates'

// What the session keeps for one product: how long it lasts and exactly which form values that
// answer was for. Never a date, and never a no-date answer, since those have no shelf life.
const entrySchema = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  category: z.string().nullable(),
  productCategory: z.string().nullable(),
  shelfLife: shelfLifeSchema,
})

// The user is in the key so a second account in the same tab can't read the first one's answers.
// The barcode is padded the way the server keys a product, so 12 and 13 digit forms share an entry.
function storageKey(userId: string, barcode: string) {
  return `bestbefore.shelfLife.v1:${userId}:${barcode.padStart(14, '0')}`
}

// Storage can throw on access in a private window or with site data blocked. Without it the page
// just asks the server each time.
function sessionStore(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function rememberShelfLife(userId: string | undefined, request: ExpiryRequest, shelfLife: ShelfLife) {
  if (!userId || !request.barcode) return
  const { name, brand, category, productCategory } = request
  try {
    sessionStore()?.setItem(
      storageKey(userId, request.barcode),
      JSON.stringify({ name, brand, category, productCategory, shelfLife }),
    )
  } catch {
    // Full or blocked. The next date change asks the server instead.
  }
}

function recallShelfLife(userId: string | undefined, request: ExpiryRequest): ShelfLife | null {
  if (!userId || !request.barcode) return null
  const key = storageKey(userId, request.barcode)
  try {
    const raw = sessionStore()?.getItem(key)
    if (!raw) return null

    const parsed = entrySchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      sessionStore()?.removeItem(key)
      return null
    }
    const { name, brand, category, productCategory, shelfLife } = parsed.data
    const sameItem =
      name === request.name &&
      brand === request.brand &&
      category === request.category &&
      productCategory === request.productCategory
    return sameItem ? shelfLife : null
  } catch {
    return null
  }
}

// This item's suggestion for this purchase date, worked out here with no request. Null means the
// session has nothing usable, so the page asks the server.
export function suggestionFromSession(userId: string | undefined, request: ExpiryRequest): ExpirySuggestion | null {
  const shelfLife = recallShelfLife(userId, request)
  if (!shelfLife || !request.purchaseDate) return null

  const { storage, label, matchedFood, confidence, aiUsed } = shelfLife
  return {
    status: 'suggested',
    ...datesFromLength(request.purchaseDate, shelfLife.length),
    storage,
    label,
    matchedFood,
    confidence,
    aiUsed,
  }
}
