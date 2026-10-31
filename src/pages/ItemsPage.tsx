import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import InventoryList from '../components/InventoryList'
import PageHeader from '../components/PageHeader'
import { PlusIcon } from '../components/icons'
import '../styles/ItemsPage.css'

export default function ItemsPage() {
  const navigate = useNavigate()

  return (
    <div className="items">
      <PageHeader title="My Items" />

      <Button icon={<PlusIcon />} onClick={() => navigate('/items/new')}>
        Add Item
      </Button>

      <InventoryList className="items-list" />
      
      
    </div>
  )
}
