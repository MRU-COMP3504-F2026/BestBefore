import { z } from 'zod'
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
export const IDENTIFY_TIMEOUT_MS = 20_000

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
