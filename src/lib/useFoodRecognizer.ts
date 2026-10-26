import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { FoodIdentifyError, identifyFood, type IdentifiedFood } from './foodApi'
import { describeCameraError, whenScannerIdle, type RecognitionCapture } from './useBarcodeScanner'

// AI Vision (Beta). The camera only previews; Gemini sees a single still, and only when the
// user asks for one, so a photo costs exactly one API call.

// Longest side of the uploaded photo. Plenty for recognizing a food, and keeps uploads small.
export const MAX_PHOTO_SIZE = 1024
const PHOTO_QUALITY = 0.8

export type RecognizerState =
  | { status: 'starting' }
  | { status: 'ready' }
  | { status: 'identifying'; still: RecognitionCapture }
  | { status: 'identified'; still: RecognitionCapture; food: IdentifiedFood }
  | { status: 'not-identified'; still: RecognitionCapture }
  | { status: 'failed'; still: RecognitionCapture; message: string }
  | { status: 'error'; message: string }

type Photo = { blob: Blob; still: RecognitionCapture }

// Grabs the current video frame, scaled down to MAX_PHOTO_SIZE, as a JPEG.
async function takePhoto(video: HTMLVideoElement): Promise<Photo | null> {
  const { videoWidth, videoHeight } = video
  if (!videoWidth || !videoHeight) return null
  const scale = Math.min(1, MAX_PHOTO_SIZE / Math.max(videoWidth, videoHeight))
  const width = Math.round(videoWidth * scale)
  const height = Math.round(videoHeight * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY),
  )
  if (!blob) return null
  const frame = canvas.toDataURL('image/jpeg', PHOTO_QUALITY)
  return { blob, still: { width, height, frame, box: null, line: null } }
}

/**
 * Shows a live camera preview in `videoRef` and identifies the food in it on `identify`.
 * Taking the photo releases the camera; `retake` opens it again. The camera is also
 * released, and any running request abandoned, on unmount and when `enabled` becomes false.
 */
export function useFoodRecognizer(videoRef: RefObject<HTMLVideoElement | null>, enabled = true) {
  const [state, setState] = useState<RecognizerState>({ status: 'starting' })
  const [run, setRun] = useState({ attempt: 0, live: true })
  const busy = useRef(false)
  const request = useRef<AbortController | null>(null)
  const shouldRun = enabled && run.live

  useEffect(() => {
    const video = videoRef.current
    if (!shouldRun || !video) return

    let active = true
    let stream: MediaStream | undefined

    const open = async () => {
      // Quagga may still be closing its stream after a switch from barcode mode.
      await whenScannerIdle()
      if (!active) return

      if (!navigator.mediaDevices?.getUserMedia) {
        setState({
          status: 'error',
          message: 'Camera access needs a secure (HTTPS) connection and a supported browser.',
        })
        return
      }

      try {
        const opened = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: 1280, height: 720, facingMode: 'environment' },
        })
        stream = opened
        // Closed while the camera was opening.
        if (!active) {
          opened.getTracks().forEach((track) => track.stop())
          return
        }
        video.srcObject = opened
        await video.play().catch(() => {})
        if (active) setState({ status: 'ready' })
      } catch (err) {
        if (active) setState({ status: 'error', message: describeCameraError(err) })
      }
    }
    void open()

    return () => {
      active = false
      stream?.getTracks().forEach((track) => track.stop())
      video.srcObject = null
    }
  }, [videoRef, shouldRun, run.attempt])

  // Leaving AI mode abandons a request in flight; its result is never shown.
  useEffect(() => {
    if (enabled) return
    request.current?.abort()
  }, [enabled])

  useEffect(() => () => request.current?.abort(), [])

  const identify = useCallback(async () => {
    const video = videoRef.current
    // One request at a time, and only from a live preview.
    if (busy.current || state.status !== 'ready' || !video) return
    busy.current = true

    try {
      const photo = await takePhoto(video)
      if (!photo) {
        setState({ status: 'error', message: "Couldn't take a photo. Please try again." })
        setRun((r) => ({ ...r, live: false }))
        return
      }

      // The still replaces the preview, so the camera can go.
      setRun((r) => ({ ...r, live: false }))
      setState({ status: 'identifying', still: photo.still })

      const controller = new AbortController()
      request.current = controller
      try {
        const result = await identifyFood(photo.blob, controller.signal)
        if (controller.signal.aborted) return
        if (result.identified) {
          console.log(`Identified food: ${result.food.name}`)
          setState({ status: 'identified', still: photo.still, food: result.food })
        } else {
          setState({ status: 'not-identified', still: photo.still })
        }
      } catch (err) {
        if (controller.signal.aborted) return
        const message =
          err instanceof FoodIdentifyError ? err.message : 'Something went wrong. Please try again.'
        setState({ status: 'failed', still: photo.still, message })
      }
    } finally {
      busy.current = false
    }
  }, [videoRef, state.status])

  const retake = useCallback(() => {
    request.current?.abort()
    setState({ status: 'starting' })
    setRun((r) => ({ attempt: r.attempt + 1, live: true }))
  }, [])

  return { ...state, identify, retake }
}
