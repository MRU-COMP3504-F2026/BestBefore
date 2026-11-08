import express from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth/requireAuth.js'
import { findPhotoMatch } from './items.js'
import { verifyPhotoProvenance } from './photoItems.js'

export const photoRouter = express.Router()

const matchRequestSchema = z.object({ photoToken: z.string().min(1).max(1000) })

// What another user confirmed for a photo Gemini named the same way, for the add form to offer.
// Keyed by the token's alias, never by text the client sends, so it can't be used to search the
// table. Read only: nothing is written here, whatever the answer.
photoRouter.post('/match', requireAuth, async (req, res) => {
  const parsed = matchRequestSchema.safeParse(req.body)
  const provenance = parsed.success ? verifyPhotoProvenance(parsed.data.photoToken, res.locals.user!.id) : null
  if (!provenance) {
    res.status(400).json({ error: "That photo can't be matched." })
    return
  }

  const match = await findPhotoMatch(provenance.alias)
  res.json({ match: match && { name: match.name, brand: match.brand, category: match.category } })
})
