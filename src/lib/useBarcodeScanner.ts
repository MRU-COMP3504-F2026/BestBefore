/*
 * Barcode scanning: Quagga2 (https://github.com/ericblade/quagga2), v1.13.0
 * License: MIT (https://github.com/ericblade/quagga2/blob/master/LICENSE)
 */
import { useCallback, useEffect, useState, type RefObject } from 'react'
import Quagga, { type QuaggaJSResultObject } from '@ericblade/quagga2'
import { barsLine, toPoints, type Point } from './barcodeGeometry'

export type TorchState = 'unsupported' | 'off' | 'on'

/**
 * What the camera saw at the moment of recognition, in Quagga's canvas coordinates
 * (same aspect ratio as the video). `frame` is a still of the decoded frame, `box` the
 * region Quagga located and `line` where it read the bars; each is null when unavailable.
 */
export type RecognitionCapture = {
  width: number
  height: number
  frame: string | null
  box: Point[] | null
  line: [Point, Point] | null
}

export type ScannerState =
  | { status: 'starting' }
  | { status: 'scanning'; torch: TorchState; struggling: boolean; found: boolean }
  | { status: 'paused' }
  | { status: 'recognized'; barcode: string; capture?: RecognitionCapture }
  | { status: 'not-recognized' }
  | { status: 'error'; message: string }

// upc_reader comes before ean_reader so UPC-A reads as 12 digits instead of a 0-padded EAN-13.
const READERS = ['upc_reader', 'ean_reader', 'upc_e_reader', 'ean_8_reader'] as const

// Quagga processes frames on the main thread, as often as every animation frame by default.
// Capping it leaves the main thread free for a smooth preview; two reads still take ~130ms.
export const SCANS_PER_SECOND = 15

// Quagga can misread a single frame, so a code must be read this many times in a row.
const REQUIRED_MATCHES = 2

// How long a single read keeps the "barcode found" hint up while waiting for a confirming one.
const FOUND_HOLD_MS = 800

// After this long without a read, the scanner suggests better lighting or positioning.
export const STRUGGLING_AFTER_MS = 10_000

// After this long without a read, scanning stops and the barcode counts as not recognized.
export const TIMEOUT_AFTER_MS = 30_000

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

// Keeps the frame Quagga decoded and the barcode's outline, so the viewfinder can show them
// after the camera stops.
function captureRecognition(result: QuaggaJSResultObject): RecognitionCapture | undefined {
  // Quagga draws each frame it processes into this canvas before decoding it, and reports
  // the result before grabbing the next one, so it still holds the exact decoded frame.
  // Its size is also the coordinate space of the result's line and box.
  const buffer = Quagga.canvas?.dom.image
  if (!buffer?.width || !buffer.height) return undefined
  const { width, height } = buffer

  let frame: string | null = null
  try {
    frame = buffer.toDataURL('image/jpeg', 0.85)
  } catch {
    // The still is only cosmetic; the outline can show without it.
  }

  const box = toPoints(result.box)
  const line = barsLine(result)
  return frame || box || line ? { width, height, frame, box, line } : undefined
}

function strokePath(ctx: CanvasRenderingContext2D, points: Point[] | null, close: boolean) {
  if (!points?.length) return
  ctx.beginPath()
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  if (close) ctx.closePath()
  ctx.stroke()
}

/**
 * Draws what Quagga is doing on its overlay canvas, which sits over the video: faint
 * outlines for every region the locator suspects, then the region it decoded and the
 * stretch of bars it read. Called with no result to clear it.
 */
function drawOverlay(result: QuaggaJSResultObject | undefined, readColor: string) {
  const canvas = Quagga.canvas?.dom.overlay
  const ctx = Quagga.canvas?.ctx.overlay
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!result) return

  // The canvas is scaled to fill the viewfinder, so line widths follow its resolution.
  const unit = Math.max(1, Math.max(canvas.width, canvas.height) / 400)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.lineWidth = unit
  for (const box of result.boxes ?? []) {
    if (box !== result.box) strokePath(ctx, toPoints(box), true)
  }

  if (result.codeResult?.code) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineWidth = unit * 1.5
    strokePath(ctx, toPoints(result.box), true)
    ctx.strokeStyle = readColor
    ctx.lineWidth = unit * 3
    strokePath(ctx, barsLine(result), false)
  }
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
    let lastReadAt = -Infinity
    let found = false
    let strugglingTimer: ReturnType<typeof setTimeout> | undefined
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    const readColor =
      getComputedStyle(target).getPropertyValue('--color-success-light').trim() || '#a8dcc4'

    // Stopping the camera releases its track, which also turns the torch off.
    const stop = () => {
      active = false
      clearTimeout(strugglingTimer)
      clearTimeout(timeoutTimer)
      Quagga.offDetected(onDetected)
      Quagga.offProcessed(onProcessed)
      drawOverlay(undefined, readColor)
      enqueue(() => Quagga.stop())
    }

    const finish = (next: ScannerState) => {
      stop()
      setState(next)
    }

    // Runs for every frame Quagga processes, before onDetected for frames it could read.
    const onProcessed = (result?: QuaggaJSResultObject) => {
      if (!active) return
      drawOverlay(result, readColor)

      const now = performance.now()
      if (result?.codeResult?.code) lastReadAt = now
      const nowFound = now - lastReadAt < FOUND_HOLD_MS
      if (nowFound !== found) {
        found = nowFound
        setState((s) => (s.status === 'scanning' ? { ...s, found: nowFound } : s))
      }
    }

    const onDetected = (result: QuaggaJSResultObject) => {
      const code = result.codeResult.code
      if (!active || !code) return

      matches = code === lastCode ? matches + 1 : 1
      lastCode = code
      if (matches < REQUIRED_MATCHES) return

      console.log(`Scanned barcode: ${code}`)
      let capture: RecognitionCapture | undefined
      try {
        capture = captureRecognition(result)
      } catch {
        // The capture is only cosmetic; the recognition stands without it.
      }
      finish({ status: 'recognized', barcode: code, capture })
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
            // Quagga reads every frame back from its canvas; a CPU-backed canvas avoids
            // stalling the GPU on each read, which made the preview stutter on phones.
            willReadFrequently: true,
          },
          decoder: { readers: [...READERS] },
          locate: true,
          frequency: SCANS_PER_SECOND,
        })
      } catch (err) {
        await Quagga.stop()
        if (active) setState({ status: 'error', message: describeCameraError(err) })
        return
      }

      // Closed while the camera was opening; the cleanup's queued stop releases it.
      if (!active) return

      Quagga.onProcessed(onProcessed)
      Quagga.onDetected(onDetected)
      Quagga.start()
      setState({
        status: 'scanning',
        torch: hasTorch() ? 'off' : 'unsupported',
        struggling: false,
        found: false,
      })
      strugglingTimer = setTimeout(() => {
        setState((s) => (s.status === 'scanning' ? { ...s, struggling: true } : s))
      }, STRUGGLING_AFTER_MS)
      timeoutTimer = setTimeout(() => finish({ status: 'not-recognized' }), TIMEOUT_AFTER_MS)
    })

    return stop
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
