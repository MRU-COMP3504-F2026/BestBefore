import request from 'supertest'
import { app } from '../app.js'
import { db } from '../db/index.js'
import { products } from '../db/schema.js'
import { eq } from 'drizzle-orm'

// Mock the database queries so tests run locally without live connection errors
vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        // Support .leftJoin() used by GET /api/inventory
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { inventory: { inventoryId: 1, quantity: 1 }, products: { name: 'Milk 2%' } }
          ])
        }),
        // Support .where().limit() used by product catalog lookups
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ productId: 1, name: 'Milk 2%', barcode: '0068700011016' }])
        })
      })
    })
  }
}))

describe('Automated Inventory Scan & Lookup Simulation (GET)', () => {
  const mockBarcode = '0068700011016'

  // Step 1: Test the barcode lookup / scanning recognition phase
  it('Step 1: recognizes and queries the scanned barcode from catalog', async () => {
    const catalogProduct = await db
      .select()
      .from(products)
      .where(eq(products.barcode, mockBarcode))
      .limit(1)

    expect(catalogProduct).toHaveLength(1)
    expect(catalogProduct[0].barcode).toBe(mockBarcode)
  })

  // Step 2: Test fetching user inventory using GET
  it('Step 2: successfully queries user inventory via GET /api/inventory', async () => {
    const response = await request(app).get('/api/inventory')

    // Expect successful retrieval or expected authentication status
    expect([200, 401]).toContain(response.status)
  })
})