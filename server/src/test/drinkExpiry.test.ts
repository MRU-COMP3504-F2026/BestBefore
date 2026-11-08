import { appCategory, suggestExpiry } from '../food/expirySuggestion.js'

const NO_DRINK_DATE = { status: 'none', message: 'FoodKeeper has no unopened date for this drink. Check the package.' }
const NO_SUGGESTION = { status: 'none', message: expect.stringMatching(/^No reliable suggestion/) }

function suggest(name: string, brand: string | null, category: string | null, barcode: string | null = null) {
  return suggestExpiry(
    {
      name,
      brand,
      barcode,
      category: appCategory(category),
      productCategory: category,
      purchaseDate: '2026-11-07',
    },
    'test-user',
  )
}

describe('drinks FoodKeeper has no unopened date for', () => {
  // This checks the local engine, whatever a developer's .env.local says.
  beforeEach(() => {
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Open Food Facts' record for this can, captured live on 2026-11-07. The word "Ultra" reaches
  // Milk (ultra-pasteurized) in the engine.
  it.each(['070847015208', '0070847015208'])('offers no date for Monster, barcode %s', async (barcode) => {
    const suggestion = await suggest(
      'Monster Energy Zero Ultra',
      'Monster',
      'Artificially sweetened beverages, Energy drinks',
      barcode,
    )

    expect(suggestion).toEqual(NO_DRINK_DATE)
  })

  it.each<[string, string | null, string | null]>([
    ['Canned Energy Drink', null, 'Beverages'],
    ['Canned Energy Drink', null, null],
    ['Energy drinks', 'Monster', 'Energy drinks'],
    ['Monster Zero Ultra', 'Monster', null],
    ['Zero Ultra', 'Monster, Monster Energy', 'Beverages'],
    ['Red Bull', 'Red Bull', 'Energy drinks'],
    ['Red Bull', null, null],
    ['Sugarfree', 'Red Bull', null],
    ['Rockstar Energy Drink Original', 'Rockstar', 'Beverages'],
    ['Pepsi', 'Pepsi', 'Soda'],
    ['Soda', null, null],
    ['Canned Soda', null, 'Beverages'],
    ['Cream Soda', null, null],
    ['Coca-Cola Original', 'Coca-Cola', 'Colas, pt:bebidas cafeína'],
    ['Ginger Ale', null, 'Carbonated drinks'],
    ['Lemon Lime', null, 'Food, Beverages & Tobacco > Beverages > Soft Drinks'],
    // Rows that only have an after-opening window, or say to read the package.
    ['Soy Milk', 'Silk', 'Plant-based milks'],
    ['Soy Beverage', null, 'Beverages'],
    ['Silk Soy Beverage', 'Silk', 'Soy milks, Beverages'],
    ['Coconut Milk', null, 'Dairy'],
    ['Carton Orange Juice', 'Tropicana', 'Fruit juices'],
    ['Orange Juice', 'Tropicana', 'Juices'],
    // "Canned" and "drink" alone reach the nutrition supplement row. They don't make it one.
    ['Canned Sports Drink', null, 'Beverages'],
    ['Canned Drink', null, 'Beverages'],
  ])('%s, brand %s, category %s', async (name, brand, category) => {
    expect(await suggest(name, brand, category)).toEqual(NO_DRINK_DATE)
  })
})

describe('foods and drinks the guard must leave alone', () => {
  beforeEach(() => {
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each<[string, string | null, string | null, RegExp]>([
    ['Canned Tuna', null, null, /^Tuna \(canned\)/],
    ['Coconut Water', 'Vita Coco', 'Beverages', /^Coconut water/],
    ['Coconut Water', null, null, /^Coconut water/],
    ['Canned Corn', null, null, /^Canned goods/],
    ['Canned Soup', null, 'Canned soups', /^Canned goods/],
    ['Spring Water', null, 'Spring waters, Unsweetened beverages', /^Water/],
    ['Fruit Juice in Cartons', null, 'Beverages', /^Fruit Juice in cartons/],
    // The one kind of drink #558 is for.
    ['Canned Nutrition Drink', 'Ensure', 'Beverages', /^Nutrition supplement drinks \(canned\)/],
    // Soda and energy as words in a food's name.
    ['Baking Soda', null, 'Pantry', /^Baking soda/],
    ['Soda Crackers', null, 'Crackers', /^Crackers/],
  ])('still suggests a date for %s, brand %s, category %s', async (name, brand, category, matchedFood) => {
    const suggestion = await suggest(name, brand, category)

    expect(suggestion).toMatchObject({ status: 'suggested', matchedFood: expect.stringMatching(matchedFood) })
  })

  it('keeps the plain message for other foods that have no date', async () => {
    expect(await suggest('Whole Milk', null, 'Dairy')).toEqual(NO_SUGGESTION)
  })

  it('does not treat a beverage category as a drink with no date', async () => {
    expect(await suggest('Zzyzx', null, 'Beverages')).toEqual(NO_SUGGESTION)
  })

  it.each<[string, string | null]>([
    ['Monster Munch', 'Walkers'],
    ['Monster Cookies', null],
    // A powder has its own FoodKeeper row, so it is left to the engine.
    ['Energy Drink Mix', null],
  ])('does not read %s as the energy drink', async (name, brand) => {
    expect(await suggest(name, brand, null)).not.toEqual(NO_DRINK_DATE)
  })
})
