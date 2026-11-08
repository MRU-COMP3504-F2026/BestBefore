import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '../components/Button'
import PageHeader from '../components/PageHeader'
import { categoryIcon } from '../lib/categoryIcon'
import { formatDate, todayIsoDate } from '../lib/dates'
import { expiryTone, useInventory, type InventoryItem } from '../lib/inventoryApi'
import { useItemImageSrc } from '../lib/useItemImage'
import '../styles/InventoryList.css'
import '../styles/ProductDetailPage.css'

function expiryLabel(bestBefore: string): string {
  if (bestBefore < todayIsoDate()) return 'Expired'
  return expiryTone(bestBefore) === 'amber' ? 'Expiring soon' : 'Fresh'
}

function detailRows(item: InventoryItem): [string, string][] {
  return [
    ['Purchased', formatDate(item.purchaseDate)],
    ['Quantity', item.unit ? `${item.quantity} ${item.unit}` : String(item.quantity)],
    ['Category', item.category ?? '—'],
    ['Brand', item.brand ?? '—'],
    ['Barcode', item.barcode ?? '—'],
    ['Added', formatDate(item.createdAt.slice(0, 10))],
  ]
}

// The item's own picture: the product image link, or the AI Vision still fetched with the token.
// Its category icon shows while there is none and when it fails to load.
function ItemImage({ item }: { item: InventoryItem }) {
  const src = useItemImageSrc(item)
  // Remembered per link, so a new picture gets its own try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const tone = expiryTone(item.bestBefore)

  return (
    <figure className={`product-detail-image product-detail-image-${tone}`}>
      {src && src !== failedSrc ? (
        <img
          src={src}
          alt={item.imageSource === 'photo' ? 'Your photo' : 'Product'}
          decoding="async"
          // Product images are other sites' files; don't tell them which page asked.
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span className="product-detail-image-icon">{categoryIcon(item.category)}</span>
      )}
    </figure>
  )
}

// One inventory item, read from the same cached query as the item list.
export default function ProductDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, isPending, isError } = useInventory()
  const item = data?.find((i) => i.id === Number(id))

  useEffect(() => {
    document.title = `BestBefore | ${item?.name ?? 'Item'}`
  }, [item?.name])

  if (isPending) {
    return <p className="inventory-status">Loading item…</p>
  }
  if (isError) {
    return (
      <p className="inventory-status inventory-status-error" role="alert">
        Couldn't load this item. Please try again.
      </p>
    )
  }
  if (!item) {
    return (
      <div className="product-detail">
        <PageHeader title="Item not found" backTo="/items" />
        <p className="inventory-status">This item may have been removed.</p>
      </div>
    )
  }

  const tone = expiryTone(item.bestBefore)

  return (
    <div className="product-detail">
      <PageHeader title={item.name} backTo="/items" />

      <ItemImage item={item} />

      <section className={`product-detail-expiry product-detail-expiry-${tone}`}>
        <span className="product-detail-expiry-label">{expiryLabel(item.bestBefore)}</span>
        <span className="product-detail-expiry-date">Best before {formatDate(item.bestBefore)}</span>
      </section>

      <dl className="product-detail-list">
        {detailRows(item).map(([label, value]) => (
          <div key={label} className="product-detail-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <Button variant="secondary" onClick={() => navigate(`/items/${item.id}/edit`)}>
        Edit
      </Button>
    </div>
  )
}
