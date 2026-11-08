import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import InventoryList from '../components/InventoryList'
import ItemCard from '../components/ItemCard'
import { LeafIcon } from '../components/icons'
import AddItemPage from '../pages/AddItemPage'
import ScanAddedPage from '../pages/ScanAddedPage'
import { ApiError, apiFetch } from '../lib/api'
import type { PhotoHandoff, ScanHandoff } from '../lib/foodApi'
import type { InventoryItem } from '../lib/inventoryApi'
import { ITEMS, renderWithQuery } from './inventoryFixtures'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiFetch: vi.fn(),
}))

vi.mock('../lib/authClient', () => ({
  getApiToken: async () => 'test-token',
  useAuthSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }),
}))

const PRODUCT_IMAGE = 'https://images.openfoodfacts.org/images/products/001/milk.400.jpg'
// The still AI Vision identified, as the scanner hands it over.
const FRAME = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='

const SCAN: ScanHandoff = {
  barcode: '012345678905',
  product: {
    source: 'Open Facts',
    barcode: '012345678905',
    name: 'Whole Milk',
    brand: 'Dairyland',
    description: null,
    quantity: '1 L',
    category: 'Milks',
    imageUrl: PRODUCT_IMAGE,
    ingredients: null,
  },
  category: 'Dairy',
  notice: null,
}

const PHOTO: PhotoHandoff = {
  food: { name: 'Apple', category: 'Fresh fruit', quantity: 1, unit: 'piece', ripeness: 'ripe' },
  frame: FRAME,
}

function renderAddItem(state: { scan?: ScanHandoff; photo?: PhotoHandoff }) {
  renderWithQuery(
    <MemoryRouter initialEntries={[{ pathname: '/items/new', state }]}>
      <Routes>
        <Route path="/scan" element={<p>Scanner</p>} />
        <Route path="/items/new" element={<AddItemPage />} />
        <Route path="/scan/added" element={<ScanAddedPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// Answers like the real API, or fails the save when `saveFails`.
function fakeApi({ saveFails = false } = {}) {
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === '/food/expiry-suggestion') return { status: 'none', message: 'No suggestion.' } as never
    if (saveFails) throw new ApiError(500, "Couldn't save your item. Please try again.")
    const body = JSON.parse(options!.body as string)
    return { item: { ...body, id: 1, unit: null, createdAt: '2026-11-08T12:00:00.000Z' } } as never
  })
}

const saves = () => vi.mocked(apiFetch).mock.calls.filter(([path]) => path === '/inventory')
const savedBody = () => JSON.parse(saves().at(-1)![1]!.body as string)

async function fillDateAndSave() {
  await userEvent.type(screen.getByLabelText(/Best before date/), '2026-12-01')
  await userEvent.click(screen.getByRole('button', { name: 'Save Item' }))
}

describe('ItemCard picture', () => {
  it('shows the picture in the tile', () => {
    const { container } = render(<ItemCard name="Milk" expires="Nov 28" icon={<LeafIcon />} imageSrc={PRODUCT_IMAGE} />)

    const image = container.querySelector('img.item-card-image')
    expect(image).toHaveAttribute('src', PRODUCT_IMAGE)
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(container.querySelector('.item-card-tile svg')).toBeNull()
  })

  it('falls back to the icon when the picture fails to load', () => {
    const { container } = render(<ItemCard name="Milk" expires="Nov 28" icon={<LeafIcon />} imageSrc={PRODUCT_IMAGE} />)

    fireEvent.error(container.querySelector('img')!)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.item-card-tile svg')).toBeInTheDocument()
  })

  it('shows the icon when there is no picture', () => {
    const { container } = render(<ItemCard name="Milk" expires="Nov 28" icon={<LeafIcon />} imageSrc={null} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.item-card-tile svg')).toBeInTheDocument()
  })
})

describe('InventoryList pictures', () => {
  const fetchMock = vi.fn()

  const withImages: InventoryItem[] = [
    { ...ITEMS[0], imageSource: 'product', imageUrl: PRODUCT_IMAGE },
    { ...ITEMS[1], imageSource: 'photo', imageUrl: null },
    ITEMS[2],
  ]

  function renderList() {
    vi.mocked(apiFetch).mockResolvedValue({ items: withImages } as never)
    return renderWithQuery(
      <MemoryRouter>
        <InventoryList />
      </MemoryRouter>,
    )
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    // jsdom has no object URLs.
    URL.createObjectURL = vi.fn(() => 'blob:photo-2')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(apiFetch).mockReset()
    fetchMock.mockReset()
  })

  it('shows the product image, the saved photo, and the icon for an item with neither', async () => {
    fetchMock.mockResolvedValue(new Response(new Blob(['jpeg'], { type: 'image/jpeg' })))
    const { container } = renderList()

    await waitFor(() => expect(container.querySelectorAll('img.item-card-image')).toHaveLength(2))
    const sources = [...container.querySelectorAll('img.item-card-image')].map((img) => img.getAttribute('src'))
    expect(sources).toEqual([PRODUCT_IMAGE, 'blob:photo-2'])
    expect(fetchMock).toHaveBeenCalledWith('/api/inventory/2/photo', expect.objectContaining({
      headers: { Authorization: 'Bearer test-token' },
    }))
    // Only the photo item is fetched; the third card keeps its icon.
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(container.querySelectorAll('.item-card-tile svg')).toHaveLength(1)
  })

  it("keeps the icon when a photo can't be fetched", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
    const { container } = renderList()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await screen.findAllByRole('listitem')
    expect([...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([PRODUCT_IMAGE])
  })
})

describe('AddItemPage pictures', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(apiFetch).mockReset()
    fakeApi()
  })

  it("saves a barcode scan with the lookup's image link", async () => {
    renderAddItem({ scan: SCAN })

    expect(screen.getByRole('img', { name: 'Product' })).toHaveAttribute('src', PRODUCT_IMAGE)
    await fillDateAndSave()

    await screen.findByText(/added/i)
    expect(savedBody()).toMatchObject({ imageUrl: PRODUCT_IMAGE })
    expect(savedBody()).not.toHaveProperty('photo')
  })

  it('saves an AI Vision item with the exact still it identified', async () => {
    renderAddItem({ photo: PHOTO })

    expect(screen.getByRole('img', { name: 'Your photo' })).toHaveAttribute('src', FRAME)
    await fillDateAndSave()

    await screen.findByText(/added/i)
    expect(savedBody().photo).toBe(FRAME)
    expect(savedBody()).not.toHaveProperty('imageUrl')
  })

  it('saves without a picture when the lookup had none', async () => {
    renderAddItem({ scan: { ...SCAN, product: { ...SCAN.product!, imageUrl: null } } })

    expect(screen.queryByRole('img')).toBeNull()
    await fillDateAndSave()

    await screen.findByText(/added/i)
    expect(savedBody()).not.toHaveProperty('imageUrl')
    expect(savedBody()).not.toHaveProperty('photo')
  })

  it('hides a preview that fails to load', async () => {
    renderAddItem({ scan: SCAN })

    fireEvent.error(screen.getByRole('img', { name: 'Product' }))

    expect(screen.queryByRole('img')).toBeNull()
  })

  it('sends nothing when the form is cancelled', async () => {
    renderAddItem({ photo: PHOTO })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Scanner')).toBeInTheDocument()
    expect(saves()).toHaveLength(0)
  })

  it('stays on the form with the photo when the save fails', async () => {
    fakeApi({ saveFails: true })
    renderAddItem({ photo: PHOTO })

    await fillDateAndSave()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save your item")
    expect(saves()).toHaveLength(1)
    // Nothing was stored, and the user can try again with the same still.
    expect(screen.getByRole('img', { name: 'Your photo' })).toHaveAttribute('src', FRAME)
  })
})
