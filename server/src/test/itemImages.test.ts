import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import request from 'supertest'
import type { FinalRecord } from '../../../testscripts/normalizer.js'
import { app } from '../app.js'
import { DEV_USER } from '../auth/devAuth.js'
import { db as appDb } from '../db/index.js'
import { inventoryItems, items, MAX_ITEM_PHOTO_BYTES } from '../db/schema.js'
import { saveItem } from '../food/items.js'
import { decodePhoto, safeImageUrl } from '../inventory/itemImages.js'

// A real Postgres in memory, built by the real migrations, so the bytea round trip and the image
// check constraint are Postgres's behaviour and not a stub's.
vi.mock('../db/index.js', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const schema = await import('../db/schema.js')
  return { db: drizzle(new PGlite(), { schema }) }
})

const db = appDb as unknown as PgliteDatabase<Record<string, never>>

const OTHER_USER = '00000000-0000-4000-8000-000000000001'
const SCANNED = '012345678905'
const IMAGE = 'https://images.openfoodfacts.org/images/products/001/milk.400.jpg'

const PRODUCT: FinalRecord = {
  source: 'Open Facts',
  barcode: SCANNED,
  name: 'Whole Milk',
  brand: 'Dairyland',
  description: null,
  quantity: '1 L',
  category: 'Milks',
  imageUrl: IMAGE,
  ingredients: null,
}

// The smallest thing that starts like a JPEG, plus some bytes to round-trip.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])
const PHOTO = `data:image/jpeg;base64,${JPEG.toString('base64')}`

const ITEM = {
  name: 'Whole Milk',
  brand: 'Dairyland',
  barcode: SCANNED,
  category: 'Dairy',
  quantity: 1,
  purchaseDate: '2026-11-08',
  bestBefore: '2026-11-15',
}

const post = (body: object) => request(app).post('/api/inventory').send(body)
const savedRows = () => db.select().from(inventoryItems)

beforeAll(async () => {
  // Neon Auth owns this table in production; the migrations only point a foreign key at it.
  await db.execute(sql`CREATE SCHEMA neon_auth`)
  await db.execute(sql`CREATE TABLE neon_auth."user" (id uuid PRIMARY KEY)`)
  await db.execute(sql`INSERT INTO neon_auth."user" (id) VALUES (${DEV_USER.id}), (${OTHER_USER})`)
  await migrate(db, { migrationsFolder: 'drizzle' })
})

beforeEach(async () => {
  await db.delete(inventoryItems)
  await db.delete(items)
  vi.stubEnv('VITE_DISABLE_AUTH', 'true')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('barcode product images', () => {
  it("saves the lookup's image link with the item and lists it", async () => {
    await saveItem(SCANNED, PRODUCT, true)

    const response = await post({ ...ITEM, imageUrl: IMAGE })

    expect(response.status).toBe(201)
    expect(response.body.item).toMatchObject({ imageSource: 'product', imageUrl: IMAGE })
    const list = await request(app).get('/api/inventory')
    expect(list.body.items).toEqual([expect.objectContaining({ imageSource: 'product', imageUrl: IMAGE })])
  })

  it('upgrades an http link to https', async () => {
    await saveItem(SCANNED, { ...PRODUCT, imageUrl: 'http://images.test/milk.jpg' }, true)

    const response = await post({ ...ITEM, imageUrl: 'http://images.test/milk.jpg' })

    expect(response.body.item.imageUrl).toBe('https://images.test/milk.jpg')
  })

  it.each([
    ['a link the lookup never returned', async () => saveItem(SCANNED, PRODUCT, true), 'https://evil.test/pixel.gif'],
    ['a barcode nobody looked up', async () => {}, IMAGE],
  ])('saves the item without a picture for %s', async (_label, setup, imageUrl) => {
    await setup()

    const response = await post({ ...ITEM, imageUrl })

    expect(response.status).toBe(201)
    expect(response.body.item).toMatchObject({ imageSource: null, imageUrl: null })
  })

  it('drops a recorded link a browser should not load', async () => {
    await saveItem(SCANNED, { ...PRODUCT, imageUrl: 'https://127.0.0.1/milk.jpg' }, true)

    const response = await post({ ...ITEM, imageUrl: 'https://127.0.0.1/milk.jpg' })

    expect(response.body.item.imageUrl).toBeNull()
  })

  it('never puts the image or the owner in the shared product row', async () => {
    await saveItem(SCANNED, PRODUCT, true)
    await post({ ...ITEM, photo: PHOTO })

    const [shared] = await db.select().from(items)
    expect(shared.payload).toEqual(PRODUCT)
  })
})

describe('AI Vision photos', () => {
  it('saves the still exactly as sent and serves it back only to its owner', async () => {
    const response = await post({ ...ITEM, barcode: null, photo: PHOTO })

    expect(response.status).toBe(201)
    expect(response.body.item).toMatchObject({ imageSource: 'photo', imageUrl: null })
    expect(response.body.item).not.toHaveProperty('photo')

    const photo = await request(app).get(`/api/inventory/${response.body.item.id}/photo`)
    expect(photo.status).toBe(200)
    expect(photo.headers['content-type']).toBe('image/jpeg')
    expect(photo.headers['cache-control']).toBe('private, max-age=86400')
    expect(Buffer.compare(photo.body as Buffer, JPEG)).toBe(0)
  })

  it("never serves another user's photo", async () => {
    const [row] = await db
      .insert(inventoryItems)
      .values({ ...ITEM, userId: OTHER_USER, imageSource: 'photo', photo: JPEG, photoType: 'image/jpeg' })
      .returning({ id: inventoryItems.id })

    const response = await request(app).get(`/api/inventory/${row.id}/photo`)

    expect(response.status).toBe(404)
  })

  it('needs a session to read a photo', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', '')

    expect((await request(app).get('/api/inventory/1/photo')).status).toBe(401)
  })

  it('has no photo for an item saved without one', async () => {
    const response = await post(ITEM)

    expect(response.body.item).toMatchObject({ imageSource: null, imageUrl: null })
    expect((await request(app).get(`/api/inventory/${response.body.item.id}/photo`)).status).toBe(404)
  })

  it.each([
    ['a PNG', `data:image/png;base64,${JPEG.toString('base64')}`],
    ['bytes that are not a JPEG', `data:image/jpeg;base64,${Buffer.from('hello world').toString('base64')}`],
    ['a link instead of a still', 'https://images.test/apple.jpg'],
  ])('rejects %s and saves nothing', async (_label, photo) => {
    const response = await post({ ...ITEM, photo })

    expect(response.status).toBe(400)
    expect(await savedRows()).toEqual([])
  })

  it('rejects a photo over the size cap and saves nothing', async () => {
    const big = Buffer.alloc(MAX_ITEM_PHOTO_BYTES + 1, 0)
    JPEG.copy(big)

    const response = await post({ ...ITEM, photo: `data:image/jpeg;base64,${big.toString('base64')}` })

    expect(response.status).toBe(400)
    expect(await savedRows()).toEqual([])
  })

  it('rejects a save carrying both kinds of picture', async () => {
    await saveItem(SCANNED, PRODUCT, true)

    expect((await post({ ...ITEM, imageUrl: IMAGE, photo: PHOTO })).status).toBe(400)
    expect(await savedRows()).toEqual([])
  })

  it('leaves no photo behind when the save itself fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // With the user gone from Neon Auth, the insert fails on its foreign key.
    await db.execute(sql`DELETE FROM neon_auth."user" WHERE id = ${DEV_USER.id}`)
    try {
      const response = await post({ ...ITEM, photo: PHOTO })

      expect(response.status).toBe(500)
      expect(await savedRows()).toEqual([])
    } finally {
      await db.execute(sql`INSERT INTO neon_auth."user" (id) VALUES (${DEV_USER.id})`)
    }
  })
})

describe('safeImageUrl', () => {
  it.each([
    ['javascript:alert(1)'],
    ['data:image/png;base64,AA'],
    ['https://user:pass@images.test/a.jpg'],
    ['https://localhost/a.jpg'],
    ['https://[::1]/a.jpg'],
    ['https://intranet/a.jpg'],
    [`https://images.test/${'a'.repeat(2048)}`],
  ])('refuses %s', (url) => {
    expect(safeImageUrl(url)).toBeNull()
  })
})

describe('decodePhoto', () => {
  it('returns the bytes as sent', () => {
    expect(Buffer.compare(decodePhoto(PHOTO), JPEG)).toBe(0)
  })
})
