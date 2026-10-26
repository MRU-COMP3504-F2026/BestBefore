/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { CheckIcon } from './icons'
import {
  RECOGNITION_PHASE_AT,
  RECOGNITION_PHASES,
  spring,
  type RecognitionPhase,
} from '../lib/motion'
import type { RecognitionCapture } from '../lib/useBarcodeScanner'

type Props = {
  // Defaults match a barcode read; AI Vision passes its own wording.
  title?: string
  detail: string
  variant?: 'barcode' | 'food'
  capture?: RecognitionCapture
}

/**
 * Recognition sequence shown inside the viewfinder: over the frozen frame, the region Quagga
 * located and the line where it read the bars lock on (matching the live overlay), then
 * the confirmation and the decoded number (or the identified food) fade in.
 * Mounted only while a result is shown, so unmounting cancels any pending phase.
 */
export default function ScanRecognized({
  title = 'Barcode Recognized',
  detail,
  variant = 'barcode',
  capture,
}: Props) {
  const reduceMotion = useReducedMotion()
  const [phase, setPhase] = useState<RecognitionPhase>('locking_on')

  useEffect(() => {
    if (reduceMotion) return
    const timers = Object.entries(RECOGNITION_PHASE_AT).map(([next, at]) =>
      setTimeout(() => setPhase(next as RecognitionPhase), at),
    )
    return () => timers.forEach(clearTimeout)
  }, [reduceMotion])

  // Reduced motion skips straight to the final state.
  const shown = reduceMotion ? 'recognized' : phase
  const reached = (p: RecognitionPhase) =>
    RECOGNITION_PHASES.indexOf(shown) >= RECOGNITION_PHASES.indexOf(p)
  const enter = <T,>(from: T) => (reduceMotion ? false : from)

  return (
    <div className="scan-recognized" data-phase={shown}>
      {capture && (
        <svg
          className="scan-recognized-frame"
          viewBox={`0 0 ${capture.width} ${capture.height}`}
          // "slice" crops like the video's object-fit: cover, so the box lines up with the frame.
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          {capture.frame && (
            <image href={capture.frame} width={capture.width} height={capture.height} />
          )}
          {capture.box && (
            <motion.polygon
              className="scan-recognized-box"
              points={capture.box.map((point) => point.join(',')).join(' ')}
              vectorEffect="non-scaling-stroke"
              initial={enter({ opacity: 0, scale: 1.15 })}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring}
            />
          )}
          {capture.line && (
            <motion.line
              className="scan-recognized-line"
              x1={capture.line[0][0]}
              y1={capture.line[0][1]}
              x2={capture.line[1][0]}
              y2={capture.line[1][1]}
              vectorEffect="non-scaling-stroke"
              initial={enter({ opacity: 0 })}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
            />
          )}
        </svg>
      )}

      {reached('confirming') && (
        <motion.div
          className="scan-recognized-scrim"
          initial={enter({ opacity: 0 })}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        />
      )}

      <div className="scan-recognized-message" role="status">
        {reached('confirming') && (
          <>
            <motion.span
              className="scan-result-icon"
              aria-hidden="true"
              initial={enter({ opacity: 0, scale: 0.5 })}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring}
            >
              <CheckIcon />
            </motion.span>
            <motion.p
              className="scan-recognized-title"
              initial={enter({ opacity: 0 })}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              {title}
            </motion.p>
          </>
        )}
        {reached('revealing') && (
          <motion.p
            className={variant === 'food' ? 'scan-recognized-food' : 'scan-recognized-code'}
            initial={enter({ opacity: 0, y: 8 })}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            {detail}
          </motion.p>
        )}
      </div>
    </div>
  )
}
