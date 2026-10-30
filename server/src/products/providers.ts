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
  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`)
    if (!response.ok) return null

    const data = await response.json()
    if (data.status === 1 && data.product) {
      const p = data.product
      return {
        name: p.product_name || p.product_name_en || 'Unknown Product',
        brand: p.brands || null,
        barcode: barcode,
        category: p.categories_tags?.[0]?.replace('en:', '') || null,
        unit: p.quantity || null,
      }
    }
  } catch (err) {
    console.error('Open Food Facts API error:', err)
  }
  return null
}

// 2. GO-UPC API Adapter
async function fetchFromGoUpc(barcode: string): Promise<ExternalProduct | null> {
  try {
    // Note: GO-UPC typically requires an API key in headers or query params if configured, 
    // e.g., headers: { 'Authorization': `Bearer ${process.env.GOUPC_API_KEY}` }
    const response = await fetch(`https://api.go-upc.com/v1/code/${barcode}`, {
      headers: {
        ...(process.env.GOUPC_API_KEY ? { 'Authorization': `Bearer ${process.env.GOUPC_API_KEY}` } : {})
      }
    })
    if (!response.ok) return null

    const data = await response.json()
    if (data.product) {
      const p = data.product
      return {
        name: p.name || 'Unknown Product',
        brand: p.brand || null,
        barcode: barcode,
        category: p.category || null,
        unit: null,
      }
    }
  } catch (err) {
    console.error('GO-UPC API error:', err)
  }
  return null
}

// 3. UPCitemdb API Adapter
async function fetchFromUpcItemDb(barcode: string): Promise<ExternalProduct | null> {
  try {
    const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`)
    if (!response.ok) return null

    const data = await response.json()
    if (data.items && data.items.length > 0) {
      const p = data.items[0]
      return {
        name: p.title || 'Unknown Product',
        brand: p.brand || null,
        barcode: barcode,
        category: p.category || null,
        unit: p.size || null,
      }
    }
  } catch (err) {
    console.error('UPCitemdb API error:', err)
  }
  return null
}

// Fallback Chain Strategy: Try providers sequentially until one succeeds
export async function lookupExternalProduct(barcode: string): Promise<ExternalProduct | null> {
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