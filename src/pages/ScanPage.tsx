/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import Button from '../components/Button'
import StatusView from '../components/StatusView'
import { BarcodeIcon, ScanBarcodeIcon, XIcon } from '../components/icons'
import { mockScan, type ScanOutcome } from '../lib/mockScan'
import { useBarcodeScanner } from '../lib/useBarcodeScanner'
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

// The scanner mode toggle shows locally and on Vercel preview deploys, never in production.
// Vercel exposes VITE_VERCEL_ENV to Vite builds automatically.
const SHOW_DEV_TOGGLE = import.meta.env.DEV || import.meta.env.VITE_VERCEL_ENV === 'preview'

type ScanMode = 'camera' | ScanOutcome

const MODES: { mode: ScanMode; label: string }[] = [
  { mode: 'camera', label: 'Camera' },
  { mode: 'success', label: 'Mock success' },
  { mode: 'failure', label: 'Mock fail' },
]

export default function ScanPage() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<ScanMode>('camera')
  const [isMockScanning, setIsMockScanning] = useState(false)
  const isCamera = mode === 'camera'
  const scanner = useBarcodeScanner(videoRef, isCamera)

  const onMockScan = async () => {
    if (isCamera) return
    setIsMockScanning(true)
    const result = await mockScan(mode)
    if (result.ok) {
      navigate('/scan/added', { state: { product: result.product } })
    } else {
      navigate('/scan/failed')
    }
  }

  const onModeChange = (next: ScanMode) => {
    setMode(next)
    if (next === 'camera') scanner.restart()
  }

  const addManually = (
    <Button
      variant="secondary"
      disabled={isMockScanning}
      onClick={() => navigate('/items/new')}
    >
      Add Item Manually
    </Button>
  )

  if (isCamera && scanner.status === 'recognized') {
    return (
      <div className="scan-result">
        <StatusView
          tone="success"
          title="Barcode Recognized"
          subtitle={scanner.barcode}
          actions={
            <>
              <Button onClick={scanner.restart}>Scan Again</Button>
              {addManually}
            </>
          }
        />
      </div>
    )
  }

  if (isCamera && scanner.status === 'error') {
    return (
      <div className="scan-result">
        <StatusView
          tone="danger"
          title="Couldn't start the camera"
          caption={scanner.message}
          actions={
            <>
              <Button onClick={scanner.restart}>Try Again</Button>
              {addManually}
            </>
          }
        />
      </div>
    )
  }

  const isCameraScanning = isCamera && scanner.status === 'scanning'

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

        <motion.div
          className="scan-viewfinder"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {/* Quagga2 mounts the live <video> in here. */}
          <div ref={videoRef} className="scan-video" hidden={!isCamera} />
          {corners.map((corner) => (
            <motion.span
              key={corner.className}
              className={`scan-corner ${corner.className}`}
              initial={{ x: corner.x, y: corner.y, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.15 }}
            />
          ))}
          {!isCameraScanning && (
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
          {(isCameraScanning || isMockScanning) && (
            <motion.span
              className="scan-line"
              aria-hidden="true"
              initial={{ top: '8%' }}
              animate={{ top: ['8%', '92%', '8%'] }}
              transition={{ duration: 1.2, ease: 'easeInOut', repeat: Infinity }}
            />
          )}
        </motion.div>
      </motion.div>

      <div className="scan-controls">
        <motion.div className="scan-controls-icon" {...fadeUp(CONTROLS_DELAY)}>
          <ScanBarcodeIcon />
        </motion.div>
        {isCamera ? (
          <motion.div className="scan-status" role="status" {...fadeUp(CONTROLS_DELAY + 0.06)}>
            <p className="scan-status-title">
              {isCameraScanning ? 'Scanning for barcode…' : 'Starting camera…'}
            </p>
            <p className="scan-status-hint">Position the barcode within the frame.</p>
          </motion.div>
        ) : (
          <motion.div className="scan-controls-item" {...fadeUp(CONTROLS_DELAY + 0.06)}>
            <Button onClick={onMockScan} disabled={isMockScanning}>
              {isMockScanning ? 'Scanning…' : 'Scan'}
            </Button>
          </motion.div>
        )}
        <motion.div className="scan-controls-item" {...fadeUp(CONTROLS_DELAY + 0.12)}>
          {addManually}
        </motion.div>

        {SHOW_DEV_TOGGLE && (
          <motion.div
            className="scan-dev"
            role="group"
            aria-label="Scanner mode"
            {...fadeUp(CONTROLS_DELAY + 0.18)}
          >
            <span>Scanner:</span>
            {MODES.map(({ mode: option, label }) => (
              <motion.button
                key={option}
                type="button"
                aria-pressed={mode === option}
                disabled={isMockScanning}
                onClick={() => onModeChange(option)}
                whileTap={tap}
                transition={spring}
              >
                {label}
              </motion.button>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  )
}
