import { render, screen } from '@testing-library/react'
import HomePage from '../pages/HomePage'

describe('HomePage', () => {
  it('renders the application', () => {
    render(<HomePage />)

    expect(screen.getByText(/BestBefore/i)).toBeInTheDocument()
  })
})
