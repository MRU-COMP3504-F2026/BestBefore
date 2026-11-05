import request from 'supertest'
import { app } from '../app.js'
import { lookupExternalProduct } from '../products/providers.js'
import { providerAnalytics } from '../products/providerAnalytics.js'

vi.mock('../db/index.js', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [], }), }), }) } }))

describe('External Providers, Analytics & API Integration Suite', () => {
    const testBarcode = '0068700011016'

    beforeEach(() => {
        vi.restoreAllMocks()
        // @ts-expect-error accessing private metrics array for test isolation
        providerAnalytics.metrics = []
    })

    describe('lookupExternalProduct & Analytics Logging', () => {
        
        // Test Case: Path where the first provider in the chain succeeds
        it('Should succeed on Open Food Facts (first try) and log analytics', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({
            status: 1,
            product: {
                product_name: 'Organic Milk',
                brands: 'Dairyland',
                categories_tags: ['en:dairy'],
                quantity: '1L',
            },
            }),
        } as Response)

        const result = await lookupExternalProduct(testBarcode)

        expect(result).toEqual({
            name: 'Organic Milk',
            brand: 'Dairyland',
            barcode: testBarcode,
            category: 'dairy',
            unit: '1L',
        })

        expect(fetchSpy).toHaveBeenCalledTimes(1)
        expect(fetchSpy).toHaveBeenCalledWith(
            `https://world.openfoodfacts.org/api/v0/product/${testBarcode}.json`
        )

        const summary = providerAnalytics.getSummary()
        expect(summary.totalCalls).toBe(1)
        expect(summary.breakdown?.[0]?.source).toBe('Open Food Facts')
        expect(summary.breakdown?.[0]?.successRate).toBe('100.0%')
        })

        // Test Case: Fallback chain handling when the first provider misses
        it('Should fallback to Go-UPC if Open Food Facts misses', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch')
            .mockResolvedValueOnce({
            ok: false,
            status: 404,
            } as Response)
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                product: {
                name: 'Go-UPC Milk',
                brand: 'Dairyland',
                category: 'Beverages',
                },
            }),
            } as Response)

        const result = await lookupExternalProduct(testBarcode)

        expect(result?.name).toBe('Go-UPC Milk')
        expect(fetchSpy).toHaveBeenCalledTimes(2)

        const summary = providerAnalytics.getSummary()
        expect(summary.totalCalls).toBe(2)
        })

        // Test Case: Fallback chain reaching the final provider (UPCitemdb)
        it('Should fallback all the way to UPCitemdb if OFF and Go-UPC miss', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch')
            .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
            .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                items: [
                {
                    title: 'UPCitemdb Milk',
                    brand: 'Dairyland',
                    category: 'Dairy',
                    size: '2L',
                },
                ],
            }),
            } as Response)

        const result = await lookupExternalProduct(testBarcode)

        expect(result?.name).toBe('UPCitemdb Milk')
        expect(result?.unit).toBe('2L')
        expect(fetchSpy).toHaveBeenCalledTimes(3)
        })

        // Test Case: Nnull return when all providers fail
        it('Should return null and log failures when all providers fail', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
            ok: false,
            status: 500,
        } as Response)

        const result = await lookupExternalProduct(testBarcode)

        expect(result).toBeNull()
        expect(fetchSpy).toHaveBeenCalledTimes(3)
        })
    })

    describe('Product Lookup API Endpoint Integration (`supertest`)', () => {
        
        // Test Case: End-to-end integration test hitting the Express app router
        it('should successfully fetch product via API endpoint and record analytics', async () => {
        vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({
            status: 1,
            product: {
                product_name: 'Organic Milk',
                brands: 'Dairyland',
                categories_tags: ['en:dairy'],
                quantity: '1L',
            },
            }),
        } as Response)

        const response = await request(app)
            .get(`/api/products/lookup/${testBarcode}`)

        expect(response.status).toBe(200)
        
        // Look inside response.body.product to match the returned product fields
        expect(response.body.product).toMatchObject({
            name: 'Organic Milk',
            brand: 'Dairyland',
            barcode: testBarcode,
        })

        const summary = providerAnalytics.getSummary()
        expect(summary.totalCalls).toBeGreaterThan(0)
        })
    })
})