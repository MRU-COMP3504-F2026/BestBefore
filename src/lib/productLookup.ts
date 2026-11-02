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
  // Keep the barcode as a string. "07227479" must keep its leading zero.
  const code = barcode.trim()
  if (!code) return null

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json` +
        `?fields=product_name,generic_name,brands,categories_tags`,
    )
    if (!res.ok) return null

    const data = await res.json()
    if (data.status !== 1) return null // barcode not in their database

    const p = data.product
    const name = (p.product_name || p.generic_name || '').trim().slice(0, NAME_MAX)
    if (!name) return null // products.name is NOT NULL, so a nameless hit is useless

    const brand = (p.brands?.split(',')[0] ?? '').trim().slice(0, BRAND_MAX)

    return {
      name,
      barcode: code,
      brand: brand || null,
      categories: p.categories_tags ?? [],
    }
  } catch {
    return null // offline or network error
  }
}