// The first three fields match the `products` table 1:1.
export type ProductInfo = {
  name: string          // products.name     VARCHAR(255) NOT NULL
  barcode: string       // products.barcode  VARCHAR(64) UNIQUE
  brand: string | null  // products.brand    VARCHAR(255), nullable
  // NOT stored. Only used to estimate the best-before date.
  categories: string[]
}

const NAME_MAX = 255
const BRAND_MAX = 255

export async function lookupBarcode(barcode: string): Promise<ProductInfo | null> {
  const code = barcode.trim()
  if (!code) return null

  // UPC-A (12 digits) is stored as EAN-13 (a leading 0 added) in Open Food Facts.
  const candidates = [...new Set([code, code.padStart(13, '0')])]

  for (const candidate of candidates) {
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(candidate)}.json` +
          `?fields=product_name,product_name_en,generic_name,brands,categories_tags`,
      )
      if (!res.ok) continue // 404 just means "not under this form", so try the next one
      const data = await res.json()
      if (data.status !== 1) continue

      const p = data.product
      const name = (p.product_name || p.product_name_en || p.generic_name || '')
        .trim()
        .slice(0, NAME_MAX)
      if (!name) continue

      const brand = (p.brands?.split(',')[0] ?? '').trim().slice(0, BRAND_MAX)
      // Keep the barcode as scanned or typed.
      return { name, barcode: code, brand: brand || null, categories: p.categories_tags ?? [] }
    } catch (err) {
      console.error('[lookup] failed', err)
    }
  }
  return null
}