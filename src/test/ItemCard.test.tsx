import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ItemCard from '../components/ItemCard'
import { LeafIcon } from '../components/icons'

describe('ItemCard', () => {
  it('renders as a button with the name and expiry date', () => {
    render(<ItemCard name="Spinach" expires="Nov 29, 2026" icon={<LeafIcon />} />)

    expect(
      screen.getByRole('button', { name: 'Spinach Expires Nov 29, 2026' }),
    ).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn()
    render(<ItemCard name="Milk" expires="Nov 28, 2026" icon={<LeafIcon />} onClick={onClick} />)

    await userEvent.click(screen.getByRole('button', { name: /Milk/ }))

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('applies the tone to the icon tile', () => {
    const { container } = render(
      <ItemCard name="Eggs" expires="Nov 30, 2026" icon={<LeafIcon />} tone="amber" />,
    )

    expect(container.querySelector('.item-card-tile-amber')).toBeInTheDocument()
  })

  it('says an item expired on its date when the tone is red', () => {
    const { container } = render(
      <ItemCard name="Milk" expires="Oct 24, 2026" icon={<LeafIcon />} tone="red" />,
    )

    expect(screen.getByRole('button', { name: 'Milk Expired on Oct 24, 2026' })).toBeInTheDocument()
    expect(container.querySelector('.item-card-tile-red')).toBeInTheDocument()
    expect(container.querySelector('.item-card-expires-red')).toBeInTheDocument()
  })
})
