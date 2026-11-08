/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ChevronRightIcon } from './icons'
import { spring, tap } from '../lib/motion'
import '../styles/ItemCard.css'

type ItemCardProps = {
  name: string
  expires: string
  icon: ReactNode
  tone?: 'green' | 'amber'
  // The item's picture. The icon shows while there is none and when it fails to load.
  imageSrc?: string | null
  onClick?: () => void
}

export default function ItemCard({ name, expires, icon, tone = 'green', imageSrc, onClick }: ItemCardProps) {
  // Remembered per link, so a new picture gets its own try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(imageSrc) && imageSrc !== failedSrc

  return (
    <motion.button
      type="button"
      className="item-card"
      onClick={onClick}
      whileTap={tap}
      transition={spring}
    >
      <span className={`item-card-tile item-card-tile-${tone}`}>
        {showImage ? (
          <img
            className="item-card-image"
            src={imageSrc!}
            alt=""
            loading="lazy"
            decoding="async"
            // Product images are other sites' files; don't tell them which page asked.
            referrerPolicy="no-referrer"
            onError={() => setFailedSrc(imageSrc!)}
          />
        ) : (
          icon
        )}
      </span>
      <span className="item-card-body">
        <span className="item-card-name">{name}</span>{' '}
        <span className="item-card-expires">Expires {expires}</span>
      </span>
      <ChevronRightIcon className="item-card-chevron" />
    </motion.button>
  )
}
