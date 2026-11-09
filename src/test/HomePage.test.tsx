import { screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import HomePage from '../pages/HomePage'
import { ITEMS, TODAY, renderWithQuery } from './inventoryFixtures'

vi.mock('../lib/api', () => ({ apiFetch: vi.fn() }))

function renderHome() {
  renderWithQuery(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
    vi.mocked(apiFetch).mockResolvedValue({ items: ITEMS })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(apiFetch).mockReset()
  })

  it('renders the header, greeting and scan button', () => {
    renderHome()

    expect(screen.getByRole('heading', { name: 'BestBefore' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Good Morning!' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scan Barcode' })).toBeInTheDocument()
  })

  it('previews only the 3 soonest-expiring items', async () => {
    renderHome()

    expect(screen.getByRole('heading', { name: 'My Items' })).toBeInTheDocument()
    expect(await screen.findAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('button', { name: /Milk/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Spinach/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Eggs/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cheddar/ })).not.toBeInTheDocument()
  })

  it('tints each whole preview card by its expiry, with no Remove action on Home', async () => {
    renderHome()

    await screen.findAllByRole('listitem')
    expect(screen.getByRole('button', { name: /Milk/ })).toHaveClass('item-card-red')
    expect(screen.getByRole('button', { name: /Spinach/ })).toHaveClass('item-card-amber')
    expect(screen.getByRole('button', { name: /Eggs/ })).toHaveClass('item-card-amber')
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
  })

  it('shows the preview cards in their expiry colour with matching labels', async () => {
    renderHome()

    const card = (name: string) => screen.getByRole('button', { name: new RegExp(name) })
    const tile = (name: string) =>
      within(card(name)).getByText((_, el) => el?.classList.contains('item-card-tile') ?? false).className

    await screen.findAllByRole('listitem')
    // Milk passed its date two days ago, Spinach is due today, Eggs in 3 days.
    expect(tile('Milk')).toContain('item-card-tile-red')
    expect(card('Milk')).toHaveTextContent('Expired on Oct 24, 2026')
    expect(tile('Spinach')).toContain('item-card-tile-amber')
    expect(card('Spinach')).toHaveTextContent('Expires Oct 26, 2026')
    expect(tile('Eggs')).toContain('item-card-tile-amber')
    expect(card('Eggs')).toHaveTextContent('Expires Oct 29, 2026')
  })
})
