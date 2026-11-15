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
  // A filtered/sorted view of the inventory to show instead of the full list.
  data?: InventoryItem[]
  // Changing this replays the list's entry animation (e.g. on a new filter or sort).
  activeFilter?: string
}

function InventoryItemCard({ item, removeExpired }: { item: InventoryItem; removeExpired: boolean }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const tone = expiryTone(item.bestBefore)
  
  const imageSrc = useItemImageSrc(item)

  const card = (
    <ItemCard
      name={item.name}
      expires={formatDate(item.bestBefore)}
      icon={categoryIcon(item.category)}
      tone={tone}
      imageSrc={imageSrc}
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
export default function InventoryList({ className, limit, removeExpired = false, data, activeFilter }: InventoryListProps) {
  const inventory = useInventory()

  if (inventory.isPending) {
    return <p className="inventory-status">Loading your items…</p>
  }
  if (inventory.isError) {
    return (
      <p className="inventory-status inventory-status-error" role="alert">
        Couldn't load your items. Please try again.
      </p>
    )
  }
  if (inventory.data.length === 0) {
    return <p className="inventory-status">No items yet. Add one to start tracking it.</p>
  }

  const shown = data ?? inventory.data
  if (shown.length === 0) {
    return <p className="inventory-status">No items match this view.</p>
  }
  const items = limit === undefined ? shown : shown.slice(0, limit)

  return (
    <motion.ul className={className} key={activeFilter}>
      {items.map((item, index) => (
        <motion.li key={item.id} className="inventory-list-item" layout {...listItem(index)}>
          <InventoryItemCard item={item} removeExpired={removeExpired} />
        </motion.li>
      ))}
    </motion.ul>
  )
}
