import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import InventoryList from '../components/InventoryList'
import ProfileButton from '../components/ProfileButton'
import { BasketIcon, ScanBarcodeIcon } from '../components/icons'
import '../styles/HomePage.css'
import { useEffect } from 'react'

// Home previews only the soonest-expiring items; My Items shows them all.
const HOME_ITEM_LIMIT = 3

export default function HomePage() {
  useEffect(() => {
    document.title = 'BestBefore | Home'
  }, [])

  const navigate = useNavigate()

  return (
    <div className="home">
      <header className="home-header">
        <h1 className="home-wordmark">BestBefore</h1>
        <ProfileButton onClick={() => navigate('/profile')} />
      </header>

      {/* The greeting and Scan share one panel: the screen's starting point. */}
      <div className="home-start">
        <section className="home-hero">
          <h2 className="home-greeting">Good Morning!</h2>
          <BasketIcon className="home-basket" />
        </section>

        <Button icon={<ScanBarcodeIcon />} onClick={() => navigate('/scan')}>
          Scan Barcode
        </Button>
      </div>

      <section className="home-items">
        <h2 className="home-section-title">My Items</h2>
        <InventoryList className="home-item-list" limit={HOME_ITEM_LIMIT} />
      </section>
    </div>
  )
}