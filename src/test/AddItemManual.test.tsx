import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AddItemPage from '../pages/AddItemPage'
import ItemsPage from '../pages/ItemsPage'
import ScanAddedPage from '../pages/ScanAddedPage'
import { apiFetch } from '../lib/api'
import { CATEGORIES } from '../lib/categories'
import { todayIsoDate } from '../lib/dates'
import type { ScanHandoff } from '../lib/foodApi'
import type { InventoryItem } from '../lib/inventoryApi'
import { renderWithQuery } from './inventoryFixtures'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiFetch: vi.fn(),
}))

vi.mock('../lib/authClient', () => ({
  getApiToken: async () => 'test-token',
  useAuthSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }),
}))

// A tiny inventory server: GET lists what POST saved, so a save has to show up in the list.
function fakeServer() {
  const saved: InventoryItem[] = []
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === '/inventory' && options?.method === 'POST') {
      const item = { ...JSON.parse(options.body as string), id: saved.length + 1, unit: null, createdAt: '2026-11-07T12:00:00.000Z' }
      saved.push(item)
      return { item } as never
    }
    if (path === '/inventory') return { items: [...saved] } as never
    if (path === '/food/expiry-suggestion') return { status: 'none', message: 'No reliable suggestion.' } as never
    throw new Error(`Unexpected call to ${path}`)
  })
}

function callsTo(pattern: RegExp) {
  return vi.mocked(apiFetch).mock.calls.filter(([path]) => pattern.test(path))
}

function renderApp(path = '/items', scan?: ScanHandoff) {
  renderWithQuery(
    <MemoryRouter initialEntries={[{ pathname: path, state: scan ? { scan } : null }]}>
      <Routes>
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/items/new" element={<AddItemPage />} />
        <Route path="/scan/added" element={<ScanAddedPage />} />
        <Route path="/scan" element={<p>Scanner</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const category = () => screen.getByLabelText(/Category/)

describe('manual add item', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')

  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(apiFetch).mockReset()
    fetchSpy.mockReset()
    fakeServer()
  })

  it('offers an optional category, unset by default, with the engine labels', () => {
    renderApp('/items/new')

    expect(category()).toHaveValue('')
    expect(category()).not.toBeRequired()
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Not sure',
      ...CATEGORIES,
    ])
  })

  // My Items' Add Item opens the scanner (see ItemsPage.test.tsx), so the form is entered directly.
  it('saves from the form and shows the new item in the list', async () => {
    renderApp('/items/new')

    await userEvent.type(screen.getByLabelText(/Product name/), 'Greek Yogurt')
    await userEvent.selectOptions(category(), 'Dairy')
    const quantity = screen.getByLabelText(/Quantity/)
    await userEvent.clear(quantity)
    await userEvent.type(quantity, '3')
    const bought = screen.getByLabelText(/Date bought/)
    await userEvent.clear(bought)
    await userEvent.type(bought, '2026-11-01')
    await userEvent.type(screen.getByLabelText(/Best before date/), '2026-11-20')
    await userEvent.click(screen.getByRole('button', { name: 'Save Item' }))

    expect(await screen.findByRole('heading', { name: 'Item Added!' })).toBeInTheDocument()
    expect(JSON.parse(callsTo(/^\/inventory$/).find(([, o]) => o?.method === 'POST')![1]!.body as string)).toEqual({
      name: 'Greek Yogurt',
      brand: null,
      barcode: null,
      category: 'Dairy',
      quantity: 3,
      purchaseDate: '2026-11-01',
      bestBefore: '2026-11-20',
    })

    await userEvent.click(screen.getByRole('button', { name: 'View My Items' }))
    expect(await screen.findByText('Greek Yogurt')).toBeInTheDocument()
    expect(screen.getByText(/Nov 20, 2026/)).toBeInTheDocument()
  })

  it('never looks up a barcode, identifies a photo or suggests a date, even with a typed barcode', async () => {
    renderApp('/items/new')

    await userEvent.type(screen.getByLabelText(/Product name/), 'Milk')
    await userEvent.type(screen.getByLabelText(/^Barcode/), '012345678905')
    await userEvent.selectOptions(category(), 'Dairy')
    await new Promise((resolve) => setTimeout(resolve, 500))
    await userEvent.type(screen.getByLabelText(/Best before date/), '2026-12-01')
    await userEvent.click(screen.getByRole('button', { name: 'Save Item' }))
    await screen.findByRole('heading', { name: 'Item Added!' })

    expect(callsTo(/^\/food\//)).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.queryByText(/suggest/i)).not.toBeInTheDocument()
  })

  it('saves no category when it is left as Not sure', async () => {
    renderApp('/items/new')

    await userEvent.type(screen.getByLabelText(/Product name/), 'Mystery jar')
    await userEvent.type(screen.getByLabelText(/Best before date/), '2027-01-01')
    await userEvent.click(screen.getByRole('button', { name: 'Save Item' }))
    await screen.findByRole('heading', { name: 'Item Added!' })

    const [post] = callsTo(/^\/inventory$/).filter(([, o]) => o?.method === 'POST')
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ category: null, purchaseDate: todayIsoDate() })
  })

  describe('from a scan', () => {
    const SCAN: ScanHandoff = {
      barcode: '012345678905',
      category: 'Dairy',
      notice: null,
      product: {
        source: 'Open Facts',
        barcode: '012345678905',
        name: 'Whole Milk',
        brand: null,
        description: null,
        quantity: null,
        category: 'Dairies, Milks',
        imageUrl: null,
        ingredients: null,
      },
    }

    it('prefills the mapped category, and a changed one is what the suggestion and save use', async () => {
      renderApp('/items/new', SCAN)
      expect(category()).toHaveValue('Dairy')
      await waitFor(() => expect(callsTo(/^\/food\/expiry-suggestion$/)).toHaveLength(1))

      await userEvent.selectOptions(category(), 'Beverages')

      await waitFor(() => expect(callsTo(/^\/food\/expiry-suggestion$/)).toHaveLength(2))
      const [, latest] = callsTo(/^\/food\/expiry-suggestion$/)[1]
      expect(JSON.parse(latest!.body as string).category).toBe('Beverages')
    })

    it('keeps a scanned category that is not one of the labels', () => {
      renderApp('/items/new', { ...SCAN, category: 'Snacks' })

      expect(category()).toHaveValue('Snacks')
    })
  })
})
