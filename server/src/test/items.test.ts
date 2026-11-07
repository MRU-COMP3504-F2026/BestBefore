import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import request from 'supertest'
import { suggestWithFallback } from '../../../expiry-tests/ai-fallback.js'
import { formatDay, parseDay, predict, windowLength, type Storage } from '../../../expiry-tests/expiry.js'
import { FoodKeeper } from '../../../expiry-tests/foodkeeper.js'
import { FOODKEEPER_PATH } from '../../../expiry-tests/strategies.js'
import { datesFromLength } from '../../../src/lib/shelfLifeDates.js'
import type { FinalRecord } from '../../../testscripts/normalizer.js'
import { app } from '../app.js'
import { db as appDb } from '../db/index.js'
import { items } from '../db/schema.js'
import { canonicalBarcode, findItem, isShareable, rememberItem, saveItem } from '../food/items.js'
import { LOOKUP_PER_MINUTE, resetLookupLimits } from '../food/rateLimit.js'

// Counts engine runs, so a test can tell a saved rule from a fresh search.
vi.mock('../../../expiry-tests/ai-fallback.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../expiry-tests/ai-fallback.js')>()
  return { ...actual, suggestWithFallback: vi.fn(actual.suggestWithFallback) }
})

// A real Postgres in memory, built by the real migrations, so the JSONB round trip and the
// upsert are Postgres's behaviour and not a stub's.
vi.mock('../db/index.js', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const schema = await import('../db/schema.js')
  return { db: drizzle(new PGlite(), { schema }) }
})

const db = appDb as unknown as PgliteDatabase<Record<string, never>>

// The product databases are always faked: tests never spend their quotas.
const fetchMock = vi.fn()

const SCANNED = '012345678905'
const KEY = '00012345678905'

const OPEN_FACTS_HIT = {
  code: SCANNED,
  result: { id: 'product_found' },
  product: {
    code: SCANNED,
    product_name: 'Whole Milk',
    brands: 'Dairyland',
    quantity: '400.0 g',
    categories: 'Dairies, Milks',
    image_front_url: 'https://images.test/milk.jpg',
    ingredients_text: 'Milk',
  },
}
const OPEN_FACTS_MISS = { result: { id: 'product_not_found' } }
const UPC_HIT = {
  total: 1,
  items: [{ ean: '0012345678905', title: 'Reseller Milk Title', brand: 'Other', description: 'Fresh milk', images: [] }],
}
const UPC_MISS = { total: 0, items: [] }

const SINGLE: FinalRecord = {
  source: 'Open Facts',
  barcode: SCANNED,
  name: 'Whole Milk',
  brand: null,
  description: null,
  quantity: null,
  category: null,
  imageUrl: null,
  ingredients: null,
}

const MERGED: FinalRecord = {
  barcode: SCANNED,
  sources: ['Open Facts', 'UPCitemdb'],
  name: 'Whole Milk',
  brand: 'Dairyland',
  description: 'Fresh milk',
  quantity: '400.0 g',
  category: 'Dairies, Milks',
  imageUrl: null,
  ingredients: null,
}

// Well formed, but its length isn't what FoodKeeper says for the row any more.
const STALE_RULE = {
  foodKeeperId: 1,
  matchedFood: 'Old row',
  storage: 'fridge',
  label: 'Fridge',
  length: { unit: 'days', min: 1, max: 1 },
  window: { min: 1, max: 1, metric: 'Days' },
  source: 'USDA',
  confidence: 'high',
  aiUsed: false,
}

function storageOf(key: string): Storage {
  return key.startsWith('freezer') ? 'freezer' : key.startsWith('pantry') ? 'pantry' : 'fridge'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function answer({ openFacts = OPEN_FACTS_MISS as unknown, upcItemDb = UPC_MISS as unknown }) {
  fetchMock.mockImplementation(async (url: string) => {
    const value = url.includes('openfoodfacts') ? openFacts : upcItemDb
    if (value instanceof Error) throw value
    return value instanceof Response ? value : json(value)
  })
}

const lookup = (barcode = SCANNED) => request(app).get(`/api/food/barcode/${barcode}`)
const allRows = () => db.select().from(items)

async function rowFor(key: string) {
  const [row] = await db.select().from(items).where(eq(items.barcode, key))
  return row
}

beforeAll(async () => {
  // Neon Auth owns this table in production; the migrations only point a foreign key at it.
  await db.execute(sql`CREATE SCHEMA neon_auth`)
  await db.execute(sql`CREATE TABLE neon_auth."user" (id uuid PRIMARY KEY)`)
  await migrate(db, { migrationsFolder: 'drizzle' })
})

beforeEach(async () => {
  await db.delete(items)
  fetchMock.mockReset()
  resetLookupLimits()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_DISABLE_AUTH', 'true')
  vi.stubEnv('GO_UPC_API_KEY', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('canonicalBarcode', () => {
  it('gives UPC-A, EAN-13 and GTIN-14 forms of a code the same key', () => {
    expect(canonicalBarcode('012345678905')).toBe(KEY)
    expect(canonicalBarcode('0012345678905')).toBe(KEY)
    expect(canonicalBarcode('00012345678905')).toBe(KEY)
  })

  it('keeps codes that differ in a real digit apart', () => {
    // A leading digit that isn't a pad, and a case-level GTIN-14 of the same product.
    expect(canonicalBarcode('5012345678900')).toBe('05012345678900')
    expect(canonicalBarcode('10012345678902')).toBe('10012345678902')
    expect(canonicalBarcode('0012345678905')).not.toBe(canonicalBarcode('10012345678905'))
  })

  it('pads an EAN-8 on the left only', () => {
    expect(canonicalBarcode('96385074')).toBe('00000096385074')
  })
})

describe('saving looked-up products', () => {
  it('stores one hit as the exact record the client got, with `source`', async () => {
    answer({ openFacts: OPEN_FACTS_HIT })

    const response = await lookup()

    expect(response.status).toBe(200)
    const row = await rowFor(KEY)
    expect(row.payload).toStrictEqual(response.body.product)
    expect(row.payload).toStrictEqual({
      source: 'Open Facts',
      barcode: SCANNED,
      name: 'Whole Milk',
      brand: 'Dairyland',
      description: null,
      quantity: '400.0 g',
      category: 'Dairies, Milks',
      categoryTags: null,
      imageUrl: 'https://images.test/milk.jpg',
      ingredients: 'Milk',
    })
    expect(row.payload).not.toHaveProperty('sources')
  })

  it('stores several hits as the exact merged record, with `sources` in order', async () => {
    answer({ openFacts: OPEN_FACTS_HIT, upcItemDb: UPC_HIT })

    const response = await lookup()

    const row = await rowFor(KEY)
    expect(row.payload).toStrictEqual(response.body.product)
    expect(row.payload).toHaveProperty('sources', ['Open Facts', 'UPCitemdb'])
    expect(row.payload).not.toHaveProperty('source')
  })

  it("keys by the scanned code but keeps the source's own barcode in the record", async () => {
    answer({ upcItemDb: UPC_HIT })

    await lookup()

    const row = await rowFor(KEY)
    expect(row.payload.barcode).toBe('0012345678905')
    expect(await allRows()).toHaveLength(1)
  })

  it('round-trips awkward text and null fields through JSONB untouched', async () => {
    const product: FinalRecord = {
      ...SINGLE,
      name: 'Crème "brûlée" \\ 🍮 100%',
      brand: "O'Neill; DROP TABLE items; --",
      description: 'line one\nline two\ttabbed',
      ingredients: '牛乳, ' + 'x'.repeat(10_000),
    }

    await saveItem(SCANNED, product, true)

    expect((await rowFor(KEY)).payload).toStrictEqual(product)
    const [{ type }] = (await db.execute(sql`SELECT jsonb_typeof(payload) AS type FROM items`)).rows as { type: string }[]
    expect(type).toBe('object')
  })

  it('keeps one row for repeated lookups, and for other forms of the same code', async () => {
    answer({ openFacts: OPEN_FACTS_HIT })

    await lookup()
    const first = await rowFor(KEY)
    await lookup()
    await lookup('0012345678905')

    expect(await allRows()).toHaveLength(1)
    const row = await rowFor(KEY)
    expect(row.createdAt).toEqual(first.createdAt)
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime())
  })

  it('replaces the record when two complete lookups race', async () => {
    await saveItem(SCANNED, SINGLE, true)

    await saveItem(SCANNED, { ...SINGLE, name: 'Newer Milk' }, true)

    expect((await rowFor(KEY)).payload.name).toBe('Newer Milk')
  })

  it('does not let a lookup with a failed database replace a fuller record', async () => {
    await saveItem(SCANNED, { ...SINGLE, name: 'Fuller Milk' }, true)

    await saveItem(SCANNED, SINGLE, false)

    expect((await rowFor(KEY)).payload.name).toBe('Fuller Milk')
  })

  it('still saves a lookup with a failed database when nothing is stored yet', async () => {
    answer({ openFacts: OPEN_FACTS_HIT, upcItemDb: new Error('connection reset') })

    await lookup()

    expect((await rowFor(KEY)).payload).toHaveProperty('source', 'Open Facts')
  })

  it('leaves one row when the same code is saved concurrently', async () => {
    const saves = Array.from({ length: 20 }, (_, i) =>
      saveItem(i % 2 ? SCANNED : `0${SCANNED}`, { ...SINGLE, name: `Save ${i}` }, i % 3 !== 0),
    )

    await Promise.all(saves)

    expect(await allRows()).toHaveLength(1)
    expect((await rowFor(KEY)).payload.name).toMatch(/^Save \d+$/)
  })

  it('refuses a key that is not a GTIN-14', async () => {
    await expect(
      db.insert(items).values({ barcode: SCANNED, payload: SINGLE }),
    ).rejects.toThrow()
  })

  describe('saves nothing when there is no product', () => {
    it.each([
      ['every database missed', {}, 404],
      ['a database failed and the rest missed', { upcItemDb: json({}, 429) }, 502],
      ['a database sent an unreadable 200', { openFacts: new Response('<html>', { status: 200 }) }, 502],
      ['a connection dropped', { openFacts: new Error('connection reset') }, 502],
    ])('%s', async (_name, answers, status) => {
      answer(answers)

      expect((await lookup()).status).toBe(status)
      expect(await allRows()).toHaveLength(0)
    })

    it('an invalid barcode', async () => {
      expect((await lookup('abc')).status).toBe(400)
      expect(await allRows()).toHaveLength(0)
    })
  })

  describe('when saving fails', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    it('still returns the product and logs the reason', async () => {
      answer({ openFacts: OPEN_FACTS_HIT })
      vi.spyOn(db, 'insert').mockImplementation(() => {
        throw new Error('relation "items" does not exist')
      })

      const response = await lookup()

      expect(response.status).toBe(200)
      expect(response.body.product.name).toBe('Whole Milk')
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('relation "items" does not exist'))
    })

    it('reports a value Postgres refuses without losing the lookup', async () => {
      // JSONB can't hold a NUL character, and the record is never altered to make it fit.
      answer({
        openFacts: { ...OPEN_FACTS_HIT, product: { ...OPEN_FACTS_HIT.product, product_name: 'Milk\u0000' } },
      })

      const response = await lookup()

      expect(response.status).toBe(200)
      expect(response.body.product.name).toBe('Milk\u0000')
      expect(await allRows()).toHaveLength(0)
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^Item save for ${SCANNED} failed: `)))
    })

    it('gives up on a save that hangs', async () => {
      const never = { values: () => ({ onConflictDoUpdate: () => new Promise(() => {}) }) }
      vi.spyOn(db, 'insert').mockReturnValue(never as never)

      await rememberItem(SCANNED, SINGLE, true, 20)

      expect(console.error).toHaveBeenCalledWith(`Item save for ${SCANNED} failed: timed out after 20 ms`)
    })
  })
})

describe('answering a scan from the items table', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it.each([
    ['one source', SINGLE],
    ['several sources', MERGED],
  ])('returns the saved record with %s, with no product database call', async (_name, record) => {
    await saveItem(SCANNED, record, true)

    const response = await lookup()

    expect(response.status).toBe(200)
    expect(response.body.product).toStrictEqual(record)
    expect(response.body.category).toBe(record.category ? 'Dairy' : null)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['012345678905', '0012345678905', '00012345678905'])('finds the row when scanned as %s', async (code) => {
    await saveItem(SCANNED, SINGLE, true)

    expect((await lookup(code)).body.product.barcode).toBe(SCANNED)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not count a saved product against the lookup limit', async () => {
    await saveItem(SCANNED, SINGLE, true)

    for (let i = 0; i < LOOKUP_PER_MINUTE + 1; i++) {
      expect((await lookup()).status).toBe(200)
    }
  })

  it('still answers a saved product while a different lookup is running', async () => {
    await saveItem(SCANNED, SINGLE, true)
    let finish!: (value: Response) => void
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const running = lookup('5012345678900').then((response) => response)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect((await lookup()).status).toBe(200)

    finish(json(UPC_MISS))
    await running
  })

  it('asks the product databases once, on a real miss', async () => {
    answer({ openFacts: OPEN_FACTS_HIT })

    await lookup()
    const callsOnMiss = fetchMock.mock.calls.length
    await lookup()

    expect(callsOnMiss).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(callsOnMiss)
  })

  it('does not remember a not-found, so the next scan asks again', async () => {
    answer({})

    await lookup()
    const callsOnMiss = fetchMock.mock.calls.length
    await lookup()

    expect(fetchMock.mock.calls.length).toBe(callsOnMiss * 2)
  })

  it('falls back to the product databases when the table can not answer', async () => {
    answer({ openFacts: OPEN_FACTS_HIT })
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('connection refused')
    })

    const response = await lookup()

    expect(response.status).toBe(200)
    expect(response.body.product.name).toBe('Whole Milk')
    expect(fetchMock).toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
  })

  it('gives up on a table read that hangs', async () => {
    const never = { from: () => ({ where: () => new Promise(() => {}) }) }
    vi.spyOn(db, 'select').mockReturnValue(never as never)

    expect(await findItem(SCANNED, 20)).toBeNull()
    expect(console.error).toHaveBeenCalledWith(`Item read for ${SCANNED} failed: timed out after 20 ms`)
  })

  it('still limits lookups that do reach the product databases', async () => {
    answer({})
    for (let i = 0; i < LOOKUP_PER_MINUTE; i++) await lookup()

    expect((await lookup()).status).toBe(429)
  })
})

describe('the shelf life on a saved row', () => {
  const YOGURT: FinalRecord = {
    ...SINGLE,
    name: 'Greek Yogurt',
    brand: 'Dairyland',
    category: 'Dairies, Yogurts',
  }
  const REQUEST = {
    name: 'Greek Yogurt',
    brand: 'Dairyland',
    barcode: SCANNED,
    category: 'Dairy',
    productCategory: 'Dairies, Yogurts',
    purchaseDate: '2026-11-07',
  }
  const suggest = (body: object) => request(app).post('/api/food/expiry-suggestion').send(body)

  beforeEach(() => {
    vi.mocked(suggestWithFallback).mockClear()
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('saves it on the same row, with no date in it, leaving the record untouched', async () => {
    await saveItem(SCANNED, YOGURT, true)
    const before = await rowFor(KEY)

    const response = await suggest(REQUEST)

    expect(response.body.status).toBe('suggested')
    expect(await allRows()).toHaveLength(1)
    const row = await rowFor(KEY)
    expect(row.payload).toStrictEqual(YOGURT)
    expect(row.updatedAt).toEqual(before.updatedAt)
    expect(row.expirySuggestion).toStrictEqual(response.body.shelfLife)
    expect(row.expirySuggestion).toMatchObject({
      matchedFood: expect.any(String),
      foodKeeperId: expect.any(Number),
      storage: 'fridge',
      source: 'USDA',
      confidence: 'high',
      length: { unit: expect.stringMatching(/^(days|months)$/) },
    })
    expect(JSON.stringify(row.expirySuggestion)).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(JSON.stringify(row.expirySuggestion)).not.toMatch(/earliest|latest|purchaseDate|userId/)
  })

  it("searches the saved record's English tags, only while the form still describes it", async () => {
    // The display category is French, and the name is only the brand line.
    const BISCUITS: FinalRecord = {
      ...SINGLE,
      name: 'Prince',
      brand: 'LU',
      category: 'Snacks sucrés, fr:Biscuits fourrés',
      categoryTags: ['en:snacks', 'en:sweet-snacks', 'en:biscuits-and-cakes', 'en:biscuits', 'en:chocolate-biscuits'],
    }
    const body = {
      ...REQUEST,
      name: 'Prince',
      brand: 'LU',
      category: 'Bakery',
      productCategory: 'Snacks sucrés, fr:Biscuits fourrés',
    }
    await saveItem(SCANNED, BISCUITS, true)

    expect((await suggest({ ...body, name: 'Prince fourré' })).body.status).toBe('none')
    const response = await suggest(body)

    expect(response.body).toMatchObject({ status: 'suggested', matchedFood: 'Cookies (crispy)', aiUsed: false })
  })

  it('counts each purchase from its own date, without running the engine again', async () => {
    await saveItem(SCANNED, YOGURT, true)
    const first = await suggest(REQUEST)
    const saved = (await rowFor(KEY)).expirySuggestion
    vi.mocked(suggestWithFallback).mockClear()

    const later = await suggest({ ...REQUEST, purchaseDate: '2027-01-15' })

    expect(suggestWithFallback).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(later.body.status).toBe('suggested')
    expect(later.body.earliest).not.toBe(first.body.earliest)
    expect(later.body.earliest > '2027-01-15').toBe(true)
    expect(later.body.shelfLife).toStrictEqual(first.body.shelfLife)
    expect((await rowFor(KEY)).expirySuggestion).toStrictEqual(saved)
  })

  it('gives the same dates from a saved rule as the engine does', async () => {
    await saveItem(SCANNED, YOGURT, true)
    await suggest(REQUEST)
    const reused = await suggest({ ...REQUEST, purchaseDate: '2028-02-29' })

    await db.update(items).set({ expirySuggestion: null })
    const fresh = await suggest({ ...REQUEST, purchaseDate: '2028-02-29' })

    expect(reused.body).toStrictEqual(fresh.body)
  })

  it('works one out locally for a saved row without one, with no product database call', async () => {
    await saveItem(SCANNED, YOGURT, true)
    expect((await rowFor(KEY)).expirySuggestion).toBeNull()

    expect((await suggest(REQUEST)).body.status).toBe('suggested')

    expect(suggestWithFallback).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await rowFor(KEY)).expirySuggestion).not.toBeNull()
  })

  it.each([
    ['malformed', { nonsense: true }],
    ['from a FoodKeeper that has since changed', { ...STALE_RULE }],
  ])('replaces a saved value that is %s', async (_name, stale) => {
    await saveItem(SCANNED, YOGURT, true)
    await db.update(items).set({ expirySuggestion: stale as never })

    const response = await suggest(REQUEST)

    expect(response.body.status).toBe('suggested')
    expect(response.body.earliest).not.toBe('2026-11-08')
    expect(suggestWithFallback).toHaveBeenCalled()
    expect((await rowFor(KEY)).expirySuggestion).toStrictEqual(response.body.shelfLife)
  })

  it('saves nothing for a product with no date, and looks again next time', async () => {
    const unknown = { ...YOGURT, name: 'Zzyzx', category: null }
    await saveItem(SCANNED, unknown, true)

    const response = await suggest({ ...REQUEST, name: 'Zzyzx', category: null, productCategory: null })

    expect(response.body.status).toBe('none')
    expect((await rowFor(KEY)).expirySuggestion).toBeNull()
  })

  it('saves nothing for a drink the guard refuses', async () => {
    const monster = { ...YOGURT, name: 'Monster Energy Zero Ultra', brand: 'Monster', category: null }
    await saveItem(SCANNED, monster, true)

    const response = await suggest({ ...REQUEST, name: monster.name, brand: 'Monster', category: null, productCategory: null })

    expect(response.body.status).toBe('none')
    expect((await rowFor(KEY)).expirySuggestion).toBeNull()
  })

  it('does not reuse a rule saved on a row the drink guard now refuses', async () => {
    await saveItem(SCANNED, YOGURT, true)
    const { shelfLife } = (await suggest(REQUEST)).body
    const monster = { ...YOGURT, name: 'Monster Energy Zero Ultra', brand: 'Monster', category: null }
    await saveItem(SCANNED, monster, true)
    expect((await rowFor(KEY)).expirySuggestion).toStrictEqual(shelfLife)

    const response = await suggest({ ...REQUEST, name: monster.name, brand: 'Monster', category: null, productCategory: null })

    expect(response.body.status).toBe('none')
    expect(response.body).not.toHaveProperty('shelfLife')
  })

  it.each([
    ['an edited name', { name: 'Grandma Yogurt' }],
    ['an edited brand', { brand: 'Homemade' }],
    ['another category from the client', { category: 'Pantry' }],
    ['another product category from the client', { productCategory: 'Spreads' }],
  ])('keeps %s out of the shared row, and does not reuse the rule for it', async (_name, change) => {
    await saveItem(SCANNED, YOGURT, true)

    const response = await suggest({ ...REQUEST, ...change })

    expect(response.status).toBe(200)
    expect((await rowFor(KEY)).expirySuggestion).toBeNull()
  })

  it('recognises the same product by any form of its barcode', async () => {
    await saveItem(SCANNED, YOGURT, true)

    await suggest({ ...REQUEST, barcode: `00${SCANNED}` })

    expect((await rowFor(KEY)).expirySuggestion).not.toBeNull()
  })

  it('creates no row when the barcode has none', async () => {
    const response = await suggest(REQUEST)

    expect(response.body.status).toBe('suggested')
    expect(await allRows()).toHaveLength(0)
  })

  it('ignores a barcode that could never be a key', async () => {
    const response = await suggest({ ...REQUEST, barcode: 'not-a-barcode' })

    expect(response.body.status).toBe('suggested')
    expect(await allRows()).toHaveLength(0)
  })

  it('keeps the shelf life through repeat scans and a later save of the record', async () => {
    answer({ openFacts: OPEN_FACTS_HIT })
    await saveItem(SCANNED, YOGURT, true)
    const { shelfLife } = (await suggest(REQUEST)).body

    await lookup()
    await saveItem(SCANNED, { ...YOGURT, description: 'Updated' }, true)
    await saveItem(SCANNED, YOGURT, false)

    const row = await rowFor(KEY)
    expect(row.expirySuggestion).toStrictEqual(shelfLife)
    expect(row.payload.description).toBe('Updated')
  })

  it('still answers when the table can not be read', async () => {
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('connection refused')
    })

    const response = await suggest(REQUEST)

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('suggested')
  })

  it('still answers when the shelf life can not be saved, and logs it', async () => {
    await saveItem(SCANNED, YOGURT, true)
    vi.spyOn(db, 'update').mockImplementation(() => {
      throw new Error('connection refused')
    })

    const response = await suggest(REQUEST)

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('suggested')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Shelf life save'))
    vi.restoreAllMocks()
    expect((await rowFor(KEY)).expirySuggestion).toBeNull()
  })

  it('leaves one whole value after concurrent requests and saves', async () => {
    await saveItem(SCANNED, YOGURT, true)

    const responses = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => suggest({ ...REQUEST, purchaseDate: `2026-11-${10 + i}` })),
      saveItem(SCANNED, YOGURT, true),
      saveItem(SCANNED, YOGURT, false),
    ])

    expect(await allRows()).toHaveLength(1)
    const row = await rowFor(KEY)
    expect(row.payload).toStrictEqual(YOGURT)
    expect(row.expirySuggestion).toStrictEqual((responses[0] as request.Response).body.shelfLife)
  })

  it('shares only a sure match', () => {
    const shelfLife = (confidence: string) => ({ confidence }) as never

    expect(isShareable(shelfLife('high'))).toBe(true)
    expect(isShareable(shelfLife('medium'))).toBe(true)
    expect(isShareable(shelfLife('low'))).toBe(false)
    expect(isShareable(shelfLife('tie'))).toBe(false)
  })
})

describe('recomputing a date in the browser', () => {
  const foodKeeper = new FoodKeeper(FOODKEEPER_PATH)

  // The browser's copy of the date arithmetic must land on the engine's days, rollovers included.
  it.each(['2026-11-07', '2027-01-31', '2028-02-29', '2026-12-31'])('agrees with predict() from %s', (purchaseDate) => {
    let compared = 0
    for (const row of foodKeeper.products) {
      for (const window of foodKeeper.storageWindows(row)) {
        const length = windowLength(window, row.categoryId)
        const prediction = predict([window], row.categoryId, parseDay(purchaseDate), storageOf(window.key))
        if (!length || prediction.kind !== 'range' || prediction.label !== window.label) continue

        expect(datesFromLength(purchaseDate, length)).toEqual({
          earliest: formatDay(prediction.earliest),
          latest: formatDay(prediction.latest),
        })
        compared++
      }
    }
    expect(compared).toBeGreaterThan(100)
  })
})
