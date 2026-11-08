import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AddItemPage from '../pages/AddItemPage'
import ScanAddedPage from '../pages/ScanAddedPage'
import { apiFetch } from '../lib/api'
import { formatDate, todayIsoDate } from '../lib/dates'
import type { PhotoHandoff } from '../lib/foodApi'
import { renderWithQuery } from './inventoryFixtures'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiFetch: vi.fn(),
}))

vi.mock('../lib/authClient', () => ({
  getApiToken: async () => 'test-token',
  useAuthSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }),
}))

const APPLE: PhotoHandoff = {
  food: { name: 'Apple', category: 'Fresh fruit', quantity: 1, unit: 'piece', ripeness: 'ripe' },
}

const SUGGESTED = {
  status: 'suggested',
  earliest: '2026-12-07',
  latest: '2027-01-07',
  storage: 'fridge',
  label: 'Refrigerator',
  matchedFood: 'Apples',
  confidence: 'high',
  aiUsed: false,
}

function renderPhoto(photo: PhotoHandoff = APPLE) {
  renderWithQuery(
    <MemoryRouter initialEntries={[{ pathname: '/items/new', state: { photo } }]}>
      <Routes>
        <Route path="/scan" element={<p>Scanner</p>} />
        <Route path="/items/new" element={<AddItemPage />} />
        <Route path="/scan/added" element={<ScanAddedPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

type Suggestion = { status: string; [key: string]: unknown }
function fakeApi(suggestion: Suggestion) {
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === '/food/expiry-suggestion') return suggestion as never
    const body = JSON.parse(options!.body as string)
    return { item: { ...body, id: 1, unit: null, createdAt: '2026-11-07T12:00:00.000Z' } } as never
  })
}

const callsTo = (path: string) => vi.mocked(apiFetch).mock.calls.filter(([called]) => called === path)
const requestBody = (path: string) => JSON.parse(callsTo(path).at(-1)![1]!.body as string)
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save Item' }))

describe('AddItemPage from AI Vision', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(apiFetch).mockReset()
    fakeApi(SUGGESTED)
  })

  it('prefills the name and says the food came from a photo', () => {
    renderPhoto()

    expect(screen.getByLabelText(/Product name/)).toHaveValue('Apple')
    expect(screen.getByLabelText(/^Barcode/)).toHaveValue('')
    expect(screen.getByLabelText(/Quantity/)).toHaveValue(1)
    expect(screen.getByText(/AI Vision named this from your photo/)).toBeInTheDocument()
  })

  it('asks for a FoodKeeper-only suggestion, with no barcode', async () => {
    renderPhoto()

    await waitFor(() => expect(callsTo('/food/expiry-suggestion')).toHaveLength(1))
    expect(requestBody('/food/expiry-suggestion')).toEqual({
      name: 'Apple',
      brand: null,
      barcode: null,
      category: null,
      productCategory: 'Fresh fruit',
      purchaseDate: todayIsoDate(),
      source: 'photo',
    })
    expect(callsTo('/food/expiry-suggestion').every(([, options]) => options?.method === 'POST')).toBe(true)
  })

  it('leaves the category on Not sure when the photo category is not one of ours', () => {
    renderPhoto()

    expect(screen.getByLabelText(/Category/)).toHaveValue('')
  })

  it('picks the category when the photo names one of ours, and sends and saves it', async () => {
    renderPhoto({ food: { ...APPLE.food, name: 'Greek Yogurt', category: 'dairy' } })

    expect(screen.getByLabelText(/Category/)).toHaveValue('Dairy')
    await waitFor(() => expect(callsTo('/food/expiry-suggestion')).toHaveLength(1))
    expect(requestBody('/food/expiry-suggestion')).toMatchObject({ category: 'Dairy', source: 'photo' })

    await userEvent.click(await screen.findByRole('button', { name: `Use ${formatDate('2026-12-07')}` }))
    await save()
    await waitFor(() => expect(callsTo('/inventory')).toHaveLength(1))
    expect(requestBody('/inventory')).toMatchObject({ category: 'Dairy', bestBefore: '2026-12-07' })
  })

  it('keeps a typed barcode out of the suggestion request', async () => {
    renderPhoto()
    await userEvent.type(screen.getByLabelText(/^Barcode/), '012345678905')

    await waitFor(() => expect(callsTo('/food/expiry-suggestion').length).toBeGreaterThan(0))
    expect(requestBody('/food/expiry-suggestion')).toMatchObject({ barcode: null, source: 'photo' })
  })

  it('shows the FoodKeeper match and only fills the date once accepted', async () => {
    renderPhoto()

    expect(await screen.findByText(/matched to “Apples” in USDA FoodKeeper/)).toBeInTheDocument()
    expect(screen.queryByText(/with AI help/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Best before date/)).toHaveValue('')

    await save()
    expect(await screen.findByText('Best before date is required')).toBeInTheDocument()
    expect(callsTo('/inventory')).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: `Use ${formatDate('2026-12-07')}` }))
    expect(screen.getByLabelText(/Best before date/)).toHaveValue('2026-12-07')
    await save()

    await waitFor(() => expect(callsTo('/inventory')).toHaveLength(1))
    expect(requestBody('/inventory')).toMatchObject({ name: 'Apple', barcode: null, bestBefore: '2026-12-07' })
  })

  it('leaves the date blank and says why when FoodKeeper has no match', async () => {
    fakeApi({
      status: 'none',
      message: 'No reliable suggestion for this item. Check the package and enter the date.',
    })
    renderPhoto({ food: { ...APPLE.food, name: 'Mystery Fruit' } })

    expect(await screen.findByText(/Check the package and enter the date/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Best before date/)).toHaveValue('')

    await userEvent.type(screen.getByLabelText(/Best before date/), '2026-11-20')
    await save()
    await waitFor(() => expect(callsTo('/inventory')).toHaveLength(1))
    expect(requestBody('/inventory')).toMatchObject({ name: 'Mystery Fruit', bestBefore: '2026-11-20' })
  })

  it('goes back to the scanner on Cancel', async () => {
    renderPhoto()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Scanner')).toBeInTheDocument()
  })
})
