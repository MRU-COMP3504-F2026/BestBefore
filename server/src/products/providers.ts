import { providerAnalytics } from './providerAnalytics.js'

// External Product Provider Adapters

export interface ExternalProduct {
  name: string
  brand: string | null
  barcode: string
  category: string | null
  unit: string | null
}

// 1. Open Food Facts API Adapter
async function fetchFromOpenFoodFacts(barcode: string): Promise<ExternalProduct | null> {
  const encodedBarcode = encodeURIComponent(barcode)
  const start = performance.now()
  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodedBarcode}.json`)
    const responseTimeMs = Math.round(performance.now() - start)

    if (!response.ok) {
      providerAnalytics.logMetric({
        source: 'Open Food Facts',
        barcode,
        success: false,
        responseTimeMs,
        error: `HTTP ${response.status}`,
      })
      return null
    }

    const data = await response.json()
    if (data.status === 1 && data.product) {
      providerAnalytics.logMetric({
        source: 'Open Food Facts',
        barcode,
        success: true,
        responseTimeMs,
      })
      const p = data.product
      return {
        name: p.product_name || p.product_name_en || 'Unknown Product',
        brand: p.brands || null,
        barcode: barcode,
        category: p.categories_tags?.[0]?.replace('en:', '') || null,
        unit: p.quantity || null,
      }
    }

    providerAnalytics.logMetric({
      source: 'Open Food Facts',
      barcode,
      success: false,
      responseTimeMs,
      error: 'Product not found in body',
    })
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - start)
    providerAnalytics.logMetric({
      source: 'Open Food Facts',
      barcode,
      success: false,
      responseTimeMs,
      error: err instanceof Error ? err.message : String(err),
    })
    console.error('Open Food Facts API error:', err)
  }
  return null
}

// 2. GO-UPC API Adapter
async function fetchFromGoUpc(barcode: string): Promise<ExternalProduct | null> {
  const encodedBarcode = encodeURIComponent(barcode)
  const start = performance.now()
  try {
    const response = await fetch(`https://api.go-upc.com/v1/code/${encodedBarcode}`, {
      headers: {
        ...(process.env.GOUPC_API_KEY ? { 'Authorization': `Bearer ${process.env.GOUPC_API_KEY}` } : {})
      }
    })
    const responseTimeMs = Math.round(performance.now() - start)

    if (!response.ok) {
      providerAnalytics.logMetric({
        source: 'Go-UPC',
        barcode,
        success: false,
        responseTimeMs,
        error: `HTTP ${response.status}`,
      })
      return null
    }

    const data = await response.json()
    if (data.product) {
      providerAnalytics.logMetric({
        source: 'Go-UPC',
        barcode,
        success: true,
        responseTimeMs,
      })
      const p = data.product
      return {
        name: p.name || 'Unknown Product',
        brand: p.brand || null,
        barcode: barcode,
        category: p.category || null,
        unit: null,
      }
    }

    providerAnalytics.logMetric({
      source: 'Go-UPC',
      barcode,
      success: false,
      responseTimeMs,
      error: 'Product not found in body',
    })
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - start)
    providerAnalytics.logMetric({
      source: 'Go-UPC',
      barcode,
      success: false,
      responseTimeMs,
      error: err instanceof Error ? err.message : String(err),
    })
    console.error('GO-UPC API error:', err)
  }
  return null
}

// 3. UPCitemdb API Adapter
async function fetchFromUpcItemDb(barcode: string): Promise<ExternalProduct | null> {
  
  const encodedBarcode = encodeURIComponent(barcode)
  const start = performance.now()
  try {
    const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodedBarcode}`)
    AbortSignal.timeout(5000)
    const responseTimeMs = Math.round(performance.now() - start)

    if (!response.ok) {
      providerAnalytics.logMetric({
        source: 'UPCitemdb',
        barcode,
        success: false,
        responseTimeMs,
        error: `HTTP ${response.status}`,
      })
      return null
    }

    const data = await response.json()
    if (data.items && data.items.length > 0) {
      providerAnalytics.logMetric({
        source: 'UPCitemdb',
        barcode,
        success: true,
        responseTimeMs,
      })
      const p = data.items[0]
      return {
        name: p.title || 'Unknown Product',
        brand: p.brand || null,
        barcode: barcode,
        category: p.category || null,
        unit: p.size || null,
      }
    }

    providerAnalytics.logMetric({
      source: 'UPCitemdb',
      barcode,
      success: false,
      responseTimeMs,
      error: 'Items array empty',
    })
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - start)
    providerAnalytics.logMetric({
      source: 'UPCitemdb',
      barcode,
      success: false,
      responseTimeMs,
      error: err instanceof Error ? err.message : String(err),
    })
    console.error('UPCitemdb API error:', err)
  }
  return null
}

// Fallback Chain Strategy: Try providers sequentially until one succeeds
export async function lookupExternalProduct(barcode: string): Promise<ExternalProduct | null> {
  // Validate that the barcode consists strictly of digits (Item 10)
  if (!barcode || !/^\d+$/.test(barcode)) {
    console.warn(`[Validation] Rejected invalid barcode format: "${barcode}"`)
    return null
  }

  // Try Open Food Facts first (free, robust for grocery items)
  let product = await fetchFromOpenFoodFacts(barcode)
  if (product) return product

  // Fallback to GO-UPC
  product = await fetchFromGoUpc(barcode)
  if (product) return product

  // Fallback to UPCitemdb
  product = await fetchFromUpcItemDb(barcode)
  if (product) return product

  return null
}