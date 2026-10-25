import { ApiError, GoogleGenAI } from '@google/genai'
import { geminiResponseSchema, normalizeGeminiFood, type FoodIdentification } from './foodSchema.js'

// Any vision-capable Flash model works; override with GEMINI_MODEL.
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'

export const GEMINI_TIMEOUT_MS = 25_000

const PROMPT = `Identify the single main food item in this photo.
Respond with JSON only, matching the schema.
- "name": a short, generic food name (e.g. "Banana", "Cheddar cheese"). Never guess a brand.
- "category": a short food category (e.g. "Fresh fruit", "Dairy"), or null.
- "quantity" and "unit": only if you can clearly count them (e.g. 3 "piece"); otherwise null.
- "ripeness": only for produce where it is visible (e.g. "unripe", "ripe", "overripe"); otherwise null.
Set "identified" to false, with every other field null, when the photo is too unclear,
shows no food, or shows several different foods with no clear main item.`

export type GeminiErrorCode =
  | 'not_configured'
  | 'timeout'
  | 'rate_limited'
  | 'overloaded'
  | 'bad_response'
  | 'upstream'

export class GeminiError extends Error {
  code: GeminiErrorCode
  // Gemini's own status and message, for the server log. Never includes the image or key.
  detail?: string

  constructor(code: GeminiErrorCode, detail?: string) {
    super(code)
    this.code = code
    this.detail = detail
  }
}

function describeUpstream(err: unknown): string {
  if (err instanceof ApiError) return `${err.status} ${err.message.slice(0, 300)}`
  return err instanceof Error ? `${err.name}: ${err.message.slice(0, 300)}` : 'unknown error'
}

let client: GoogleGenAI | undefined

// Why the key isn't there, for the server log: variable names and deployment only, no values.
function describeMissingKey(apiKey: string | undefined): string {
  const similar = Object.keys(process.env).filter((name) => /gemini|genai/i.test(name))
  return [
    `GEMINI_API_KEY ${apiKey === undefined ? 'missing' : 'empty'}`,
    `similar names: ${similar.join(', ') || 'none'}`,
    `VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'}`,
    `branch=${process.env.VERCEL_GIT_COMMIT_REF ?? 'unset'}`,
  ].join('; ')
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) throw new GeminiError('not_configured', describeMissingKey(process.env.GEMINI_API_KEY))
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
        responseSchema: geminiResponseSchema,
        // Temperature and thinking stay at the model defaults: lowering the temperature can
        // make Gemini 3 loop, and thinking settings are model-specific (the API rejects ones
        // a model doesn't support with a 400).
        // No maxOutputTokens: on thinking models it also caps the thinking, which can
        // leave no room for the answer.
        abortSignal: abort.signal,
      },
    })

    const result = normalizeGeminiFood(response.text)
    if (!result) {
      const finish = response.candidates?.[0]?.finishReason ?? 'none'
      throw new GeminiError('bad_response', `finishReason ${finish}`)
    }
    return result
  } catch (err) {
    if (err instanceof GeminiError) throw err
    if (abort.signal.aborted) throw new GeminiError('timeout')
    const detail = describeUpstream(err)
    if (err instanceof ApiError && err.status === 429) throw new GeminiError('rate_limited', detail)
    // Google's side is overloaded for this model; temporary, and the user retries by hand.
    if (err instanceof ApiError && err.status === 503) throw new GeminiError('overloaded', detail)
    throw new GeminiError('upstream', detail)
  } finally {
    clearTimeout(timer)
  }
}
