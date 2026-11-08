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
import {
  fetchExpirySuggestion,
  fetchPhotoMatch,
  type ExpiryRequest,
  type IdentifiedFood,
  type PhotoHandoff,
  type ScanHandoff,
} from '../lib/foodApi'
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

// A weight or volume, not a number of items.
const MEASURE_UNIT = /^(m?g|kg|grams?|kilograms?|m?l|litres?|liters?|millilitres?|milliliters?|oz|ounces?|fl\.? ?oz|lbs?|pounds?|cups?|tbsp|tsp)$/i

// How many Gemini counted in the photo ("3 piece"), or null. Never a package size like "500 g".
function photoCount(food: IdentifiedFood | undefined): number | null {
  const count = food?.quantity
  if (!count || !Number.isInteger(count) || count < 1 || count > 10_000) return null
  return food.unit && MEASURE_UNIT.test(food.unit.trim()) ? null : count
}

const FROM_PHOTO = 'From your photo. Check it.'

export default function AddItemPage() {
  useEffect(() => {
    document.title = 'BestBefore | Add Item'
  }, [])
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const userId = useAuthSession().data?.user.id
  // Set only when the scanner sent us here. Reload keeps it, so a lookup isn't spent twice.
  const handoff = useLocation().state as { scan?: ScanHandoff; photo?: PhotoHandoff } | null
  const scan = handoff?.scan ?? null
  // Set only when AI Vision sent us here: a food named from a photo, with nothing looked up.
  const photo = scan ? null : (handoff?.photo ?? null)
  const product = scan?.product ?? null
  const fromScanner = Boolean(scan || photo)
  // Gemini's category is free text ("Fresh fruit"). It only picks a category when it is one of ours.
  const photoCategory =
    CATEGORIES.find((label) => label.toLowerCase() === photo?.food.category?.trim().toLowerCase()) ?? null
  // Gemini is told to leave the brand out unless it can read it on the package.
  const photoBrand = photo?.food.brand?.trim() || null
  const photoQuantity = photoCount(photo?.food)
  const leaveTo = fromScanner ? '/scan' : '/items'
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
      name: product?.name ?? photo?.food.name ?? '',
      brand: product?.brand ?? photoBrand ?? '',
      barcode: product?.barcode ?? scan?.barcode ?? '',
      category: scan?.category ?? photoCategory ?? '',
      // Always a count of items. The product's own quantity is the package size; a photo's is what
      // Gemini counted.
      quantity: photoQuantity ?? 1,
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
  const productCategory = product?.category ?? photo?.food.category ?? null
  const request = useMemo<ExpiryRequest>(
    () => ({
      name: name.trim(),
      brand: brand?.trim() || null,
      // A photo's suggestion is FoodKeeper only. A barcode typed here is saved, never looked up.
      barcode: photo ? null : barcode?.trim() || null,
      category,
      productCategory,
      purchaseDate,
      ...(photo && { source: 'photo' as const }),
    }),
    [photo, name, brand, barcode, category, productCategory, purchaseDate],
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
      Boolean(fromScanner && settledRequest.name && settledRequest.purchaseDate) &&
      !suggestionFromSession(userId, settledRequest),
    retry: false,
    staleTime: Infinity,
  })
  const wantsSuggestion = Boolean(fromScanner && request.name && request.purchaseDate)
  // Read again once an answer arrives, since that is what fills the session.
  const localSuggestion = useMemo(
    () => (scan ? suggestionFromSession(userId, request) : null),
    [scan, userId, request, suggestion.data], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // What someone confirmed before for a photo named like this one, offered and never applied unasked.
  const photoToken = photo?.provenance ?? null
  const photoMatch = useQuery({
    queryKey: ['photo-match', photoToken],
    queryFn: ({ signal }) => fetchPhotoMatch(photoToken!, signal),
    enabled: Boolean(photoToken),
    retry: false,
    staleTime: Infinity,
  })
  const offeredMatch =
    photoMatch.data &&
    (photoMatch.data.name !== name.trim() ||
      (photoMatch.data.brand ?? '') !== (brand?.trim() ?? '') ||
      (photoMatch.data.category ?? '') !== (categoryValue ?? ''))
      ? photoMatch.data
      : null

  const useMatch = () => {
    if (!offeredMatch) return
    setValue('name', offeredMatch.name, { shouldValidate: true, shouldDirty: true })
    setValue('brand', offeredMatch.brand ?? '', { shouldDirty: true })
    if (offeredMatch.category && CATEGORIES.includes(offeredMatch.category)) {
      setValue('category', offeredMatch.category, { shouldDirty: true })
    }
  }

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
        // Lets the server share this product under the barcode, only once the item is saved.
        ...(photo?.provenance && { photoToken: photo.provenance }),
      })
      queryClient.invalidateQueries({ queryKey: INVENTORY_QUERY_KEY })
      navigate('/scan/added', {
        state: {
          product: { name: item.name, expires: formatDate(item.bestBefore) },
          source: fromScanner ? 'scan' : 'manual',
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
        {photo && (
          <p className="add-item-notice" role="status">
            AI Vision named this from your photo. Check the details, and use the date on the package if
            it has one.
          </p>
        )}
        {offeredMatch && (
          <div className="add-item-notice add-item-match" role="status">
            <p>
              Someone saved a photo like this as “{offeredMatch.name}”
              {[offeredMatch.brand, offeredMatch.category].filter(Boolean).map((part) => ` · ${part}`)}.
            </p>
            <Button variant="secondary" disabled={isSubmitting} onClick={useMatch}>
              Use These Details
            </Button>
          </div>
        )}

        <p className="add-item-required-note">
          <span aria-hidden="true">*</span> Required
        </p>

        <TextField
          label="Product name"
          required
          placeholder="e.g. Organic Milk"
          hint={photo ? FROM_PHOTO : undefined}
          disabled={isSubmitting}
          error={errors.name?.message}
          {...register('name')}
        />

        <TextField
          label="Brand"
          tag="Optional"
          hint={photoBrand ? 'Read from the package in your photo. Check it.' : undefined}
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
          hint={
            product?.quantity
              ? `How many packages. Each one is ${product.quantity}.`
              : photoQuantity
                ? 'Counted in your photo. Check it.'
                : undefined
          }
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
