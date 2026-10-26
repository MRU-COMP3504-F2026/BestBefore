import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { apiFetch } from './api'
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
  createdAt: z.string(),
})

const inventoryResponseSchema = z.object({ items: z.array(inventoryItemSchema) })

export type InventoryItem = z.infer<typeof inventoryItemSchema>

export const INVENTORY_QUERY_KEY = ['inventory']

// Items expiring within this many days (or already expired) show as amber.
export const EXPIRING_SOON_DAYS = 3

// The signed-in user's items, soonest best-before first.
export async function fetchInventory(): Promise<InventoryItem[]> {
  const body = await apiFetch<unknown>('/inventory')
  return inventoryResponseSchema.parse(body).items
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
