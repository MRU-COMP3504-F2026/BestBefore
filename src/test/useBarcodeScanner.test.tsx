import { StrictMode, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { QuaggaJSResultObject } from '@ericblade/quagga2'
import { STRUGGLING_AFTER_MS, useBarcodeScanner } from '../lib/useBarcodeScanner'

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

function renderScanner(options: { strict?: boolean } = {}) {
  const ref = { current: document.createElement('div') }
  const wrapper = options.strict
    ? ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    : undefined
  return { ref, ...renderHook(() => useBarcodeScanner(ref), { wrapper }) }
}

// Feeds a decoded frame to the most recently registered detection callback.
function detect(code: string) {
  const onDetected = quagga.onDetected.mock.lastCall![0]
  act(() => onDetected({ codeResult: { code } } as QuaggaJSResultObject))
}

function cameraError(name: string) {
  return Object.assign(new Error(name), { name })
}

describe('useBarcodeScanner', () => {
  let log: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    quagga.init.mockResolvedValue(undefined)
    quagga.stop.mockResolvedValue(undefined)
    quagga.CameraAccess.getActiveTrack.mockReturnValue(null)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    })
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    log.mockRestore()
  })

  describe('initialization', () => {
    it('starts in the starting state, then moves to scanning once the camera opens', async () => {
      const { result } = renderScanner()

      expect(result.current.status).toBe('starting')
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      expect(quagga.start).toHaveBeenCalledTimes(1)
      expect(quagga.onDetected).toHaveBeenCalledTimes(1)
    })

    it('targets the given element with the rear camera', async () => {
      const { ref, result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))

      const { inputStream } = quagga.init.mock.lastCall![0]
      expect(inputStream.type).toBe('LiveStream')
      expect(inputStream.target).toBe(ref.current)
      expect(inputStream.constraints.facingMode).toBe('environment')
    })

    it('reads UPC-A, UPC-E, EAN-13 and EAN-8, trying UPC-A before EAN-13', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))

      const readers: string[] = quagga.init.mock.lastCall![0].decoder.readers
      expect(readers).toEqual(
        expect.arrayContaining(['upc_reader', 'upc_e_reader', 'ean_reader', 'ean_8_reader']),
      )
      expect(readers).toHaveLength(4)
      expect(readers.indexOf('upc_reader')).toBeLessThan(readers.indexOf('ean_reader'))
    })

    it('does not open the camera while disabled', () => {
      const ref = { current: document.createElement('div') }
      const { result } = renderHook(() => useBarcodeScanner(ref, false))

      expect(result.current.status).toBe('starting')
      expect(quagga.init).not.toHaveBeenCalled()
    })

    it('opens the camera when enabled and releases it when disabled again', async () => {
      const ref = { current: document.createElement('div') }
      const { result, rerender } = renderHook(
        ({ enabled }) => useBarcodeScanner(ref, enabled),
        { initialProps: { enabled: false } },
      )

      rerender({ enabled: true })
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      rerender({ enabled: false })

      await waitFor(() => expect(quagga.stop).toHaveBeenCalledTimes(1))
      expect(quagga.offDetected).toHaveBeenCalled()
    })

    it('does nothing when there is no target element', () => {
      const ref = { current: null }
      const { result } = renderHook(() => useBarcodeScanner(ref))

      expect(result.current.status).toBe('starting')
      expect(quagga.init).not.toHaveBeenCalled()
    })
  })

  describe('detection', () => {
    it('recognizes a barcode after two matching reads, keeping leading zeros', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))

      detect('012345678905')
      expect(result.current.status).toBe('scanning')
      detect('012345678905')

      expect(result.current).toMatchObject({ status: 'recognized', barcode: '012345678905' })
      expect(log).toHaveBeenCalledWith('Scanned barcode: 012345678905')
    })

    it('does not recognize reads that disagree', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))

      detect('012345678905')
      detect('4006381333931')
      detect('012345678905')

      expect(result.current.status).toBe('scanning')
      expect(log).not.toHaveBeenCalled()
    })

    it('ignores frames without a decoded code', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))

      detect('')
      detect('')

      expect(result.current.status).toBe('scanning')
    })

    it('stops the camera and unsubscribes after a successful scan', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      const onDetected = quagga.onDetected.mock.lastCall![0]

      detect('96385074')
      detect('96385074')

      expect(quagga.offDetected).toHaveBeenCalledWith(onDetected)
      await waitFor(() => expect(quagga.stop).toHaveBeenCalledTimes(1))
    })

    it('fires only once even if more frames arrive after recognition', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))

      detect('012345678905')
      detect('012345678905')
      detect('012345678905')
      detect('4006381333931')
      detect('4006381333931')

      expect(log).toHaveBeenCalledTimes(1)
      expect(result.current).toMatchObject({ status: 'recognized', barcode: '012345678905' })
    })
  })

  describe('errors', () => {
    it.each([
      ['NotAllowedError', /Camera access was denied/],
      ['SecurityError', /Camera access was denied/],
      ['NotFoundError', /No camera was found/],
      ['OverconstrainedError', /No camera was found/],
      ['NotReadableError', /in use by another app/],
      ['SomethingElse', /couldn't be started/],
    ])('maps %s to a readable message', async (name, message) => {
      quagga.init.mockRejectedValueOnce(cameraError(name))
      const { result } = renderScanner()

      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(result.current).toMatchObject({ message: expect.stringMatching(message) })
    })

    it('releases any partially opened camera when init fails', async () => {
      quagga.init.mockRejectedValueOnce(cameraError('NotAllowedError'))
      const { result } = renderScanner()

      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(quagga.stop).toHaveBeenCalled()
      expect(quagga.start).not.toHaveBeenCalled()
    })

    it('reports an error without calling Quagga when camera APIs are unavailable', async () => {
      Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
      const { result } = renderScanner()

      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(result.current).toMatchObject({ message: expect.stringMatching(/HTTPS/) })
      expect(quagga.init).not.toHaveBeenCalled()
    })
  })

  describe('restart', () => {
    it('goes back to starting and opens the camera again', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      detect('012345678905')
      detect('012345678905')

      act(() => result.current.restart())

      expect(result.current.status).toBe('starting')
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      expect(quagga.init).toHaveBeenCalledTimes(2)
    })

    it('recovers from an error', async () => {
      quagga.init.mockRejectedValueOnce(cameraError('NotReadableError'))
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('error'))

      act(() => result.current.restart())

      await waitFor(() => expect(result.current.status).toBe('scanning'))
    })

    it('does not carry a partial read over into the next scan', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      detect('012345678905')
      detect('012345678905')
      act(() => result.current.restart())
      await waitFor(() => expect(result.current.status).toBe('scanning'))

      detect('012345678905')

      expect(result.current.status).toBe('scanning')
    })
  })

  describe('torch', () => {
    function withTorchSupport() {
      quagga.CameraAccess.getActiveTrack.mockReturnValue({
        getCapabilities: () => ({ torch: true }),
      })
      quagga.CameraAccess.enableTorch.mockResolvedValue(undefined)
      quagga.CameraAccess.disableTorch.mockResolvedValue(undefined)
    }

    it('is unsupported when there is no active track', async () => {
      const { result } = renderScanner()

      await waitFor(() => expect(result.current).toMatchObject({ torch: 'unsupported' }))
    })

    it('is unsupported when the camera has no torch capability', async () => {
      quagga.CameraAccess.getActiveTrack.mockReturnValue({ getCapabilities: () => ({}) })
      const { result } = renderScanner()

      await waitFor(() => expect(result.current).toMatchObject({ torch: 'unsupported' }))
    })

    it('starts off when supported and toggles on and off', async () => {
      withTorchSupport()
      const { result } = renderScanner()
      await waitFor(() => expect(result.current).toMatchObject({ torch: 'off' }))

      act(() => result.current.toggleTorch())
      await waitFor(() => expect(result.current).toMatchObject({ torch: 'on' }))
      expect(quagga.CameraAccess.enableTorch).toHaveBeenCalledTimes(1)

      act(() => result.current.toggleTorch())
      await waitFor(() => expect(result.current).toMatchObject({ torch: 'off' }))
      expect(quagga.CameraAccess.disableTorch).toHaveBeenCalledTimes(1)
    })

    it('stays off if the torch cannot be turned on', async () => {
      withTorchSupport()
      quagga.CameraAccess.enableTorch.mockRejectedValueOnce(new Error('no torch'))
      const { result } = renderScanner()
      await waitFor(() => expect(result.current).toMatchObject({ torch: 'off' }))

      act(() => result.current.toggleTorch())

      await waitFor(() => expect(quagga.CameraAccess.enableTorch).toHaveBeenCalled())
      expect(result.current).toMatchObject({ status: 'scanning', torch: 'off' })
    })

    it('does nothing when unsupported', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))

      act(() => result.current.toggleTorch())

      expect(quagga.CameraAccess.enableTorch).not.toHaveBeenCalled()
    })

    it('resets to off when the scanner restarts', async () => {
      withTorchSupport()
      const { result } = renderScanner()
      await waitFor(() => expect(result.current).toMatchObject({ torch: 'off' }))
      act(() => result.current.toggleTorch())
      await waitFor(() => expect(result.current).toMatchObject({ torch: 'on' }))

      act(() => result.current.restart())

      await waitFor(() => expect(result.current).toMatchObject({ status: 'scanning', torch: 'off' }))
    })
  })

  describe('struggling hint', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('flags a slow scan after the threshold without stopping', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const { result } = renderScanner()
      await waitFor(() => expect(result.current).toMatchObject({ struggling: false }))

      act(() => vi.advanceTimersByTime(STRUGGLING_AFTER_MS))

      expect(result.current).toMatchObject({ status: 'scanning', struggling: true })
      expect(quagga.stop).not.toHaveBeenCalled()
    })

    it('starts over on restart', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      act(() => vi.advanceTimersByTime(STRUGGLING_AFTER_MS))

      act(() => result.current.restart())

      await waitFor(() => expect(result.current).toMatchObject({ status: 'scanning', struggling: false }))
    })

    it('does not fire after the scanner has stopped', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))

      act(() => result.current.cancel())
      act(() => vi.advanceTimersByTime(STRUGGLING_AFTER_MS))

      expect(result.current.status).toBe('paused')
    })
  })

  describe('cancel', () => {
    it('pauses and releases the camera', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      const onDetected = quagga.onDetected.mock.lastCall![0]

      act(() => result.current.cancel())

      expect(result.current.status).toBe('paused')
      expect(quagga.offDetected).toHaveBeenCalledWith(onDetected)
      await waitFor(() => expect(quagga.stop).toHaveBeenCalledTimes(1))
      expect(quagga.init).toHaveBeenCalledTimes(1)
    })

    it('ignores detections after pausing', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      const onDetected = quagga.onDetected.mock.lastCall![0]

      act(() => result.current.cancel())
      act(() => {
        onDetected({ codeResult: { code: '012345678905' } })
        onDetected({ codeResult: { code: '012345678905' } })
      })

      expect(result.current.status).toBe('paused')
      expect(log).not.toHaveBeenCalled()
    })

    it('stays paused instead of scanning if cancelled while the camera is opening', async () => {
      let finishInit!: () => void
      quagga.init.mockReturnValueOnce(new Promise<void>((resolve) => (finishInit = resolve)))
      const { result } = renderScanner()
      await waitFor(() => expect(quagga.init).toHaveBeenCalled())

      act(() => result.current.cancel())
      finishInit()

      await waitFor(() => expect(quagga.stop).toHaveBeenCalledTimes(1))
      expect(result.current.status).toBe('paused')
      expect(quagga.start).not.toHaveBeenCalled()
    })

    it('resumes scanning on restart', async () => {
      const { result } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      act(() => result.current.cancel())

      act(() => result.current.restart())

      expect(result.current.status).toBe('starting')
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      expect(quagga.init).toHaveBeenCalledTimes(2)
    })
  })

  describe('cleanup', () => {
    it('stops the camera and unsubscribes on unmount', async () => {
      const { result, unmount } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      const onDetected = quagga.onDetected.mock.lastCall![0]

      unmount()

      expect(quagga.offDetected).toHaveBeenCalledWith(onDetected)
      await waitFor(() => expect(quagga.stop).toHaveBeenCalledTimes(1))
    })

    it('does not start scanning if unmounted while the camera is opening', async () => {
      let finishInit!: () => void
      quagga.init.mockReturnValueOnce(new Promise<void>((resolve) => (finishInit = resolve)))
      const { unmount } = renderScanner()
      await waitFor(() => expect(quagga.init).toHaveBeenCalled())

      unmount()
      finishInit()

      await waitFor(() => expect(quagga.stop).toHaveBeenCalledTimes(1))
      expect(quagga.start).not.toHaveBeenCalled()
      expect(quagga.onDetected).not.toHaveBeenCalled()
    })

    it('ignores detections that arrive after unmount', async () => {
      const { result, unmount } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))
      const onDetected = quagga.onDetected.mock.lastCall![0]

      unmount()
      onDetected({ codeResult: { code: '012345678905' } })
      onDetected({ codeResult: { code: '012345678905' } })

      expect(log).not.toHaveBeenCalled()
    })

    it('opens the camera only once under StrictMode', async () => {
      const { result } = renderScanner({ strict: true })

      await waitFor(() => expect(result.current.status).toBe('scanning'))
      expect(quagga.init).toHaveBeenCalledTimes(1)
      expect(quagga.start).toHaveBeenCalledTimes(1)
    })

    it('skips a queued init that was cancelled before it ran', async () => {
      const events: string[] = []
      quagga.init.mockImplementation(async () => {
        events.push('init:start')
        await Promise.resolve()
        events.push('init:end')
      })
      quagga.stop.mockImplementation(async () => {
        events.push('stop')
      })
      const { result, unmount } = renderScanner()
      await waitFor(() => expect(result.current.status).toBe('scanning'))

      act(() => result.current.restart())
      unmount()

      // Restart stops the first scan; the second init is cancelled by unmount, which stops again.
      await waitFor(() => expect(events.filter((e) => e === 'stop')).toHaveLength(2))
      expect(events).toEqual(['init:start', 'init:end', 'stop', 'stop'])
    })
  })
})
