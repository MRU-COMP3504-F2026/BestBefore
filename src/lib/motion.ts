/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import type { Transition } from 'motion/react'

// Shared animation presets so every component moves the same way.

export const spring: Transition = { type: 'spring', stiffness: 500, damping: 30 }

export const tap = { scale: 0.97 }

export function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: 'easeOut', delay } satisfies Transition,
  }
}

export function listItem(index: number) {
  return fadeUp(index * 0.05)
}

// Barcode recognition presentation, in order. Only paces what the scanner shows:
// the barcode is already stored and the camera released by the time it runs.
export type RecognitionPhase = 'locking_on' | 'confirming' | 'revealing' | 'recognized'

export const RECOGNITION_PHASES: RecognitionPhase[] = [
  'locking_on',
  'confirming',
  'revealing',
  'recognized',
]

// When each phase starts, in ms after recognition.
export const RECOGNITION_PHASE_AT: Record<Exclude<RecognitionPhase, 'locking_on'>, number> = {
  confirming: 200,
  revealing: 500,
  recognized: 850,
}

export const errorReveal = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 } satisfies Transition,
}
