/*
 * Barcode scanning: Quagga2 (https://github.com/ericblade/quagga2), v1.13.0
 * License: MIT (https://github.com/ericblade/quagga2/blob/master/LICENSE)
 */
import { useCallback, useEffect, useState, type RefObject } from 'react'
import Quagga, { type QuaggaJSResultObject } from '@ericblade/quagga2'

export type TorchState = 'unsupported' | 'off' | 'on'

export type ScannerState =
  | { status: 'starting' }
  | { status: 'scanning'; torch: TorchState; struggling: boolean }
  | { status: 'paused' }
  | { status: 'recognized'; barcode: string }
  | { status: 'error'; message: string }

// upc_reader comes before ean_reader so UPC-A reads as 12 digits instead of a 0-padded EAN-13.
const READERS = ['upc_reader', 'ean_reader', 'upc_e_reader', 'ean_8_reader'] as const

// Quagga can misread a single frame, so a code must be read this many times in a row.
const REQUIRED_MATCHES = 2

// After this long without a read, the scanner suggests better lighting or positioning.
export const STRUGGLING_AFTER_MS = 10_000

// Quagga is a singleton, so init/stop calls are queued to keep them from overlapping
// (e.g. StrictMode mounting, unmounting and remounting before the camera has opened).
let queue: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>) {
  queue = queue.then(task).catch(() => {})
}

function describeCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was denied. Allow camera access in your browser settings and try again.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device.'
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'The camera is in use by another app. Close it and try again.'
  }
  return "The camera couldn't be started. Please try again."
}

function hasTorch(): boolean {
  const capabilities = Quagga.CameraAccess.getActiveTrack()?.getCapabilities?.()
  return !!capabilities && 'torch' in capabilities
}

/**
 * Runs a live Quagga2 scan inside `targetRef` and stops after the first recognized barcode.
 * `cancel` pauses and `restart` scans again; the camera is released on success, error,
 * pause, unmount and when `enabled` becomes false.
 */
export function useBarcodeScanner(targetRef: RefObject<HTMLElement | null>, enabled = true) {
  const [state, setState] = useState<ScannerState>({ status: 'starting' })
  const [run, setRun] = useState({ attempt: 0, paused: false })
  const shouldRun = enabled && !run.paused

  useEffect(() => {
    const target = targetRef.current
    if (!shouldRun || !target) return

    let active = true
    let lastCode = ''
    let matches = 0
    let strugglingTimer: ReturnType<typeof setTimeout> | undefined

    const onDetected = (result: QuaggaJSResultObject) => {
      const code = result.codeResult.code
      if (!active || !code) return

      matches = code === lastCode ? matches + 1 : 1
      lastCode = code
      if (matches < REQUIRED_MATCHES) return

      active = false
      clearTimeout(strugglingTimer)
      Quagga.offDetected(onDetected)
      enqueue(() => Quagga.stop())
      console.log(`Scanned barcode: ${code}`)
      setState({ status: 'recognized', barcode: code })
    }

    enqueue(async () => {
      if (!active) return

      if (!navigator.mediaDevices?.getUserMedia) {
        setState({
          status: 'error',
          message: 'Camera access needs a secure (HTTPS) connection and a supported browser.',
        })
        return
      }

      try {
        await Quagga.init({
          inputStream: {
            type: 'LiveStream',
            target,
            constraints: { width: 1280, height: 720, facingMode: 'environment' },
          },
          decoder: { readers: [...READERS] },
          locate: true,
        })
      } catch (err) {
        await Quagga.stop()
        if (active) setState({ status: 'error', message: describeCameraError(err) })
        return
      }

      // Closed while the camera was opening; the cleanup's queued stop releases it.
      if (!active) return

      Quagga.onDetected(onDetected)
      Quagga.start()
      setState({ status: 'scanning', torch: hasTorch() ? 'off' : 'unsupported', struggling: false })
      strugglingTimer = setTimeout(() => {
        setState((s) => (s.status === 'scanning' ? { ...s, struggling: true } : s))
      }, STRUGGLING_AFTER_MS)
    })

    // Stopping the camera releases its track, which also turns the torch off.
    return () => {
      active = false
      clearTimeout(strugglingTimer)
      Quagga.offDetected(onDetected)
      enqueue(() => Quagga.stop())
    }
  }, [targetRef, shouldRun, run.attempt])

  const restart = useCallback(() => {
    setState({ status: 'starting' })
    setRun((r) => ({ attempt: r.attempt + 1, paused: false }))
  }, [])

  const cancel = useCallback(() => {
    setState({ status: 'paused' })
    setRun((r) => ({ ...r, paused: true }))
  }, [])

  const toggleTorch = useCallback(() => {
    if (state.status !== 'scanning' || state.torch === 'unsupported') return
    const turnOn = state.torch === 'off'
    enqueue(async () => {
      await (turnOn ? Quagga.CameraAccess.enableTorch() : Quagga.CameraAccess.disableTorch())
      setState((s) => (s.status === 'scanning' ? { ...s, torch: turnOn ? 'on' : 'off' } : s))
    })
  }, [state])

  return { ...state, restart, cancel, toggleTorch }
}
