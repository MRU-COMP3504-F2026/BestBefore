import request from 'supertest'
import { app } from '../app.js'
import { db } from '../db/index.js'

function stubSelect(result: () => Promise<unknown>) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: result,
    then: (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) =>
      result().then(resolve, reject),
  }
  return vi.spyOn(db, 'select').mockReturnValue(chain as never)
}

describe('Automated Inventory Scan & Lookup Simulation (GET)', () => {
  const mockBarcode = '0068700011016'
  const unknownBarcode = '9999999999999'

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  // End-to-end route test for barcode lookup
  it('Successfully looks up scanned barcode via product route', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    stubSelect(async () => [{ productId: 1, name: 'Milk 2%', barcode: mockBarcode, brand: 'Dairyland' }])

    const response = await request(app).get(`/api/products/lookup/${mockBarcode}`)

    expect(response.status).toBe(200)
    const productData = response.body.product || response.body
    expect(productData).toHaveProperty('barcode', mockBarcode)
  })

  // Strict authorization status check
  it('Strictly enforces authentication on lookup route when unauthorized', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'false')

    const response = await request(app).get(`/api/products/lookup/${mockBarcode}`)

    expect(response.status).toBe(401)
  })

  // External Provider Fallback / Local Miss
  it('should fallback to external providers if local database lookup misses', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    stubSelect(async () => [])

    // Mock global fetch for ALL calls so no real network requests are attempted
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ product: { product_name: 'External Milk', brands: 'Dairyland' } }),
    } as Response)

    const response = await request(app).get(`/api/products/lookup/${mockBarcode}`)

    expect(response.status).toBe(200)
    expect(response.body).toBeDefined()
    fetchSpy.mockRestore()
  })

  // 404 when barcode is not found anywhere
  it('should return 404 when barcode is not found by any provider', async () => {
    vi.stubEnv('VITE_DISABLE_AUTH', 'true')
    stubSelect(async () => [])

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response)

    const response = await request(app).get(`/api/products/lookup/${unknownBarcode}`)

    expect(response.status).toBe(404)
    fetchSpy.mockRestore()
  })
})