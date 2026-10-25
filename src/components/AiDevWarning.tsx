/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import { motion } from 'motion/react'
import Button from './Button'

type Props = {
  onCancel: () => void
  onContinue: () => void
}

/**
 * Reminder that every AI Vision photo spends Gemini quota. Informational only: the camera
 * waits for Continue, and nothing about the dismissal is remembered.
 */
export default function AiDevWarning({ onCancel, onContinue }: Props) {
  return (
    <motion.div
      className="scan-ai-warning"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <motion.div
        className="scan-ai-warning-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="scan-ai-warning-title"
        aria-describedby="scan-ai-warning-text"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <h2 id="scan-ai-warning-title">Development Mode — AI API Usage</h2>
        <p id="scan-ai-warning-text">DEV ONLY, be mindful of API limits, test accordingly</p>
        <Button onClick={onContinue} autoFocus>
          I Understand, Continue
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </motion.div>
    </motion.div>
  )
}
