import { readFileSync } from 'node:fs'
import type { FinalRecord } from '../../../testscripts/normalizer.js'
import { appCategory, suggestExpiry } from '../food/expirySuggestion.js'

// Real normalizer output, captured live, through the real engine. See docs/scanflow-expiry.md.
type Fixture = {
  items: { scannedBarcode: string; expectedMatch: string | null; final: FinalRecord }[]
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL('../../../expiry-tests/fixtures/normalized-products.json', import.meta.url), 'utf8'),
)

function suggest(product: FinalRecord) {
  return suggestExpiry(
    {
      name: product.name ?? '',
      brand: product.brand,
      barcode: product.barcode,
      category: appCategory(product.category),
      productCategory: product.category,
      purchaseDate: '2026-11-07',
    },
    'test-user',
  )
}

describe('real normalized products through the expiry engine', () => {
  // This checks the local engine, whatever a developer's .env.local says.
  beforeEach(() => {
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(fixture.items.map((item) => [item.final.name, item] as const))('%s', async (_name, item) => {
    const suggestion = await suggest(item.final)

    if (item.expectedMatch === null) {
      expect(suggestion.status).toBe('none')
    } else {
      expect(suggestion).toMatchObject({ status: 'suggested', aiUsed: false })
      expect(suggestion.status === 'suggested' && suggestion.matchedFood).toMatch(
        new RegExp(`^${item.expectedMatch.replace(/[()]/g, '\\$&')}`),
      )
    }
  })

  it('keeps the shapes the normalizer produces', () => {
    for (const { final } of fixture.items) {
      expect('source' in final !== 'sources' in final).toBe(true)
    }
    expect(fixture.items.some(({ final }) => 'source' in final)).toBe(true)
    expect(fixture.items.some(({ final }) => 'sources' in final)).toBe(true)
  })
})

// Hand-built records in the shape the normalizer now produces, not live captures. Each is the kind of
// product the live fixture showed going wrong, with the tags Open Food Facts files it under.
describe('names and English category tags', () => {
  beforeEach(() => {
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const run = (name: string, productCategory: string | null, categoryTags: string[] | null = null) =>
    suggestExpiry(
      {
        name,
        brand: 'Brand',
        barcode: '0000000000000',
        category: appCategory(productCategory),
        productCategory,
        categoryTags,
        purchaseDate: '2026-11-07',
      },
      'test-user',
    )
  const matched = async (...args: Parameters<typeof run>) => {
    const suggestion = await run(...args)
    return suggestion.status === 'suggested' ? suggestion.matchedFood : null
  }

  it('finds a brand-named biscuit from its English tags when the category text is French', async () => {
    expect(await matched('Prince', 'Snacks sucrés, fr:Biscuits fourrés')).toBeNull()
    expect(
      await matched('Prince', 'Snacks sucrés, fr:Biscuits fourrés', [
        'en:snacks',
        'en:sweet-snacks',
        'en:biscuits-and-cakes',
        'en:biscuits',
        'en:chocolate-biscuits',
      ]),
    ).toBe('Cookies (crispy)')
  })

  it('searches the narrowest tag first', async () => {
    // "nuts" alone reaches Nuts (jars or cans), with another date.
    const tags = ['en:plant-based-foods-and-beverages', 'en:plant-based-foods', 'en:nuts', 'en:almonds', 'en:shelled-almonds']

    expect(await matched('Zzyzx', null, tags)).toBe('Almonds  (no shell)')
  })

  it('tells shelled almonds apart, and leaves plain almonds to the user', async () => {
    expect(await matched('Shelled almonds', 'Almonds')).toBe('Almonds  (no shell)')
    // In shell and no shell have different dates, and nothing says which this is.
    expect((await run('Almonds', 'Almonds')).status).toBe('none')
  })

  it.each([
    ['Buttermilk Biscuits', 'Refrigerated doughs, Biscuit doughs'],
    ['Soft Baked Chocolate Chip Cookies', 'Biscuits, Soft cookies'],
    ['Butter Crackers', 'Biscuits, Crackers'],
  ])('does not call %s a crisp cookie', async (name, category) => {
    expect(await matched(name, category)).not.toBe('Cookies (crispy)')
  })

  it('offers no date where FoodKeeper has none, however the spread is found', async () => {
    const suggestion = await run('Zzyzx', 'Petit-déjeuners, Produits à tartiner', ['en:spreads', 'en:hazelnut-spreads'])

    expect(suggestion.status).toBe('none')
  })

  it('applies the drink guard to the tags', async () => {
    const suggestion = await run('Zzyzx', null, ['en:beverages', 'en:carbonated-drinks', 'en:sodas', 'en:colas'])

    expect(suggestion).toEqual({ status: 'none', message: expect.stringMatching(/drink/) })
  })
})

// Cached records Brian reported, with the name, category and English tags Open Food Facts gave
// (fetched once on 2026-11-07 for the read-only audit; no request is made here).
describe('reported cached records', () => {
  beforeEach(() => {
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const NO_DRINK_DATE = { status: 'none', message: 'FoodKeeper has no unopened date for this drink. Check the package.' }
  const NO_SUGGESTION = { status: 'none', message: expect.stringMatching(/^No reliable suggestion/) }

  const SILK = {
    name: 'Soy Protein',
    brand: 'Silk',
    barcode: '025293600713',
    productCategory: 'Dairies, Soy-based drinks',
    categoryTags: [
      'en:beverages-and-beverages-preparations',
      'en:plant-based-foods-and-beverages',
      'en:beverages',
      'en:plant-based-foods',
      'en:dairies',
      'en:legumes-and-their-products',
      'en:dairy-substitutes',
      'en:milk-substitutes',
      'en:plant-based-beverages',
      'en:plant-based-milk-alternatives',
      'en:legume-based-drinks',
      'en:soy-based-drinks',
    ],
  }
  const HEINZ = {
    name: 'Tomato Ketchup',
    brand: 'Heinz',
    barcode: '057000063085',
    productCategory: 'Tomato Ketchup, Groceries',
    categoryTags: [
      'en:plant-based-foods-and-beverages',
      'en:plant-based-foods',
      'en:fruits-and-vegetables-based-foods',
      'en:vegetable-based-foods-and-beverages',
      'en:condiments',
      'en:vegetables-based-foods',
      'en:tomatoes-and-their-products',
      'en:sauces',
      'en:tomato-sauces',
      'en:ketchup',
      'en:tomato-ketchup',
    ],
  }

  type CachedRecord = { name: string; brand: string | null; productCategory: string | null; categoryTags?: string[] | null }
  const run = (record: CachedRecord) =>
    suggestExpiry(
      {
        barcode: null,
        categoryTags: null,
        ...record,
        category: appCategory(record.productCategory),
        purchaseDate: '2026-11-07',
      },
      'test-user',
    )

  it("finds soy milk for Silk's 'Soy Protein' and says to check the package", async () => {
    expect(await run(SILK)).toEqual(NO_DRINK_DATE)
    // A row saved before the tags were kept has only the category.
    expect(await run({ ...SILK, categoryTags: null })).toEqual(NO_DRINK_DATE)
  })

  it('never gives a soy drink a soy food row', async () => {
    // With no Beverages hint, "Soy Protein" alone reaches Textured soy protein with high confidence.
    const drink = { name: 'Soy Protein', brand: 'Silk', productCategory: 'Plant-based beverages' }

    expect(await run(drink)).not.toMatchObject({ matchedFood: expect.stringMatching(/soy protein/i) })
    expect(await run({ ...drink, categoryTags: ['en:soy-based-drinks'] })).toEqual(NO_DRINK_DATE)
  })

  it('calls the milk-substitute tags soy milk only for a soy product', async () => {
    const almond = {
      name: 'Almond Breeze Original',
      brand: 'Blue Diamond',
      productCategory: null,
      categoryTags: ['en:plant-based-beverages', 'en:milk-substitutes', 'en:plant-based-milk-alternatives'],
    }

    expect(await run(almond)).not.toEqual(NO_DRINK_DATE)
  })

  it.each([
    ['the Open Food Facts record', HEINZ],
    ['an old row with no tags', { ...HEINZ, categoryTags: null }],
    ['the bare name', { name: 'Ketchup', brand: 'Heinz', productCategory: null }],
  ])('matches Heinz ketchup to the ketchup row, from %s', async (_case, record) => {
    expect(await run(record)).toMatchObject({
      status: 'suggested',
      matchedFood: 'Ketchup, cocktail, or chili sauce',
      shelfLife: { length: { unit: 'months', min: 12, max: 12 } },
    })
  })

  it('does not read ketchup chips as the condiment', async () => {
    const suggestion = await run({ name: 'Ketchup Chips', brand: 'Lays', productCategory: null })

    expect(suggestion).not.toMatchObject({ matchedFood: expect.stringMatching(/^Ketchup/) })
  })

  it('does not stop at a no-date category when a later one names the product', async () => {
    // Display categories run broad to specific, so "Tomato sauces" (read the package) comes first.
    const record = { name: 'Heinz Ketchup Squeeze Bottle', brand: 'Heinz', productCategory: 'Sauces, Tomato sauces, Ketchup' }

    expect(await run(record)).toMatchObject({ status: 'suggested', matchedFood: 'Ketchup, cocktail, or chili sauce' })
  })

  it('keeps a no-date category when nothing later names the product', async () => {
    // "Creams" alone ties two dated cream rows. Neither is this product.
    const record = { name: 'Gay Lea Original', brand: 'Gay Lea', productCategory: 'Dairies, Creams, Sour creams' }

    expect(await run(record)).toEqual(NO_SUGGESTION)
  })

  it('keeps no date for Compliments sour cream', async () => {
    expect(
      await run({ name: 'Sour Cream 14%', brand: 'Compliments', productCategory: 'Dairies, Creams, Sour creams' }),
    ).toEqual(NO_SUGGESTION)
  })

  it('matches grated mozzarella to shredded cheese, and leaves grated parmesan where it was', async () => {
    expect(await run({ name: 'Mozzarella Grated', brand: 'Armstrong', productCategory: null })).toMatchObject({
      status: 'suggested',
      matchedFood: 'Cheese (shredded; cheddar, mozzarella, etc.)',
      shelfLife: { length: { unit: 'months', min: 1, max: 1 } },
    })
    expect(await run({ name: 'Grated Parmesan Cheese', brand: 'Kraft', productCategory: null })).toMatchObject({
      matchedFood: 'Cheese (parmesan; shredded or grated)',
    })
  })

  it('never calls a cake fruit cake unless it says fruit', async () => {
    for (const name of ['Steam Cake', 'Steamed Cake', 'Chocolate Cake']) {
      const suggestion = await run({ name, brand: 'T&T', productCategory: 'Cakes' })
      expect(suggestion.status === 'suggested' && suggestion.matchedFood).not.toBe('Fruit cake')
    }
    expect(await run({ name: 'Christmas Fruit Cake', brand: null, productCategory: 'Cakes' })).toMatchObject({
      matchedFood: 'Fruit cake',
    })
  })
})

describe('appCategory', () => {
  it.each([
    ['Dairies, Milks', 'Dairy'],
    ['Breakfast cereals', 'Pantry'],
    ['Spring waters, Unsweetened beverages', 'Beverages'],
    ['Bircher-style sugar free muesli flakes with fruits', 'Pantry'],
    // The taxonomy root must not make everything a beverage.
    ['Food, Beverages & Tobacco > Food Items > Dairy Products > Cheese', 'Dairy'],
    ['Food, Beverages & Tobacco > Food Items > Frozen Vegetables', 'Frozen'],
    ['Food, Beverages & Tobacco > Food Items', null],
    ['Toys & Games', null],
    [null, null],
    ['', null],
  ])('%s -> %s', (text, label) => {
    expect(appCategory(text)).toBe(label)
  })
})
