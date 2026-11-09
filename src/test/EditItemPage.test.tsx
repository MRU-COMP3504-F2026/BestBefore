import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError, apiFetch } from '../lib/api'
import EditItemPage from '../pages/EditItemPage'
import { ITEMS, TODAY, renderWithQuery } from './inventoryFixtures'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiFetch: vi.fn(),
}))

vi.mock('../lib/authClient', () => ({
  getApiToken: async () => 'test-token',
  useAuthSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }),
}))

// Old Cheddar, bought Oct 20, best before Nov 16, with a barcode the user can't change here.
const CHEDDAR = { ...ITEMS[3], brand: 'Black Diamond', barcode: '0012345678905', quantity: 2 }

const SUGGESTED = {
  status: 'suggested',
  earliest: '2026-11-22',
  latest: '2026-12-22',
  storage: 'fridge',
  label: 'Refrigerator',
  matchedFood: 'Cheese, hard',
  confidence: 'high',
  aiUsed: false,
}

type Answer = unknown | (() => unknown)

// Answers the item list, the item's suggestion and the save by path, remembering every call.
function stubApi({ suggestion = SUGGESTED, save }: { suggestion?: Answer; save?: Answer } = {}) {
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === '/inventory') return { items: [ITEMS[0], CHEDDAR] }
    if (path.startsWith('/inventory/4/expiry-suggestion')) {
      return typeof suggestion === 'function' ? suggestion() : suggestion
    }
    if (path === '/inventory/4' && options?.method === 'PATCH') {
      if (typeof save === 'function') return save()
      return { item: { ...CHEDDAR, ...JSON.parse(String(options.body)) } }
    }
    throw new Error(`unexpected request ${path}`)
  })
}

function renderEdit() {
  return renderWithQuery(
    <MemoryRouter initialEntries={['/items/4/edit']}>
      <Routes>
        <Route path="/items/:id/edit" element={<EditItemPage />} />
        <Route path="/items/:id" element={<p>Detail page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const saveCalls = () => vi.mocked(apiFetch).mock.calls.filter(([, options]) => options?.method === 'PATCH')
const savedBody = () => JSON.parse(String(saveCalls()[0][1]!.body))
const suggestionCalls = () =>
  vi.mocked(apiFetch).mock.calls.filter(([path]) => path.startsWith('/inventory/4/expiry-suggestion'))

const changeDateBought = (value: string) => fireEvent.change(screen.getByLabelText(/Date bought/), { target: { value } })
const bestBeforeField = () => screen.getByLabelText(/Best before date/) as HTMLInputElement

describe('EditItemPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(apiFetch).mockReset()
  })

  it("prefills the item and saves only the user's own fields", async () => {
    stubApi()
    renderEdit()

    const name = await screen.findByLabelText(/Product name/)
    expect(name).toHaveValue('Old Cheddar')
    expect(screen.getByLabelText(/Brand/)).toHaveValue('Black Diamond')
    expect(screen.getByLabelText(/Barcode/)).toBeDisabled()
    expect(screen.getByLabelText(/Quantity/)).toHaveValue(2)

    await userEvent.clear(name)
    await userEvent.type(name, 'Aged Cheddar')
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByText('Detail page')).toBeInTheDocument()
    expect(saveCalls()).toHaveLength(1)
    expect(saveCalls()[0][0]).toBe('/inventory/4')
    expect(savedBody()).toEqual({
      name: 'Aged Cheddar',
      brand: 'Black Diamond',
      category: 'Dairy',
      quantity: 2,
      purchaseDate: '2026-10-20',
      bestBefore: '2026-11-16',
    })
    // No date bought change, so no suggestion was asked for.
    expect(suggestionCalls()).toHaveLength(0)
  })

  it('offers a new date when the date bought changes, but never applies it unasked', async () => {
    stubApi()
    renderEdit()
    await screen.findByLabelText(/Product name/)

    changeDateBought('2026-10-26')

    expect(await screen.findByText('Suggested: Nov 22, 2026')).toBeInTheDocument()
    expect(suggestionCalls().map(([path]) => path)).toEqual(['/inventory/4/expiry-suggestion?purchaseDate=2026-10-26'])
    expect(bestBeforeField()).toHaveValue('2026-11-16')
    expect(screen.getByText(/The best before date is still Nov 16, 2026/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await screen.findByText('Detail page')
    expect(savedBody()).toMatchObject({ purchaseDate: '2026-10-26', bestBefore: '2026-11-16' })
  })

  it('saves the suggested date once the user accepts it', async () => {
    stubApi()
    renderEdit()
    await screen.findByLabelText(/Product name/)

    changeDateBought('2026-10-26')
    await userEvent.click(await screen.findByRole('button', { name: 'Use Nov 22, 2026' }))

    expect(bestBeforeField()).toHaveValue('2026-11-22')
    expect(screen.getByText('Using the suggested date.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await screen.findByText('Detail page')
    expect(savedBody()).toMatchObject({ purchaseDate: '2026-10-26', bestBefore: '2026-11-22' })
  })

  it('drops an accepted date when the date bought changes again, but keeps a typed one', async () => {
    stubApi()
    renderEdit()
    await screen.findByLabelText(/Product name/)

    changeDateBought('2026-10-26')
    await userEvent.click(await screen.findByRole('button', { name: 'Use Nov 22, 2026' }))
    changeDateBought('2026-10-27')
    // The accepted date was counted from the old date bought.
    expect(bestBeforeField()).toHaveValue('2026-11-16')

    fireEvent.change(bestBeforeField(), { target: { value: '2026-12-01' } })
    changeDateBought('2026-10-28')

    expect(bestBeforeField()).toHaveValue('2026-12-01')
  })

  it('says so honestly when there is no saved suggestion', async () => {
    stubApi({
      suggestion: {
        status: 'none',
        message: 'No saved suggestion for this item. Check the package and enter the date.',
      },
    })
    renderEdit()
    await screen.findByLabelText(/Product name/)

    changeDateBought('2026-10-26')

    expect(await screen.findByText(/No saved suggestion for this item/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
    expect(bestBeforeField()).toHaveValue('2026-11-16')
  })

  it('shows the server error and stays on the form when the save fails', async () => {
    stubApi({
      save: () => {
        throw new ApiError(404, 'Item not found.')
      },
    })
    renderEdit()
    await screen.findByLabelText(/Product name/)

    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Item not found.')
    expect(screen.queryByText('Detail page')).not.toBeInTheDocument()
  })

  it('blocks a best before earlier than the date bought', async () => {
    stubApi()
    renderEdit()
    await screen.findByLabelText(/Product name/)

    fireEvent.change(bestBeforeField(), { target: { value: '2026-10-01' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(screen.getByText('You should probably not be eating this')).toBeInTheDocument())
    expect(saveCalls()).toHaveLength(0)
  })
})
