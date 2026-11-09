import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '../components/Button'
import ExpirySuggestionCard from '../components/ExpirySuggestionCard'
import PageHeader from '../components/PageHeader'
import TextField from '../components/TextField'
import { ApiError } from '../lib/api'
import { CATEGORIES } from '../lib/categories'
import { formatDate } from '../lib/dates'
import {
  fetchItemExpirySuggestion,
  INVENTORY_QUERY_KEY,
  updateInventoryItem,
  useInventory,
  type InventoryItem,
} from '../lib/inventoryApi'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { SUGGESTION_DEBOUNCE_MS } from './AddItemPage'
import '../styles/AddItemPage.css'
import '../styles/InventoryList.css'
import { useEffect, useId, useState } from 'react'

const editItemSchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required'),
    brand: z.string().trim().optional(),
    category: z.string().optional(),
    quantity: z
      .number({ error: 'Quantity is required' })
      .int('Quantity must be a whole number')
      .min(1, 'Quantity must be at least 1'),
    purchaseDate: z.string().min(1, 'Date bought is required'),
    bestBefore: z.string().min(1, 'Best before date is required'),
  })
  // ISO dates (YYYY-MM-DD) compare correctly as strings.
  .refine((values) => !values.purchaseDate || values.bestBefore >= values.purchaseDate, {
    message: 'You should probably not be eating this',
    path: ['bestBefore'],
  })

type EditItemValues = z.infer<typeof editItemSchema>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// The form for one loaded item. Only the user's own copy is saved; the barcode and picture stay.
function EditItemForm({ item }: { item: InventoryItem }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const backTo = `/items/${item.id}`
  const [saveError, setSaveError] = useState<string | null>(null)
  const [acceptedDate, setAcceptedDate] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EditItemValues>({
    resolver: zodResolver(editItemSchema),
    defaultValues: {
      name: item.name,
      brand: item.brand ?? '',
      category: item.category ?? '',
      quantity: item.quantity,
      purchaseDate: item.purchaseDate,
      bestBefore: item.bestBefore,
    },
  })

  const [purchaseDate, bestBefore] = useWatch({ control, name: ['purchaseDate', 'bestBefore'] })
  // A saved label that isn't one of ours stays choosable rather than lost.
  const categoryOptions =
    item.category && !CATEGORIES.includes(item.category) ? [...CATEGORIES, item.category] : CATEGORIES
  const categoryId = useId()

  // Only a new date bought asks for a suggestion, counted from the shelf life already saved.
  const purchaseDateChanged = ISO_DATE.test(purchaseDate) && purchaseDate !== item.purchaseDate
  const settledDate = useDebouncedValue(purchaseDate, SUGGESTION_DEBOUNCE_MS)
  const suggestion = useQuery({
    queryKey: ['item-expiry-suggestion', item.id, settledDate],
    queryFn: ({ signal }) => fetchItemExpirySuggestion(item.id, settledDate, signal),
    enabled: purchaseDateChanged && settledDate === purchaseDate,
    retry: false,
    staleTime: Infinity,
  })

  const acceptSuggestion = (date: string) => {
    setValue('bestBefore', date, { shouldValidate: true, shouldDirty: true })
    setAcceptedDate(date)
  }

  // An accepted date was counted from the old date bought, so it goes back to the saved one. A date
  // the user typed is theirs and stays.
  const onPurchaseDateChange = () => {
    if (acceptedDate && getValues('bestBefore') === acceptedDate) {
      setValue('bestBefore', item.bestBefore, { shouldDirty: true })
    }
    setAcceptedDate(null)
  }

  const onSubmit = async (values: EditItemValues) => {
    setSaveError(null)
    try {
      const saved = await updateInventoryItem(item.id, {
        name: values.name,
        brand: values.brand || null,
        category: values.category || null,
        quantity: values.quantity,
        purchaseDate: values.purchaseDate,
        bestBefore: values.bestBefore,
      })
      queryClient.setQueryData<InventoryItem[]>(INVENTORY_QUERY_KEY, (items) =>
        items?.map((i) => (i.id === saved.id ? saved : i)),
      )
      queryClient.invalidateQueries({ queryKey: INVENTORY_QUERY_KEY })
      navigate(backTo)
    } catch (err) {
      setSaveError(
        (err instanceof ApiError && err.serverMessage) || "Couldn't save your changes. Please try again.",
      )
    }
  }

  return (
    <form className="add-item-form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <p className="add-item-required-note">
        <span aria-hidden="true">*</span> Required
      </p>

      <TextField
        label="Product name"
        required
        disabled={isSubmitting}
        error={errors.name?.message}
        {...register('name')}
      />

      <TextField
        label="Brand"
        tag="Optional"
        disabled={isSubmitting}
        error={errors.brand?.message}
        {...register('brand')}
      />

      {item.barcode && (
        <TextField label="Barcode" hint="Saved with the item. Can't be changed here." value={item.barcode} disabled readOnly />
      )}

      <div className="text-field">
        <div className="text-field-label-row">
          <label htmlFor={categoryId}>
            Category
            <span className="text-field-tag text-field-tag-optional">Optional</span>
          </label>
        </div>
        <div className="text-field-input">
          <select id={categoryId} disabled={isSubmitting} {...register('category')}>
            <option value="">Not sure</option>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <TextField
        label="Quantity"
        required
        type="number"
        min={1}
        step={1}
        disabled={isSubmitting}
        error={errors.quantity?.message}
        {...register('quantity', { valueAsNumber: true })}
      />

      <TextField
        label="Date bought"
        required
        type="date"
        disabled={isSubmitting}
        error={errors.purchaseDate?.message}
        {...register('purchaseDate', { onChange: onPurchaseDateChange })}
      />

      <TextField
        label="Best before date"
        required
        type="date"
        disabled={isSubmitting}
        error={errors.bestBefore?.message}
        {...register('bestBefore')}
      />

      {purchaseDateChanged && bestBefore === item.bestBefore && (
        <p className="add-item-notice" role="status">
          The best before date is still {formatDate(item.bestBefore)}. Use the suggestion or change it
          yourself if it should move.
        </p>
      )}

      {purchaseDateChanged && (
        <ExpirySuggestionCard
          isLoading={settledDate !== purchaseDate || suggestion.isPending}
          isError={suggestion.isError}
          suggestion={suggestion.data}
          acceptedDate={bestBefore === acceptedDate ? acceptedDate : null}
          disabled={isSubmitting}
          onAccept={acceptSuggestion}
        />
      )}

      {saveError && (
        <p className="add-item-error" role="alert">
          {saveError}
        </p>
      )}

      <div className="add-item-actions">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save Changes'}
        </Button>
        <Button variant="secondary" disabled={isSubmitting} onClick={() => navigate(backTo)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// Edits one of the signed-in user's items, read from the same cached query as the item list.
export default function EditItemPage() {
  const { id } = useParams()
  const { data, isPending, isError } = useInventory()
  const item = data?.find((i) => i.id === Number(id))

  useEffect(() => {
    document.title = 'BestBefore | Edit Item'
  }, [])

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
      <div className="add-item">
        <PageHeader title="Item not found" backTo="/items" />
        <p className="inventory-status">This item may have been removed.</p>
      </div>
    )
  }

  return (
    <div className="add-item">
      <PageHeader title="Edit Item" backTo={`/items/${item.id}`} />
      <EditItemForm key={item.id} item={item} />
    </div>
  )
}
