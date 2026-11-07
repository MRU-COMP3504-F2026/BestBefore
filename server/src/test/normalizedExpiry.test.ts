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
