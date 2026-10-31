/*
 * Animations: Motion (https://motion.dev), v14.3.0
 * License: MIT (https://github.com/motiondivision/motion/blob/main/LICENSE.md)
 * Copyright (c) 2024 Motion B.V.
 */
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import ItemCard from './ItemCard'
import { BasketIcon, LeafIcon, MilkIcon } from './icons'
import { formatDate } from '../lib/dates'
import { expiryTone, useInventory } from '../lib/inventoryApi'
import { listItem } from '../lib/motion'
import '../styles/InventoryList.css'

type InventoryListProps = {
  className?: string
  // Show only the first `limit` items (they arrive soonest-expiring first).
  limit?: number
}

function categoryIcon(category: string | null): ReactNode {
  switch (category?.toLowerCase()) {
    case 'dairy':
      return <MilkIcon />
    case 'produce':
      return <LeafIcon />
    default:
      return <BasketIcon />
  }
}

// The signed-in user's inventory as item cards, with loading, error and empty states.
export default function InventoryList({ className, limit }: InventoryListProps) {
  const { data, isPending, isError } = useInventory()
  const navigate = useNavigate();

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
        <motion.li key={item.id} {...listItem(index)}>
          <ItemCard
            name={item.name}
            expires={formatDate(item.bestBefore)}
            icon={categoryIcon(item.category)}
            tone={expiryTone(item.bestBefore)}
            onClick={() => navigate(`/items/${item.id}`)}
          />
        </motion.li>
      ))}
    </ul>
  )
}
