import { screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import ProductDetailPage from '../pages/ProductDetailPage'
import { ITEMS, TODAY, renderWithQuery } from './inventoryFixtures'

vi.mock('../lib/api', () => ({ apiFetch: vi.fn() }))

function renderDetail(id: number) {
  renderWithQuery(
    <MemoryRouter initialEntries={[`/items/${id}`]}>
      <Routes>
        <Route path="/items/:id" element={<ProductDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProductDetailPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(apiFetch).mockReset()
  })

  it("shows the item's details with formatted dates", async () => {
    const cheddar = { ...ITEMS[3], brand: 'Black Diamond', unit: 'g', quantity: 400 }
    vi.mocked(apiFetch).mockResolvedValue({ items: [...ITEMS.slice(0, 3), cheddar, ITEMS[4]] })
    renderDetail(4)

    expect(await screen.findByRole('heading', { name: 'Old Cheddar' })).toBeInTheDocument()
    expect(screen.getByText('Fresh')).toBeInTheDocument()
    expect(screen.getByText('Best before Nov 16, 2026')).toBeInTheDocument()
    expect(screen.getByText('400 g')).toBeInTheDocument()
    expect(screen.getByText('Black Diamond')).toBeInTheDocument()
    // Purchased and Added, both Oct 20 in the fixture.
    expect(screen.getAllByText('Oct 20, 2026', { selector: 'dd' })).toHaveLength(2)
  })

  it('labels a past best-before date as expired', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: ITEMS })
    renderDetail(1)

    expect(await screen.findByText('Expired')).toBeInTheDocument()
  })

  it('shows a not-found state for an unknown id', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: ITEMS })
    renderDetail(999)

    expect(await screen.findByRole('heading', { name: 'Item not found' })).toBeInTheDocument()
  })

  it('shows an error when the request fails', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('API request failed: 500'))
    renderDetail(1)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this item.")
  })
})
