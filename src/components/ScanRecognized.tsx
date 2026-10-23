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
  barcode: string
  capture?: RecognitionCapture
}

/**
 * Recognition sequence shown inside the viewfinder: the outline locks onto the barcode
 * over the frozen frame, then the confirmation and the decoded number fade in.
 * Mounted only while a barcode is recognized, so unmounting cancels any pending phase.
 */
export default function ScanRecognized({ barcode, capture }: Props) {
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
              Barcode Recognized
            </motion.p>
          </>
        )}
        {reached('revealing') && (
          <motion.p
            className="scan-recognized-code"
            initial={enter({ opacity: 0, y: 8 })}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            {barcode}
          </motion.p>
        )}
      </div>
    </div>
  )
}
