import { screen } from '@testing-library/react'
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
})
