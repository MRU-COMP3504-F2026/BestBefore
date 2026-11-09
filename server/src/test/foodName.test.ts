import { readFileSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import request from 'supertest'
import { windowLength } from '../../../expiry-tests/expiry.js'
import { FoodKeeper } from '../../../expiry-tests/foodkeeper.js'
import { FOODKEEPER_PATH } from '../../../expiry-tests/strategies.js'
import { aggregate, foodName, normalize, withFoodName, type FinalRecord } from '../../../testscripts/normalizer.js'
import { app } from '../app.js'
import { db as appDb } from '../db/index.js'
import { items } from '../db/schema.js'
import { appCategory, suggestExpiry, type ExpiryInput } from '../food/expirySuggestion.js'
import { saveItem } from '../food/items.js'

// A real Postgres in memory, built by the real migrations, as in items.test.ts.
vi.mock('../db/index.js', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const schema = await import('../db/schema.js')
  return { db: drizzle(new PGlite(), { schema }) }
})

const db = appDb as unknown as PgliteDatabase<Record<string, never>>

// Hand-built in the shape of the record reported for 00629307123313, not a live capture: no request
// is made here.
const SCANNED = '00629307123313'
const KEY = '00629307123313'
const PLANT_TAGS = ['en:plant-based-foods-and-beverages', 'en:plant-based-foods']
const LITTLE_YELLOWS = {
  code: '0629307123313',
  lang: 'en',
  product_name: 'LITTLE YELLOWS',
  brands: 'THE LITTLE POTATO CO.',
  categories: 'Plant-based foods',
  categories_tags: PLANT_TAGS,
  ingredients_text: 'yellow creamer potatoes',
}
const RESELLER = {
  total: 1,
  items: [
    {
      ean: '0629307123313',
      title: 'The Little Potato Company Little Yellows 1.5 lb',
      brand: 'The Little Potato Company',
      description: 'Little potatoes, big flavour. Great roasted with onions and garlic. Free shipping!',
      images: [],
    },
  ],
}

function openFacts(product: Record<string, unknown>) {
  return normalize('Open Facts', { result: { id: 'product_found' }, product }, SCANNED)!
}

describe('foodName', () => {
  it("adds back the noun a name leaves off its one ingredient, in the name's own case", () => {
    expect(foodName('LITTLE YELLOWS', 'yellow creamer potatoes')).toBe('LITTLE YELLOWS POTATOES')
    expect(foodName('Little Yellows', 'Ingredients: Yellow creamer potatoes.')).toBe('Little Yellows Potatoes')
    expect(foodName('Russet', 'russet potatoes')).toBe('Russet Potatoes')
  })

  it.each([
    ['the name already says the food', 'Baby Spinach', 'baby spinach'],
    ['the singular is in the name', 'Potato Yellows', 'yellow creamer potatoes'],
    ['a brand name shares no word with it', 'Spaghetti Nº5', 'DURUM WHEAT SEMOLINA PASTA'],
    ['there is more than one ingredient', 'Little Yellows', 'yellow potatoes, canola oil'],
    ['the list is a recipe', 'Little Yellows', 'yellow potatoes and herbs'],
    ['the list has a percentage', 'Yellows', 'yellow potatoes 98%'],
    ['the name is not English', 'Amandes décortiquées', 'shelled almonds'],
    ['the list is not English', 'Petites Jaunes', 'pommes de terre jaunes'],
    ['there is no list', 'LITTLE YELLOWS', null],
  ])('leaves the name alone when %s', (_case, name, ingredients) => {
    expect(foodName(name, ingredients)).toBe(name)
  })

  it('leaves every captured fixture name as it was', () => {
    const fixture: { items: { final: FinalRecord }[] } = JSON.parse(
      readFileSync(new URL('../../../expiry-tests/fixtures/normalized-products.json', import.meta.url), 'utf8'),
    )

    for (const { final } of fixture.items) {
      expect(foodName(final.name, final.ingredients)).toBe(final.name)
    }
  })
})

describe('the normalized name', () => {
  it('completes the Open Food Facts name and nothing else', () => {
    const record = openFacts(LITTLE_YELLOWS)

    expect(record).toMatchObject({
      name: 'LITTLE YELLOWS POTATOES',
      brand: 'THE LITTLE POTATO CO.',
      category: 'Plant-based foods',
      ingredients: 'yellow creamer potatoes',
    })
  })

  it("never takes a word from a reseller's description", () => {
    const upc = normalize('UPCitemdb', RESELLER, SCANNED)!
    const merged = aggregate([openFacts({ ...LITTLE_YELLOWS, ingredients_text: null }), upc], SCANNED)

    // "onions" and "garlic" are in the description. Without an ingredient list the name stays.
    expect(merged.name).toBe('LITTLE YELLOWS')
    expect(merged.sources).toEqual(['Open Facts', 'UPCitemdb'])
    expect(aggregate([openFacts(LITTLE_YELLOWS), upc], SCANNED).name).toBe('LITTLE YELLOWS POTATOES')
  })
})

describe('withFoodName', () => {
  const saved = openFacts({ ...LITTLE_YELLOWS, product_name: 'LITTLE YELLOWS', ingredients_text: null })
  const old = { ...saved, ingredients: 'yellow creamer potatoes' }

  it('completes a record the normalizer built, single or merged', () => {
    expect(withFoodName(old).name).toBe('LITTLE YELLOWS POTATOES')
    const merged = { ...old, source: undefined, sources: ['Open Facts', 'UPCitemdb'] }
    expect(withFoodName(merged).name).toBe('LITTLE YELLOWS POTATOES')
  })

  it('returns anything else as it is, such as a name a user confirmed from a photo', () => {
    const confirmed = { ...old, source: 'AI Vision' }

    expect(withFoodName(confirmed)).toBe(confirmed)
    expect(withFoodName(saved)).toBe(saved)
  })
})

describe('FoodKeeper for a name that leaves out the food', () => {
  beforeEach(() => {
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const run = (fields: Partial<ExpiryInput>) =>
    suggestExpiry(
      {
        name: 'LITTLE YELLOWS',
        brand: 'THE LITTLE POTATO CO.',
        barcode: SCANNED,
        category: appCategory('Plant-based foods'),
        productCategory: 'Plant-based foods',
        categoryTags: PLANT_TAGS,
        purchaseDate: '2026-11-07',
        ...fields,
      },
      'test-user',
    )

  it("finds FoodKeeper's potatoes row for the completed name", async () => {
    expect(await run({ name: 'LITTLE YELLOWS POTATOES' })).toMatchObject({
      status: 'suggested',
      matchedFood: 'Potatoes',
      confidence: 'high',
      aiUsed: false,
      // FoodKeeper: "This is the recommended storage method for whole potatoes."
      storage: 'pantry',
      label: 'Pantry (from purchase)',
      earliest: '2026-12-07',
      latest: '2027-01-07',
      shelfLife: { foodKeeperId: 297, source: 'USDA', length: { unit: 'months', min: 1, max: 2 } },
    })
  })

  it('keeps every other row on its usual storage', async () => {
    // Potatoes is the only row whose tips name a recommended storage.
    const engine = new FoodKeeper(FOODKEEPER_PATH)
    const marked = engine.products.filter((row) => engine.storageWindows(row).some((window) => window.recommended))
    expect(marked.map((row) => row.id)).toEqual([297])

    expect(await run({ category: 'Produce', name: 'Yellow Onions' })).toMatchObject({ storage: 'fridge' })
    // Food bought frozen still starts in the freezer.
    expect(await run({ name: 'Frozen hashbrowns', category: 'Frozen' })).toMatchObject({ storage: 'freezer' })
  })

  it('finds it for an old row with the bare name from its ingredients, never as high', async () => {
    expect(await run({ ingredients: 'yellow creamer potatoes' })).toMatchObject({
      status: 'suggested',
      matchedFood: 'Potatoes',
      confidence: 'medium',
    })
  })

  it('offers no date for the bare name with nothing else to go on', async () => {
    expect((await run({})).status).toBe('none')
  })

  it('never calls it an onion on the colour alone', async () => {
    // "yellow" is in FoodKeeper's onion row, and a Produce hint made that a sure match.
    expect(await run({ category: 'Produce' })).not.toMatchObject({ matchedFood: expect.stringMatching(/onion/i) })
    expect(await run({ category: 'Produce', name: 'Yellow Onions' })).toMatchObject({
      status: 'suggested',
      matchedFood: 'Onions (yellow, white, red, etc.)',
    })
  })

  it('offers no date when FoodKeeper has no row for the completed food', async () => {
    // FoodKeeper has no rambutan row, and "red" alone is only a colour.
    expect(foodName('Little Reds', 'red rambutans')).toBe('Little Reds Rambutans')
    const suggestion = await run({ name: 'Little Reds', brand: 'Brand', ingredients: 'red rambutans', category: 'Produce' })

    expect(suggestion.status).toBe('none')
  })
})

describe('a cached row named without its food', () => {
  const OLD: FinalRecord = {
    source: 'Open Facts',
    barcode: '0629307123313',
    name: 'LITTLE YELLOWS',
    brand: 'THE LITTLE POTATO CO.',
    description: null,
    quantity: null,
    category: 'Plant-based foods',
    categoryTags: PLANT_TAGS,
    imageUrl: null,
    ingredients: 'yellow creamer potatoes',
  }
  const BODY = {
    name: 'LITTLE YELLOWS',
    brand: 'THE LITTLE POTATO CO.',
    barcode: SCANNED,
    category: null,
    productCategory: 'Plant-based foods',
    purchaseDate: '2026-11-07',
  }
  const suggest = (body: object) => request(app).post('/api/food/expiry-suggestion').send(body)
  const row = async () => (await db.select().from(items).where(eq(items.barcode, KEY)))[0]

  beforeAll(async () => {
    await db.execute(sql`CREATE SCHEMA neon_auth`)
    await db.execute(sql`CREATE TABLE neon_auth."user" (id uuid PRIMARY KEY)`)
    await migrate(db, { migrationsFolder: 'drizzle' })
  })

  beforeEach(async () => {
    await db.delete(items)
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('is checked against FoodKeeper again from its ingredients, and keeps the match', async () => {
    await saveItem(SCANNED, OLD, true)

    const response = await suggest(BODY)

    expect(response.body).toMatchObject({ status: 'suggested', matchedFood: 'Potatoes', confidence: 'medium' })
    expect(fetch).not.toHaveBeenCalled()
    const saved = await row()
    expect(saved.payload).toStrictEqual(OLD)
    expect(saved.expirySuggestion).toStrictEqual(response.body.shelfLife)
  })

  it('replaces an onion date saved on the colour alone', async () => {
    const onion = await suggestExpiry({ ...BODY, name: 'Yellow Onions', category: 'Produce' }, 'test-user')
    expect(onion).toMatchObject({ status: 'suggested', matchedFood: 'Onions (yellow, white, red, etc.)' })
    await saveItem(SCANNED, OLD, true)
    await db.update(items).set({ expirySuggestion: onion.status === 'suggested' ? onion.shelfLife : null })

    const response = await suggest(BODY)

    expect(response.body).toMatchObject({ status: 'suggested', matchedFood: 'Potatoes' })
    expect((await row()).expirySuggestion).toStrictEqual(response.body.shelfLife)
  })

  it('shows the completed name on a cache hit, without rewriting the row', async () => {
    await saveItem(SCANNED, OLD, true)
    const before = await row()

    const response = await request(app).get(`/api/food/barcode/${SCANNED}`)

    expect(response.status).toBe(200)
    expect(response.body.product).toStrictEqual({ ...OLD, name: 'LITTLE YELLOWS POTATOES' })
    expect(fetch).not.toHaveBeenCalled()
    const after = await row()
    expect(after.payload).toStrictEqual(OLD)
    expect(after.updatedAt).toEqual(before.updatedAt)

    // The add form sends back the name it was shown, which still counts as the saved product.
    const suggestion = await suggest({ ...BODY, name: 'LITTLE YELLOWS POTATOES' })
    expect(suggestion.body).toMatchObject({ status: 'suggested', matchedFood: 'Potatoes', storage: 'pantry' })
    expect((await row()).expirySuggestion).toStrictEqual(suggestion.body.shelfLife)
  })

  it('works a saved fridge date for potatoes out again, as the pantry one', async () => {
    const engine = new FoodKeeper(FOODKEEPER_PATH)
    const potatoes = engine.products.find((product) => product.id === 297)!
    const fridge = engine.storageWindows(potatoes).find((window) => window.key === 'fridgeDop')!
    const oldRule = {
      foodKeeperId: 297,
      matchedFood: 'Potatoes',
      storage: 'fridge',
      label: fridge.label,
      length: windowLength(fridge, potatoes.categoryId),
      window: { min: fridge.min, max: fridge.max, metric: fridge.metric },
      source: 'USDA',
      confidence: 'high',
      aiUsed: false,
    }
    await saveItem(SCANNED, OLD, true)
    await db.update(items).set({ expirySuggestion: oldRule as never })

    const response = await suggest(BODY)

    expect(response.body).toMatchObject({ status: 'suggested', matchedFood: 'Potatoes', storage: 'pantry' })
    expect((await row()).expirySuggestion).toStrictEqual(response.body.shelfLife)
  })

  it("does not read the row's ingredients once the form says something else", async () => {
    await saveItem(SCANNED, OLD, true)

    const response = await suggest({ ...BODY, name: 'LITTLE YELLOWS mix' })

    expect(response.body.status).toBe('none')
    expect((await row()).expirySuggestion).toBeNull()
  })
})
