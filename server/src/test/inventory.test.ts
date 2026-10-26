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
