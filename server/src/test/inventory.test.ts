import request from 'supertest'
import { app } from '../app.js'
import { DEV_USER } from '../auth/devAuth.js'
import { db } from '../db/index.js'
import { inventoryItems } from '../db/schema.js'

const { eqSpy } = vi.hoisted(() => ({ eqSpy: vi.fn() }))

// Records which user each query is scoped to.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    eq: (...args: Parameters<typeof actual.eq>) => {
      eqSpy(...args)
      return actual.eq(...args)
    },
  }
})

const ITEM = {
  id: 1,
  name: 'Milk 2%',
  brand: 'Dairyland',
  barcode: '0068700011016',
  category: 'Dairy',
  quantity: 1,
  unit: 'L',
  purchaseDate: '2026-10-17',
  bestBefore: '2026-10-24',
  createdAt: new Date('2026-10-17T15:00:00Z'),
}

// Stubs db.select().from().where().orderBy() to resolve with (or reject on) `result()`.
function stubSelect(result: () => Promise<unknown>) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: result,
  }
  return vi.spyOn(db, 'select').mockReturnValue(chain as never)
}

describe('GET /api/inventory', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    eqSpy.mockClear()
  })

  it('rejects requests without a token', async () => {
    const select = stubSelect(async () => [])

    const response = await request(app).get('/api/inventory')

    expect(response.status).toBe(401)
    expect(select).not.toHaveBeenCalled()
  })

  it("returns the signed-in user's items", async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    stubSelect(async () => [ITEM])

    const response = await request(app).get('/api/inventory')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      items: [{ ...ITEM, createdAt: '2026-10-17T15:00:00.000Z' }],
    })
    expect(eqSpy).toHaveBeenCalledWith(inventoryItems.userId, DEV_USER.id)
  })

  it('returns a JSON error when the query fails', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubSelect(async () => {
      throw new Error('connection refused')
    })

    const response = await request(app).get('/api/inventory')

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: "Couldn't load your items. Please try again." })
  })
})

describe('POST /api/inventory', () => {
  const NEW_ITEM = {
    name: 'Milk 2%',
    brand: 'Dairyland',
    barcode: '0068700011016',
    category: 'Dairy',
    quantity: 2,
    purchaseDate: '2026-10-17',
    bestBefore: '2026-10-24',
  }

  // Stubs db.insert().values().returning(), remembering what was inserted.
  function stubInsert(result: () => Promise<unknown>) {
    const values = vi.fn(() => ({ returning: result }))
    const insert = vi.spyOn(db, 'insert').mockReturnValue({ values } as never)
    return { insert, values }
  }

  const post = (body: object) => request(app).post('/api/inventory').send(body)

  beforeEach(() => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('rejects requests without a token', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', '')
    const { insert } = stubInsert(async () => [])

    expect((await post(NEW_ITEM)).status).toBe(401)
    expect(insert).not.toHaveBeenCalled()
  })

  it('saves the item for the signed-in user and returns the saved row', async () => {
    const { values } = stubInsert(async () => [ITEM])

    const response = await post(NEW_ITEM)

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ item: { ...ITEM, createdAt: '2026-10-17T15:00:00.000Z' } })
    expect(values).toHaveBeenCalledWith({ ...NEW_ITEM, userId: DEV_USER.id })
  })

  it('never takes the owner from the request', async () => {
    const { values } = stubInsert(async () => [ITEM])

    await post({ ...NEW_ITEM, userId: '00000000-0000-0000-0000-000000000000', id: 99 })

    expect(values).toHaveBeenCalledWith({ ...NEW_ITEM, userId: DEV_USER.id })
  })

  it('stores blank optional fields as null', async () => {
    const { values } = stubInsert(async () => [ITEM])

    await post({ ...NEW_ITEM, brand: '  ', barcode: '', category: null })

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ brand: null, barcode: null, category: null }),
    )
  })

  it.each([
    ['a missing name', { name: ' ' }],
    ['a package size as the quantity', { quantity: '400.0 g' }],
    ['a zero quantity', { quantity: 0 }],
    ['a fractional quantity', { quantity: 1.5 }],
    ['a bad date', { bestBefore: 'next week' }],
    ['an impossible date', { purchaseDate: '2026-02-31' }],
    ['a best before earlier than the date bought', { bestBefore: '2026-10-16' }],
  ])('rejects %s', async (_label, change) => {
    const { insert } = stubInsert(async () => [ITEM])

    const response = await post({ ...NEW_ITEM, ...change })

    expect(response.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('reports a failed save instead of claiming success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubInsert(async () => {
      throw new Error('connection refused')
    })

    const response = await post(NEW_ITEM)

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: "Couldn't save your item. Please try again." })
  })
})
