import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, apiFetch } from './api'
import { getApiToken } from './authClient'
import { todayIsoDate } from './dates'

// Mirrors GET /api/inventory in server/src/inventory/routes.ts.
const inventoryItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  category: z.string().nullable(),
  quantity: z.number(),
  unit: z.string().nullable(),
  purchaseDate: z.string(),
  bestBefore: z.string(),
  // 'product' is a link to the barcode lookup's image; 'photo' is the AI Vision still, read with
  // fetchItemPhoto. Missing on a server from before item pictures.
  imageSource: z.enum(['product', 'photo']).nullable().default(null),
  imageUrl: z.string().nullable().default(null),
  createdAt: z.string(),
})

const inventoryResponseSchema = z.object({ items: z.array(inventoryItemSchema) })

export type InventoryItem = z.infer<typeof inventoryItemSchema>

const addedItemResponseSchema = z.object({ item: inventoryItemSchema })

export type NewInventoryItem = {
  name: string
  brand: string | null
  barcode: string | null
  category: string | null
  quantity: number
  purchaseDate: string
  bestBefore: string
  // Only from an add form AI Vision filled. Lets the server share the product once it is saved.
  photoToken?: string
  // At most one: the barcode lookup's image link, or the AI Vision still as a JPEG data URL.
  imageUrl?: string | null
  photo?: string | null
}

// Largest photo data URL the server takes. Mirrors MAX_PHOTO_DATA_URL_LENGTH in
// server/src/inventory/itemImages.ts.
export const MAX_PHOTO_DATA_URL_LENGTH = 1_048_640

export const INVENTORY_QUERY_KEY = ['inventory']

// Items expiring within this many days (or already expired) show as amber.
export const EXPIRING_SOON_DAYS = 3

// The signed-in user's items, soonest best-before first.
export async function fetchInventory(): Promise<InventoryItem[]> {
  const body = await apiFetch<unknown>('/inventory')
  return inventoryResponseSchema.parse(body).items
}

// Saves one item for the signed-in user and returns the row the server stored.
export async function addInventoryItem(item: NewInventoryItem): Promise<InventoryItem> {
  const body = await apiFetch<unknown>('/inventory', { method: 'POST', body: JSON.stringify(item) })
  return addedItemResponseSchema.parse(body).item
}

// The AI Vision still saved with one of the signed-in user's items. The route needs the token, so
// an <img> can't load it directly.
export async function fetchItemPhoto(id: number, signal?: AbortSignal): Promise<Blob> {
  const token = await getApiToken()
  const response = await fetch(`/api/inventory/${id}/photo`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  })
  if (!response.ok) throw new ApiError(response.status)
  return response.blob()
}

export function useInventory() {
  return useQuery({ queryKey: INVENTORY_QUERY_KEY, queryFn: fetchInventory })
}

// Whole days from today to an ISO date; negative once it has passed.
function daysUntil(isoDate: string): number {
  const toUtc = (iso: string) => {
    const [year, month, day] = iso.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((toUtc(isoDate) - toUtc(todayIsoDate())) / (24 * 60 * 60 * 1000))
}

export function expiryTone(bestBefore: string): 'green' | 'amber' {
  return daysUntil(bestBefore) <= EXPIRING_SOON_DAYS ? 'amber' : 'green'
}
