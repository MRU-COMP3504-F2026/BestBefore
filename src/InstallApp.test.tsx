import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { InstallApp } from './InstallApp'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('provides manual Safari and Android instructions without a native prompt', () => {
  render(<InstallApp />)
  expect(screen.getByText(/iPhone or iPad/)).toHaveTextContent('Add to Home Screen')
  expect(screen.getByText(/Android:/)).toHaveTextContent('Install app')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
test('native install is offered only after eligibility and used only on click', async () => {
  render(<InstallApp />)
  const prompt = vi.fn().mockResolvedValue(undefined)
  const event = new Event('beforeinstallprompt', { cancelable: true })
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }) })
  fireEvent(window, event)
  expect(event.defaultPrevented).toBe(true)
  expect(prompt).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Install BestBefore' }))
  await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument())
  expect(prompt).toHaveBeenCalledOnce()
  expect(screen.getByText(/iPhone or iPad/)).toBeInTheDocument()
})
test('hides install guidance after installation and when standalone', () => {
  const view = render(<InstallApp />)
  fireEvent(window, new Event('appinstalled'))
  expect(screen.queryByLabelText('Install BestBefore')).not.toBeInTheDocument()
  view.unmount()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  render(<InstallApp />)
  expect(screen.queryByLabelText('Install BestBefore')).not.toBeInTheDocument()
})
