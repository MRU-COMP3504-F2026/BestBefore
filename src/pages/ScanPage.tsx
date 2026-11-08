/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import AiDevWarning from '../components/AiDevWarning'
import Button from '../components/Button'
import ScanRecognized from '../components/ScanRecognized'
import {
  BarcodeIcon,
  CircleAlertIcon,
  FlashlightIcon,
  FlashlightOffIcon,
  ScanBarcodeIcon,
  SparklesIcon,
  XIcon,
} from '../components/icons'
import { lookupBarcode } from '../lib/foodApi'
import { useBarcodeScanner } from '../lib/useBarcodeScanner'
import { useFoodRecognizer } from '../lib/useFoodRecognizer'
import { fadeUp, spring, tap } from '../lib/motion'
import '../styles/ScanPage.css'

// Each corner starts pushed outward, then snaps into place ("locking on").
const CORNER_OFFSET = 14
const corners = [
  { className: 'scan-corner-tl', x: -CORNER_OFFSET, y: -CORNER_OFFSET },
  { className: 'scan-corner-tr', x: CORNER_OFFSET, y: -CORNER_OFFSET },
  { className: 'scan-corner-bl', x: -CORNER_OFFSET, y: CORNER_OFFSET },
  { className: 'scan-corner-br', x: CORNER_OFFSET, y: CORNER_OFFSET },
]

// Controls fade up after the viewfinder has locked on.
const CONTROLS_DELAY = 0.3

// The AI quota warning shows locally and on Vercel preview deploys, where AI Vision is tested.
// Vercel exposes VITE_VERCEL_ENV to Vite builds automatically.
const SHOW_AI_WARNING = import.meta.env.DEV || import.meta.env.VITE_VERCEL_ENV === 'preview'

// Long enough for the recognition animation to finish before a fast lookup moves on.
const RECOGNIZED_HOLD_MS = 1200

type ScanSource = 'barcode' | 'ai'

export default function ScanPage() {
  useEffect(() => {
    document.title = 'BestBefore | Scan Barcode'
  }, [])
  const navigate = useNavigate()
  const videoRef = useRef<HTMLDivElement>(null)
  const aiVideoRef = useRef<HTMLVideoElement>(null)
  const [source, setSource] = useState<ScanSource>('barcode')
  // Asked again every time AI Vision is entered; never remembered.
  const [aiConfirmed, setAiConfirmed] = useState(false)
  const isAi = source === 'ai'
  const isCamera = !isAi
  const scanner = useBarcodeScanner(videoRef, isCamera)
  const showAiWarning = isAi && SHOW_AI_WARNING && !aiConfirmed
  // The AI camera waits until the warning is confirmed.
  const recognizer = useFoodRecognizer(aiVideoRef, isAi && !showAiWarning)
  const ai = isAi && !showAiWarning ? recognizer : null

  const onSourceChange = (next: ScanSource) => {
    if (next === source) return
    setSource(next)
    if (next === 'ai') {
      setAiConfirmed(false)
      recognizer.retake()
    } else {
      scanner.restart()
    }
  }

  const addManually = (
    <Button variant="secondary" onClick={() => navigate('/items/new')}>
      Add Item Manually
    </Button>
  )

  const isCameraScanning = scanner.status === 'scanning' && isCamera
  const isPaused = scanner.status === 'paused' && isCamera
  const torch = scanner.status === 'scanning' ? scanner.torch : 'unsupported'

  // Recognition results stay inside the viewfinder; full-screen results are for product lookup.
  const recognized = isCamera && scanner.status === 'recognized' ? scanner : null
  const recognizedBarcode = recognized?.barcode

  // A recognized barcode goes straight to the add form, found or not: a failed lookup still
  // leaves the barcode to keep and a form to fill in. Scan Again or Close cancels it.
  useEffect(() => {
    if (!recognizedBarcode) return
    const abort = new AbortController()
    const hold = new Promise((resolve) => setTimeout(resolve, RECOGNIZED_HOLD_MS))
    Promise.all([lookupBarcode(recognizedBarcode, abort.signal), hold])
      .then(([scan]) => {
        if (!abort.signal.aborted) navigate('/items/new', { state: { scan } })
      })
      .catch(() => {
        // Only an abort rejects, and whoever aborted has already moved on.
      })
    return () => abort.abort()
  }, [recognizedBarcode, navigate])

  const identified = ai?.status === 'identified' ? ai : null
  const identifying = ai?.status === 'identifying' ? ai : null
  let failure: { title: string; detail: string } | null = null
  if (isCamera && scanner.status === 'not-recognized') {
    failure = {
      title: 'Barcode Not Recognized',
      detail: 'Try more light, hold steady, or move a little closer.',
    }
  } else if (isCamera && scanner.status === 'error') {
    failure = { title: 'Camera Unavailable', detail: scanner.message }
  } else if (ai?.status === 'not-identified') {
    failure = {
      title: 'Unable to Identify Food',
      detail: 'Center one food item in good light and try again.',
    }
  } else if (ai?.status === 'failed') {
    failure = { title: 'Unable to Identify Food', detail: ai.message }
  } else if (ai?.status === 'error') {
    failure = { title: 'Camera Unavailable', detail: ai.message }
  }
  const hasResult = !!recognized || !!identified || !!failure
  const onRetry = isAi ? recognizer.retake : scanner.restart
  let retryLabel = 'Try Again'
  if (recognized) retryLabel = 'Scan Again'
  else if (identified) retryLabel = 'Retake Photo'

  let statusTitle = 'Starting camera…'
  let statusHint = 'Position the barcode within the frame.'
  if (isAi) {
    statusHint = 'Center one food item in the frame.'
    if (showAiWarning) {
      statusTitle = 'AI Vision (Beta)'
      statusHint = 'Confirm the notice to start the camera.'
    } else if (identifying) {
      statusTitle = 'Identifying food…'
      statusHint = 'This usually takes a few seconds.'
    } else if (ai?.status === 'ready') {
      statusTitle = 'Center one food item'
      statusHint = 'Then tap Identify Food. Each photo is one AI request.'
    }
  } else if (isPaused) {
    statusTitle = 'Scanning paused'
    statusHint = 'Tap Rescan to start the camera again.'
  } else if (scanner.status === 'scanning' && scanner.found) {
    statusTitle = 'Barcode found'
    statusHint = 'Hold steady…'
  } else if (scanner.status === 'scanning') {
    statusTitle = 'Scanning for barcode…'
    if (scanner.struggling) {
      statusHint = 'Having trouble? Try more light, hold steady, or move a little closer.'
    }
  }

  const viewfinderClasses = [
    'scan-viewfinder',
    (recognized || identified) && 'scan-viewfinder-locked',
    isAi && 'scan-viewfinder-ai',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="scan">
      <motion.div
        className="scan-camera"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <motion.button
          type="button"
          className="scan-close"
          aria-label="Close"
          onClick={() => navigate('/')}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileTap={{ scale: 0.85 }}
          transition={spring}
        >
          <XIcon />
        </motion.button>

        {isCameraScanning && torch !== 'unsupported' && (
          <motion.button
            type="button"
            className="scan-torch"
            aria-label={torch === 'on' ? 'Turn off flashlight' : 'Turn on flashlight'}
            aria-pressed={torch === 'on'}
            onClick={scanner.toggleTorch}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            whileTap={{ scale: 0.85 }}
            transition={spring}
          >
            {torch === 'on' ? <FlashlightIcon /> : <FlashlightOffIcon />}
          </motion.button>
        )}

        <div className="scan-source" role="group" aria-label="Scan with">
          <motion.button
            type="button"
            aria-pressed={!isAi}
            onClick={() => onSourceChange('barcode')}
            whileTap={tap}
            transition={spring}
          >
            Barcode
          </motion.button>
          <motion.button
            type="button"
            aria-pressed={isAi}
            onClick={() => onSourceChange('ai')}
            whileTap={tap}
            transition={spring}
          >
            <SparklesIcon />
            AI Vision <span className="scan-source-beta">(Beta)</span>
          </motion.button>
        </div>

        <motion.div
          className={viewfinderClasses}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {/* Quagga2 mounts the live <video> in here. */}
          <div ref={videoRef} className="scan-video" hidden={!isCamera || isPaused || hasResult} />
          {/* AI Vision's live preview. Only the still taken on Identify Food is uploaded. */}
          {isAi && (
            <div className="scan-video" hidden={ai?.status !== 'ready'}>
              <video ref={aiVideoRef} muted playsInline aria-hidden="true" />
            </div>
          )}
          {recognized && <ScanRecognized detail={recognized.barcode} capture={recognized.capture} />}
          {identified && (
            <ScanRecognized
              title="This is probably"
              detail={identified.food.name}
              variant="food"
              capture={identified.still}
            />
          )}
          {identifying && (
            <div className="scan-recognized">
              {identifying.still.frame && (
                <img className="scan-ai-still" src={identifying.still.frame} alt="" />
              )}
              <motion.div
                className="scan-recognized-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
              />
              <span className="scan-ai-shimmer" aria-hidden="true" />
              <div className="scan-recognized-message" role="status">
                <span className="scan-result-icon scan-ai-pending" aria-hidden="true">
                  <SparklesIcon />
                </span>
                <p className="scan-recognized-title">Identifying food…</p>
              </div>
            </div>
          )}
          {corners.map((corner) => (
            <motion.span
              key={corner.className}
              className={`scan-corner ${corner.className}`}
              initial={{ x: corner.x, y: corner.y, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.15 }}
            />
          ))}
          {failure && (
            <motion.div
              className="scan-result scan-result-danger"
              role="status"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              <motion.span
                className="scan-result-icon"
                aria-hidden="true"
                initial={{ scale: 0.5 }}
                animate={{ scale: 1 }}
                transition={spring}
              >
                <CircleAlertIcon />
              </motion.span>
              <p className="scan-result-title">{failure.title}</p>
              <p className="scan-result-detail">{failure.detail}</p>
            </motion.div>
          )}
          {!isAi && !isCameraScanning && !hasResult && (
            <motion.div
              className="scan-barcode"
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25, delay: 0.3 }}
            >
              <BarcodeIcon />
              <span>123456 789</span>
            </motion.div>
          )}
          {isAi && !hasResult && !identifying && ai?.status !== 'ready' && (
            <motion.div
              className="scan-ai-placeholder"
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25, delay: 0.3 }}
            >
              <SparklesIcon />
            </motion.div>
          )}
          {/* A CSS transform animation runs on the compositor, so Quagga's work on the main
              thread can't make it stutter. */}
          {isCameraScanning && (
            <span className="scan-line-track" aria-hidden="true">
              <span className="scan-line" />
            </span>
          )}
        </motion.div>
      </motion.div>

      <div className="scan-controls">
        <motion.div className="scan-controls-icon" {...fadeUp(CONTROLS_DELAY)}>
          {isAi ? <SparklesIcon /> : <ScanBarcodeIcon />}
        </motion.div>
        {hasResult ? (
          <>
            {identified && (
              <motion.div className="scan-controls-item" {...fadeUp(0)}>
                <Button
                  onClick={() =>
                    navigate('/items/new', { state: { photo: { food: identified.food } } })
                  }
                >
                  Add This Food
                </Button>
              </motion.div>
            )}
            {recognized && (
              <motion.div className="scan-status" role="status" {...fadeUp(0)}>
                <p className="scan-status-title">Looking up product…</p>
              </motion.div>
            )}
            <motion.div className="scan-controls-item" {...fadeUp(0)}>
              <Button variant={identified ? 'secondary' : undefined} onClick={onRetry}>
                {retryLabel}
              </Button>
            </motion.div>
          </>
        ) : isAi ? (
          <>
            <motion.div className="scan-status" role="status" {...fadeUp(CONTROLS_DELAY + 0.06)}>
              <p className="scan-status-title">{statusTitle}</p>
              <p className="scan-status-hint">{statusHint}</p>
            </motion.div>
            <motion.div className="scan-controls-item" {...fadeUp(CONTROLS_DELAY + 0.09)}>
              <Button onClick={recognizer.identify} disabled={ai?.status !== 'ready'}>
                {identifying ? 'Identifying…' : 'Identify Food'}
              </Button>
            </motion.div>
          </>
        ) : (
          <>
            <motion.div className="scan-status" role="status" {...fadeUp(CONTROLS_DELAY + 0.06)}>
              <p className="scan-status-title">{statusTitle}</p>
              <p className="scan-status-hint">{statusHint}</p>
            </motion.div>
            <motion.div className="scan-controls-item" {...fadeUp(CONTROLS_DELAY + 0.09)}>
              {isPaused ? (
                <Button onClick={scanner.restart}>Rescan</Button>
              ) : (
                <div className="scan-controls-row">
                  <Button variant="secondary" onClick={scanner.cancel}>
                    Cancel
                  </Button>
                  <Button variant="secondary" onClick={scanner.restart}>
                    Rescan
                  </Button>
                </div>
              )}
            </motion.div>
          </>
        )}
        <motion.div className="scan-controls-item" {...fadeUp(CONTROLS_DELAY + 0.12)}>
          {addManually}
        </motion.div>
      </div>

      {showAiWarning && (
        <AiDevWarning
          onCancel={() => onSourceChange('barcode')}
          onContinue={() => setAiConfirmed(true)}
        />
      )}
    </div>
  )
}
