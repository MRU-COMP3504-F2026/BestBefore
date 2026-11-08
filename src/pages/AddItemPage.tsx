import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useLocation, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import ExpirySuggestionCard from '../components/ExpirySuggestionCard'
import PageHeader from '../components/PageHeader'
import TextField from '../components/TextField'
import { ApiError } from '../lib/api'
import { useAuthSession } from '../lib/authClient'
import { CATEGORIES } from '../lib/categories'
import { formatDate, todayIsoDate } from '../lib/dates'
import { fetchExpirySuggestion, type ExpiryRequest, type ScanHandoff } from '../lib/foodApi'
import { addInventoryItem, INVENTORY_QUERY_KEY } from '../lib/inventoryApi'
import { rememberShelfLife, suggestionFromSession } from '../lib/shelfLifeSession'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import '../styles/AddItemPage.css'
import { useEffect, useId, useMemo, useState } from 'react'

const addItemSchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required'),
    brand: z.string().trim().optional(),
    barcode: z.string().trim().optional(),
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

type AddItemValues = z.infer<typeof addItemSchema>

// Typing in a prefilled field shouldn't ask for a new suggestion on every key.
export const SUGGESTION_DEBOUNCE_MS = 400

export default function AddItemPage() {
  useEffect(() => {
    document.title = 'BestBefore | Add Item'
  }, [])
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const userId = useAuthSession().data?.user.id
  // Set only when the scanner sent us here. Reload keeps it, so a lookup isn't spent twice.
  const scan = (useLocation().state as { scan?: ScanHandoff } | null)?.scan ?? null
  const product = scan?.product ?? null
  const leaveTo = scan ? '/scan' : '/items'
  const [saveError, setSaveError] = useState<string | null>(null)
  const [acceptedDate, setAcceptedDate] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AddItemValues>({
    resolver: zodResolver(addItemSchema),
    defaultValues: {
      name: product?.name ?? '',
      brand: product?.brand ?? '',
      barcode: product?.barcode ?? scan?.barcode ?? '',
      category: scan?.category ?? '',
      // Always a count of items. The product's own quantity is the package size.
      quantity: 1,
      purchaseDate: todayIsoDate(),
    },
  })

  const [name, brand, barcode, categoryValue, purchaseDate, bestBefore] = useWatch({
    control,
    name: ['name', 'brand', 'barcode', 'category', 'purchaseDate', 'bestBefore'],
  })
  const category = categoryValue || null
  // A scan can hand over a label that isn't one of ours. Keep it choosable rather than lose it.
  const categoryOptions =
    scan?.category && !CATEGORIES.includes(scan.category) ? [...CATEGORIES, scan.category] : CATEGORIES
  const categoryId = useId()
  const productCategory = product?.category ?? null
  const request = useMemo<ExpiryRequest>(
    () => ({
      name: name.trim(),
      brand: brand?.trim() || null,
      barcode: barcode?.trim() || null,
      category,
      productCategory,
      purchaseDate,
    }),
    [name, brand, barcode, category, productCategory, purchaseDate],
  )
  const settledRequest = useDebouncedValue(request, SUGGESTION_DEBOUNCE_MS)
  const isSettled = settledRequest === request
  const suggestion = useQuery({
    queryKey: ['expiry-suggestion', settledRequest],
    queryFn: async ({ signal }) => {
      const answer = await fetchExpirySuggestion(settledRequest, signal)
      if (answer.status === 'suggested' && answer.shelfLife) {
        rememberShelfLife(userId, settledRequest, answer.shelfLife)
      }
      return answer
    },
    enabled:
      Boolean(scan && settledRequest.name && settledRequest.purchaseDate) &&
      !suggestionFromSession(userId, settledRequest),
    retry: false,
    staleTime: Infinity,
  })
  const wantsSuggestion = Boolean(scan && request.name && request.purchaseDate)
  // Read again once an answer arrives, since that is what fills the session.
  const localSuggestion = useMemo(
    () => (scan ? suggestionFromSession(userId, request) : null),
    [scan, userId, request, suggestion.data], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const acceptSuggestion = (date: string) => {
    setValue('bestBefore', date, { shouldValidate: true, shouldDirty: true })
    setAcceptedDate(date)
  }

  // A suggestion is counted from the date bought, so an accepted date dies with it. A date the
  // user typed is theirs and stays.
  const onPurchaseDateChange = () => {
    if (acceptedDate && getValues('bestBefore') === acceptedDate) {
      setValue('bestBefore', '', { shouldDirty: true })
    }
    setAcceptedDate(null)
  }

  const onSubmit = async (values: AddItemValues) => {
    setSaveError(null)
    try {
      const item = await addInventoryItem({
        name: values.name,
        brand: values.brand || null,
        barcode: values.barcode || null,
        category: values.category || null,
        quantity: values.quantity,
        purchaseDate: values.purchaseDate,
        bestBefore: values.bestBefore,
      })
      queryClient.invalidateQueries({ queryKey: INVENTORY_QUERY_KEY })
      navigate('/scan/added', {
        state: {
          product: { name: item.name, expires: formatDate(item.bestBefore) },
          source: scan ? 'scan' : 'manual',
        },
      })
    } catch (err) {
      setSaveError(
        (err instanceof ApiError && err.serverMessage) || "Couldn't save your item. Please try again.",
      )
    }
  }

  return (
    <div className="add-item">
      <PageHeader title="Add Item" backTo={leaveTo} />

      <form className="add-item-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        {scan?.notice && (
          <p className="add-item-notice" role="status">
            {scan.notice}
          </p>
        )}

        <p className="add-item-required-note">
          <span aria-hidden="true">*</span> Required
        </p>

        <TextField
          label="Product name"
          required
          placeholder="e.g. Organic Milk"
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

        <TextField
          label="Barcode"
          tag="Recommended"
          inputMode="numeric"
          hint="Not required, but helps recognize this product next time."
          disabled={isSubmitting}
          error={errors.barcode?.message}
          {...register('barcode')}
        />

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
          hint={product?.quantity ? `How many packages. Each one is ${product.quantity}.` : undefined}
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

        {wantsSuggestion && (
          <ExpirySuggestionCard
            isLoading={!localSuggestion && (!isSettled || suggestion.isPending)}
            isError={!localSuggestion && suggestion.isError}
            suggestion={localSuggestion ?? suggestion.data}
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
            {isSubmitting ? 'Saving…' : 'Save Item'}
          </Button>
          <Button variant="secondary" disabled={isSubmitting} onClick={() => navigate(leaveTo)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
