import request from 'supertest'
import { app } from '../app.js'
import { DEV_USER } from '../auth/devAuth.js'
import { db } from '../db/index.js'
import { inventoryItems, items } from '../db/schema.js'
import { suggestExpiry, type ShelfLife } from '../food/expirySuggestion.js'
import { findItem } from '../food/items.js'

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

// The shared product row is only ever read, through findItem.
vi.mock('../food/items.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../food/items.js')>()),
  findItem: vi.fn(),
}))

const OTHER_USER = '00000000-0000-0000-0000-000000000000'

const SAVED = {
  id: 7,
  name: 'Canned Tuna',
  brand: 'Ocean Co',
  barcode: '0012345678905',
  category: 'Pantry',
  quantity: 3,
  unit: null,
  purchaseDate: '2026-11-01',
  bestBefore: '2029-11-01',
  imageSource: null,
  imageUrl: null,
  createdAt: new Date('2026-11-01T15:00:00Z'),
}

const EDIT = {
  name: 'Canned Tuna',
  brand: 'Ocean Co',
  category: 'Pantry',
  quantity: 3,
  purchaseDate: '2026-11-01',
  bestBefore: '2029-11-01',
}

// Stubs db.update().set().where().returning(), remembering the table, values and filter.
function stubUpdate(result: () => Promise<unknown>) {
  const where = vi.fn(() => ({ returning: result }))
  const set = vi.fn(() => ({ where }))
  const update = vi.spyOn(db, 'update').mockReturnValue({ set } as never)
  return { update, set, where }
}

// Stubs db.select().from().where() to resolve with `rows`, the owner's own row or nothing.
function stubSelect(rows: unknown[]) {
  const chain = { from: () => chain, where: async () => rows }
  return vi.spyOn(db, 'select').mockReturnValue(chain as never)
}

beforeEach(() => {
  vi.stubEnv('VITE_DISABLE_AUTH', 'true')
  vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.mocked(findItem).mockReset()
  eqSpy.mockClear()
})

describe('PATCH /api/inventory/:id', () => {
  const patch = (id: number | string, body: object) => request(app).patch(`/api/inventory/${id}`).send(body)

  it('rejects requests without a token', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', '')
    const { update } = stubUpdate(async () => [SAVED])

    expect((await patch(7, EDIT)).status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it("updates only the signed-in user's inventory row and returns it", async () => {
    const insert = vi.spyOn(db, 'insert')
    const { update, set } = stubUpdate(async () => [{ ...SAVED, quantity: 2 }])

    const response = await patch(7, { ...EDIT, quantity: 2 })

    expect(response.status).toBe(200)
    expect(response.body.item).toMatchObject({ id: 7, quantity: 2 })
    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(inventoryItems)
    expect(update).not.toHaveBeenCalledWith(items)
    expect(insert).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith({ ...EDIT, quantity: 2 })
    expect(eqSpy).toHaveBeenCalledWith(inventoryItems.id, 7)
    expect(eqSpy).toHaveBeenCalledWith(inventoryItems.userId, DEV_USER.id)
  })

  it('never takes the owner, barcode or picture from the request', async () => {
    const { set } = stubUpdate(async () => [SAVED])

    await patch(7, {
      ...EDIT,
      id: 99,
      userId: OTHER_USER,
      barcode: '0000000000000',
      imageUrl: 'https://example.com/x.jpg',
      photo: 'data:image/jpeg;base64,AA==',
    })

    expect(set).toHaveBeenCalledWith(EDIT)
    expect(eqSpy).not.toHaveBeenCalledWith(inventoryItems.userId, OTHER_USER)
  })

  it("is a 404 for another user's item, as for a missing one", async () => {
    // The owner filter matches no row.
    stubUpdate(async () => [])

    const response = await patch(7, EDIT)

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: 'Item not found.' })
  })

  it.each([
    ['a missing name', { name: ' ' }],
    ['a zero quantity', { quantity: 0 }],
    ['a bad date', { purchaseDate: 'yesterday' }],
    ['a best before earlier than the date bought', { bestBefore: '2026-10-31' }],
  ])('rejects %s without writing', async (_label, change) => {
    const { update } = stubUpdate(async () => [SAVED])

    expect((await patch(7, { ...EDIT, ...change })).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('is a 404 for an id that is not one', async () => {
    const { update } = stubUpdate(async () => [SAVED])

    expect((await patch('abc', EDIT)).status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })

  it('reports a failed save instead of claiming success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubUpdate(async () => {
      throw new Error('connection refused')
    })

    const response = await patch(7, EDIT)

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: "Couldn't save your changes. Please try again." })
  })
})

describe('GET /api/inventory/:id/expiry-suggestion', () => {
  const OWN_ROW = { name: 'Canned Tuna', brand: 'Ocean Co', barcode: SAVED.barcode, category: null }
  const RECORD = {
    source: 'Open Facts',
    barcode: SAVED.barcode,
    name: 'Canned Tuna',
    brand: 'Ocean Co',
    description: null,
    quantity: null,
    category: null,
    imageUrl: null,
    ingredients: null,
  }
  let tuna: ShelfLife

  beforeAll(async () => {
    vi.stubEnv('EXPIRY_AI_FALLBACK_ENABLED', 'false')
    const answer = await suggestExpiry(
      { name: 'Canned Tuna', brand: null, barcode: null, category: null, productCategory: null, purchaseDate: '2026-11-01' },
      'test-user',
    )
    if (answer.status !== 'suggested') throw new Error('no shelf life for tuna')
    tuna = answer.shelfLife
    vi.unstubAllEnvs()
  })

  const get = (id: number, purchaseDate?: string) =>
    request(app)
      .get(`/api/inventory/${id}/expiry-suggestion`)
      .query(purchaseDate ? { purchaseDate } : {})

  function savedProduct(expirySuggestion: unknown) {
    vi.mocked(findItem).mockResolvedValue({
      id: 1,
      barcode: '00012345678905',
      photoKey: null,
      photoAlias: null,
      payload: RECORD as never,
      expirySuggestion: expirySuggestion as never,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  it('rejects requests without a token', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', '')
    const select = stubSelect([OWN_ROW])

    expect((await get(7, '2027-01-15')).status).toBe(401)
    expect(select).not.toHaveBeenCalled()
  })

  it('counts the saved shelf life from the new date bought, without writing anything', async () => {
    stubSelect([OWN_ROW])
    savedProduct(tuna)
    const update = vi.spyOn(db, 'update')
    const insert = vi.spyOn(db, 'insert')

    const response = await get(7, '2027-01-15')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'suggested', earliest: '2030-01-15', matchedFood: tuna.matchedFood })
    expect(findItem).toHaveBeenCalledWith(SAVED.barcode)
    expect(eqSpy).toHaveBeenCalledWith(inventoryItems.userId, DEV_USER.id)
    expect(update).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it("is a 404 for another user's item", async () => {
    stubSelect([])

    expect((await get(7, '2027-01-15')).status).toBe(404)
    expect(findItem).not.toHaveBeenCalled()
  })

  it.each([
    ['no barcode', { ...OWN_ROW, barcode: null }, null],
    ['no saved shelf life', OWN_ROW, null],
    ['an item renamed away from the saved product', { ...OWN_ROW, name: 'Peanut Butter' }, 'tuna'],
  ])('says honestly there is no suggestion for %s', async (_label, row, stored) => {
    stubSelect([row])
    savedProduct(stored === 'tuna' ? tuna : null)

    const response = await get(7, '2027-01-15')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      status: 'none',
      message: 'No saved suggestion for this item. Check the package and enter the date.',
    })
  })

  it('needs the date bought', async () => {
    const select = stubSelect([OWN_ROW])

    expect((await get(7)).status).toBe(400)
    expect(select).not.toHaveBeenCalled()
  })
})
