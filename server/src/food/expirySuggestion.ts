import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { suggestWithFallback, type HybridResult } from '../../../expiry-tests/ai-fallback.js'
import { formatDay, parseDay, predict, windowLength, type Storage } from '../../../expiry-tests/expiry.js'
import { FoodKeeper } from '../../../expiry-tests/foodkeeper.js'
import { createGeminiClient, loadAiConfig, type AiClient, type AiConfig } from '../../../expiry-tests/gemini-expiry.js'
import { FOODKEEPER_PATH } from '../../../expiry-tests/strategies.js'
import { claimExpiryAiSlot } from './rateLimit.js'

export type ExpiryInput = {
  name: string
  brand: string | null
  barcode: string | null
  // Our own label, from appCategory. The only form the engine's category hints understand.
  category: string | null
  // The product's own free-text category, when a database gave one.
  productCategory: string | null
  purchaseDate: string
}

// What the client is allowed to see. The engine's diagnostics stay on the server.
export type ExpirySuggestion =
  | {
      status: 'suggested'
      earliest: string
      latest: string
      storage: string
      label: string
      matchedFood: string
      confidence: 'high' | 'medium' | 'low' | 'tie'
      aiUsed: boolean
      shelfLife: ShelfLife
    }
  | { status: 'none'; message: string }

// What is true of the product whenever it was bought, so it can be kept and reused. Never holds a
// date: each purchase counts its own from length. window is FoodKeeper's own wording, null when the
// length is its category's default rather than the row's.
const shelfLifeSchema = z.object({
  foodKeeperId: z.number().int(),
  matchedFood: z.string(),
  storage: z.enum(['pantry', 'fridge', 'freezer']),
  label: z.string(),
  length: z.object({ unit: z.enum(['days', 'months']), min: z.number(), max: z.number() }),
  window: z
    .object({ min: z.number().nullable(), max: z.number().nullable(), metric: z.string() })
    .nullable(),
  source: z.enum(['USDA', 'estimated']),
  confidence: z.enum(['high', 'medium', 'low', 'tie']),
  aiUsed: z.boolean(),
})
export type ShelfLife = z.infer<typeof shelfLifeSchema>

const NO_SUGGESTION = 'No reliable suggestion for this item. Check the package and enter the date.'
const NO_DRINK_DATE = 'FoodKeeper has no unopened date for this drink. Check the package.'

// Built once, on the first request that needs it: it parses a 600 KB file.
let foodKeeper: FoodKeeper | undefined
function getFoodKeeper(): FoodKeeper {
  foodKeeper ??= new FoodKeeper(FOODKEEPER_PATH)
  return foodKeeper
}

// UPCitemdb and Go-UPC start every food at this Google taxonomy root. It would read as a
// beverage for anything, and its comma would split it in two.
const TAXONOMY_ROOT = /food,\s*beverages\s*&\s*tobacco/gi

// One category trail as its segments, in the order the database gave them.
function categorySegments(category: string | null): string[] {
  if (!category) return []
  return category
    .replace(TAXONOMY_ROOT, '')
    .split(/,|>/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

// Product databases file things under long free-text trails ("Spreads, Sweet spreads,
// Cocoa and hazelnuts spreads" or "Food Items > Dairy > Milk"), but the engine's category hints
// only know our own labels. Each rule turns one segment of a trail into one of those labels.
// Order matters: "muesli with fruits" is a cereal, not produce.
const CATEGORY_RULES: [RegExp, string][] = [
  [/\bfrozen\b/, 'Frozen'],
  [/\b(deli|sandwiches|ready meals)\b/, 'Deli'],
  [/\b(seafoods?|fish|shellfish|shrimps?|salmon|tuna)\b/, 'Seafood'],
  [/\b(poultry|poultries|chickens?|turkeys?)\b/, 'Poultry'],
  [/\b(meats?|beef|pork|sausages?|bacon|hams?)\b/, 'Meat'],
  [/\b(dairy|dairies|milks?|cheeses?|yogurts?|yoghurts?|skyrs?|butters?|creams?|eggs?)\b/, 'Dairy'],
  [/\b(beverages?|drinks?|sodas?|colas?|waters?|juices?|coffees?|teas?)\b/, 'Beverages'],
  [/\b(breads?|bakery|baked goods|biscuits?|cookies|cakes?|pastries)\b/, 'Bakery'],
  [
    /\b(pantry|groceries|cereals?|muesli|granola|pastas?|spaghetti|noodles?|rice|spreads?|sauces?|ketchup|condiments?|canned|snacks?|crisps|pretzels?|chocolates?|confectioner(y|ies)|sweets?|grains?|legumes?|beans?|nuts?|almonds?|oils?)\b/,
    'Pantry',
  ],
  [/\b(fruits?|vegetables?|produce)\b/, 'Produce'],
]

// The most specific segment any rule recognises decides. The trails usually run broad to
// specific, so they are read from the end. Open Food Facts contributors don't always follow
// that, which is one reason this label is only a hint.
export function appCategory(category: string | null): string | null {
  for (const segment of categorySegments(category).reverse()) {
    const text = segment.toLowerCase()
    for (const [pattern, label] of CATEGORY_RULES) {
      if (pattern.test(text)) return label
    }
  }
  return null
}

// Too broad to say what a food is. "Snacks" matched Nutella to gummy fruit snacks.
const BROAD_SEGMENTS = new Set([
  'snacks',
  'sweet snacks',
  'salty snacks',
  'groceries',
  'foods',
  'food',
  'meats',
  'beverages',
  'drinks',
  'breakfasts',
  'spreads',
  'food items',
])

// Words to search FoodKeeper with, best first. Marketing names ("Cheerios", "Tiny Twists") share
// no word with it, but the product's category often does ("Breakfast cereals", "Pretzel").
// Language-tagged segments ("fr:Goûter") and slugs ("snacks-sales") can't match its English.
function searchNames(input: ExpiryInput): string[] {
  const fromCategory = categorySegments(input.productCategory).filter(
    (segment) => !BROAD_SEGMENTS.has(segment.toLowerCase()) && !/[:-]/.test(segment),
  )
  return [...new Set([input.name, ...fromCategory])]
}

// FoodKeeper has no row for energy drinks, and its soda row only covers an opened can. Any date
// for these would come from a row about something else. Monster Energy Zero Ultra reached
// Milk (ultra-pasteurized) on the word "Ultra", so these never reach the engine or Gemini.
// Soda and cola must end the text: "Soda Crackers" is a food, and so is "Baking Soda".
const UNSUPPORTED_DRINK =
  /\benergy (drinks?|shots?|beverages?)\b(?! (mix|powder))|(?<!baking )\b(sodas?|soft drinks?|carbonated (drinks?|beverages?)|colas?)$/i
// Brands that often give no other clue. "Monster" has to be the whole brand: "Monster Munch" is not.
const ENERGY_DRINK_BRAND = /\b(monster energy|red bull|rockstar energy)\b/i

function isUnsupportedDrink(input: ExpiryInput): boolean {
  const brands = categorySegments(input.brand)
  return (
    [input.name, ...categorySegments(input.productCategory)].some((text) => UNSUPPORTED_DRINK.test(text)) ||
    [input.name, ...brands].some((text) => ENERGY_DRINK_BRAND.test(text)) ||
    brands.some((brand) => brand.toLowerCase() === 'monster')
  )
}

const BEVERAGES_CATEGORY = 5
// Plant milks are filed under dairy, and bottled supplement drinks under shelf-stable foods.
const OTHER_DRINK_ROWS = new Set([421, 429, 651])
// "Canned" and "drink" are enough to reach these rows, but only a nutrition drink belongs on them.
const NUTRITION_DRINK_ROWS = new Set([558, 651])
const NUTRITION_DRINK = /\b(nutrition(al)?|supplements?|boost|ensure)\b/i

function isUnfoundedNutritionDrink(id: number, input: ExpiryInput): boolean {
  return (
    NUTRITION_DRINK_ROWS.has(id) &&
    !NUTRITION_DRINK.test(`${input.name} ${input.brand ?? ''} ${input.productCategory ?? ''}`)
  )
}

function isDrinkRow(id: number): boolean {
  const row = getFoodKeeper().products.find((product) => product.id === id)
  return row?.categoryId === BEVERAGES_CATEGORY || OTHER_DRINK_ROWS.has(id)
}

// The engine's low and tie picks are its best guesses, not answers. On real products they said
// ketchup was tomato paste and canned kidney beans were mung sprouts, so only a local pick it
// is sure of counts. See docs/scanflow-expiry.md.
function isResolved(result: HybridResult): boolean {
  if (result.local.route === 'no_match' && !result.aiUsed) return false
  if (!result.selected || !result.confidence) return false
  return result.aiUsed || result.confidence === 'high' || result.confidence === 'medium'
}

// A date with no words from the product's own name behind it is never fully trusted.
function capConfidence(confidence: 'high' | 'medium' | 'low' | 'tie', fromName: boolean) {
  return !fromName && confidence === 'high' ? 'medium' : confidence
}

function noDate(message: string): ExpirySuggestion {
  return { status: 'none', message }
}

// The shelf life FoodKeeper gives this row today, or null if the row can't give one.
function shelfLifeOf(
  id: number,
  match: Pick<ShelfLife, 'matchedFood' | 'storage' | 'label' | 'confidence' | 'aiUsed'>,
): ShelfLife | null {
  const engine = getFoodKeeper()
  const row = engine.products.find((product) => product.id === id)
  if (!row) return null

  const window = engine.storageWindows(row).find((item) => item.label === match.label) ?? null
  const length = windowLength(window, row.categoryId)
  if (!length) return null
  return {
    foodKeeperId: id,
    matchedFood: match.matchedFood,
    storage: match.storage,
    label: match.label,
    length,
    window: window && { min: window.min, max: window.max, metric: window.metric },
    // The same split predict() makes: only a real length of time is USDA's own number.
    source: window && window.min !== null ? 'USDA' : 'estimated',
    confidence: match.confidence,
    aiUsed: match.aiUsed,
  }
}

function toSuggestion(result: HybridResult, fromName: boolean, input: ExpiryInput): ExpirySuggestion {
  if (result.selected && isUnfoundedNutritionDrink(result.selected.id, input)) return noDate(NO_DRINK_DATE)
  // A resolved food can still have no date, because FoodKeeper says to read the package (milk).
  if (!result.range || !result.selected || !result.confidence) {
    return noDate(result.selected && isDrinkRow(result.selected.id) ? NO_DRINK_DATE : NO_SUGGESTION)
  }

  const match = {
    ...result.range,
    storage: result.range.storage as Storage,
    matchedFood: result.selected.name,
    confidence: capConfidence(result.confidence, fromName),
    aiUsed: result.aiUsed,
  }
  const shelfLife = shelfLifeOf(result.selected.id, match)
  return shelfLife ? { status: 'suggested', ...match, shelfLife } : noDate(NO_SUGGESTION)
}

// Each real Gemini request claims a slot here, so a local answer or a switched-off fallback is
// never counted. A refused slot fails like any other AI error: no suggestion, and the user types
// the date.
function limitedClient(userId: string, client: AiClient): AiClient {
  return async (request) => {
    const slot = claimExpiryAiSlot(userId)
    if (!slot.ok) throw new Error(`rate limited (${slot.reason})`)
    try {
      return await client(request)
    } finally {
      slot.release()
    }
  }
}

export async function suggestExpiry(input: ExpiryInput, userId: string): Promise<ExpirySuggestion> {
  if (isUnsupportedDrink(input)) return noDate(NO_DRINK_DATE)

  const engine = getFoodKeeper()
  const item = {
    name: input.name,
    brand: input.brand,
    barcode: input.barcode,
    category: input.category,
    purchaseDate: input.purchaseDate,
    // The fixture fields the engine's shared item type requires but never reads here.
    id: 0,
    quantity: 1,
    unit: null,
    bestBefore: input.purchaseDate,
    createdAt: '',
    expectedFoodKeeperId: 0,
    expectedFoodKeeperName: '',
  }

  // Every local search first, with AI held back, so Gemini is only ever asked as a last resort.
  const config = loadAiConfig()
  const localOnly: AiConfig = { ...config, enabled: false, tieBreak: false, expansion: false }
  for (const name of searchNames(input)) {
    const result = await suggestWithFallback(engine, { ...item, name }, { config: localOnly })
    if (isResolved(result)) return toSuggestion(result, name === input.name, input)
  }

  if (!config.enabled) return noDate(NO_SUGGESTION)

  // At most one Gemini request per suggestion: the engine makes one call for the real name.
  const result = await suggestWithFallback(engine, item, {
    config,
    client: limitedClient(userId, createGeminiClient(config)),
  })
  return result.aiUsed && isResolved(result) ? toSuggestion(result, true, input) : noDate(NO_SUGGESTION)
}

// A stored shelf life, turned back into a date for this purchase. Costs no Gemini request. The
// guards run again, so a row saved before a guard existed can't bring its date back. Null means the
// stored value can't be used (malformed, or FoodKeeper has changed), so search as if it wasn't there.
// Only send a browser the shelfLife this returns. It has no guards of its own.
export function suggestionFromShelfLife(input: ExpiryInput, stored: unknown): ExpirySuggestion | null {
  if (isUnsupportedDrink(input)) return noDate(NO_DRINK_DATE)

  const parsed = shelfLifeSchema.safeParse(stored)
  if (!parsed.success) return null
  const shelfLife = parsed.data
  if (isUnfoundedNutritionDrink(shelfLife.foodKeeperId, input)) return noDate(NO_DRINK_DATE)

  // Anything that no longer matches what FoodKeeper says now, length included, is not reused.
  const current = shelfLifeOf(shelfLife.foodKeeperId, shelfLife)
  if (!current || !isDeepStrictEqual(current, shelfLife)) return null

  const engine = getFoodKeeper()
  const row = engine.products.find((product) => product.id === shelfLife.foodKeeperId)!
  const window = engine.storageWindows(row).find((item) => item.label === shelfLife.label)
  // Only the stored window, so predict() can't move on to a different one.
  const prediction = predict(window ? [window] : [], row.categoryId, parseDay(input.purchaseDate), shelfLife.storage)
  if (prediction.kind !== 'range' || prediction.label !== shelfLife.label) return null

  return {
    status: 'suggested',
    earliest: formatDay(prediction.earliest),
    latest: formatDay(prediction.latest),
    storage: prediction.storage,
    label: prediction.label,
    matchedFood: shelfLife.matchedFood,
    confidence: shelfLife.confidence,
    aiUsed: shelfLife.aiUsed,
    shelfLife,
  }
}
