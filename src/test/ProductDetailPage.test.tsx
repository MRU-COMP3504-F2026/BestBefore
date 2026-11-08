import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import ProductDetailPage from '../pages/ProductDetailPage'
import { ITEMS, TODAY, renderWithQuery } from './inventoryFixtures'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiFetch: vi.fn(),
}))

vi.mock('../lib/authClient', () => ({
  getApiToken: async () => 'test-token',
  useAuthSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }),
}))

const PRODUCT_IMAGE = 'https://images.openfoodfacts.org/images/products/001/cheddar.400.jpg'

function renderDetail(id: number) {
  return renderWithQuery(
    <MemoryRouter initialEntries={[`/items/${id}`]}>
      <Routes>
        <Route path="/items/:id" element={<ProductDetailPage />} />
        <Route path="/items/:id/edit" element={<p>Edit page</p>} />
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

  it('labels a past best-before date as expired, in red', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: ITEMS })
    const { container } = renderDetail(1)

    expect(await screen.findByText('Expired')).toBeInTheDocument()
    expect(screen.getByText('Expired on Oct 24, 2026')).toBeInTheDocument()
    expect(container.querySelector('.product-detail-expiry-red')).toBeInTheDocument()
    expect(container.querySelector('.product-detail-image-red')).toBeInTheDocument()
  })

  it('shows an item due today as expiring soon, not expired', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: ITEMS })
    const { container } = renderDetail(2)

    expect(await screen.findByText('Expiring soon')).toBeInTheDocument()
    expect(screen.getByText('Best before Oct 26, 2026')).toBeInTheDocument()
    expect(container.querySelector('.product-detail-expiry-amber')).toBeInTheDocument()
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

  describe('picture', () => {
    const fetchMock = vi.fn()

    beforeEach(() => {
      vi.stubGlobal('fetch', fetchMock)
      // jsdom has no object URLs.
      URL.createObjectURL = vi.fn(() => 'blob:photo-4')
      URL.revokeObjectURL = vi.fn()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      fetchMock.mockReset()
    })

    it('shows the product image the barcode lookup returned', async () => {
      vi.mocked(apiFetch).mockResolvedValue({
        items: [{ ...ITEMS[3], imageSource: 'product', imageUrl: PRODUCT_IMAGE }],
      })
      renderDetail(4)

      expect(await screen.findByRole('img', { name: 'Product' })).toHaveAttribute('src', PRODUCT_IMAGE)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("shows the user's own photo from the private endpoint", async () => {
      fetchMock.mockResolvedValue(new Response('jpeg', { headers: { 'Content-Type': 'image/jpeg' } }))
      vi.mocked(apiFetch).mockResolvedValue({ items: [{ ...ITEMS[3], imageSource: 'photo', imageUrl: null }] })
      renderDetail(4)

      expect(await screen.findByRole('img', { name: 'Your photo' })).toHaveAttribute('src', 'blob:photo-4')
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/inventory/4/photo',
        expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
      )
    })

    it('falls back to the category icon when the image fails or there is none', async () => {
      vi.mocked(apiFetch).mockResolvedValue({
        items: [{ ...ITEMS[3], imageSource: 'product', imageUrl: PRODUCT_IMAGE }, ITEMS[4]],
      })
      const { container } = renderDetail(4)

      fireEvent.error(await screen.findByRole('img', { name: 'Product' }))

      expect(screen.queryByRole('img', { name: 'Product' })).not.toBeInTheDocument()
      expect(container.querySelector('.product-detail-image svg')).toBeInTheDocument()
    })

    it("keeps the icon when the photo can't be fetched", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
      vi.mocked(apiFetch).mockResolvedValue({ items: [{ ...ITEMS[3], imageSource: 'photo', imageUrl: null }] })
      const { container } = renderDetail(4)

      await screen.findByRole('heading', { name: 'Old Cheddar' })
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      expect(container.querySelector('.product-detail-image img')).toBeNull()
      expect(container.querySelector('.product-detail-image svg')).toBeInTheDocument()
    })
  })

  it('opens the edit form from the Edit button', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: ITEMS })
    renderDetail(4)

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(screen.getByText('Edit page')).toBeInTheDocument()
  })
})
