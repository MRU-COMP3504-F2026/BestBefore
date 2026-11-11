import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import DeleteItemConfirm from './DeleteItemConfirm'
import ItemCard from './ItemCard'
import { categoryIcon } from '../lib/categoryIcon'
import { formatDate } from '../lib/dates'
import { expiryTone, type InventoryItem } from '../lib/inventoryApi'
import { listItem } from '../lib/motion'
import { useItemImageSrc } from '../lib/useItemImage'
import '../styles/InventoryList.css'

type InventoryListProps = {
  className?: string
  removeExpired?: boolean
  data: InventoryItem[] 
  activeFilter: string 
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

export default function InventoryList({ className, removeExpired = false, data = [], activeFilter }: InventoryListProps)  {
  return (
    <motion.ul className={className} key={activeFilter}>
      {data.map((item, index) => (
        <motion.li key={item.id} className="inventory-list-item" layout {...listItem(index)}>
          <InventoryItemCard item={item} removeExpired={removeExpired} />
        </motion.li>
      ))}
    </motion.ul>
  )
}