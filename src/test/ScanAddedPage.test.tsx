import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ScanAddedPage from '../pages/ScanAddedPage'

const PRODUCT = { name: 'Organic Milk', expires: 'Apr 25, 2027' }

function renderAdded(state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/scan/added', state }]}>
      <Routes>
        <Route path="/scan" element={<p>Scan</p>} />
        <Route path="/scan/added" element={<ScanAddedPage />} />
        <Route path="/items" element={<p>Items</p>} />
        <Route path="/items/new" element={<p>Add Item Form</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ScanAddedPage', () => {
  it('redirects to the scan page when there is no product', () => {
    renderAdded()

    expect(screen.getByText('Scan')).toBeInTheDocument()
  })

  it('shows when the added item expires', () => {
    renderAdded({ product: PRODUCT })

    expect(screen.getByText('Expires Apr 25, 2027')).toBeInTheDocument()
  })

  it('says an added item already expired when its date has passed', () => {
    renderAdded({ product: { name: 'Old Milk', expires: 'Oct 24, 2026', expired: true } })

    expect(screen.getByText('Expired on Oct 24, 2026')).toBeInTheDocument()
    expect(screen.queryByText(/^Expires/)).not.toBeInTheDocument()
  })

  it('goes to items from View My Items', async () => {
    renderAdded({ product: PRODUCT })

    await userEvent.click(screen.getByRole('button', { name: 'View My Items' }))

    expect(screen.getByText('Items')).toBeInTheDocument()
  })

  it('goes back to scanning from Scan Another', async () => {
    renderAdded({ product: PRODUCT, source: 'scan' })

    await userEvent.click(screen.getByRole('button', { name: 'Scan Another' }))

    expect(screen.getByText('Scan')).toBeInTheDocument()
  })

  it('offers Add Another for manually added items', async () => {
    renderAdded({ product: PRODUCT, source: 'manual' })

    await userEvent.click(screen.getByRole('button', { name: 'Add Another' }))

    expect(screen.getByText('Add Item Form')).toBeInTheDocument()
  })
})
