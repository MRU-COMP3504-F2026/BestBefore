import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import InventoryList from '../components/InventoryList'
import PageHeader from '../components/PageHeader'
import { PlusIcon } from '../components/icons'
import '../styles/ItemsPage.css'
import { useEffect } from 'react'

export default function ItemsPage() {
  useEffect(() => {
    document.title = 'BestBefore | My Inventory'
  }, [])
  const navigate = useNavigate()

  return (
    <div className="items">
      <PageHeader title="My Items" />

      {/* Adding starts at the scanner, which keeps its own link to the manual form. */}
      <Button icon={<PlusIcon />} onClick={() => navigate('/scan')}>
        Add Item
      </Button>

      <InventoryList className="items-list" removeExpired />
      
      
    </div>
  )
}
