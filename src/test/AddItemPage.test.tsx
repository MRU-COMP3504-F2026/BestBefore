import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AddItemPage from '../pages/AddItemPage'
import ScanAddedPage from '../pages/ScanAddedPage'
import { ApiError, apiFetch } from '../lib/api'
import { todayIsoDate } from '../lib/dates'
import type { ScanHandoff } from '../lib/foodApi'
import { renderWithQuery } from './inventoryFixtures'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiFetch: vi.fn(),
}))

function renderAddItem(scan?: ScanHandoff) {
  renderWithQuery(
    <MemoryRouter initialEntries={[{ pathname: '/items/new', state: scan ? { scan } : null }]}>
      <Routes>
        <Route path="/items" element={<p>Items</p>} />
        <Route path="/scan" element={<p>Scanner</p>} />
        <Route path="/items/new" element={<AddItemPage />} />
        <Route path="/scan/added" element={<ScanAddedPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const save = () => userEvent.click(screen.getByRole('button', { name: 'Save Item' }))

// Answers like the real API: the row it saved, or the suggestion it was given.
type Suggestion = { status: string; [key: string]: unknown }
function fakeApi(suggestion: Suggestion | Error = { status: 'none', message: 'No reliable suggestion.' }) {
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === '/food/expiry-suggestion') {
      if (suggestion instanceof Error) throw suggestion
      return suggestion as never
    }
    const body = JSON.parse(options!.body as string)
    return {
      item: { ...body, id: 1, unit: null, createdAt: '2026-11-07T12:00:00.000Z' },
    } as never
  })
}

function callsTo(path: string) {
  return vi.mocked(apiFetch).mock.calls.filter(([called]) => called === path)
}

function savedBody() {
  const [call] = callsTo('/inventory')
  return JSON.parse(call[1]!.body as string)
}

describe('AddItemPage', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
    fakeApi()
  })

  it('marks required fields and the recommended barcode', () => {
    renderAddItem()

    expect(screen.getByLabelText(/Product name/)).toBeRequired()
    expect(screen.getByLabelText(/Quantity/)).toBeRequired()
    expect(screen.getByLabelText(/Date bought/)).toBeRequired()
    expect(screen.getByLabelText(/Best before date/)).toBeRequired()
    expect(screen.getByLabelText(/^Barcode/)).not.toBeRequired()
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getByText('Optional')).toBeInTheDocument()
  })

  it('defaults quantity to 1 and date bought to today', () => {
    renderAddItem()

    expect(screen.getByLabelText(/Quantity/)).toHaveValue(1)
    expect(screen.getByLabelText(/Date bought/)).toHaveValue(todayIsoDate())
  })

  it('shows inline errors for every missing required field', async () => {
    renderAddItem()

    await userEvent.clear(screen.getByLabelText(/Quantity/))
    await userEvent.clear(screen.getByLabelText(/Date bought/))
    await save()

    expect(await screen.findByText('Product name is required')).toBeInTheDocument()
    expect(screen.getByText('Quantity is required')).toBeInTheDocument()
    expect(screen.getByText('Date bought is required')).toBeInTheDocument()
    expect(screen.getByText('Best before date is required')).toBeInTheDocument()
  })

  it('rejects a quantity below 1', async () => {
    renderAddItem()

    const quantity = screen.getByLabelText(/Quantity/)
    await userEvent.clear(quantity)
    await userEvent.type(quantity, '0')
    await save()

    expect(await screen.findByText('Quantity must be at least 1')).toBeInTheDocument()
  })

  it('rejects a best before date earlier than the date bought', async () => {
    renderAddItem()

    const purchaseDate = screen.getByLabelText(/Date bought/)
    await userEvent.clear(purchaseDate)
    await userEvent.type(purchaseDate, '2026-10-10')
    await userEvent.type(screen.getByLabelText(/Product name/), 'Yogurt')
    await userEvent.type(screen.getByLabelText(/Best before date/), '2026-10-09')
    await save()

    expect(
      await screen.findByText('You should probably not be eating this'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Item Added!' })).not.toBeInTheDocument()
  })

  it('allows a best before date on the same day as the date bought', async () => {
    renderAddItem()

    const purchaseDate = screen.getByLabelText(/Date bought/)
    await userEvent.clear(purchaseDate)
    await userEvent.type(purchaseDate, '2026-10-10')
    await userEvent.type(screen.getByLabelText(/Product name/), 'Bread')
    await userEvent.type(screen.getByLabelText(/Best before date/), '2026-10-10')
    await save()

    expect(await screen.findByRole('heading', { name: 'Item Added!' })).toBeInTheDocument()
  })

  it('saves without a barcode, shows the pending state, then the confirmation', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(apiFetch).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderAddItem()

    await userEvent.type(screen.getByLabelText(/Product name/), 'Yogurt')
    await userEvent.type(screen.getByLabelText(/Best before date/), '2026-12-01')
    await save()

    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    // No success screen until the server has answered.
    expect(screen.queryByRole('heading', { name: 'Item Added!' })).not.toBeInTheDocument()
    finish({
      item: {
        id: 1,
        name: 'Yogurt',
        brand: null,
        barcode: null,
        category: null,
        quantity: 1,
        unit: null,
        purchaseDate: todayIsoDate(),
        bestBefore: '2026-12-01',
        createdAt: '2026-11-07T12:00:00.000Z',
      },
    })
    expect(await screen.findByRole('heading', { name: 'Item Added!' })).toBeInTheDocument()
    expect(screen.getByText('Yogurt')).toBeInTheDocument()
    expect(screen.getByText('Expires Dec 1, 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Another' })).toBeInTheDocument()
  })

  it('cancels back to items', async () => {
    renderAddItem()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Items')).toBeInTheDocument()
  })

  it('posts a manual item and shows the name and date the server saved', async () => {
    renderAddItem()

    await userEvent.type(screen.getByLabelText(/Product name/), 'Yogurt')
    await userEvent.type(screen.getByLabelText(/Best before date/), '2026-12-01')
    await save()

    await screen.findByRole('heading', { name: 'Item Added!' })
    expect(callsTo('/inventory')[0][1]!.method).toBe('POST')
    expect(savedBody()).toEqual({
      name: 'Yogurt',
      brand: null,
      barcode: null,
      category: null,
      quantity: 1,
      purchaseDate: todayIsoDate(),
      bestBefore: '2026-12-01',
    })
  })

  it('stays on the form with an error, not a success screen, when the save fails', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(500, "Couldn't save your item. Please try again."))
    renderAddItem()

    await userEvent.type(screen.getByLabelText(/Product name/), 'Yogurt')
    await userEvent.type(screen.getByLabelText(/Best before date/), '2026-12-01')
    await save()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save your item.")
    expect(screen.queryByRole('heading', { name: 'Item Added!' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Product name/)).toHaveValue('Yogurt')
  })

  it('does not ask for a suggestion on a manual add', async () => {
    renderAddItem()

    await userEvent.type(screen.getByLabelText(/Product name/), 'Yogurt')
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(callsTo('/food/expiry-suggestion')).toHaveLength(0)
  })

  describe('from a scan', () => {
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

    const SUGGESTED: Suggestion = {
      status: 'suggested',
      earliest: '2026-11-14',
      latest: '2026-11-21',
      storage: 'fridge',
      label: 'Fridge (from purchase)',
      matchedFood: 'Milk (plain)',
      confidence: 'high',
      aiUsed: false,
    }

    it('prefills name, brand and barcode, and keeps quantity a count', async () => {
      renderAddItem(MILK)

      expect(screen.getByLabelText(/Product name/)).toHaveValue('Whole Milk')
      expect(screen.getByLabelText(/Brand/)).toHaveValue('Dairyland')
      expect(screen.getByLabelText(/^Barcode/)).toHaveValue('012345678905')
      expect(screen.getByLabelText(/Quantity/)).toHaveValue(1)
      expect(screen.getByText('How many packages. Each one is 400.0 g.')).toBeInTheDocument()
    })

    it('shows null brand as an empty field and handles a merged record', async () => {
      renderAddItem({
        ...MILK,
        product: { ...MILK.product!, source: undefined, sources: ['Open Facts', 'UPCitemdb'], brand: null } as never,
      })

      expect(screen.getByLabelText(/Brand/)).toHaveValue('')
      expect(screen.getByLabelText(/Product name/)).toHaveValue('Whole Milk')
    })

    it('leaves the barcode and the reason when the lookup found nothing', async () => {
      renderAddItem({
        barcode: '012345678905',
        category: null,
        product: null,
        notice: 'No product found for this barcode. Add the details below.',
      })

      expect(screen.getByRole('status')).toHaveTextContent('No product found')
      expect(screen.getByLabelText(/^Barcode/)).toHaveValue('012345678905')
      expect(screen.getByLabelText(/Product name/)).toHaveValue('')
    })

    it('asks for a suggestion with the mapped category and the date bought', async () => {
      fakeApi(SUGGESTED)
      renderAddItem(MILK)

      await screen.findByRole('button', { name: 'Use Nov 14, 2026' })

      expect(JSON.parse(callsTo('/food/expiry-suggestion')[0][1]!.body as string)).toEqual({
        name: 'Whole Milk',
        brand: 'Dairyland',
        barcode: '012345678905',
        category: 'Dairy',
        productCategory: 'Dairies, Milks',
        purchaseDate: todayIsoDate(),
      })
    })

    it('never fills the date until the suggestion is accepted, and will not save without one', async () => {
      fakeApi(SUGGESTED)
      renderAddItem(MILK)
      await screen.findByRole('button', { name: 'Use Nov 14, 2026' })

      expect(screen.getByLabelText(/Best before date/)).toHaveValue('')
      await save()

      expect(await screen.findByText('Best before date is required')).toBeInTheDocument()
      expect(callsTo('/inventory')).toHaveLength(0)
    })

    it('saves the accepted date with the mapped category, not the package size', async () => {
      fakeApi(SUGGESTED)
      const purchase = '2026-11-07'
      renderAddItem(MILK)
      const bought = screen.getByLabelText(/Date bought/)
      await userEvent.clear(bought)
      await userEvent.type(bought, purchase)

      await userEvent.click(await screen.findByRole('button', { name: 'Use Nov 14, 2026' }))

      expect(screen.getByLabelText(/Best before date/)).toHaveValue('2026-11-14')
      expect(screen.getByText('Using the suggested date.')).toBeInTheDocument()

      await save()
      await screen.findByRole('heading', { name: 'Item Added!' })

      expect(screen.getByText('Expires Nov 14, 2026')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Scan Another' })).toBeInTheDocument()
      expect(savedBody()).toEqual({
        name: 'Whole Milk',
        brand: 'Dairyland',
        barcode: '012345678905',
        category: 'Dairy',
        quantity: 1,
        purchaseDate: purchase,
        bestBefore: '2026-11-14',
      })
    })

    it('saves a typed date without touching the suggestion', async () => {
      fakeApi(SUGGESTED)
      renderAddItem(MILK)
      await screen.findByRole('button', { name: 'Use Nov 14, 2026' })

      await userEvent.type(screen.getByLabelText(/Best before date/), '2030-01-15')
      await save()
      await screen.findByRole('heading', { name: 'Item Added!' })

      expect(savedBody().bestBefore).toBe('2030-01-15')
    })

    it('clears an accepted date, but not a typed one, when the date bought changes', async () => {
      fakeApi(SUGGESTED)
      renderAddItem(MILK)
      const bestBefore = screen.getByLabelText(/Best before date/)
      const bought = screen.getByLabelText(/Date bought/)

      await userEvent.click(await screen.findByRole('button', { name: 'Use Nov 14, 2026' }))
      expect(bestBefore).toHaveValue('2026-11-14')

      await userEvent.clear(bought)
      await userEvent.type(bought, '2026-11-01')
      expect(bestBefore).toHaveValue('')

      await userEvent.type(bestBefore, '2030-01-15')
      await userEvent.clear(bought)
      await userEvent.type(bought, '2026-11-02')
      expect(bestBefore).toHaveValue('2030-01-15')
    })

    it('flags an uncertain match', async () => {
      fakeApi({ ...SUGGESTED, confidence: 'low' })
      renderAddItem(MILK)

      expect(await screen.findByText(/This match is uncertain/)).toBeInTheDocument()
    })

    it('offers no date when the engine has none, and the date can still be typed', async () => {
      fakeApi({ status: 'none', message: 'No reliable suggestion for this item.' })
      renderAddItem(MILK)

      expect(await screen.findByText('No reliable suggestion for this item.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()

      await userEvent.type(screen.getByLabelText(/Best before date/), '2030-01-15')
      await save()

      expect(await screen.findByRole('heading', { name: 'Item Added!' })).toBeInTheDocument()
    })

    it('shows a drink with no FoodKeeper date as no date, with nothing to accept', async () => {
      fakeApi({
        status: 'none',
        message: 'FoodKeeper has no unopened date for this drink. Check the package.',
      })
      renderAddItem(MILK)

      expect(
        await screen.findByText('FoodKeeper has no unopened date for this drink. Check the package.'),
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
      expect(screen.queryByText(/^Suggested:/)).not.toBeInTheDocument()
      expect(screen.queryByText(/USDA/)).not.toBeInTheDocument()
      expect(screen.getByLabelText(/Best before date/)).toHaveValue('')
    })

    it('survives a failed suggestion request', async () => {
      fakeApi(new ApiError(500))
      renderAddItem(MILK)

      expect(await screen.findByText(/Couldn't get a suggested date/)).toBeInTheDocument()
    })

    it('waits for typing to stop before asking again', async () => {
      fakeApi(SUGGESTED)
      renderAddItem(MILK)
      await screen.findByRole('button', { name: 'Use Nov 14, 2026' })
      expect(callsTo('/food/expiry-suggestion')).toHaveLength(1)

      await userEvent.type(screen.getByLabelText(/Product name/), ' 2%')

      // The old answer can't be accepted while the new one is pending.
      expect(screen.queryByRole('button', { name: /^Use / })).not.toBeInTheDocument()
      await waitFor(() => expect(callsTo('/food/expiry-suggestion')).toHaveLength(2))
    })

    it('goes back to the scanner on Cancel', async () => {
      renderAddItem(MILK)

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.getByText('Scanner')).toBeInTheDocument()
    })
  })
})
