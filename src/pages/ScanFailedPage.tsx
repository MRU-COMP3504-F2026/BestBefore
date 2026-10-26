import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import StatusView from '../components/StatusView'
import { useEffect } from 'react'

export default function ScanFailedPage() {
  useEffect(() => {
    document.title = 'BestBefore | Scan Failed'
  }, [])
  const navigate = useNavigate()

  return (
    <StatusView
      tone="danger"
      title="Couldn't read the barcode"
      actions={
        <>
          <Button onClick={() => navigate('/scan')}>Retake Scan</Button>
          <Button variant="secondary" onClick={() => navigate('/items/new')}>
            Add Item Manually
          </Button>
        </>
      }
    />
  )
}
