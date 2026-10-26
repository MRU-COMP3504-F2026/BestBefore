import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InventoryItem } from '../lib/inventoryApi'

// Tests pin "today" here (Date only, so userEvent's timers still run).
export const TODAY = new Date(2026, 9, 26, 12)

function item(id: number, name: string, category: string | null, bestBefore: string): InventoryItem {
  return {
    id,
    name,
    brand: null,
    barcode: null,
    category,
    quantity: 1,
    unit: null,
    purchaseDate: '2026-10-20',
    bestBefore,
    createdAt: '2026-10-20T12:00:00.000Z',
  }
}

// Soonest first, as the API returns them.
export const ITEMS: InventoryItem[] = [
  item(1, 'Milk 2%', 'Dairy', '2026-10-24'),
  item(2, 'Baby Spinach', 'Produce', '2026-10-26'),
  item(3, 'Large Eggs', 'Dairy', '2026-10-29'),
  item(4, 'Old Cheddar', 'Dairy', '2026-11-16'),
  item(5, 'Diced Tomatoes', 'Pantry', '2027-10-26'),
]

// Fresh client per test, no retries so error states show immediately.
export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
