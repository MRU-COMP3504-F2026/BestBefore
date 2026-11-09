import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import type { ScanHandoff } from '../lib/foodApi'
import { datesFromLength } from '../lib/shelfLifeDates'
import AddItemPage, { SUGGESTION_DEBOUNCE_MS } from '../pages/AddItemPage'
import { renderWithQuery } from './inventoryFixtures'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiFetch: vi.fn(),
}))

const session = vi.hoisted(() => ({ userId: 'user-1' }))
vi.mock('../lib/authClient', () => ({
  getApiToken: async () => 'test-token',
  useAuthSession: () => ({ data: { user: { id: session.userId } }, isPending: false }),
}))

const MILK: ScanHandoff = {
  barcode: '012345678905',
  category: 'Dairy',
  notice: null,
  product: {
    source: 'Open Facts',
    barcode: '012345678905',
    name: 'Whole Milk',
    brand: 'Dairyland',
    description: null,
    quantity: '400.0 g',
    category: 'Dairies, Milks',
    imageUrl: null,
    ingredients: null,
  },
}
const BREAD: ScanHandoff = {
  ...MILK,
  barcode: '5012345678900',
  category: 'Bakery',
  product: { ...MILK.product!, barcode: '5012345678900', name: 'Bread', category: 'Bakery' },
}

const SHELF_LIFE = {
  foodKeeperId: 1,
  matchedFood: 'Milk (plain)',
  storage: 'fridge',
  label: 'Fridge (from purchase)',
  length: { unit: 'days', min: 7, max: 14 },
  window: { min: 1, max: 2, metric: 'Weeks' },
  source: 'USDA',
  confidence: 'high',
  aiUsed: false,
}
const SUGGESTED = {
  status: 'suggested',
  earliest: '2026-11-08',
  latest: '2026-11-15',
  storage: 'fridge',
  label: 'Fridge (from purchase)',
  matchedFood: 'Milk (plain)',
  confidence: 'high',
  aiUsed: false,
  shelfLife: SHELF_LIFE,
}
const KEY = 'bestbefore.shelfLife.v1:user-1:00012345678905'

const NO_DRINK_DATE = { status: 'none', message: 'FoodKeeper has no unopened date for this drink.' }

function answerWith(answer: unknown) {
  vi.mocked(apiFetch).mockImplementation(async () => answer as never)
}

function suggestionCalls() {
  return vi.mocked(apiFetch).mock.calls.filter(([path]) => path === '/food/expiry-suggestion')
}

function renderAddItem(scan: ScanHandoff) {
  renderWithQuery(
    <MemoryRouter initialEntries={[{ pathname: '/items/new', state: { scan } }]}>
      <Routes>
        <Route path="/items/new" element={<AddItemPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const setBought = (date: string) => fireEvent.change(screen.getByLabelText(/Date bought/), { target: { value: date } })

// Long enough that the form would have asked the server if it was going to.
async function afterDebounce() {
  await act(() => new Promise((resolve) => setTimeout(resolve, SUGGESTION_DEBOUNCE_MS + 50)))
}

// A session that already knows the milk, as a reload in the same tab would find it.
function seedMilk(overrides: object = {}) {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      name: 'Whole Milk',
      brand: 'Dairyland',
      category: 'Dairy',
      productCategory: 'Dairies, Milks',
      shelfLife: SHELF_LIFE,
      ...overrides,
    }),
  )
}

describe('AddItemPage shelf life in the session', () => {
  beforeEach(() => {
    sessionStorage.clear()
    session.userId = 'user-1'
    vi.mocked(apiFetch).mockReset()
    answerWith(SUGGESTED)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps only the shelf life and the item it is for, never a date', async () => {
    renderAddItem(MILK)
    await screen.findByRole('button', { name: /^Use / })

    const stored = sessionStorage.getItem(KEY)!
    expect(JSON.parse(stored)).toMatchObject({ name: 'Whole Milk', shelfLife: { length: { unit: 'days', min: 7 } } })
    expect(stored).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('recomputes when the date bought changes, with no second request', async () => {
    renderAddItem(MILK)
    await screen.findByRole('button', { name: /^Use / })
    expect(suggestionCalls()).toHaveLength(1)

    setBought('2027-03-01')
    expect(await screen.findByRole('button', { name: 'Use Mar 8, 2027' })).toBeInTheDocument()
    expect(screen.getByText(/Mar 8, 2027 to Mar 15, 2027/)).toBeInTheDocument()

    await afterDebounce()
    expect(suggestionCalls()).toHaveLength(1)
  })

  it('never fills the date on its own, and clears an accepted one when the date bought changes', async () => {
    seedMilk()
    renderAddItem(MILK)
    const bestBefore = screen.getByLabelText(/Best before date/)
    setBought('2027-03-01')
    expect(bestBefore).toHaveValue('')

    await userEvent.click(await screen.findByRole('button', { name: 'Use Mar 8, 2027' }))
    expect(bestBefore).toHaveValue('2027-03-08')
    expect(screen.getByText('Using the suggested date.')).toBeInTheDocument()

    setBought('2027-04-01')
    expect(bestBefore).toHaveValue('')
    expect(await screen.findByRole('button', { name: 'Use Apr 8, 2027' })).toBeInTheDocument()
    expect(bestBefore).toHaveValue('')
    expect(suggestionCalls()).toHaveLength(0)
  })

  it('leaves a typed date alone when the date bought changes', async () => {
    seedMilk()
    renderAddItem(MILK)
    const bestBefore = screen.getByLabelText(/Best before date/)
    fireEvent.change(bestBefore, { target: { value: '2030-01-15' } })

    setBought('2027-03-01')

    expect(bestBefore).toHaveValue('2030-01-15')
  })

  it('restores from the session after a reload, with no request', async () => {
    renderAddItem(MILK)
    await screen.findByRole('button', { name: /^Use / })
    cleanup()
    vi.mocked(apiFetch).mockClear()

    renderAddItem(MILK)

    expect(await screen.findByRole('button', { name: /^Use / })).toBeInTheDocument()
    await afterDebounce()
    expect(suggestionCalls()).toHaveLength(0)
  })

  it('treats 12 and 13 digit forms of the barcode as the same item', async () => {
    seedMilk()

    renderAddItem({ ...MILK, product: { ...MILK.product!, barcode: '0012345678905' } })

    expect(await screen.findByRole('button', { name: /^Use / })).toBeInTheDocument()
    await afterDebounce()
    expect(suggestionCalls()).toHaveLength(0)
  })

  it('does not carry a shelf life over to another item', async () => {
    seedMilk()
    answerWith({ status: 'none', message: 'No reliable suggestion.' })

    renderAddItem(BREAD)

    expect(await screen.findByText('No reliable suggestion.')).toBeInTheDocument()
    expect(suggestionCalls()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
  })

  it('does not reuse a shelf life once the item has been edited', async () => {
    seedMilk()
    answerWith({ status: 'none', message: 'No reliable suggestion.' })
    renderAddItem(MILK)
    await screen.findByRole('button', { name: /^Use / })

    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: 'Oat Drink' } })

    expect(await screen.findByText('No reliable suggestion.')).toBeInTheDocument()
    expect(suggestionCalls()).toHaveLength(1)
    expect(JSON.parse(suggestionCalls()[0][1]!.body as string).name).toBe('Oat Drink')
  })

  it("does not read another user's entry", async () => {
    seedMilk()
    session.userId = 'user-2'

    renderAddItem(MILK)

    await screen.findByRole('button', { name: /^Use / })
    expect(suggestionCalls()).toHaveLength(1)
  })

  it.each([
    ['unreadable', () => sessionStorage.setItem(KEY, '{not json')],
    ['the wrong shape', () => seedMilk({ shelfLife: { length: { unit: 'years', min: 1, max: 2 } } })],
    ['for other form values', () => seedMilk({ brand: 'Other' })],
  ])('asks the server instead of using an entry that is %s', async (_name, seed) => {
    seed()

    renderAddItem(MILK)

    await screen.findByRole('button', { name: /^Use / })
    expect(suggestionCalls()).toHaveLength(1)
    expect(JSON.parse(sessionStorage.getItem(KEY)!).brand).toBe('Dairyland')
  })

  it('does not trust a suggested answer that has no shelf life', async () => {
    answerWith({ ...SUGGESTED, shelfLife: undefined })

    renderAddItem(MILK)
    await screen.findByRole('button', { name: /^Use / })

    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('never keeps a no-date answer, and asks again for each date', async () => {
    answerWith(NO_DRINK_DATE)
    renderAddItem(MILK)
    await screen.findByText(NO_DRINK_DATE.message)
    expect(sessionStorage.length).toBe(0)

    setBought('2027-03-01')

    await waitFor(() => expect(suggestionCalls()).toHaveLength(2))
    expect(sessionStorage.length).toBe(0)
    expect(screen.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
  })

  it('keeps working when sessionStorage is unavailable', async () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })

    renderAddItem(MILK)
    await screen.findByRole('button', { name: /^Use / })

    setBought('2027-03-01')

    await waitFor(() => expect(suggestionCalls()).toHaveLength(2))
  })

  it('keeps working when sessionStorage refuses a write', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError')
    })

    renderAddItem(MILK)

    expect(await screen.findByRole('button', { name: /^Use / })).toBeInTheDocument()
  })
})

describe('datesFromLength', () => {
  it('counts whole days across a month end', () => {
    expect(datesFromLength('2026-12-28', { unit: 'days', min: 3, max: 7 })).toEqual({
      earliest: '2026-12-31',
      latest: '2027-01-04',
    })
  })

  it('rolls months over the way the server does', () => {
    expect(datesFromLength('2027-01-31', { unit: 'months', min: 1, max: 1 })).toEqual({
      earliest: '2027-03-03',
      latest: '2027-03-03',
    })
  })

  it('lands on the same day of a later year', () => {
    expect(datesFromLength('2026-11-07', { unit: 'months', min: 24, max: 24 }).earliest).toBe('2028-11-07')
  })
})
