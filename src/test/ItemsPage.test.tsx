import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import ItemsPage from '../pages/ItemsPage'
import { ITEMS, TODAY, renderWithQuery } from './inventoryFixtures'

vi.mock('../lib/api', () => ({ apiFetch: vi.fn() }))

function renderItems() {
  renderWithQuery(
    <MemoryRouter initialEntries={['/items']}>
      <Routes>
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/items/new" element={<p>Add Item Form</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ItemsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(apiFetch).mockReset()
  })

  it('renders every item from the API with formatted dates', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: ITEMS })
    renderItems()

    expect(screen.getByRole('heading', { name: 'My Items' })).toBeInTheDocument()
    expect(await screen.findAllByRole('listitem')).toHaveLength(ITEMS.length)
    expect(screen.getByText('Expires Nov 16, 2026')).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledWith('/inventory')
  })

  it('marks items expiring within 3 days (or expired) amber', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: ITEMS })
    renderItems()

    const tone = (name: string) =>
      within(screen.getByRole('button', { name: new RegExp(name) }))
        .getByText((_, el) => el?.classList.contains('item-card-tile') ?? false)
        .className

    await screen.findAllByRole('listitem')
    expect(tone('Milk')).toContain('amber')
    expect(tone('Spinach')).toContain('amber')
    expect(tone('Eggs')).toContain('amber')
    expect(tone('Cheddar')).toContain('green')
    expect(tone('Tomatoes')).toContain('green')
  })

  it('shows a loading message while fetching', () => {
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}))
    renderItems()

    expect(screen.getByText('Loading your items…')).toBeInTheDocument()
  })

  it('shows an error when the request fails', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('API request failed: 500'))
    renderItems()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your items.")
  })

  it('shows an empty state with no items', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [] })
    renderItems()

    expect(await screen.findByText(/No items yet/)).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('goes to the manual entry form from Add Item', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [] })
    renderItems()

    await userEvent.click(screen.getByRole('button', { name: 'Add Item' }))

    expect(screen.getByText('Add Item Form')).toBeInTheDocument()
  })
})
