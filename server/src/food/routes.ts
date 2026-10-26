import express, { type NextFunction, type Request, type Response } from 'express'
import { requireAuth } from '../auth/requireAuth.js'
import { GeminiError, identifyFoodImage, type GeminiErrorCode } from './gemini.js'
import { claimIdentifySlot } from './rateLimit.js'

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

export const foodRouter = express.Router()

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
