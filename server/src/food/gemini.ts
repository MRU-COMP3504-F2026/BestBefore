import { ApiError, GoogleGenAI } from '@google/genai'
import { geminiResponseJsonSchema, normalizeGeminiFood, type FoodIdentification } from './foodSchema.js'

// Any vision-capable Flash model works; override with GEMINI_MODEL.
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'

export const GEMINI_TIMEOUT_MS = 15_000

const PROMPT = `Identify the single main food item in this photo.
Respond with JSON only, matching the schema.
- "name": a short, generic food name (e.g. "Banana", "Cheddar cheese"). Never guess a brand.
- "category": a short food category (e.g. "Fresh fruit", "Dairy"), or null.
- "quantity" and "unit": only if you can clearly count them (e.g. 3 "piece"); otherwise null.
- "ripeness": only for produce where it is visible (e.g. "unripe", "ripe", "overripe"); otherwise null.
Set "identified" to false, with every other field null, when the photo is too unclear,
shows no food, or shows several different foods with no clear main item.`

export type GeminiErrorCode = 'not_configured' | 'timeout' | 'rate_limited' | 'bad_response' | 'upstream'

export class GeminiError extends Error {
  code: GeminiErrorCode

  constructor(code: GeminiErrorCode) {
    super(code)
    this.code = code
  }
}

let client: GoogleGenAI | undefined

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new GeminiError('not_configured')
  client ??= new GoogleGenAI({ apiKey })
  return client
}

// One Gemini call per photo, never retried: a failure goes back to the user to retry by hand.
export async function identifyFoodImage(image: Buffer, mimeType: string): Promise<FoodIdentification> {
  const ai = getClient()
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), GEMINI_TIMEOUT_MS)

  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType, data: image.toString('base64') } }, { text: PROMPT }],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: geminiResponseJsonSchema,
        temperature: 0,
        maxOutputTokens: 256,
        abortSignal: abort.signal,
      },
    })

    const result = normalizeGeminiFood(response.text)
    if (!result) throw new GeminiError('bad_response')
    return result
  } catch (err) {
    if (err instanceof GeminiError) throw err
    if (abort.signal.aborted) throw new GeminiError('timeout')
    if (err instanceof ApiError && err.status === 429) throw new GeminiError('rate_limited')
    throw new GeminiError('upstream')
  } finally {
    clearTimeout(timer)
  }
}
