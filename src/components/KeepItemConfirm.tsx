import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Button from './Button'
import { ApiError } from '../lib/api'
import { addDays, formatDate, todayIsoDate } from '../lib/dates'
import { INVENTORY_QUERY_KEY, keepInventoryItem, type InventoryItem } from '../lib/inventoryApi'
import '../styles/KeepItemConfirm.css'

// how many days ahead the reminder date starts at
const DEFAULT_REMINDER_DAYS = 3

type KeepItemConfirmProps = {
  item: InventoryItem
  onCancel: () => void
  // called once the server has saved the reminder, before the list is refreshed
  onKept?: () => void
}

// Lets the user keep an expired item and pick a later day to be asked about it again
export default function KeepItemConfirm({ item, onCancel, onKept }: KeepItemConfirmProps) {
  const queryClient = useQueryClient()
  const id = useId()
  const tomorrow = addDays(todayIsoDate(), 1)
  const [reminderDate, setReminderDate] = useState(() => addDays(todayIsoDate(), DEFAULT_REMINDER_DAYS))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onKeep = async () => {
    // Empty when the field is cleared. ISO dates compare correctly as strings.
    if (reminderDate < tomorrow) {
      setError('Choose a reminder date after today.')
      return
    }
    setIsSaving(true)
    setError(null)
    let saved: InventoryItem
    try {
      saved = await keepInventoryItem(item.id, reminderDate)
    } catch (err) {
      setIsSaving(false)
      setError((err instanceof ApiError && err.serverMessage) || "Couldn't save your reminder. Please try again.")
      return
    }
    setIsSaving(false)
    onKept?.()
    queryClient.setQueryData<InventoryItem[]>(INVENTORY_QUERY_KEY, (items) =>
      items?.map((i) => (i.id === saved.id ? saved : i)),
    )
    queryClient.invalidateQueries({ queryKey: INVENTORY_QUERY_KEY })
  }

  return (
    <section className="keep-confirm" role="group" aria-labelledby={`${id}-title`}>
      <p id={`${id}-title`} className="keep-confirm-title">
        Keep {item.name}?
      </p>
      <p>Its best-before date stays {formatDate(item.bestBefore)}. We'll ask about it again on the day you pick.</p>
      <label className="keep-confirm-label" htmlFor={`${id}-date`}>
        Remind me on
      </label>
      <input
        id={`${id}-date`}
        className="keep-confirm-date"
        type="date"
        value={reminderDate}
        min={tomorrow}
        disabled={isSaving}
        onChange={(event) => setReminderDate(event.target.value)}
      />
      {error && (
        <p className="keep-confirm-error" role="alert">
          {error}
        </p>
      )}
      <Button onClick={onKeep} disabled={isSaving}>
        {isSaving ? 'Saving…' : 'Keep item'}
      </Button>
      <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
        Cancel
      </Button>
    </section>
  )
}