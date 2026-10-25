import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TextField from '../components/TextField'

describe('TextField', () => {
  it('links the label to the input', () => {
    render(<TextField label="Email" />)

    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('marks required fields', () => {
    render(<TextField label="Product name" required />)

    const input = screen.getByRole('textbox', { name: 'Product name' })
    expect(input).toBeRequired()
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows a tag and a hint linked to the input', () => {
    render(<TextField label="Barcode" tag="Recommended" hint="Helps next time." />)

    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('Helps next time.')
  })

  it('shows an inline error and marks the input invalid', () => {
    render(<TextField label="Email" error="Email is required" />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Email is required')
  })

  it('renders a label action', () => {
    render(<TextField label="Password" labelAction={<a href="#">Forgot password?</a>} />)

    expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeInTheDocument()
  })

  it('toggles password visibility', async () => {
    render(<TextField label="Password" type="password" />)

    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('only shows the visibility toggle on password fields', () => {
    render(<TextField label="Email" type="email" />)

    expect(screen.queryByRole('button', { name: 'Show password' })).not.toBeInTheDocument()
  })
})
