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

const YOGURT: PhotoHandoff = {
  food: { name: 'Greek Yogurt', brand: 'Chobani', category: 'Dairy', quantity: 2, unit: null, ripeness: null },
  provenance: 'signed.token',
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
type Match = { name: string; brand: string | null; category: string | null } | null
function fakeApi(suggestion: Suggestion, failSave = false, match: Match = null) {
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === '/food/expiry-suggestion') return suggestion as never
    if (path === '/food/photo/match') return { match } as never
    if (failSave) throw new Error('offline')
    const body = JSON.parse(options!.body as string)
    return {
      item: { ...body, id: 1, unit: null, createdAt: '2026-11-07T12:00:00.000Z' },
      catalog: 'saved',
    } as never
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

  it('goes back to the scanner on Cancel, without saving anything', async () => {
    renderPhoto(YOGURT)
    await waitFor(() => expect(callsTo('/food/expiry-suggestion')).toHaveLength(1))

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Scanner')).toBeInTheDocument()
    expect(callsTo('/inventory')).toHaveLength(0)
  })

  it('prefills a brand read off the package and a count, and says they came from the photo', () => {
    renderPhoto(YOGURT)

    expect(screen.getByLabelText(/Brand/)).toHaveValue('Chobani')
    expect(screen.getByText('Read from the package in your photo. Check it.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Quantity/)).toHaveValue(2)
    expect(screen.getByText('Counted in your photo. Check it.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Category/)).toHaveValue('Dairy')
    expect(screen.getByText('From your photo. Check it.')).toBeInTheDocument()
    // Nothing a photo can't show: no barcode and no date until the user gives one.
    expect(screen.getByLabelText(/^Barcode/)).toHaveValue('')
    expect(screen.getByLabelText(/Best before date/)).toHaveValue('')
  })

  it('leaves the brand blank when Gemini read none', () => {
    renderPhoto()

    expect(screen.getByLabelText(/Brand/)).toHaveValue('')
    expect(screen.queryByText(/Read from the package/)).not.toBeInTheDocument()
  })

  it.each([
    ['a weight', { quantity: 500, unit: 'g' }],
    ['a volume', { quantity: 2, unit: 'L' }],
    ['no count', { quantity: null, unit: null }],
  ])('keeps the quantity at 1 for %s', (_label, change) => {
    renderPhoto({ food: { ...APPLE.food, ...change } })

    expect(screen.getByLabelText(/Quantity/)).toHaveValue(1)
    expect(screen.queryByText(/Counted in your photo/)).not.toBeInTheDocument()
  })

  it("saves the user's edits over the photo's, with the provenance so the server can share it", async () => {
    renderPhoto(YOGURT)

    await userEvent.clear(screen.getByLabelText(/Product name/))
    await userEvent.type(screen.getByLabelText(/Product name/), 'Skyr')
    await userEvent.clear(screen.getByLabelText(/Brand/))
    await userEvent.clear(screen.getByLabelText(/Quantity/))
    await userEvent.type(screen.getByLabelText(/Quantity/), '4')
    await userEvent.selectOptions(screen.getByLabelText(/Category/), 'Deli')
    await userEvent.type(screen.getByLabelText(/^Barcode/), '012345678905')
    await userEvent.type(screen.getByLabelText(/Best before date/), '2026-12-01')
    await save()

    await waitFor(() => expect(callsTo('/inventory')).toHaveLength(1))
    expect(requestBody('/inventory')).toEqual({
      name: 'Skyr',
      brand: null,
      barcode: '012345678905',
      category: 'Deli',
      quantity: 4,
      purchaseDate: todayIsoDate(),
      bestBefore: '2026-12-01',
      photoToken: 'signed.token',
    })
    expect(await screen.findByText(/Skyr/)).toBeInTheDocument()
  })

  it('sends no provenance when the server gave none', async () => {
    renderPhoto()
    await userEvent.type(screen.getByLabelText(/Best before date/), '2026-12-01')
    await save()

    await waitFor(() => expect(callsTo('/inventory')).toHaveLength(1))
    expect(requestBody('/inventory')).not.toHaveProperty('photoToken')
  })

  it('offers what someone confirmed for a photo like this, and only uses it when asked', async () => {
    fakeApi(SUGGESTED, false, { name: 'Skyr', brand: 'Siggi', category: 'Dairy' })
    renderPhoto(YOGURT)

    expect(await screen.findByText(/Someone saved a photo like this as “Skyr” · Siggi · Dairy/)).toBeInTheDocument()
    expect(requestBody('/food/photo/match')).toEqual({ photoToken: 'signed.token' })
    expect(screen.getByLabelText(/Product name/)).toHaveValue('Greek Yogurt')

    await userEvent.click(screen.getByRole('button', { name: 'Use These Details' }))

    expect(screen.getByLabelText(/Product name/)).toHaveValue('Skyr')
    expect(screen.getByLabelText(/Brand/)).toHaveValue('Siggi')
    expect(screen.getByLabelText(/Category/)).toHaveValue('Dairy')
    expect(screen.getByLabelText(/Best before date/)).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Use These Details' })).not.toBeInTheDocument()
  })

  it('offers nothing when no one confirmed a photo like this, or the form already says it', async () => {
    fakeApi(SUGGESTED, false, { name: 'Greek Yogurt', brand: 'Chobani', category: 'Dairy' })
    renderPhoto(YOGURT)

    await waitFor(() => expect(callsTo('/food/photo/match')).toHaveLength(1))
    expect(screen.queryByText(/Someone saved a photo like this/)).not.toBeInTheDocument()
  })

  it('asks for no match without a provenance from the server', async () => {
    renderPhoto()

    await waitFor(() => expect(callsTo('/food/expiry-suggestion')).toHaveLength(1))
    expect(callsTo('/food/photo/match')).toHaveLength(0)
  })

  it('stays on the form with the edits kept when the save fails', async () => {
    fakeApi(SUGGESTED, true)
    renderPhoto(YOGURT)
    await userEvent.type(screen.getByLabelText(/Best before date/), '2026-12-01')
    await save()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't save your item/)
    expect(screen.getByLabelText(/Brand/)).toHaveValue('Chobani')
    expect(screen.getByLabelText(/Best before date/)).toHaveValue('2026-12-01')
  })
})
