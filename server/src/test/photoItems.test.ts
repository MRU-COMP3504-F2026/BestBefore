import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import request from 'supertest'
import type { FinalRecord } from '../../../testscripts/normalizer.js'
import { app } from '../app.js'
import { DEV_USER } from '../auth/devAuth.js'
import { db as appDb } from '../db/index.js'
import { inventoryItems, items } from '../db/schema.js'
import {
  isValidGtin,
  PHOTO_PROVENANCE_TTL_MS,
  signPhotoProvenance,
  verifyPhotoProvenance,
} from '../food/photoItems.js'
import { resetIdentifyLimits, resetLookupLimits } from '../food/rateLimit.js'

// Gemini is always mocked: tests never spend real API quota.
const generateContent = vi.hoisted(() => vi.fn())

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent }
  },
}))

// A real Postgres in memory, built by the real migrations, as in items.test.ts.
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

const YOGURT = {
  name: 'Greek Yogurt',
  brand: 'Chobani',
  barcode: SCANNED,
  category: 'Dairy',
  quantity: 2,
  purchaseDate: '2026-11-08',
  bestBefore: '2026-11-20',
}

const OPEN_FACTS_HIT = {
  code: SCANNED,
  result: { id: 'product_found' },
  product: { code: SCANNED, product_name: 'Plain Greek Yogurt', brands: 'Chobani', categories: 'Dairies, Yogurts' },
}
const OPEN_FACTS_MISS = { result: { id: 'product_not_found' } }
const UPC_MISS = { total: 0, items: [] }

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

// What Gemini called the photo, which the token carries. The user then confirms their own details.
const AI_FOOD = { name: 'Yogurt', brand: 'Chobani' }
const ALIAS = 'v1|yogurt|chobani'
const token = (food: { name: string; brand?: string | null } = AI_FOOD) => signPhotoProvenance(DEV_USER.id, food)!
const NOBODY = '00000000-0000-0000-0000-000000000000'
const save = (body: object) => request(app).post('/api/inventory').send(body)
const lookup = (barcode = SCANNED) => request(app).get(`/api/food/barcode/${barcode}`)
const sharedRows = () => db.select().from(items)
const inventoryRows = () => db.select().from(inventoryItems)

const PHOTO_ROW = {
  source: 'AI Vision',
  barcode: KEY,
  name: 'Greek Yogurt',
  brand: 'Chobani',
  description: null,
  quantity: null,
  category: 'Dairy',
  categoryTags: null,
  imageUrl: null,
  ingredients: null,
}

beforeAll(async () => {
  // Neon Auth owns this table in production; the migrations only point a foreign key at it.
  await db.execute(sql`CREATE SCHEMA neon_auth`)
  await db.execute(sql`CREATE TABLE neon_auth."user" (id uuid PRIMARY KEY)`)
  await migrate(db, { migrationsFolder: 'drizzle' })
  await db.execute(sql`INSERT INTO neon_auth."user" (id) VALUES (${DEV_USER.id})`)
})

beforeEach(async () => {
  await db.delete(items)
  await db.delete(inventoryItems)
  fetchMock.mockReset()
  generateContent.mockReset()
  resetLookupLimits()
  resetIdentifyLimits()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_DISABLE_AUTH', 'true')
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  vi.stubEnv('GO_UPC_API_KEY', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('isValidGtin', () => {
  it.each(['96385074', '012345678905', '4006381333931', '00012345678905'])('accepts %s', (code) => {
    expect(isValidGtin(code)).toBe(true)
  })

  it.each([null, '', '012345678906', '4006381333932', '1234567890', '01234567890', 'abcdefghijkl'])(
    'refuses %s',
    (code) => {
      expect(isValidGtin(code)).toBe(false)
    },
  )
})

describe('photo provenance', () => {
  it("only verifies for the user it was signed for, until it's expired", () => {
    const now = Date.now()
    const signed = signPhotoProvenance(DEV_USER.id, AI_FOOD, now)!

    expect(verifyPhotoProvenance(signed, DEV_USER.id, now)).toEqual({ alias: ALIAS })
    expect(verifyPhotoProvenance(signed, DEV_USER.id, now + PHOTO_PROVENANCE_TTL_MS)).toEqual({ alias: ALIAS })
    expect(verifyPhotoProvenance(signed, DEV_USER.id, now + PHOTO_PROVENANCE_TTL_MS + 1)).toBeNull()
    expect(verifyPhotoProvenance(signed, NOBODY, now)).toBeNull()
  })

  it('refuses a token that was changed or made up', () => {
    const [body, signature] = token().split('.')
    const claims = { u: DEV_USER.id, a: 'v1|caviar|', exp: Date.now() + 10 ** 9 }
    const forged = Buffer.from(JSON.stringify(claims)).toString('base64url')

    expect(verifyPhotoProvenance(`${forged}.${signature}`, DEV_USER.id)).toBeNull()
    expect(verifyPhotoProvenance(`${body}.${signature.slice(1)}x`, DEV_USER.id)).toBeNull()
    expect(verifyPhotoProvenance(`${body}.${signature}.extra`, DEV_USER.id)).toBeNull()
    expect(verifyPhotoProvenance('not-a-token', DEV_USER.id)).toBeNull()
  })

  it('needs the Gemini key, and stops verifying when it changes', () => {
    const signed = token()
    vi.stubEnv('GEMINI_API_KEY', 'rotated-key')
    expect(verifyPhotoProvenance(signed, DEV_USER.id)).toBeNull()

    vi.stubEnv('GEMINI_API_KEY', '')
    expect(signPhotoProvenance(DEV_USER.id, AI_FOOD)).toBeNull()
    expect(verifyPhotoProvenance(signed, DEV_USER.id)).toBeNull()
  })
})

describe('nothing is shared before the item is saved', () => {
  it('identifying a photo writes nothing', async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        identified: true,
        name: 'Greek Yogurt',
        brand: 'Chobani',
        category: 'Dairy',
        quantity: 2,
        unit: 'cup',
        ripeness: null,
      }),
    })

    const response = await request(app).post('/api/food/identify').set('Content-Type', 'image/jpeg').send(Buffer.from([1]))

    expect(response.status).toBe(200)
    expect(await sharedRows()).toEqual([])
    expect(await inventoryRows()).toEqual([])
  })

  it("a photo's expiry suggestion writes nothing and asks no product database", async () => {
    const response = await request(app).post('/api/food/expiry-suggestion').send({
      name: 'Greek Yogurt',
      brand: 'Chobani',
      barcode: null,
      category: 'Dairy',
      productCategory: 'Dairy',
      purchaseDate: '2026-11-08',
      source: 'photo',
    })

    expect(response.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(generateContent).not.toHaveBeenCalled()
    expect(await sharedRows()).toEqual([])
  })

  it('an item that fails validation writes nothing', async () => {
    const response = await save({ ...YOGURT, bestBefore: '2026-11-01', photoToken: token() })

    expect(response.status).toBe(400)
    expect(await inventoryRows()).toEqual([])
    expect(await sharedRows()).toEqual([])
  })

  it('a failed inventory save shares nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const insert = vi.spyOn(db, 'insert').mockImplementationOnce(() => {
      throw new Error('connection refused')
    })

    const response = await save({ ...YOGURT, photoToken: token() })

    expect(response.status).toBe(500)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(await sharedRows()).toEqual([])
  })
})

describe('saving an item AI Vision filled', () => {
  it("shares only the confirmed product facts, keyed by the typed barcode, after the user's row", async () => {
    const photoToken = token()
    const response = await save({ ...YOGURT, photoToken })

    expect(response.status).toBe(201)
    expect(response.body.catalog).toBe('saved')
    expect(response.body.item).toMatchObject({ name: 'Greek Yogurt', quantity: 2, barcode: SCANNED })
    const [row] = await sharedRows()
    expect(row).toMatchObject({ barcode: KEY, photoKey: null, photoAlias: ALIAS, expirySuggestion: null })
    expect(row.payload).toEqual(PHOTO_ROW)
    // No owner, dates, count or token in what every other user can read.
    const shared = JSON.stringify({ payload: row.payload, expirySuggestion: row.expirySuggestion })
    for (const secret of [DEV_USER.id, '2026-11-08', '2026-11-20', photoToken, 'test-key']) {
      expect(shared).not.toContain(secret)
    }
    expect(await inventoryRows()).toHaveLength(1)
  })

  it('keeps edits the user made, and leaves out a category that is not one of ours', async () => {
    const response = await save({ ...YOGURT, name: ' Skyr ', brand: '', category: 'Snacks', photoToken: token() })

    expect(response.body.catalog).toBe('saved')
    const [row] = await sharedRows()
    expect(row.payload).toEqual({ ...PHOTO_ROW, name: 'Skyr', brand: null, category: null })
    const [saved] = await inventoryRows()
    expect(saved.category).toBe('Snacks')
  })

  it('is idempotent: saving it again adds the item but keeps the first shared row', async () => {
    await save({ ...YOGURT, photoToken: token() })
    const response = await save({ ...YOGURT, name: 'Other name', photoToken: token() })

    expect(response.status).toBe(201)
    expect(response.body.catalog).toBe('exists')
    expect(await inventoryRows()).toHaveLength(2)
    const rows = await sharedRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].payload.name).toBe('Greek Yogurt')
  })

  it('never overwrites a product a database found, under any form of the code', async () => {
    const found: FinalRecord = {
      source: 'Open Facts',
      barcode: SCANNED,
      name: 'Plain Greek Yogurt',
      brand: 'Chobani',
      description: null,
      quantity: '500 g',
      category: 'Dairies',
      imageUrl: null,
      ingredients: null,
    }
    await db.insert(items).values({ barcode: KEY, payload: found })

    const response = await save({ ...YOGURT, barcode: '0012345678905', photoToken: token() })

    expect(response.body.catalog).toBe('exists')
    const [row] = await sharedRows()
    expect(row.payload).toEqual(found)
  })

  it.each([
    ['a barcode with a wrong check digit', { barcode: '012345678906' }],
    ['a code too short to be a GTIN', { barcode: '12345' }],
  ])('saves the item but shares nothing for %s', async (_label, change) => {
    const response = await save({ ...YOGURT, ...change, photoToken: token() })

    expect(response.status).toBe(201)
    expect(response.body.catalog).toBe('bad-barcode')
    expect(await inventoryRows()).toHaveLength(1)
    expect(await sharedRows()).toEqual([])
  })

  it.each([
    ['a made-up token', () => 'made.up'],
    ["another user's token", () => signPhotoProvenance(NOBODY, AI_FOOD)!],
    ['an expired token', () => signPhotoProvenance(DEV_USER.id, AI_FOOD, Date.now() - PHOTO_PROVENANCE_TTL_MS - 1)!],
  ])('saves the item but shares nothing for %s', async (_label, makeToken) => {
    const response = await save({ ...YOGURT, photoToken: makeToken() })

    expect(response.status).toBe(201)
    expect(response.body.catalog).toBe('unverified')
    expect(await inventoryRows()).toHaveLength(1)
    expect(await sharedRows()).toEqual([])
  })

  it('shares nothing for a save without a token, as from the barcode scanner or by hand', async () => {
    const response = await save(YOGURT)

    expect(response.status).toBe(201)
    expect(response.body).not.toHaveProperty('catalog')
    expect(await sharedRows()).toEqual([])
  })

  it('still saves the item when the shared row cannot be written, and says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = db.insert.bind(db)
    vi.spyOn(db, 'insert').mockImplementation(((table: typeof items) => {
      if (table === items) throw new Error('connection refused')
      return original(table)
    }) as never)

    const response = await save({ ...YOGURT, photoToken: token() })

    expect(response.status).toBe(201)
    expect(response.body.catalog).toBe('failed')
    expect(await inventoryRows()).toHaveLength(1)
    vi.mocked(db.insert).mockRestore()
    expect(await sharedRows()).toEqual([])
  })
})

describe('scanning a barcode a photo item was shared under', () => {
  beforeEach(async () => {
    await db.insert(items).values({
      barcode: KEY,
      photoAlias: ALIAS,
      payload: PHOTO_ROW as never,
      expirySuggestion: { matchedFood: 'Yogurt' } as never,
    })
  })

  it('answers with the shared row when no database has the product', async () => {
    answer({})

    const response = await lookup()

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ product: PHOTO_ROW, category: 'Dairy' })
  })

  it('answers with the shared row when the databases are down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    answer({ openFacts: new Error('ECONNRESET'), upcItemDb: new Error('ECONNRESET') })

    const response = await lookup()

    expect(response.status).toBe(200)
    expect(response.body.product).toEqual(PHOTO_ROW)
  })

  it("replaces it with a database's record, and drops the shelf life worked out from the photo", async () => {
    answer({ openFacts: OPEN_FACTS_HIT })

    const response = await lookup()

    expect(response.status).toBe(200)
    expect(response.body.product).toMatchObject({ source: 'Open Facts', name: 'Plain Greek Yogurt' })
    const [row] = await db.select().from(items).where(eq(items.barcode, KEY))
    expect(row.payload).toMatchObject({ source: 'Open Facts', name: 'Plain Greek Yogurt' })
    expect(row.expirySuggestion).toBeNull()
  })
})

const NO_BARCODE = { ...YOGURT, barcode: '' }
const BARCODELESS_KEY = 'v1|greek yogurt|chobani|Dairy'
const match = (photoToken: unknown) => request(app).post('/api/food/photo/match').send({ photoToken })

describe('saving an item AI Vision filled, with no barcode', () => {
  it('shares it under its name, brand and category, with what Gemini called it', async () => {
    const photoToken = token()
    const response = await save({ ...NO_BARCODE, photoToken })

    expect(response.status).toBe(201)
    expect(response.body.catalog).toBe('saved')
    const [row] = await sharedRows()
    expect(row).toMatchObject({ barcode: null, photoKey: BARCODELESS_KEY, photoAlias: ALIAS, expirySuggestion: null })
    expect(row.payload).toEqual({ ...PHOTO_ROW, barcode: null })
    const shared = JSON.stringify({ key: row.photoKey, payload: row.payload })
    for (const secret of [DEV_USER.id, '2026-11-08', '2026-11-20', photoToken, 'test-key']) {
      expect(shared).not.toContain(secret)
    }
  })

  it('keeps one row for the same product however it was typed, and saving again is a no-op', async () => {
    await save({ ...NO_BARCODE, photoToken: token() })
    const again = await save({ ...NO_BARCODE, name: '  greek   YOGURT! ', brand: 'CHOBANI', photoToken: token() })

    expect(again.body.catalog).toBe('exists')
    const rows = await sharedRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].payload.name).toBe('Greek Yogurt')
    expect(await inventoryRows()).toHaveLength(2)
  })

  it.each([
    ['another category', { category: 'Frozen' }],
    ['another brand', { brand: 'Fage' }],
    ['no brand', { brand: '' }],
    ['a plural name', { name: 'Greek Yogurts' }],
  ])('keeps a product with %s apart', async (_label, change) => {
    await save({ ...NO_BARCODE, photoToken: token() })
    const other = await save({ ...NO_BARCODE, ...change, photoToken: token() })

    expect(other.body.catalog).toBe('saved')
    expect(await sharedRows()).toHaveLength(2)
  })

  it.each([
    ['an email address', { name: 'Yogurt for jo@example.com' }],
    ['a phone number', { name: 'Call 555-123-4567 yogurt' }],
    ['a link', { brand: 'www.example.org' }],
    ['a long note', { name: 'Yogurt that my roommate left in the fridge last week, do not eat' }],
    ['no letters or numbers', { name: '!!!' }],
  ])('saves the item but shares nothing with %s in it', async (_label, change) => {
    const response = await save({ ...NO_BARCODE, ...change, photoToken: token() })

    expect(response.status).toBe(201)
    expect(response.body.catalog).toBe('private-text')
    expect(await inventoryRows()).toHaveLength(1)
    expect(await sharedRows()).toEqual([])
  })

  it('is never found by a barcode scan', async () => {
    await save({ ...NO_BARCODE, photoToken: token() })
    answer({})

    const response = await lookup()

    expect(response.status).toBe(404)
  })

  it('cannot exist with both keys, or neither', async () => {
    await expect(
      db.insert(items).values({ barcode: KEY, photoKey: BARCODELESS_KEY, payload: PHOTO_ROW as never }),
    ).rejects.toThrow()
    await expect(db.insert(items).values({ payload: PHOTO_ROW as never })).rejects.toThrow()
  })
})

describe('POST /api/food/photo/match', () => {
  it('offers what someone confirmed for a photo Gemini named the same way, and writes nothing', async () => {
    // As another user's save left it: shared rows hold no owner.
    await db.insert(items).values({
      photoKey: BARCODELESS_KEY,
      photoAlias: ALIAS,
      payload: { ...PHOTO_ROW, barcode: null } as never,
    })
    const before = await sharedRows()

    const response = await match(token())

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ match: { name: 'Greek Yogurt', brand: 'Chobani', category: 'Dairy' } })
    expect(await sharedRows()).toEqual(before)
    expect(await inventoryRows()).toEqual([])
  })

  it('offers nothing when two different products were confirmed for it', async () => {
    await save({ ...NO_BARCODE, photoToken: token() })
    await save({ ...NO_BARCODE, name: 'Skyr', photoToken: token() })

    expect((await match(token())).body).toEqual({ match: null })
  })

  it('offers nothing for a different photo, or one only shared under a barcode', async () => {
    await save({ ...YOGURT, photoToken: token() })

    expect((await match(token())).body).toEqual({ match: null })
    expect((await match(token({ name: 'Banana' }))).body).toEqual({ match: null })
  })

  it.each([
    ['no token', undefined],
    ['a made-up token', 'made.up'],
    ["another user's token", () => signPhotoProvenance(NOBODY, AI_FOOD)!],
  ])('refuses %s', async (_label, value) => {
    const response = await match(typeof value === 'function' ? value() : value)

    expect(response.status).toBe(400)
  })

  it('requires auth', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', '')

    expect((await match(token())).status).toBe(401)
  })
})

describe('migration 0004 on a table that already has rows', () => {
  it('keeps every barcode row, its payload and shelf life, and still refuses a duplicate code', async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const { drizzle } = await import('drizzle-orm/pglite')
    const fresh = drizzle(new PGlite())
    const before = mkdtempSync(join(tmpdir(), 'bestbefore-migrations-'))
    try {
      // The migrations as they were before 0004.
      cpSync('drizzle', before, { recursive: true })
      const journalPath = join(before, 'meta', '_journal.json')
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
      journal.entries = journal.entries.filter((entry: { tag: string }) => entry.tag < '0004')
      writeFileSync(journalPath, JSON.stringify(journal))

      await fresh.execute(sql`CREATE SCHEMA neon_auth`)
      await fresh.execute(sql`CREATE TABLE neon_auth."user" (id uuid PRIMARY KEY)`)
      await migrate(fresh, { migrationsFolder: before })
      await fresh.execute(sql`
        INSERT INTO items (barcode, payload, expiry_suggestion) VALUES
          ('00012345678905', '{"source":"Open Facts","name":"Whole Milk"}', '{"matchedFood":"Milk"}'),
          ('04006381333931', '{"sources":["Open Facts","UPCitemdb"],"name":"Pens"}', NULL)`)

      await migrate(fresh, { migrationsFolder: 'drizzle' })

      const { rows } = await fresh.execute(
        sql`SELECT id, barcode, photo_key, photo_alias, payload, expiry_suggestion FROM items ORDER BY barcode`,
      )
      expect(rows).toEqual([
        {
          id: expect.any(Number),
          barcode: '00012345678905',
          photo_key: null,
          photo_alias: null,
          payload: { source: 'Open Facts', name: 'Whole Milk' },
          expiry_suggestion: { matchedFood: 'Milk' },
        },
        {
          id: expect.any(Number),
          barcode: '04006381333931',
          photo_key: null,
          photo_alias: null,
          payload: { sources: ['Open Facts', 'UPCitemdb'], name: 'Pens' },
          expiry_suggestion: null,
        },
      ])
      await expect(
        fresh.execute(sql`INSERT INTO items (barcode, payload) VALUES ('00012345678905', '{}')`),
      ).rejects.toThrow()
      await expect(fresh.execute(sql`INSERT INTO items (barcode, payload) VALUES ('123', '{}')`)).rejects.toThrow()
      await fresh.execute(sql`INSERT INTO items (photo_key, payload) VALUES ('v1|apple||Produce', '{}')`)
      await expect(
        fresh.execute(sql`INSERT INTO items (photo_key, payload) VALUES ('v1|apple||Produce', '{}')`),
      ).rejects.toThrow()
    } finally {
      rmSync(before, { recursive: true, force: true })
    }
  })
})
