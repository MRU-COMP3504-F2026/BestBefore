import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import StatusView from '../components/StatusView'
import { useEffect } from 'react'

// Only ever set from the row the server returned, so this page can't claim a save that failed.
type AddedState = {
  product?: { name: string; expires: string }
  source?: 'scan' | 'manual'
} | null

export default function ScanAddedPage() {
  useEffect(() => {
    document.title = 'BestBefore | Item Added'
  }, [])
  const navigate = useNavigate()
  const state = useLocation().state as AddedState
  const product = state?.product
  const isManual = state?.source === 'manual'

  if (!product) {
    return <Navigate to="/scan" replace />
  }

  return (
    <StatusView
      tone="success"
      title="Item Added!"
      subtitle={product.name}
      caption={`Expires ${product.expires}`}
      actions={
        <>
          <Button onClick={() => navigate('/items')}>View My Items</Button>
          <Button
            variant="secondary"
            onClick={() => navigate(isManual ? '/items/new' : '/scan')}
          >
            {isManual ? 'Add Another' : 'Scan Another'}
          </Button>
        </>
      }
    />
  )
}
