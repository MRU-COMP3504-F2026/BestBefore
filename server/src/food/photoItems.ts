import { createHmac, timingSafeEqual } from 'node:crypto'

// AI Vision items in the shared items table. A photo has no product database behind it, so the only
// thing worth sharing is what a user confirmed by saving it. Nothing is written when a photo is taken
// or a suggestion shown: only after the inventory row is saved.
//
// A row is keyed by the barcode the user typed when there is one. Without one it is keyed by
// photoKey, the confirmed name, brand and category folded together, so two products only share a row
// when all three agree. photoAlias, the folded name and brand Gemini gave the photo, is how a later
// photo finds it, and only ever as a suggestion the user has to choose.

// The `source` of a payload a user confirmed from a photo. Never one of the normalizer's databases,
// so a real lookup can tell it apart and replace it.
export const PHOTO_SOURCE = 'AI Vision'

// Same fields as the normalizer's single-source record. Only product facts the user saw and kept:
// no owner, dates, count, photo or token. barcode is null for a row keyed by photoKey.
export type PhotoProduct = {
  source: typeof PHOTO_SOURCE
  barcode: string | null
  name: string
  brand: string | null
  description: null
  quantity: null
  category: string | null
  categoryTags: null
  imageUrl: null
  ingredients: null
}

// The expiry engine's labels (CATEGORY_RULES in expirySuggestion.ts), the same list the add form
// offers. Anything else is one user's own text and stays out of the shared row.
const APP_CATEGORIES = new Set([
  'Bakery',
  'Beverages',
  'Dairy',
  'Deli',
  'Frozen',
  'Meat',
  'Pantry',
  'Poultry',
  'Produce',
  'Seafood',
])

export function isPhotoRecord(product: object): product is PhotoProduct {
  return 'source' in product && product.source === PHOTO_SOURCE
}

type ConfirmedFood = { name: string; brand: string | null; category: string | null }

export function photoProduct(barcode: string | null, item: ConfirmedFood): PhotoProduct {
  return {
    source: PHOTO_SOURCE,
    barcode,
    name: item.name,
    brand: item.brand,
    description: null,
    quantity: null,
    category: item.category && APP_CATEGORIES.has(item.category) ? item.category : null,
    categoryTags: null,
    imageUrl: null,
    ingredients: null,
  }
}

// Case, accents, punctuation and spacing only, so "Crème fraîche" and "creme  fraiche" are one food.
// No stemming or synonyms: "Apple" and "Apples" stay apart rather than risk joining two products.
function fold(text: string | null): string {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// The shared row for a confirmed photo product with no barcode. Versioned so a later change to fold
// can't silently match keys built the old way.
export function photoKey(product: PhotoProduct): string {
  return ['v1', fold(product.name), fold(product.brand), product.category ?? ''].join('|')
}

// What Gemini called the photo. Nothing the user typed is in it.
export function photoAlias(food: { name: string; brand?: string | null }): string {
  return ['v1', fold(food.name), fold(food.brand ?? null)].join('|')
}

// Free text every other user will see. A product name or brand is short and has no contact details;
// anything else may be one user's note and stays in their own inventory.
export function isShareableText(text: string | null): boolean {
  if (text === null) return true
  return (
    text.length <= 60 &&
    fold(text) !== '' &&
    !/@|https?:|www\.|\.(com|net|org|ca)\b/i.test(text) &&
    !/\d[\d\s().-]{6,}\d/.test(text)
  )
}

// EAN-8, UPC-A, EAN-13 or GTIN-14 with a correct GS1 check digit. A typo must not become another
// product's row.
export function isValidGtin(code: string | null): code is string {
  if (!code || !/^(\d{8}|\d{12,14})$/.test(code)) return false
  const digits = [...code].map(Number)
  const check = digits.pop()!
  // Weights 3,1,3,1… from the digit next to the check digit.
  const sum = digits.reverse().reduce((total, digit, i) => total + digit * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

// How long after a photo is identified its add form can still share the product.
export const PHOTO_PROVENANCE_TTL_MS = 60 * 60 * 1000

// Derived from the Gemini key, which every photo already needs, so there is no new secret to set and
// the token never reveals the key. Null when AI Vision isn't configured: nothing can be shared then.
function provenanceKey(): Buffer | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) return null
  return createHmac('sha256', apiKey).update('bestbefore:photo-provenance:v1').digest()
}

const sign = (key: Buffer, body: string) => createHmac('sha256', key).update(body).digest('base64url')

// Proof that the server itself identified this photo for this user, recently, and what Gemini
// called it (photoAlias), so the client can't make up either. Only the user it was issued to sees it.
export function signPhotoProvenance(
  userId: string,
  food: { name: string; brand?: string | null },
  now = Date.now(),
): string | null {
  const key = provenanceKey()
  if (!key) return null
  const claims = { u: userId, a: photoAlias(food), exp: now + PHOTO_PROVENANCE_TTL_MS }
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${body}.${sign(key, body)}`
}

// The photo's alias when the token is genuine, this user's and unexpired; otherwise null.
export function verifyPhotoProvenance(token: string, userId: string, now = Date.now()): { alias: string } | null {
  const key = provenanceKey()
  const [body, signature, extra] = token.split('.')
  if (!key || !body || !signature || extra !== undefined) return null

  const expected = Buffer.from(sign(key, body))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      u?: unknown
      a?: unknown
      exp?: unknown
    }
    const valid =
      claims.u === userId && typeof claims.a === 'string' && typeof claims.exp === 'number' && now <= claims.exp
    return valid ? { alias: claims.a as string } : null
  } catch {
    return null
  }
}
