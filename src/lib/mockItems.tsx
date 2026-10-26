// Placeholder add-item call for UI work only. Replace with POST /api/inventory later.

export type NewItem = {
  name: string
  brand?: string
  barcode?: string
  quantity: number
  purchaseDate: string
  bestBefore: string
}

export const MOCK_ADD_DELAY_MS = 500

export async function mockAddItem(item: NewItem): Promise<{ ok: true; item: NewItem }> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_ADD_DELAY_MS))
  return { ok: true, item }
}
