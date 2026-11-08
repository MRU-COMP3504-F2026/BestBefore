import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { suggestWithFallback, type HybridResult } from '../../../expiry-tests/ai-fallback.js'
import { formatDay, parseDay, predict, windowLength, type Storage } from '../../../expiry-tests/expiry.js'
import { FoodKeeper, foldText, tokenize } from '../../../expiry-tests/foodkeeper.js'
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
  // Open Food Facts' English category tags ("en:chocolate-biscuits"), in its order. Only the server
  // fills this, from the saved record the request describes. The add form never sends it.
  categoryTags?: readonly string[] | null
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
// that, which is one reason this label is only a hint. Accents are folded first: \b ends a word at
// any accented letter, so "Pâtes" would otherwise be read as "p" and "tes".
export function appCategory(category: string | null): string | null {
  for (const segment of categorySegments(category).reverse()) {
    const text = foldText(segment).toLowerCase()
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
  // Open Food Facts' own top levels, which its tags always include.
  'plant based foods and beverages',
  'plant based foods',
  'biscuits and cakes',
  'dairies',
  'fermented foods',
  'fermented milk products',
  'prepared meats',
  'condiments',
  'sauces',
])

// Searched at most, so a record with a long tag list can't make one suggestion slow.
const MAX_TAGS = 8

// "en:chocolate-biscuits" -> "chocolate biscuits", most specific first. Open Food Facts lists a
// product's tags from the top of its taxonomy down, so the last tag is the narrowest. Other
// languages' tags are dropped: FoodKeeper is English. The tags come from a saved JSONB row, so
// anything that isn't a list of strings counts as no tags.
function tagSegments(tags: readonly string[] | null | undefined): string[] {
  return (Array.isArray(tags) ? tags : [])
    .filter((tag): tag is string => typeof tag === 'string' && tag.startsWith('en:'))
    .map((tag) => tag.slice(3).replace(/-/g, ' ').trim())
    .filter(Boolean)
    .reverse()
    .slice(0, MAX_TAGS)
}

// Everything the product databases say the product is, for the guards and for Gemini.
function categoryText(input: ExpiryInput): string[] {
  return [...categorySegments(input.productCategory), ...tagSegments(input.categoryTags)]
}

function isBroad(segment: string): boolean {
  return BROAD_SEGMENTS.has(foldText(segment).toLowerCase())
}

// Open Food Facts files packaged sweet biscuits ("Chocolate biscuits", "en:sandwich-biscuits") under
// the British word. FoodKeeper's "Biscuits" row is American refrigerated dough, which has no date of
// its own, and its cookie rows are split into soft and crispy. A packaged sweet biscuit is the crisp
// kind, so when the database calls the product a biscuit, biscuit and cookie are searched as
// "crispy cookies". Anything that says it is dough, chilled, soft, or a mix keeps its own words.
const BISCUIT_CATEGORY = /\bbiscuits?\b/i
const NOT_A_CRISP_BISCUIT =
  /\b(doughs?|refrigerated|chilled|frozen|soft|chewy|mix(es)?|pancakes?|scones?|crackers?)\b/i

function isCrispBiscuit(input: ExpiryInput): boolean {
  const categories = categoryText(input).filter((segment) => !isBroad(segment))
  return (
    categories.some((segment) => BISCUIT_CATEGORY.test(segment)) &&
    ![input.name, ...categories].some((text) => NOT_A_CRISP_BISCUIT.test(foldText(text)))
  )
}

// FoodKeeper's grated row is parmesan's. Grated mozzarella or cheddar is the shredded kind, so
// "Mozzarella Grated" (Armstrong) is searched as shredded. The hard grating cheeses keep the word.
const SHREDDING_CHEESE = /\b(mozzarella|cheddar|colby|monterey|marble|pizza|mexican|swiss|gouda|provolone|havarti)\b/i
const GRATING_CHEESE = /\b(parmesan|parmigiano|romano|pecorino|asiago|grana)\b/i

// Bounded rewrites of what is searched, each for a food FoodKeeper files under another name. Only
// whole phrases change, and only for the product they are true of.
function rewrite(text: string, crispBiscuit: boolean): string {
  // American cheese is process cheese by definition (21 CFR 133.169), the row Kraft Singles belong on.
  let query = text.replace(/\bamerican cheeses?\b/gi, 'processed cheese')
  if (crispBiscuit && !/\bcrispy\b/i.test(query)) {
    query = query.replace(/\b(biscuits?|cookies?)\b/gi, 'crispy cookies')
  }
  // FoodKeeper's row is "Ketchup, cocktail, or chili sauce", and every word of it the name lacks
  // costs a point, so "Tomato Ketchup" tied Tomato paste. Only a name that ends in ketchup is the
  // condiment: "Ketchup Chips" are not.
  query = query.replace(/\b(tomato\s+)?(ketchup|catsup)\s*$/i, 'ketchup, cocktail, or chili sauce')
  if (/\bgrated\b/i.test(query) && SHREDDING_CHEESE.test(query) && !GRATING_CHEESE.test(query)) {
    query = query.replace(/\bgrated\b/gi, 'shredded')
  }
  return query
}

// Open Food Facts files soy milk as "Soy-based drinks", under "Plant-based milk alternatives" and
// "Milk substitutes". None of them reach FoodKeeper's "Soy milk": "drinks" ties supplement drinks
// with soda. The parents say soy milk only for a product that says soy somewhere (Silk's name is
// "Soy Protein"): an almond drink has them too.
const SOY_DRINK = /^soya? (based )?(drinks?|beverages?|milks?)$/
const MILK_ALTERNATIVE = /^(plant based )?milk (substitutes?|alternatives?)$/
const SOY = /\bsoya?\b/

function segmentKey(segment: string): string {
  return foldText(segment).toLowerCase().replace(/-/g, ' ').trim()
}

function soyMilk(segments: string[], name: string): string[] {
  const keys = segments.map(segmentKey)
  const soy = SOY.test(segmentKey(name)) || keys.some((key) => SOY_DRINK.test(key))
  return segments.map((segment, index) =>
    SOY_DRINK.test(keys[index]) || (soy && MILK_ALTERNATIVE.test(keys[index])) ? 'soy milk' : segment,
  )
}

function isSoyMilk(input: ExpiryInput): boolean {
  return soyMilk(categoryText(input), input.name).includes('soy milk')
}

// Words to search FoodKeeper with, best first, and whether each is the product's own name.
// Marketing names ("Cheerios", "Tiny Twists") share no word with it, but the product's category
// often does ("Breakfast cereals", "Pretzel"). The display category goes first, in its own order,
// then the English tags, narrowest first. Language-tagged segments ("fr:Goûter") and slugs
// ("snacks-sales") can't match its English.
function searchNames(input: ExpiryInput, crispBiscuit: boolean): { query: string; fromName: boolean }[] {
  const fromCategory = soyMilk(categoryText(input), input.name).filter(
    (segment) => !isBroad(segment) && !/[:-]/.test(segment),
  )

  const seen = new Set<string>()
  const queries: { query: string; fromName: boolean }[] = []
  for (const [index, text] of [input.name, ...fromCategory].entries()) {
    const query = rewrite(text, crispBiscuit)
    const key = foldText(query).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    queries.push({ query, fromName: index === 0 })
  }
  return queries
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
    [input.name, ...categoryText(input)].some((text) => UNSUPPORTED_DRINK.test(text)) ||
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
    !NUTRITION_DRINK.test(`${input.name} ${input.brand ?? ''} ${categoryText(input).join(' ')}`)
  )
}

function isDrinkRow(id: number): boolean {
  const row = getFoodKeeper().products.find((product) => product.id === id)
  return row?.categoryId === BEVERAGES_CATEGORY || OTHER_DRINK_ROWS.has(id)
}

// Every row a drink can be outside the Beverages category: the milks, buttermilk, kefir, eggnog,
// drinkable yogurt, and the shelf-stable drinks. Wider than OTHER_DRINK_ROWS, which only lists the
// ones with no unopened date.
const DRINKABLE_ROWS = new Set([2, 20, 25, 27, 33, 421, 427, 428, 429, 543, 644, 651, 652, 659])
// A category that ends by naming a drink. Open Food Facts' parents for foods of every kind
// ("Plant-based foods and beverages", "Vegetable-based foods and beverages") don't.
const DRINK_SEGMENT = /\b(drinks?|beverages?|milk (substitutes?|alternatives?))$/
const FOODS_AND_BEVERAGES = /\bfoods and beverages$/

function isDrinkProduct(input: ExpiryInput): boolean {
  return categoryText(input)
    .map(segmentKey)
    .some((key) => DRINK_SEGMENT.test(key) && !FOODS_AND_BEVERAGES.test(key))
}

// Fruit cake was the tie winner for every cake ("Steam Cake", "Chocolate Cake"). A cake is only
// fruit cake when the product says fruit.
const FRUIT_CAKE_ROW = 203

// A match on a row the product gives no reason for. "Textured soy protein" (two years in the
// pantry) for a soy drink named "Soy Protein" is one, whether the engine or Gemini picked it: a
// product its database calls a drink is only ever a drink row.
function isUnfounded(id: number, input: ExpiryInput): boolean {
  if (id === FRUIT_CAKE_ROW) {
    return ![input.name, ...categoryText(input)].some((text) => /\bfruit/.test(segmentKey(text)))
  }
  return isDrinkProduct(input) && !isDrinkRow(id) && !DRINKABLE_ROWS.has(id)
}

// Whether a FoodKeeper row is named with a word of the product's own name.
function sharesNameWord(id: number, input: ExpiryInput): boolean {
  const row = getFoodKeeper().products.find((product) => product.id === id)
  const words = new Set(tokenize(input.name))
  return tokenize(row?.name ?? null).some((word) => words.has(word))
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
  const crispBiscuit = isCrispBiscuit(input)
  const item = {
    name: input.name,
    brand: input.brand,
    barcode: input.barcode,
    // A crisp biscuit is a bakery item, whatever the trail's last segment says. "Snack dolci"
    // (Italian: sweet snacks) made Nutella Biscuits a Pantry item, where FoodKeeper has no cookies.
    // Soy milk is filed under dairy, and a Beverages hint ("Soy-based drinks") searches only drinks.
    category: crispBiscuit ? 'Bakery' : isSoyMilk(input) ? 'Dairy' : input.category,
    purchaseDate: input.purchaseDate,
    // Context for Gemini only. The local engine never reads these.
    productCategory: input.productCategory,
    categoryTags: tagSegments(input.categoryTags),
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
  // A category or tag that reaches a food with no date ("tomato sauces" for ketchup) is held, not
  // final: a later one can still reach a row named after the product. A drink row's "check the
  // package" is FoodKeeper's own answer, and so is any no-date row the product's name reaches.
  let held: ExpirySuggestion | undefined
  for (const { query, fromName } of searchNames(input, crispBiscuit)) {
    const result = await suggestWithFallback(engine, { ...item, name: query }, { config: localOnly })
    if (!isResolved(result) || isUnfounded(result.selected!.id, input)) continue
    const id = result.selected!.id
    if (!fromName && !result.range && !isDrinkRow(id)) {
      held ??= toSuggestion(result, fromName, input)
      continue
    }
    if (held && !sharesNameWord(id, input)) continue
    return toSuggestion(result, fromName, input)
  }
  if (held) return held

  if (!config.enabled) return noDate(NO_SUGGESTION)

  // At most one Gemini request per suggestion: the engine makes one call for the real name.
  const result = await suggestWithFallback(engine, item, {
    config,
    client: limitedClient(userId, createGeminiClient(config)),
  })
  return result.aiUsed && isResolved(result) && !isUnfounded(result.selected!.id, input)
    ? toSuggestion(result, true, input)
    : noDate(NO_SUGGESTION)
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
  if (isUnfounded(shelfLife.foodKeeperId, input)) return null

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
