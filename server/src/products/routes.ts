import express from 'express'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../auth/requireAuth.js'
import { db } from '../db/index.js'
import { products } from '../db/schema.js'
import { lookupExternalProduct } from './providers.js'


export const productRouter = express.Router()

// GET /api/products/lookup/:barcode
productRouter.get('/lookup/:barcode', requireAuth, async (req, res) => {
  const barcode = Array.isArray(req.params.barcode) 
    ? req.params.barcode[0] 
    : req.params.barcode

  if (!barcode) {
    return res.status(400).json({ error: 'Barcode is required.' })
  }

  try {
    // 1. Check locally first against the products table
    const existingProduct = await db
      .select({
        name: products.name,
        brand: products.brand,
        barcode: products.barcode,
      })
      .from(products)
      .where(eq(products.barcode, barcode))
      .limit(1)

    if (existingProduct.length > 0) {
      return res.json({ source: 'local', product: existingProduct[0] })
    }

    // 2. Fallback to external provider adapters (Open Food Facts -> GO-UPC -> UPCitemdb)
    const externalProduct = await lookupExternalProduct(barcode)

    if (externalProduct) {
      return res.json({ source: 'external', product: externalProduct })
    }

    // 3. Product not found in local records or external providers 
    return res.status(404).json({ error: 'Product not found in local records or external providers.' })
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ''
    console.error(`Product lookup failed: ${err instanceof Error ? err.message : err}${cause}`)
    res.status(500).json({ error: "Couldn't look up the barcode. Please try again." })
  }
})
