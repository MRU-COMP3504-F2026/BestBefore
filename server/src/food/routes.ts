import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { lookupHadFailure, lookupProduct } from '../../../testscripts/normalizer.js'
import { requireAuth } from '../auth/requireAuth.js'
import { appCategory, suggestExpiry, suggestionFromShelfLife } from './expirySuggestion.js'
import { GeminiError, identifyFoodImage, type GeminiErrorCode } from './gemini.js'
import { describesRecord, findItem, isShareable, rememberItem, rememberShelfLife } from './items.js'
import { claimIdentifySlot, claimLookupSlot } from './rateLimit.js'

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

const GEMINI_ERRORS: Record<GeminiErrorCode, { status: number; error: string }> = {
  not_configured: { status: 503, error: 'AI recognition is not configured.' },
  timeout: { status: 504, error: 'AI recognition took too long. Please try again.' },
  rate_limited: { status: 429, error: 'AI recognition is busy right now. Please try again shortly.' },
  overloaded: {
    status: 503,
    error: 'The AI model is overloaded right now. Please try again in a moment.',
  },
  bad_response: { status: 502, error: 'AI recognition returned an unexpected answer. Please try again.' },
  upstream: { status: 502, error: 'AI recognition is unavailable. Please try again.' },
}

// EAN-8 up to GTIN-14, the codes the scanner reads. Digits only, leading zeros kept.
const BARCODE = /^\d{8,14}$/

const expiryRequestSchema = z.object({
  name: z.string().trim().min(1).max(500),
  brand: z.string().trim().max(200).nullable(),
  barcode: z.string().trim().max(32).nullable(),
  category: z.string().trim().max(100).nullable(),
  productCategory: z.string().trim().max(1000).nullable(),
  purchaseDate: z.iso.date(),
  // 'photo' is AI Vision: a food named from a photo, with no product behind it.
  source: z.enum(['barcode', 'photo']).optional(),
})

export const foodRouter = express.Router()

// Looks a barcode up in the product databases. `product` is the normalizer's FINAL record,
// untouched, so it keeps `source` for one hit and `sources` for a merge. `category` is ours.
// A product already in the items table is answered from there, without a database call or a slot.
foodRouter.get('/barcode/:barcode', requireAuth, async (req, res) => {
  const barcode = String(req.params.barcode)
  if (!BARCODE.test(barcode)) {
    res.status(400).json({ error: "That barcode isn't valid." })
    return
  }

  const saved = await findItem(barcode)
  if (saved) {
    res.json({ product: saved.payload, category: appCategory(saved.payload.category) })
    return
  }

  const slot = claimLookupSlot(res.locals.user!.id)
  if (!slot.ok) {
    res.status(429).json({
      error:
        slot.reason === 'busy'
          ? 'Already looking up a product.'
          : 'Product lookup limit reached. Please wait a bit and try again.',
    })
    return
  }

  try {
    const { results, final } = await lookupProduct(barcode)
    if (final) {
      await rememberItem(barcode, final, !lookupHadFailure(results))
      res.json({ product: final, category: appCategory(final.category) })
    } else if (lookupHadFailure(results)) {
      // Never say "no such product" when a database didn't actually answer.
      console.warn(
        `Barcode lookup failed: ${results
          .filter((result) => result.error && !result.skipped)
          .map((result) => `${result.source}: ${result.error}`)
          .join('; ')}`,
      )
      res.status(502).json({ error: "Couldn't reach the product databases." })
    } else {
      res.status(404).json({ error: 'No product found for this barcode.' })
    }
  } catch (err) {
    console.error(`Barcode lookup failed: ${err instanceof Error ? err.message : err}`)
    res.status(502).json({ error: "Couldn't reach the product databases." })
  } finally {
    slot.release()
  }
})

// A best-before suggestion for the user to accept or ignore, always counted from this request's
// purchase date. The items table only keeps how long a product lasts, and only for a request that
// still describes the saved product. No inventory is saved here.
foodRouter.post('/expiry-suggestion', requireAuth, async (req, res) => {
  const parsed = expiryRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "That item isn't valid." })
    return
  }

  try {
    if (parsed.data.source === 'photo') {
      // Only the name and category the photo gave, matched in FoodKeeper here. No saved product,
      // no product database and no Gemini date: a photo can't say what the package does.
      const { name, brand, productCategory, purchaseDate } = parsed.data
      const category = appCategory(productCategory)
      const input = { name, brand, barcode: null, category, productCategory, purchaseDate }
      res.json(await suggestExpiry(input, res.locals.user!.id, { ai: false }))
      return
    }

    const saved = parsed.data.barcode ? await findItem(parsed.data.barcode) : null
    const record = saved && describesRecord(saved.payload, parsed.data) ? saved : null
    // The record's English category tags, only while the form still describes it. A row saved
    // before tags were kept has none, and is searched as before.
    const input = { ...parsed.data, categoryTags: record?.payload.categoryTags ?? null }
    const reused = record?.expirySuggestion ? suggestionFromShelfLife(input, record.expirySuggestion) : null
    const suggestion = reused ?? (await suggestExpiry(input, res.locals.user!.id))

    if (record && !reused && suggestion.status === 'suggested' && isShareable(suggestion.shelfLife)) {
      // A row with no shelf life, or one that can't be reused, is worked out again here from the
      // saved record, locally first. Only a sure match is kept, and only over what was read.
      await rememberShelfLife(record.barcode, suggestion.shelfLife, record.expirySuggestion)
    }
    res.json(suggestion)
  } catch (err) {
    console.error(`Expiry suggestion failed: ${err instanceof Error ? err.message : err}`)
    res.status(500).json({ error: "Couldn't get a suggested date." })
  }
})

// Beta: identifies one food in a single photo sent as the raw request body.
foodRouter.post(
  '/identify',
  requireAuth,
  express.raw({ type: IMAGE_TYPES, limit: MAX_IMAGE_BYTES }),
  async (req, res) => {
    const mimeType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    // express.raw leaves the body unparsed for any other content type.
    if (!Buffer.isBuffer(req.body) || !IMAGE_TYPES.includes(mimeType)) {
      res.status(415).json({ error: 'Send a JPEG, PNG or WebP image.' })
      return
    }
    if (req.body.length === 0) {
      res.status(400).json({ error: 'The image is empty.' })
      return
    }

    const slot = claimIdentifySlot(res.locals.user!.id)
    if (!slot.ok) {
      res.status(429).json({
        error:
          slot.reason === 'busy'
            ? 'Already identifying a photo.'
            : 'AI recognition limit reached. Please wait a bit and try again.',
      })
      return
    }

    try {
      res.json(await identifyFoodImage(req.body, mimeType))
    } catch (err) {
      const code = err instanceof GeminiError ? err.code : 'upstream'
      const detail = err instanceof GeminiError && err.detail ? ` (${err.detail})` : ''
      // Gemini's error, never the image or key.
      console.warn(`Food identify failed: ${code}${detail}`)
      const { status, error } = GEMINI_ERRORS[code]
      res.status(status).json({ error })
    } finally {
      slot.release()
    }
  },
)

// Body parser errors (e.g. an oversized image) as JSON instead of Express's HTML page.
foodRouter.use((err: { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
  if (err.type === 'entity.too.large') {
    res.status(413).json({ error: 'The image is too large.' })
    return
  }
  next(err)
})
