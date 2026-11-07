import { FoodKeeper } from '../../../expiry-tests/foodkeeper.js'
import { FOODKEEPER_PATH } from '../../../expiry-tests/strategies.js'
import {
  suggestExpiry,
  suggestionFromShelfLife,
  type ExpiryInput,
  type ShelfLife,
} from '../food/expirySuggestion.js'

const NO_DRINK_DATE = { status: 'none', message: 'FoodKeeper has no unopened date for this drink. Check the package.' }
const FIRST_BOUGHT = '2026-11-07'
// Dates where adding months or days can roll over.
const LATER_DATES = ['2027-01-31', '2028-02-29', '2026-12-31']

function product(name: string, overrides: Partial<ExpiryInput> = {}): ExpiryInput {
  return { name, brand: null, barcode: null, category: null, productCategory: null, purchaseDate: FIRST_BOUGHT, ...overrides }
}

async function storedFor(input: ExpiryInput): Promise<ShelfLife> {
  const suggestion = await suggestExpiry(input, 'test-user')
  if (suggestion.status !== 'suggested') throw new Error(`no shelf life for ${input.name}`)
  return suggestion.shelfLife
}

// All a browser needs to move the date when the date bought changes, without the engine.
function addLength(purchaseDate: string, amount: number, unit: 'days' | 'months') {
  const [year, month, day] = purchaseDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (unit === 'days') date.setDate(date.getDate() + amount)
  else date.setMonth(date.getMonth() + amount)
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

describe('product-level shelf life', () => {
  beforeEach(() => {
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('holds the match, its length and where they came from, with no date', async () => {
    const shelfLife = await storedFor(product('Greek Yogurt'))

    expect(shelfLife).toMatchObject({
      matchedFood: 'Yogurt',
      storage: 'fridge',
      source: 'USDA',
      confidence: 'high',
      aiUsed: false,
      length: { unit: expect.stringMatching(/^(days|months)$/) },
      window: { metric: expect.any(String) },
    })
    expect(JSON.stringify(shelfLife)).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it.each([
    ['a USDA length', 'Canned Tuna', { unit: 'months', min: 36, max: 36 }, 'USDA'],
    ['an open-ended row, capped', 'Spring Water', { unit: 'months', min: 24, max: 24 }, 'estimated'],
  ])('reports %s', async (_label, name, length, source) => {
    expect(await storedFor(product(name))).toMatchObject({ length, source })
  })

  it('has none when no date was offered', async () => {
    for (const name of ['Zzyzx', 'Whole Milk', 'Monster Energy Zero Ultra', 'Soy Beverage']) {
      expect(await suggestExpiry(product(name), 'test-user')).not.toHaveProperty('shelfLife')
    }
  })

  it('agrees with a fresh search and with plain date arithmetic, for every FoodKeeper row', async () => {
    const { products } = new FoodKeeper(FOODKEEPER_PATH)
    let compared = 0

    for (const row of products) {
      const input = product(row.subtitle ? `${row.subtitle} ${row.name}` : row.name)
      const first = await suggestExpiry(input, 'test-user')
      if (first.status !== 'suggested') continue

      for (const purchaseDate of [FIRST_BOUGHT, ...LATER_DATES]) {
        const later = { ...input, purchaseDate }
        const fresh = await suggestExpiry(later, 'test-user')
        expect(suggestionFromShelfLife(later, JSON.parse(JSON.stringify(first.shelfLife)))).toEqual(fresh)

        const { length } = first.shelfLife
        expect(fresh).toMatchObject({
          earliest: addLength(purchaseDate, length.min, length.unit),
          latest: addLength(purchaseDate, length.max, length.unit),
        })
      }
      compared++
    }

    expect(compared).toBeGreaterThan(100)
  })

  it('counts from the date of this purchase', async () => {
    const stored = await storedFor(product('Canned Tuna'))

    expect(suggestionFromShelfLife(product('Canned Tuna', { purchaseDate: '2027-01-15' }), stored)).toMatchObject({
      status: 'suggested',
      earliest: '2030-01-15',
    })
  })

  it('keeps the provenance it was saved with', async () => {
    const stored: ShelfLife = { ...(await storedFor(product('Greek Yogurt'))), confidence: 'low', aiUsed: true }

    expect(suggestionFromShelfLife(product('Greek Yogurt'), stored)).toMatchObject({
      confidence: 'low',
      aiUsed: true,
      shelfLife: { confidence: 'low', aiUsed: true },
    })
  })

  describe('a saved row the guards now refuse', () => {
    it.each<[string, Partial<ExpiryInput>]>([
      ['Monster Energy Zero Ultra', { brand: 'Monster', productCategory: 'Artificially sweetened beverages, Energy drinks' }],
      ['Canned Energy Drink', { category: 'Beverages' }],
      ['Red Bull', {}],
      ['Canned Soda', {}],
    ])('offers no date or shelf life for %s', async (name, overrides) => {
      const stored = await storedFor(product('Canned Tuna'))

      expect(suggestionFromShelfLife(product(name, overrides), stored)).toEqual(NO_DRINK_DATE)
    })

    it('takes #558 back from a drink with no nutrition word', async () => {
      const stored = await storedFor(product('Canned Nutrition Drink', { brand: 'Ensure', category: 'Beverages' }))

      expect(stored.foodKeeperId).toBe(558)
      expect(suggestionFromShelfLife(product('Canned Sports Drink'), stored)).toEqual(NO_DRINK_DATE)
      expect(suggestionFromShelfLife(product('Canned Nutrition Drink', { brand: 'Ensure' }), stored)).toMatchObject({
        status: 'suggested',
      })
    })
  })

  describe('a stored value that cannot be trusted is treated as not stored', () => {
    it.each<[string, (stored: ShelfLife) => unknown]>([
      ['nothing', () => null],
      ['the wrong shape', () => ({ earliest: '2030-01-01' })],
      ['a row FoodKeeper does not have', (stored) => ({ ...stored, foodKeeperId: 999999 })],
      ['a window the row does not have', (stored) => ({ ...stored, label: 'Somewhere else' })],
      ['a window that has changed', (stored) => ({ ...stored, window: { min: 99, max: 99, metric: 'Years' } })],
      ['a missing window', (stored) => ({ ...stored, window: null })],
      ['a length that has changed', (stored) => ({ ...stored, length: { unit: 'months', min: 99, max: 99 } })],
      ['a different source', (stored) => ({ ...stored, source: 'estimated' })],
    ])('%s', async (_label, tamper) => {
      const stored = await storedFor(product('Greek Yogurt'))

      expect(suggestionFromShelfLife(product('Greek Yogurt'), tamper(stored))).toBeNull()
    })
  })
})
