/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import DeleteItemConfirm from './DeleteItemConfirm'
import ItemCard from './ItemCard'
import { categoryIcon } from '../lib/categoryIcon'
import { formatDate } from '../lib/dates'
import { expiryTone, useInventory, type InventoryItem } from '../lib/inventoryApi'
import { listItem } from '../lib/motion'
import { useItemImageSrc } from '../lib/useItemImage'
import '../styles/InventoryList.css'

type InventoryListProps = {
  className?: string
  // Show only the first `limit` items (they arrive soonest-expiring first).
  limit?: number
  // Offer a Remove action on cards whose best-before date has passed.
  removeExpired?: boolean
}

function InventoryItemCard({ item, removeExpired }: { item: InventoryItem; removeExpired: boolean }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const tone = expiryTone(item.bestBefore)
  const card = (
    <ItemCard
      name={item.name}
      expires={formatDate(item.bestBefore)}
      icon={categoryIcon(item.category)}
      tone={tone}
      imageSrc={useItemImageSrc(item)}
      onClick={() => navigate(`/items/${item.id}`)}
    />
  )

  if (!removeExpired || tone !== 'red') return card

  return (
    <>
      <div className="inventory-list-row">
        {card}
        {!confirming && (
          <button
            type="button"
            className="inventory-remove"
            aria-label={`Remove ${item.name}`}
            onClick={() => setConfirming(true)}
          >
            Remove
          </button>
        )}
      </div>
      {confirming && <DeleteItemConfirm item={item} onCancel={() => setConfirming(false)} />}
    </>
  )
}

// The signed-in user's inventory as item cards, with loading, error and empty states.
export default function InventoryList({ className, limit, removeExpired = false }: InventoryListProps) {
  const { data, isPending, isError } = useInventory()

  if (isPending) {
    return <p className="inventory-status">Loading your items…</p>
  }
  if (isError) {
    return (
      <p className="inventory-status inventory-status-error" role="alert">
        Couldn't load your items. Please try again.
      </p>
    )
  }
  if (data.length === 0) {
    return <p className="inventory-status">No items yet. Add one to start tracking it.</p>
  }

  const items = limit === undefined ? data : data.slice(0, limit)
 

  return (
    <ul className={className}>
      {items.map((item, index) => (
        <motion.li key={item.id} className="inventory-list-item" {...listItem(index)}>
          <InventoryItemCard item={item} removeExpired={removeExpired} />
        </motion.li>
      ))}
    </ul>
  )
}
