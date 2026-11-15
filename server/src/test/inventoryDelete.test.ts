import request from 'supertest'
import { app } from '../app.js'
import { DEV_USER } from '../auth/devAuth.js'
import { db } from '../db/index.js'
import { inventoryItems, items } from '../db/schema.js'

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

const OTHER_USER = '00000000-0000-0000-0000-000000000000'

// Stubs db.delete().where().returning(), remembering the table and filter.
function stubDelete(result: () => Promise<unknown>) {
  const where = vi.fn(() => ({ returning: result }))
  const remove = vi.spyOn(db, 'delete').mockReturnValue({ where } as never)
  return { remove, where }
}

// No other write may happen alongside a delete.
function spyOtherWrites() {
  return [vi.spyOn(db, 'insert'), vi.spyOn(db, 'update')]
}

beforeEach(() => {
  vi.stubEnv('VITE_DISABLE_AUTH', 'true')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  eqSpy.mockClear()
})

describe('DELETE /api/inventory/:id', () => {
  const remove = (id: number | string, body?: object) => request(app).delete(`/api/inventory/${id}`).send(body)

  it('rejects requests without a token', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', '')
    const { remove: del } = stubDelete(async () => [{ id: 7 }])

    expect((await remove(7)).status).toBe(401)
    expect(del).not.toHaveBeenCalled()
  })

  it("deletes only the signed-in user's inventory row, never the shared product", async () => {
    const others = spyOtherWrites()
    const { remove: del } = stubDelete(async () => [{ id: 7 }])

    const response = await remove(7)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: 7 })
    expect(del).toHaveBeenCalledOnce()
    expect(del).toHaveBeenCalledWith(inventoryItems)
    expect(del).not.toHaveBeenCalledWith(items)
    for (const write of others) expect(write).not.toHaveBeenCalled()
    expect(eqSpy).toHaveBeenCalledWith(inventoryItems.id, 7)
    expect(eqSpy).toHaveBeenCalledWith(inventoryItems.userId, DEV_USER.id)
  })

  it('never takes the owner from the request', async () => {
    stubDelete(async () => [{ id: 7 }])

    await remove(7, { userId: OTHER_USER, id: 99 })

    expect(eqSpy).toHaveBeenCalledWith(inventoryItems.userId, DEV_USER.id)
    expect(eqSpy).not.toHaveBeenCalledWith(inventoryItems.userId, OTHER_USER)
    expect(eqSpy).not.toHaveBeenCalledWith(inventoryItems.id, 99)
  })

  it("is a 404 for another user's item, as for a missing one", async () => {
    // The owner filter matches no row, so nothing is deleted.
    stubDelete(async () => [])

    const response = await remove(7)

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: 'Item not found.' })
  })

  it.each(['abc', '0', '-1', '1.5'])('is a 404 without deleting for the id %s', async (id) => {
    const { remove: del } = stubDelete(async () => [{ id: 7 }])

    expect((await remove(id)).status).toBe(404)
    expect(del).not.toHaveBeenCalled()
  })

  it('reports a failed delete instead of claiming success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubDelete(async () => {
      throw new Error('connection refused')
    })

    const response = await remove(7)

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: "Couldn't delete your item. Please try again." })
  })
})


describe('DELETE /api/inventory (several items)', () => {
  const removeMany = (body?: unknown) => request(app).delete('/api/inventory').send(body as object)

  it('rejects requests without a token', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', '')
    const { remove: del } = stubDelete(async () => [{ id: 1 }])

    expect((await removeMany({ ids: [1] })).status).toBe(401)
    expect(del).not.toHaveBeenCalled()
  })

  it("deletes only the signed-in user's rows and returns the removed ids", async () => {
    const others = spyOtherWrites()
    const { remove: del } = stubDelete(async () => [{ id: 1 }, { id: 2 }])

    const response = await removeMany({ ids: [1, 2] })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ids: [1, 2] })
    expect(del).toHaveBeenCalledOnce()
    expect(del).toHaveBeenCalledWith(inventoryItems)
    expect(del).not.toHaveBeenCalledWith(items)
    for (const write of others) expect(write).not.toHaveBeenCalled()
    expect(eqSpy).toHaveBeenCalledWith(inventoryItems.userId, DEV_USER.id)
  })

  it('never takes the owner from the request', async () => {
    stubDelete(async () => [{ id: 1 }])

    await removeMany({ ids: [1], userId: OTHER_USER })

    expect(eqSpy).toHaveBeenCalledWith(inventoryItems.userId, DEV_USER.id)
    expect(eqSpy).not.toHaveBeenCalledWith(inventoryItems.userId, OTHER_USER)
  })

  it('skips ids that are missing or owned by someone else instead of failing', async () => {
    stubDelete(async () => [{ id: 1 }])

    const response = await removeMany({ ids: [1, 999] })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ids: [1] })
  })

  it.each([
    ['an empty list', { ids: [] }],
    ['ids that is not an array', { ids: 'abc' }],
    ['a missing ids field', {}],
    ['a non-integer id', { ids: [1.5] }],
    ['a zero id', { ids: [0] }],
    ['an id above the Postgres integer limit', { ids: [2_147_483_648] }],
    ['more than 500 ids', { ids: Array.from({ length: 501 }, (_, i) => i + 1) }],
  ])('is a 400 without deleting for %s', async (_label, body) => {
    const { remove: del } = stubDelete(async () => [{ id: 1 }])

    const response = await removeMany(body)

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ error: 'Choose at least one item to remove.' })
    expect(del).not.toHaveBeenCalled()
  })

  it('reports a failed delete instead of claiming success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubDelete(async () => {
      throw new Error('connection refused')
    })

    const response = await removeMany({ ids: [1] })

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ error: "Couldn't remove your items. Please try again." })
  })
})
