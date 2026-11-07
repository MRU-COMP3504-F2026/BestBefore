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
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', '')
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
