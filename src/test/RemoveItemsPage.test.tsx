import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RemoveItemsPage from '../pages/RemoveItemsPage'
import { apiFetch } from '../lib/api'
import { renderWithQuery } from './inventoryFixtures'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiFetch: vi.fn(),
}))

vi.mock('../lib/authClient', () => ({
  getApiToken: async () => 'test-token',
  useAuthSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }),
}))

function item(id: number, name: string, bestBefore: string) {
  return {
    id,
    name,
    brand: null,
    barcode: null,
    category: null,
    quantity: 1,
    unit: null,
    purchaseDate: '2019-12-01',
    bestBefore,
    imageSource: null,
    imageUrl: null,
    createdAt: '2026-11-07T12:00:00.000Z',
  }
}

// Two items whose date has passed, one that has not.
const ITEMS = [
  item(1, 'Old Milk', '2020-01-01'),
  item(2, 'Old Eggs', '2020-01-02'),
  item(3, 'Fresh Spinach', '2099-01-01'),
]

// Answers like the real API: the list on GET, the removed ids on DELETE.
function fakeApi() {
  vi.mocked(apiFetch).mockImplementation(async (_path, options) => {
    if (options?.method === 'DELETE') {
      return { ids: JSON.parse(options.body as string).ids } as never
    }
    return { items: ITEMS } as never
  })
}

function deleteCalls() {
  return vi.mocked(apiFetch).mock.calls.filter(([, options]) => options?.method === 'DELETE')
}

function renderPage() {
  renderWithQuery(
    <MemoryRouter initialEntries={['/items/remove']}>
      <Routes>
        <Route path="/items" element={<p>Items</p>} />
        <Route path="/items/remove" element={<RemoveItemsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const removeButton = (count: number) => screen.getByRole('button', { name: `Remove selected (${count})` })

describe('RemoveItemsPage', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
    fakeApi()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists every item and disables Remove while nothing is selected', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: /Old Milk/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Old Eggs/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Fresh Spinach/ })).toBeInTheDocument()
    expect(removeButton(0)).toBeDisabled()
  })

  it('selects and unselects a single item', async () => {
    renderPage()

    const milk = await screen.findByRole('button', { name: /Old Milk/ })
    await userEvent.click(milk)
    expect(milk).toHaveAttribute('aria-pressed', 'true')
    expect(removeButton(1)).toBeEnabled()

    await userEvent.click(milk)
    expect(milk).toHaveAttribute('aria-pressed', 'false')
    expect(removeButton(0)).toBeDisabled()
  })

  it('selects every item with Select all, and clears them again', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Old Milk/ })

    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(removeButton(3)).toBeEnabled()
    expect(screen.getByRole('button', { name: /Fresh Spinach/ })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(removeButton(0)).toBeDisabled()
  })

  it('selects only the expired items with Select expired', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Old Milk/ })

    await userEvent.click(screen.getByRole('button', { name: 'Select expired' }))

    expect(removeButton(2)).toBeEnabled()
    expect(screen.getByRole('button', { name: /Old Milk/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Old Eggs/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Fresh Spinach/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('sends the selected ids in one DELETE request, then returns to the list', async () => {
    renderPage()
    await screen.findByRole('button', { name: /Old Milk/ })

    await userEvent.click(screen.getByRole('button', { name: 'Select expired' }))
    await userEvent.click(removeButton(2))

    expect(deleteCalls()).toHaveLength(1)
    const [path, options] = deleteCalls()[0]
    expect(path).toBe('/inventory')
    expect(JSON.parse(options!.body as string)).toEqual({ ids: [1, 2] })
    expect(await screen.findByText('Items')).toBeInTheDocument()
  })

  it('deletes nothing when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /Old Milk/ }))
    await userEvent.click(removeButton(1))

    expect(window.confirm).toHaveBeenCalledOnce()
    expect(deleteCalls()).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Old Milk/ })).toBeInTheDocument()
  })

  it('stays on the page with an error when the delete fails', async () => {
    vi.mocked(apiFetch).mockImplementation(async (_path, options) => {
      if (options?.method === 'DELETE') throw new Error('API request failed: 500')
      return { items: ITEMS } as never
    })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /Old Milk/ }))
    await userEvent.click(removeButton(1))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't remove the items")
    expect(screen.queryByText('Items')).not.toBeInTheDocument()
    await waitFor(() => expect(removeButton(1)).toBeEnabled())
  })

  it('shows an empty message when there is nothing to remove', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [] } as never)
    renderPage()

    expect(await screen.findByText('No items to remove.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select all' })).not.toBeInTheDocument()
  })
})