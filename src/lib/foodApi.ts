import { z } from 'zod'
import { ApiError, apiFetch } from './api'
import { getApiToken } from './authClient'

// AI Vision (Beta): one photo in, at most one food out. Mirrors server/src/food/foodSchema.ts.
const identificationSchema = z.discriminatedUnion('identified', [
  z.object({
    identified: z.literal(true),
    food: z.object({
      name: z.string().min(1),
      category: z.string().nullable(),
      quantity: z.number().nullable(),
      unit: z.string().nullable(),
      ripeness: z.string().nullable(),
    }),
  }),
  z.object({ identified: z.literal(false) }),
])

export type FoodIdentification = z.infer<typeof identificationSchema>
export type IdentifiedFood = Extract<FoodIdentification, { identified: true }>['food']

// A little longer than the server's own Gemini timeout, so its 504 arrives first.
export const IDENTIFY_TIMEOUT_MS = 30_000

export class FoodIdentifyError extends Error {}

// Sends a single photo to the backend, which asks Gemini. Never retries.
export async function identifyFood(image: Blob, signal?: AbortSignal): Promise<FoodIdentification> {
  const token = await getApiToken()
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), IDENTIFY_TIMEOUT_MS)
  const onAbort = () => timeout.abort()
  signal?.addEventListener('abort', onAbort)

  let response: Response
  try {
    response = await fetch('/api/food/identify', {
      method: 'POST',
      headers: {
        'Content-Type': image.type,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: image,
      signal: timeout.signal,
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new FoodIdentifyError(
      timeout.signal.aborted
        ? 'Identifying took too long. Please try again.'
        : "Couldn't reach the server. Check your connection and try again.",
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = (body as { error?: unknown } | null)?.error
    throw new FoodIdentifyError(
      typeof message === 'string'
        ? message
        : response.status === 429
          ? 'Too many requests. Please wait a bit and try again.'
          : 'Something went wrong. Please try again.',
    )
  }

  const parsed = identificationSchema.safeParse(body)
  if (!parsed.success) throw new FoodIdentifyError('Something went wrong. Please try again.')
  return parsed.data
}

// The normalizer's FINAL record (testscripts/normalizer.ts), unchanged: `source` when one database
// had the product, `sources` when several were merged. Mirrors its two types. `quantity` here is
// the package size ("400.0 g"), which is not how many items the user is adding.
const productFields = {
  barcode: z.string(),
  name: z.string().nullable(),
  brand: z.string().nullable(),
  description: z.string().nullable(),
  quantity: z.string().nullable(),
  category: z.string().nullable(),
  imageUrl: z.string().nullable(),
  ingredients: z.string().nullable(),
}

const productRecordSchema = z.union([
  z.object({ source: z.string(), ...productFields }),
  z.object({ sources: z.array(z.string()), ...productFields }),
])

const barcodeLookupSchema = z.object({
  product: productRecordSchema,
  category: z.string().nullable(),
})

export type ProductRecord = z.infer<typeof productRecordSchema>

// Handed from the scanner to the add form. product is null when the lookup found nothing, and
// notice says why. category is our own label for the expiry engine, not the product's free text.
export type ScanHandoff = {
  barcode: string
  product: ProductRecord | null
  category: string | null
  notice: string | null
}

// A little longer than the server's own wait on the slowest product database.
export const LOOKUP_TIMEOUT_MS = 12_000

// Never rejects for a failed lookup, because the user can still fill in the form by hand. Only
// aborting through `signal` rejects.
export async function lookupBarcode(barcode: string, signal: AbortSignal): Promise<ScanHandoff> {
  const missing = (notice: string): ScanHandoff => ({ barcode, product: null, category: null, notice })
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), LOOKUP_TIMEOUT_MS)
  const onAbort = () => timeout.abort()
  signal.addEventListener('abort', onAbort)

  try {
    const body = await apiFetch<unknown>(`/food/barcode/${encodeURIComponent(barcode)}`, {
      signal: timeout.signal,
    })
    return { barcode, ...barcodeLookupSchema.parse(body), notice: null }
  } catch (err) {
    if (signal.aborted) throw err
    if (err instanceof ApiError && err.status === 404) {
      return missing('No product found for this barcode. Add the details below.')
    }
    if (err instanceof ApiError && err.status === 429 && err.serverMessage) {
      return missing(`${err.serverMessage} You can add the details below.`)
    }
    return missing("We couldn't look up this barcode. Add the details below.")
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

// Mirrors ExpirySuggestion in server/src/food/expirySuggestion.ts.
const expirySuggestionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('suggested'),
    earliest: z.string(),
    latest: z.string(),
    storage: z.string(),
    label: z.string(),
    matchedFood: z.string(),
    confidence: z.enum(['high', 'medium', 'low', 'tie']),
    aiUsed: z.boolean(),
  }),
  z.object({ status: z.literal('none'), message: z.string() }),
])

export type ExpirySuggestion = z.infer<typeof expirySuggestionSchema>

export type ExpiryRequest = {
  name: string
  brand: string | null
  barcode: string | null
  category: string | null
  productCategory: string | null
  purchaseDate: string
}

export async function fetchExpirySuggestion(item: ExpiryRequest, signal?: AbortSignal): Promise<ExpirySuggestion> {
  const body = await apiFetch<unknown>('/food/expiry-suggestion', {
    method: 'POST',
    body: JSON.stringify(item),
    signal,
  })
  return expirySuggestionSchema.parse(body)
}
