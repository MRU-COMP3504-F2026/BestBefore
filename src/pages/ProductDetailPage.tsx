import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { formatDate, todayIsoDate } from '../lib/dates'
import { expiryTone, useInventory, type InventoryItem } from '../lib/inventoryApi'
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

// One inventory item, read from the same cached query as the item list.
export default function ProductDetailPage() {
  const { id } = useParams()
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
    </div>
  )
}
