import { act, render, screen } from '@testing-library/react'
import { useReducedMotion } from 'motion/react'
import ScanRecognized from '../components/ScanRecognized'
import { RECOGNITION_PHASE_AT as PHASE_AT } from '../lib/motion'
import type { RecognitionCapture } from '../lib/useBarcodeScanner'

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: vi.fn(() => false),
}))

const capture: RecognitionCapture = {
  width: 800,
  height: 450,
  frame: 'data:image/jpeg;base64,AAAA',
  box: [
    [300, 150],
    [500, 150],
    [500, 300],
    [300, 300],
  ],
}

function phaseOf(container: HTMLElement) {
  return container.querySelector('.scan-recognized')!.getAttribute('data-phase')
}

describe('ScanRecognized', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(useReducedMotion).mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('locks on, confirms, then reveals the number', () => {
    const { container } = render(<ScanRecognized barcode="012345678905" capture={capture} />)

    expect(phaseOf(container)).toBe('locking_on')
    expect(screen.queryByText('Barcode Recognized')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(PHASE_AT.confirming))
    expect(phaseOf(container)).toBe('confirming')
    expect(screen.getByText('Barcode Recognized')).toBeInTheDocument()
    expect(screen.queryByText('012345678905')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(PHASE_AT.revealing - PHASE_AT.confirming))
    expect(phaseOf(container)).toBe('revealing')
    const title = screen.getByText('Barcode Recognized')
    expect(title.nextElementSibling).toBe(screen.getByText('012345678905'))

    act(() => vi.advanceTimersByTime(PHASE_AT.recognized - PHASE_AT.revealing))
    expect(phaseOf(container)).toBe('recognized')

    // Stays on the success state rather than dismissing itself.
    act(() => vi.advanceTimersByTime(10_000))
    expect(phaseOf(container)).toBe('recognized')
    expect(screen.getByText('012345678905')).toBeInTheDocument()
  })

  it('keeps the presentation within the 700–1000 ms target', () => {
    expect(PHASE_AT.recognized).toBeGreaterThanOrEqual(700)
    expect(PHASE_AT.recognized).toBeLessThanOrEqual(1000)
  })

  it('draws the frozen frame and outlines the located barcode', () => {
    const { container } = render(<ScanRecognized barcode="012345678905" capture={capture} />)

    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('viewBox', '0 0 800 450')
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid slice')
    expect(svg.querySelector('image')).toHaveAttribute('href', capture.frame)
    expect(svg.querySelector('polygon')).toHaveAttribute('points', '300,150 500,150 500,300 300,300')
  })

  it('falls back to the viewfinder without a capture', () => {
    const { container } = render(<ScanRecognized barcode="012345678905" />)

    expect(container.querySelector('svg')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(PHASE_AT.recognized))
    expect(screen.getByText('012345678905')).toBeInTheDocument()
  })

  it('shows the final state straight away when reduced motion is preferred', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true)
    const { container } = render(<ScanRecognized barcode="012345678905" capture={capture} />)

    expect(phaseOf(container)).toBe('recognized')
    expect(screen.getByText('Barcode Recognized')).toBeInTheDocument()
    expect(screen.getByText('012345678905')).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels pending phases when unmounted mid-animation', () => {
    const { unmount } = render(<ScanRecognized barcode="012345678905" capture={capture} />)
    act(() => vi.advanceTimersByTime(PHASE_AT.confirming))

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
