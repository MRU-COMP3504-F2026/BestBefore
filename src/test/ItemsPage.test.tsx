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

  it('marks expired items red and items expiring within 3 days amber', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: ITEMS })
    renderItems()

    const tone = (name: string) =>
      within(screen.getByRole('button', { name: new RegExp(name) }))
        .getByText((_, el) => el?.classList.contains('item-card-tile') ?? false)
        .className

    await screen.findAllByRole('listitem')
    expect(tone('Milk')).toContain('red')
    expect(tone('Spinach')).toContain('amber')
    expect(tone('Eggs')).toContain('amber')
    expect(tone('Cheddar')).toContain('green')
    expect(tone('Tomatoes')).toContain('green')
  })

  it('says when an item expired and when the others expire', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: ITEMS })
    renderItems()

    expect(await screen.findByText('Expired on Oct 24, 2026')).toBeInTheDocument()
    expect(screen.getByText('Expires Oct 26, 2026')).toBeInTheDocument()
    expect(screen.getByText('Expires Oct 29, 2026')).toBeInTheDocument()
    expect(screen.queryByText('Expires Oct 24, 2026')).not.toBeInTheDocument()
  })

  it('turns a card red only once its date has passed', async () => {
    const day = (bestBefore: string, id: number, name: string) => ({ ...ITEMS[0], id, name, bestBefore })
    vi.mocked(apiFetch).mockResolvedValue({
      items: [
        day('2026-10-25', 1, 'Yesterday Bread'),
        day('2026-10-26', 2, 'Today Yogurt'),
        day('2026-10-27', 3, 'Tomorrow Cream'),
        day('2026-10-30', 4, 'Later Butter'),
      ],
    })
    renderItems()

    const card = (name: string) => screen.getByRole('button', { name: new RegExp(name) })
    const tile = (name: string) =>
      within(card(name)).getByText((_, el) => el?.classList.contains('item-card-tile') ?? false).className

    await screen.findAllByRole('listitem')
    expect(tile('Yesterday Bread')).toContain('item-card-tile-red')
    expect(card('Yesterday Bread')).toHaveTextContent('Expired on Oct 25, 2026')
    expect(tile('Today Yogurt')).toContain('item-card-tile-amber')
    expect(card('Today Yogurt')).toHaveTextContent('Expires Oct 26, 2026')
    expect(tile('Tomorrow Cream')).toContain('item-card-tile-amber')
    expect(card('Tomorrow Cream')).toHaveTextContent('Expires Oct 27, 2026')
    expect(tile('Later Butter')).toContain('item-card-tile-green')
    expect(card('Later Butter')).toHaveTextContent('Expires Oct 30, 2026')
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
