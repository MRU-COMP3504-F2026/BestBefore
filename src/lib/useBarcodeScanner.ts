/*
 * Barcode scanning: Quagga2 (https://github.com/ericblade/quagga2), v1.13.0
 * License: MIT (https://github.com/ericblade/quagga2/blob/master/LICENSE)
 */
import { useCallback, useEffect, useState, type RefObject } from 'react'
import Quagga, { type QuaggaJSResultObject } from '@ericblade/quagga2'

export type ScannerState =
  | { status: 'starting' }
  | { status: 'scanning' }
  | { status: 'recognized'; barcode: string }
  | { status: 'error'; message: string }

// upc_reader comes before ean_reader so UPC-A reads as 12 digits instead of a 0-padded EAN-13.
const READERS = ['upc_reader', 'ean_reader', 'upc_e_reader', 'ean_8_reader'] as const

// Quagga can misread a single frame, so a code must be read this many times in a row.
const REQUIRED_MATCHES = 2

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

/**
 * Runs a live Quagga2 scan inside `targetRef` and stops after the first recognized barcode.
 * Call `restart` to scan again; the camera is released on success, error, unmount and
 * when `enabled` becomes false.
 */
export function useBarcodeScanner(targetRef: RefObject<HTMLElement | null>, enabled = true) {
  const [state, setState] = useState<ScannerState>({ status: 'starting' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const target = targetRef.current
    if (!enabled || !target) return

    let active = true
    let lastCode = ''
    let matches = 0

    const onDetected = (result: QuaggaJSResultObject) => {
      const code = result.codeResult.code
      if (!active || !code) return

      matches = code === lastCode ? matches + 1 : 1
      lastCode = code
      if (matches < REQUIRED_MATCHES) return

      active = false
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
      setState({ status: 'scanning' })
    })

    return () => {
      active = false
      Quagga.offDetected(onDetected)
      enqueue(() => Quagga.stop())
    }
  }, [targetRef, enabled, attempt])

  const restart = useCallback(() => {
    setState({ status: 'starting' })
    setAttempt((n) => n + 1)
  }, [])

  return { ...state, restart }
}
