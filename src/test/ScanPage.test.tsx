import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { QuaggaJSResultObject } from '@ericblade/quagga2'
import ScanPage from '../pages/ScanPage'
import ScanAddedPage from '../pages/ScanAddedPage'
import { MOCK_PRODUCT } from '../lib/mockScan'
import { STRUGGLING_AFTER_MS } from '../lib/useBarcodeScanner'

const quagga = vi.hoisted(() => ({
  init: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  onDetected: vi.fn(),
  offDetected: vi.fn(),
  CameraAccess: {
    getActiveTrack: vi.fn(),
    enableTorch: vi.fn(),
    disableTorch: vi.fn(),
  },
}))

vi.mock('@ericblade/quagga2', () => ({ default: quagga }))

function renderScan() {
  return render(
    <MemoryRouter initialEntries={['/scan']}>
      <Routes>
        <Route path="/" element={<p>Home</p>} />
        <Route path="/scan" element={<ScanPage />} />
        <Route path="/scan/added" element={<ScanAddedPage />} />
        <Route path="/scan/failed" element={<p>Failed</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

// Feeds a decoded frame to the callback ScanPage registered with Quagga.
function detect(code: string) {
  const onDetected = quagga.onDetected.mock.lastCall![0]
  act(() => onDetected({ codeResult: { code } } as QuaggaJSResultObject))
}

describe('ScanPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    quagga.init.mockResolvedValue(undefined)
    quagga.stop.mockResolvedValue(undefined)
    quagga.CameraAccess.getActiveTrack.mockReturnValue(null)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    })
  })

  it('starts the rear camera and shows the scanning state', async () => {
    renderScan()

    expect(screen.getByText('Starting camera…')).toBeInTheDocument()
    expect(await screen.findByText('Scanning for barcode…')).toBeInTheDocument()
    expect(quagga.init).toHaveBeenCalledTimes(1)
    expect(quagga.init.mock.lastCall![0].inputStream.constraints.facingMode).toBe('environment')
    expect(quagga.start).toHaveBeenCalledTimes(1)
  })

  it('stops scanning and shows the barcode, keeping leading zeros', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    renderScan()
    await screen.findByText('Scanning for barcode…')

    detect('012345678905')
    detect('012345678905')

    expect(await screen.findByRole('heading', { name: 'Barcode Recognized' })).toBeInTheDocument()
    expect(screen.getByText('012345678905')).toBeInTheDocument()
    expect(log).toHaveBeenCalledWith('Scanned barcode: 012345678905')
    expect(quagga.offDetected).toHaveBeenCalled()
    await vi.waitFor(() => expect(quagga.stop).toHaveBeenCalled())
    log.mockRestore()
  })

  it('ignores a single unconfirmed read', async () => {
    renderScan()
    await screen.findByText('Scanning for barcode…')

    detect('012345678905')
    detect('4006381333931')

    expect(screen.getByText('Scanning for barcode…')).toBeInTheDocument()
  })

  it('restarts the camera on Scan Again', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    renderScan()
    await screen.findByText('Scanning for barcode…')
    detect('012345678905')
    detect('012345678905')

    await userEvent.click(await screen.findByRole('button', { name: 'Scan Again' }))

    expect(await screen.findByText('Scanning for barcode…')).toBeInTheDocument()
    expect(quagga.init).toHaveBeenCalledTimes(2)
  })

  it('shows a permission error and retries on Try Again', async () => {
    quagga.init.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    renderScan()

    expect(await screen.findByText(/Camera access was denied/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }))

    expect(await screen.findByText('Scanning for barcode…')).toBeInTheDocument()
  })

  describe('cancel and rescan', () => {
    it('pauses on Cancel and resumes on Rescan', async () => {
      renderScan()
      await screen.findByText('Scanning for barcode…')

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.getByText('Scanning paused')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
      await vi.waitFor(() => expect(quagga.stop).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: 'Rescan' }))

      expect(await screen.findByText('Scanning for barcode…')).toBeInTheDocument()
      expect(quagga.init).toHaveBeenCalledTimes(2)
    })

    it('restarts the camera on Rescan while scanning', async () => {
      renderScan()
      await screen.findByText('Scanning for barcode…')

      await userEvent.click(screen.getByRole('button', { name: 'Rescan' }))

      expect(await screen.findByText('Scanning for barcode…')).toBeInTheDocument()
      expect(quagga.init).toHaveBeenCalledTimes(2)
      expect(quagga.stop).toHaveBeenCalledTimes(1)
    })
  })

  describe('lighting help', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('hides the flashlight button when the camera has no torch', async () => {
      renderScan()
      await screen.findByText('Scanning for barcode…')

      expect(screen.queryByRole('button', { name: /flashlight/ })).not.toBeInTheDocument()
    })

    it('toggles the flashlight when supported', async () => {
      quagga.CameraAccess.getActiveTrack.mockReturnValue({
        getCapabilities: () => ({ torch: true }),
      })
      quagga.CameraAccess.enableTorch.mockResolvedValue(undefined)
      quagga.CameraAccess.disableTorch.mockResolvedValue(undefined)
      renderScan()

      await userEvent.click(await screen.findByRole('button', { name: 'Turn on flashlight' }))

      const off = await screen.findByRole('button', { name: 'Turn off flashlight' })
      expect(off).toHaveAttribute('aria-pressed', 'true')
      expect(quagga.CameraAccess.enableTorch).toHaveBeenCalled()

      await userEvent.click(off)

      expect(await screen.findByRole('button', { name: 'Turn on flashlight' })).toBeInTheDocument()
      expect(quagga.CameraAccess.disableTorch).toHaveBeenCalled()
    })

    it('suggests better lighting when a scan is taking a while', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      renderScan()
      await screen.findByText('Scanning for barcode…')
      expect(screen.getByText('Position the barcode within the frame.')).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(STRUGGLING_AFTER_MS))

      expect(screen.getByText(/Try more light/)).toBeInTheDocument()
      expect(screen.getByText('Scanning for barcode…')).toBeInTheDocument()
    })
  })

  describe('scanner mode toggle', () => {
    it('defaults to the camera in dev', async () => {
      renderScan()

      expect(screen.getByRole('group', { name: 'Scanner mode' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Camera' })).toHaveAttribute('aria-pressed', 'true')
      await screen.findByText('Scanning for barcode…')
    })

    it('releases the camera and shows the mock Scan button in mock mode', async () => {
      renderScan()
      await screen.findByText('Scanning for barcode…')

      await userEvent.click(screen.getByRole('button', { name: 'Mock success' }))

      expect(screen.getByRole('button', { name: 'Scan' })).toBeInTheDocument()
      expect(screen.queryByText('Scanning for barcode…')).not.toBeInTheDocument()
      await vi.waitFor(() => expect(quagga.stop).toHaveBeenCalled())
    })

    it('goes to the added page with the mock product on mock success', async () => {
      renderScan()

      await userEvent.click(screen.getByRole('button', { name: 'Mock success' }))
      await userEvent.click(screen.getByRole('button', { name: 'Scan' }))

      expect(await screen.findByRole('button', { name: 'Scanning…' })).toBeDisabled()
      expect(await screen.findByRole('heading', { name: 'Item Added!' })).toBeInTheDocument()
      expect(screen.getByText(MOCK_PRODUCT.name)).toBeInTheDocument()
    })

    it('goes to the failed page on mock fail', async () => {
      renderScan()

      await userEvent.click(screen.getByRole('button', { name: 'Mock fail' }))
      await userEvent.click(screen.getByRole('button', { name: 'Scan' }))

      expect(await screen.findByText('Failed')).toBeInTheDocument()
    })

    it('reopens the camera when switching back from mock', async () => {
      renderScan()
      await screen.findByText('Scanning for barcode…')

      await userEvent.click(screen.getByRole('button', { name: 'Mock fail' }))
      await userEvent.click(screen.getByRole('button', { name: 'Camera' }))

      expect(await screen.findByText('Scanning for barcode…')).toBeInTheDocument()
      expect(quagga.init).toHaveBeenCalledTimes(2)
    })
  })

  it('releases the camera when closed', async () => {
    renderScan()
    await screen.findByText('Scanning for barcode…')

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByText('Home')).toBeInTheDocument()
    await vi.waitFor(() => expect(quagga.stop).toHaveBeenCalled())
  })
})
