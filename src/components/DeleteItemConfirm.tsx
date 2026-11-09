import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Button from './Button'
import { ApiError } from '../lib/api'
import { deleteInventoryItem, INVENTORY_QUERY_KEY, type InventoryItem } from '../lib/inventoryApi'
import '../styles/DeleteItemConfirm.css'

type DeleteItemConfirmProps = {
  item: InventoryItem
  onCancel: () => void
  // Called once the server has deleted the item, before the list is refreshed.
  onDeleted?: () => void
}

// Asks before deleting one of the user's items. Only their own copy goes, never the shared product.
export default function DeleteItemConfirm({ item, onCancel, onDeleted }: DeleteItemConfirmProps) {
  const queryClient = useQueryClient()
  const id = useId()
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onDelete = async () => {
    setIsDeleting(true)
    setError(null)
    try {
      await deleteInventoryItem(item.id)
    } catch (err) {
      setIsDeleting(false)
      setError((err instanceof ApiError && err.serverMessage) || "Couldn't delete your item. Please try again.")
      return
    }
    onDeleted?.()
    queryClient.setQueryData<InventoryItem[]>(INVENTORY_QUERY_KEY, (items) => items?.filter((i) => i.id !== item.id))
    queryClient.invalidateQueries({ queryKey: INVENTORY_QUERY_KEY })
  }

  return (
    <section
      className="delete-confirm"
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
    >
      <p id={`${id}-title`} className="delete-confirm-title">
        Delete {item.name}?
      </p>
      <p id={`${id}-body`}>It will be removed from your items. This can't be undone.</p>
      {error && (
        <p className="delete-confirm-error" role="alert">
          {error}
        </p>
      )}
      <Button className="delete-confirm-button" onClick={onDelete} disabled={isDeleting}>
        {isDeleting ? 'Deleting…' : 'Delete item'}
      </Button>
      <Button variant="secondary" onClick={onCancel} disabled={isDeleting}>
        Cancel
      </Button>
    </section>
  )
}
