import { z } from 'zod'

// What Gemini is asked to return for one photo. Anything it can't see is null rather than
// guessed, and there is deliberately no confidence score.
export const geminiFoodSchema = z.object({
  identified: z.boolean(),
  name: z.string().nullable(),
  category: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  ripeness: z.string().nullable(),
})

export type GeminiFood = z.infer<typeof geminiFoodSchema>

export type IdentifiedFood = {
  name: string
  category: string | null
  quantity: number | null
  unit: string | null
  ripeness: string | null
}

// What POST /api/food/identify responds with.
export type FoodIdentification = { identified: true; food: IdentifiedFood } | { identified: false }

// Same shape as geminiFoodSchema, as the JSON Schema Gemini's structured output takes.
const nullableString = { type: ['string', 'null'] }
export const geminiResponseJsonSchema = {
  type: 'object',
  properties: {
    identified: { type: 'boolean' },
    name: nullableString,
    category: nullableString,
    quantity: { type: ['integer', 'null'] },
    unit: nullableString,
    ripeness: nullableString,
  },
  required: ['identified', 'name', 'category', 'quantity', 'unit', 'ripeness'],
}

// Trims to a short display string; blank or missing becomes null.
function clean(value: string | null, max: number): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

// Validates Gemini's raw JSON text. Returns null when it doesn't match the schema.
export function normalizeGeminiFood(text: string | undefined): FoodIdentification | null {
  let json: unknown
  try {
    json = JSON.parse(text ?? '')
  } catch {
    return null
  }

  const parsed = geminiFoodSchema.safeParse(json)
  if (!parsed.success) return null

  const raw = parsed.data
  const name = clean(raw.name, 60)
  // "Identified" without a name is no identification at all.
  if (!raw.identified || !name) return { identified: false }

  const quantity =
    raw.quantity !== null && Number.isInteger(raw.quantity) && raw.quantity > 0
      ? raw.quantity
      : null

  return {
    identified: true,
    food: {
      name,
      category: clean(raw.category, 60),
      quantity,
      unit: clean(raw.unit, 30),
      ripeness: clean(raw.ripeness, 30),
    },
  }
}
