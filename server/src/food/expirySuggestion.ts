import { suggestWithFallback, type HybridResult } from '../../../expiry-tests/ai-fallback.js'
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
    }
  | { status: 'none'; message: string }

const NO_SUGGESTION = 'No reliable suggestion for this item. Check the package and enter the date.'

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

function toSuggestion(result: HybridResult, fromName: boolean): ExpirySuggestion {
  // A resolved food can still have no date, because FoodKeeper says to read the package (milk).
  if (!result.range || !result.selected || !result.confidence) {
    return { status: 'none', message: NO_SUGGESTION }
  }
  return {
    status: 'suggested',
    ...result.range,
    matchedFood: result.selected.name,
    confidence: capConfidence(result.confidence, fromName),
    aiUsed: result.aiUsed,
  }
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
    if (isResolved(result)) return toSuggestion(result, name === input.name)
  }

  if (!config.enabled) return { status: 'none', message: NO_SUGGESTION }

  // At most one Gemini request per suggestion: the engine makes one call for the real name.
  const result = await suggestWithFallback(engine, item, {
    config,
    client: limitedClient(userId, createGeminiClient(config)),
  })
  return result.aiUsed && isResolved(result)
    ? toSuggestion(result, true)
    : { status: 'none', message: NO_SUGGESTION }
}
