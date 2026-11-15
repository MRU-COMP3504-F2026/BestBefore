// #183/#186 end to end: barcode lookup -> add-form suggestion -> saved item -> edit-date suggestion,
// against a real Postgres in memory, the real normalizer and the real FoodKeeper data. Only the
// product databases' HTTP answers are faked, as hand-built bodies in their real shapes.
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import request from 'supertest'
import { aggregate, normalize, type FinalRecord, type NormalizedProduct } from '../../../testscripts/normalizer.js'
import { app } from '../app.js'
import { DEV_USER } from '../auth/devAuth.js'
import { db as appDb } from '../db/index.js'
import { inventoryItems, items } from '../db/schema.js'
import { appCategory } from '../food/expirySuggestion.js'
import { saveItem } from '../food/items.js'
import { resetLookupLimits } from '../food/rateLimit.js'

vi.mock('../db/index.js', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const schema = await import('../db/schema.js')
  return { db: drizzle(new PGlite(), { schema }) }
})

const db = appDb as unknown as PgliteDatabase<Record<string, never>>
const fetchMock = vi.fn()

const SCANNED = '015000047047'
const KEY = '00015000047047'
const BOUGHT = '2026-11-07'

// Open Food Facts' English tags for a shop-bought fruit purée.
const PUREE_TAGS = ['en:baby-foods', 'en:fruit-purees', 'en:applesauces']

function openFactsBody(product: Record<string, unknown>) {
  return { code: SCANNED, result: { id: 'product_found' }, product: { code: SCANNED, ...product } }
}
function upcBody(item: Record<string, unknown>) {
  return { total: 1, items: [{ ean: `0${SCANNED}`, images: [], ...item }] }
}
const OPEN_FACTS_MISS = { result: { id: 'product_not_found' } }
const UPC_MISS = { total: 0, items: [] }

// Each source's answer: a JSON body, a Response as it is, or an Error thrown by fetch.
function answer({ openFacts = OPEN_FACTS_MISS as unknown, upcItemDb = UPC_MISS as unknown }) {
  fetchMock.mockImplementation(async (url: string) => {
    const value = url.includes('openfoodfacts') ? openFacts : upcItemDb
    if (value instanceof Error) throw value
    return value instanceof Response ? value : new Response(JSON.stringify(value), { status: 200 })
  })
}

const lookup = () => request(app).get(`/api/food/barcode/${SCANNED}`)
const suggest = (body: object) => request(app).post('/api/food/expiry-suggestion').send(body)
const addItem = (body: object) => request(app).post('/api/inventory').send(body)
const editItem = (id: number, body: object) => request(app).patch(`/api/inventory/${id}`).send(body)
const itemSuggestion = (id: number, purchaseDate: string) =>
  request(app).get(`/api/inventory/${id}/expiry-suggestion`).query({ purchaseDate })

async function row() {
  const [found] = await db.select().from(items).where(eq(items.barcode, KEY))
  return found
}

type LookupBody = { product: { name: string; brand: string | null; category: string | null }; category: string | null }

// What the add form sends for a scan it was handed: the lookup's name, brand and label, and the
// product's own category text (src/pages/AddItemPage.tsx).
function formFor(body: LookupBody) {
  return {
    name: body.product.name,
    brand: body.product.brand,
    barcode: SCANNED,
    category: body.category,
    productCategory: body.product.category,
    purchaseDate: BOUGHT,
  }
}

const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

beforeAll(async () => {
  await db.execute(sql`CREATE SCHEMA neon_auth`)
  await db.execute(sql`CREATE TABLE neon_auth."user" (id uuid PRIMARY KEY)`)
  await db.execute(sql`INSERT INTO neon_auth."user" (id) VALUES (${DEV_USER.id})`)
  await migrate(db, { migrationsFolder: 'drizzle' })
})

beforeEach(async () => {
  await db.delete(inventoryItems)
  await db.delete(items)
  fetchMock.mockReset()
  resetLookupLimits()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_DISABLE_AUTH', 'true')
  vi.stubEnv('GO_UPC_API_KEY', '')
  vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// #183: the reported case. Open Facts only had the French name, so FoodKeeper found nothing.
describe('a product Open Facts only names in French', () => {
  const FRENCH = openFactsBody({
    lang: 'fr',
    product_name: 'Purée de pommes',
    brands: 'Gerber',
    categories: 'Aliments pour bébés, Compotes',
    categories_tags: PUREE_TAGS,
  })
  const ENGLISH_LISTING = upcBody({ title: 'Gerber Applesauce, 4 oz', brand: 'Gerber' })

  it('is named, labelled, saved and dated in English from a matching listing', async () => {
    answer({ openFacts: FRENCH, upcItemDb: ENGLISH_LISTING })

    const found = await lookup()

    expect(found.status).toBe(200)
    expect(found.body.product.name).toBe('Gerber Applesauce')
    // Fruit purées are shelf stable: a Produce label kept this from its commercial row.
    expect(found.body.category).toBe('Pantry')
    expect((await row()).payload).toMatchObject({ name: 'Gerber Applesauce' })

    const suggestion = await suggest(formFor(found.body))
    expect(suggestion.body).toMatchObject({
      status: 'suggested',
      matchedFood: 'Applesauce (commercial)',
      confidence: 'high',
      aiUsed: false,
    })
    // A sure English match is kept on the shared row for the next shopper.
    expect((await row()).expirySuggestion).toMatchObject({ matchedFood: 'Applesauce (commercial)' })
  })

  // The issue's own product, whose English listing title says "Baby Food". FoodKeeper has no baby
  // food row, but the purée tags' Pantry label lets the applesauce row through.
  it('dates a Gerber baby food whose English title says "Baby Food"', async () => {
    answer({ openFacts: FRENCH, upcItemDb: upcBody({ title: 'Gerber Applesauce Baby Food, 4 oz', brand: 'Gerber' }) })
    const found = await lookup()
    expect(found.body.product.name).toBe('Gerber Applesauce Baby Food')

    expect((await suggest(formFor(found.body))).body).toMatchObject({
      status: 'suggested',
      matchedFood: 'Applesauce (commercial)',
    })
  })

  it.each([
    ['Chinese', '嘉宝苹果泥'],
    ['Russian', 'Яблочное пюре'],
    ['German with an eszett', 'Apfelmus süß'],
  ])('is named in English when the Open Facts name is %s', async (_language, name) => {
    answer({
      openFacts: openFactsBody({ product_name: name, brands: 'Gerber', categories_tags: PUREE_TAGS }),
      upcItemDb: ENGLISH_LISTING,
    })

    expect((await lookup()).body.product.name).toBe('Gerber Applesauce')
  })

  it.each([
    ['only the brand', 'Gerber'],
    ['another product of the same brand', 'Gerber Rice Cereal for Baby'],
  ])("keeps the French name over a listing that is %s", async (_case, title) => {
    answer({ openFacts: FRENCH, upcItemDb: upcBody({ title, brand: 'Gerber' }) })

    expect((await lookup()).body.product.name).toBe('Purée de pommes')
  })

  it("keeps the French name when the only listing is another brand's product", async () => {
    answer({ openFacts: FRENCH, upcItemDb: upcBody({ title: 'Swim Trunks Mens Large', brand: 'Speedo' }) })

    expect((await lookup()).body.product).toMatchObject({ name: 'Purée de pommes', sources: ['Open Facts'] })
  })

  // Audit #194 (1): a row saved before 88dc9fa keeps its French name. A saved row answers every
  // scan without asking the databases, and the listing's title was never saved, so nothing can
  // swap it now. Whether to look such rows up again is a product decision.
  it('answers a French row saved before the fix as it was saved', async () => {
    const SAVED: FinalRecord = {
      barcode: SCANNED,
      sources: ['Open Facts', 'UPCitemdb'],
      name: 'Purée de pommes',
      brand: 'Gerber',
      description: null,
      quantity: null,
      category: 'Aliments pour bébés, Compotes',
      categoryTags: PUREE_TAGS,
      imageUrl: null,
      ingredients: null,
    }
    await saveItem(SCANNED, SAVED, true)
    answer({ openFacts: FRENCH, upcItemDb: ENGLISH_LISTING })

    const found = await lookup()

    expect(found.body.product.name).toBe('Purée de pommes')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('merging names in more than one language', () => {
  const openFacts = (product: Record<string, unknown>) =>
    normalize('Open Facts', openFactsBody({ brands: 'Gerber', categories_tags: PUREE_TAGS, ...product }), SCANNED) as NormalizedProduct
  const upc = (title: string, brand = 'Gerber') => normalize('UPCitemdb', upcBody({ title, brand }), SCANNED) as NormalizedProduct
  const merge = (name: string, title: string) => aggregate([openFacts({ product_name: name }), upc(title)], SCANNED).name

  it('swaps a mixed-language or decomposed-accent name for an English listing', () => {
    expect(merge('Gerber Purée Apple', 'Gerber Apple Puree')).toBe('Gerber Apple Puree')
    // "é" as e + a combining accent, the way some systems send it.
    expect(merge('Purée de pommes', 'Gerber Applesauce')).toBe('Gerber Applesauce')
  })

  it('keeps an English name, even when a listing title is longer', () => {
    expect(merge('Applesauce', 'Gerber Applesauce 2nd Foods')).toBe('Applesauce')
  })

  // Audit #194 (3): no accent and no French stop word, so nothing says this is French. Open Facts'
  // lang isn't kept on the record, so the merge can't tell. A known limit, not asserted as wanted.
  it('cannot tell an accent-free French name from English', () => {
    expect(merge('Compote pomme banane', 'Gerber Apple Banana Puree')).toBe('Compote pomme banane')
  })
})

// #186: Open Facts' category text is often only in French, but its tags are English.
describe('our label for a French category', () => {
  it.each([
    ['Produits laitiers, Yaourts', ['en:dairies', 'en:yogurts'], 'Dairy'],
    ['Produits laitiers, Yaourts aux fruits', ['en:dairies', 'en:fermented-milk-products', 'en:fruit-yogurts'], 'Dairy'],
    ['Boissons, Jus de fruits', ['en:beverages', 'en:plant-based-foods-and-beverages', 'en:fruit-juices'], 'Beverages'],
    ['Aliments pour bébés, Compotes', PUREE_TAGS, 'Pantry'],
    // Open Food Facts' top level for every plant food, in English or French, is not a drink.
    ['Plant-based foods and beverages, Tofu', ['en:plant-based-foods-and-beverages', 'en:plant-based-foods', 'en:tofu'], null],
    ['Aliments et boissons à base de végétaux, Tofu', ['en:plant-based-foods-and-beverages', 'en:tofu'], null],
  ])('%s (tags %j) -> %s', (text, tags, label) => {
    expect(appCategory(text, tags)).toBe(label)
  })
})

describe('a product whose category text is French', () => {
  const YOGURT = openFactsBody({
    product_name: 'Plain Yogurt',
    brands: 'Liberté',
    categories: 'Produits laitiers, Yaourts',
    categories_tags: ['en:dairies', 'en:fermented-milk-products', 'en:yogurts'],
  })

  async function scanAndSuggest() {
    answer({ openFacts: YOGURT })
    const found = await lookup()
    const form = formFor(found.body)
    return { found, form, first: await suggest(form) }
  }

  it('gets our label, and the add form shares its shelf life on the saved row', async () => {
    const { found, first } = await scanAndSuggest()

    expect(found.body.category).toBe('Dairy')
    expect(first.body).toMatchObject({ status: 'suggested', matchedFood: 'Yogurt', storage: 'fridge' })
    expect((await row()).expirySuggestion).toMatchObject({ matchedFood: 'Yogurt' })
  })

  it('moves the edit-page suggestion with the date bought, by exactly the days moved', async () => {
    const { form, first } = await scanAndSuggest()
    const added = await addItem({ ...form, quantity: 1, bestBefore: first.body.earliest })
    expect(added.status).toBe(201)
    const id = added.body.item.id

    const same = await itemSuggestion(id, BOUGHT)
    const later = await itemSuggestion(id, addDays(BOUGHT, 10))

    expect(same.body).toMatchObject({ status: 'suggested', earliest: first.body.earliest, latest: first.body.latest })
    expect(later.body).toMatchObject({
      status: 'suggested',
      earliest: addDays(first.body.earliest, 10),
      latest: addDays(first.body.latest, 10),
    })
    // Asking never changes the user's item: the date they accepted stays until they save another.
    const [saved] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id))
    expect(saved).toMatchObject({ bestBefore: first.body.earliest, purchaseDate: BOUGHT })
  })

  it("offers no date for an item the user re-labelled away from the product's category", async () => {
    const { form, first } = await scanAndSuggest()
    const added = await addItem({ ...form, category: 'Bakery', quantity: 1, bestBefore: first.body.earliest })

    expect((await itemSuggestion(added.body.item.id, '2026-11-17')).body.status).toBe('none')
  })

  // A per-item edit is the user's own copy: the shared row, and the dates they chose, stay put.
  it('keeps the shared row and the accepted date through an edit of name and category', async () => {
    const { form, first } = await scanAndSuggest()
    const added = await addItem({ ...form, quantity: 1, bestBefore: first.body.earliest })
    const before = await row()

    const edited = await editItem(added.body.item.id, {
      name: 'My Breakfast Yogurt',
      brand: null,
      category: 'Bakery',
      quantity: 2,
      purchaseDate: BOUGHT,
      bestBefore: first.body.earliest,
    })

    expect(edited.status).toBe(200)
    expect(edited.body.item).toMatchObject({ name: 'My Breakfast Yogurt', bestBefore: first.body.earliest })
    const after = await row()
    expect(after.payload).toStrictEqual(before.payload)
    expect(after.expirySuggestion).toStrictEqual(before.expirySuggestion)
    expect(after.updatedAt).toEqual(before.updatedAt)
    // Renamed away from the product, it no longer borrows the product's date.
    expect((await itemSuggestion(added.body.item.id, '2026-11-17')).body.status).toBe('none')
  })
})

// #186 "should not update post lookup": the shared row is the database's record. Another scan, or
// a form the user edited, never rewrites it.
describe('the saved product after a lookup', () => {
  const YOGURT_RECORD: FinalRecord = {
    source: 'Open Facts',
    barcode: SCANNED,
    name: 'Greek Yogurt',
    brand: 'Liberté',
    description: null,
    quantity: '750 g',
    category: 'Dairies, Yogurts',
    categoryTags: ['en:dairies', 'en:yogurts'],
    imageUrl: null,
    ingredients: null,
  }
  const FORM = {
    name: YOGURT_RECORD.name,
    brand: YOGURT_RECORD.brand,
    barcode: SCANNED,
    category: 'Dairy',
    productCategory: YOGURT_RECORD.category,
    purchaseDate: BOUGHT,
  }

  it('answers a second scan from the row, without asking the databases or rewriting it', async () => {
    await saveItem(SCANNED, YOGURT_RECORD, true)
    const before = await row()
    answer({ openFacts: openFactsBody({ product_name: 'Something Else', brands: 'Other' }) })

    const found = await lookup()

    expect(found.body).toEqual({ product: YOGURT_RECORD, category: 'Dairy' })
    expect(fetchMock).not.toHaveBeenCalled()
    const after = await row()
    expect(after.payload).toStrictEqual(before.payload)
    expect(after.updatedAt).toEqual(before.updatedAt)
  })

  it.each([
    ['renamed', { name: 'Chocolate Pudding' }],
    ['re-labelled', { category: 'Bakery' }],
    ['given another brand', { brand: 'Store Brand' }],
  ])('keeps no shelf life from a form the user %s', async (_edit, edit) => {
    await saveItem(SCANNED, YOGURT_RECORD, true)

    await suggest({ ...FORM, ...edit })

    const after = await row()
    expect(after.payload).toStrictEqual(YOGURT_RECORD)
    expect(after.expirySuggestion).toBeNull()
    // The same form unedited does share it.
    await suggest(FORM)
    expect((await row()).expirySuggestion).toMatchObject({ matchedFood: 'Yogurt' })
  })

  // A JSONB row nobody checks on the way out. Nothing the normalizer writes looks like this, but a
  // hand edit or an old shape must not take the scan, the add form or the edit page down.
  it('survives a malformed saved row without writing to it', async () => {
    const MALFORMED = { ...YOGURT_RECORD, category: { fr: 'Yaourts' }, categoryTags: 'en:yogurts' }
    await db.insert(items).values({ barcode: KEY, payload: MALFORMED as never })
    const form = { ...FORM, category: null, productCategory: null }

    const found = await lookup()
    const suggestion = await suggest(form)
    const added = await addItem({ ...form, quantity: 1, bestBefore: '2026-11-14' })
    const edit = await itemSuggestion(added.body.item.id, '2026-11-10')

    expect(found.status).toBe(200)
    expect(found.body.category).toBeNull()
    expect(suggestion.status).toBe(200)
    expect(edit.status).toBe(200)
    expect(edit.body.status).toBe('none')
    const after = await row()
    expect(after.payload).toStrictEqual(MALFORMED)
    expect(after.expirySuggestion).toBeNull()
  })
})

describe('malformed product database answers', () => {
  it('names the product from the listing when Open Facts sends an HTML page', async () => {
    answer({
      openFacts: new Response('<html>502 Bad Gateway</html>', { status: 200 }),
      upcItemDb: upcBody({ title: 'Liberte Greek Yogurt 750 g', brand: 'Liberte' }),
    })

    const found = await lookup()

    expect(found.status).toBe(200)
    expect(found.body.product).toMatchObject({ source: 'UPCitemdb', name: 'Liberte Greek Yogurt' })
    expect((await row()).payload).toStrictEqual(found.body.product)
  })

  it('keeps only text from fields of the wrong type', async () => {
    answer({
      openFacts: openFactsBody({
        product_name: { fr: 'Yaourt' },
        product_name_en: 'Greek Yogurt',
        brands: ['Liberté'],
        // A number is kept as text, the way Go-UPC's numeric codes are.
        categories: 42,
        categories_tags: 'en:yogurts',
        ingredients_text: null,
        image_front_url: false,
      }),
    })

    const found = await lookup()

    expect(found.status).toBe(200)
    expect(found.body).toEqual({
      product: {
        source: 'Open Facts',
        barcode: SCANNED,
        name: 'Greek Yogurt',
        brand: null,
        description: null,
        quantity: null,
        category: '42',
        categoryTags: null,
        imageUrl: null,
        ingredients: null,
      },
      category: null,
    })
  })

  it.each([
    ['a found id with a list for a product', { result: { id: 'product_found' }, product: [] }, UPC_MISS],
    ['a listing total with no items', OPEN_FACTS_MISS, { total: 1, items: null }],
    // Was a "hit" with every field null, saved to the shared row and answered to every later scan.
    ['a listing whose first item is not an object', OPEN_FACTS_MISS, { total: 1, items: [null] }],
    ['a JSON array body', [], []],
  ])('says not found for %s, and saves nothing', async (_case, openFacts, upcItemDb) => {
    answer({ openFacts, upcItemDb })

    const found = await lookup()

    expect(found.status).toBe(404)
    expect(await db.select().from(items)).toEqual([])
  })
})
