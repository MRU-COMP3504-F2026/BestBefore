import { apiFetch } from './api' 

export type ProductLookupResult = {
  name: string
  brand: string | null
  barcode: string
  category: string | null
  unit: string | null
}

export async function lookupBarcodeProduct(barcode: string): Promise<ProductLookupResult | null> {
  try {
    const data = await apiFetch<{ product: ProductLookupResult }>(`/products/lookup/${barcode}`)
    return data.product || null
  } catch {
    // If it returns a 404 or fails, return null so the user can enter details manually
    return null
  }
}