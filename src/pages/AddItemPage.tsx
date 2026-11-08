import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useLocation, useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import PageHeader from '../components/PageHeader'
import TextField from '../components/TextField'
import { formatDate, todayIsoDate } from '../lib/dates'
import { createItem } from '../lib/inventoryApi'
import '../styles/AddItemPage.css'

// Validation rules for the form. zodResolver runs these before onSubmit is called,
// and the messages appear under the matching field.
const addItemSchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required'),
    brand: z.string().trim().optional(),
    barcode: z.string().trim().optional(),
    quantity: z
      .number({ error: 'Quantity is required' })
      .int('Quantity must be a whole number')
      .min(1, 'Quantity must be at least 1'),
    purchaseDate: z.string().min(1, 'Date bought is required'),
    bestBefore: z.string().min(1, 'Best before date is required'),
  })
  // Cross-field rule: best before can't be earlier than the purchase date.
  // ISO dates (YYYY-MM-DD) compare correctly as plain strings.
  .refine((values) => !values.purchaseDate || values.bestBefore >= values.purchaseDate, {
    message: 'You should probably not be eating this',
    path: ['bestBefore'], // show the error under the best before field
  })

type AddItemValues = z.infer<typeof addItemSchema>

// Data the scan page can pass in through router state when it navigates here.
// Both parts are optional, so opening /items/new directly still works.
type LocationState = {
  prefill?: Partial<AddItemValues> // values to pre-fill the form with
  returnTo?: string // where Back/Cancel should go (e.g. '/scan')
} | null

export default function AddItemPage() {
  const navigate = useNavigate()
  const location = useLocation()

  // Read what the scan page sent (null when opened manually).
  const state = location.state as LocationState
  const prefill = state?.prefill
  const returnTo = state?.returnTo

  // fromScan: we arrived from a scan, so show "Confirm Item" wording.
  // lookupFound: the barcode lookup returned a product name (false = barcode unknown).
  const fromScan = !!prefill
  const lookupFound = !!prefill?.name

  // Holds a message if saving to the server fails.
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Update the browser tab title to match the mode.
  useEffect(() => {
    document.title = fromScan ? 'BestBefore | Confirm Item' : 'BestBefore | Add Item'
  }, [fromScan])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddItemValues>({
    resolver: zodResolver(addItemSchema),
    // Start with sensible defaults, then let scan data override them.
    // The user can still edit every field before saving.
    defaultValues: { quantity: 1, purchaseDate: todayIsoDate(), ...prefill },
  })

  // Runs only after the form passes validation.
  const onSubmit = async (values: AddItemValues) => {
    setSubmitError(null) // clear any error from a previous attempt
    try {
      await createItem({
        name: values.name,
        brand: values.brand || undefined, // empty string -> not sent
        barcode: values.barcode || undefined,
        quantity: values.quantity,
        purchaseDate: values.purchaseDate,
        // The form calls it `bestBefore`; the API and DB call it `bestBeforeDate`.
        bestBeforeDate: values.bestBefore,
      })
    } catch {
      setSubmitError('Could not save the item. Please try again.')
      return // stay on the form so nothing the user typed is lost
    }

    // Saved successfully: show the existing success screen.
    navigate('/scan/added', {
      state: {
        product: { name: values.name, expires: formatDate(values.bestBefore) },
        source: fromScan ? 'scan' : 'manual',
      },
    })
  }

  return (
    <div className="add-item">
      {/* Back arrow returns to the scanner if we came from there, otherwise to the list. */}
      <PageHeader title={fromScan ? 'Confirm Item' : 'Add Item'} backTo={returnTo ?? '/items'} />

      {/* noValidate turns off the browser's own validation so zod's messages are used. */}
      <form className="add-item-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        {/* Only shown after a scan; tells the user whether the lookup worked. */}
        {fromScan && (
          <p className="add-item-required-note">
            {lookupFound
              ? 'We found this from the barcode. Check it and change anything that is wrong.'
              : 'We could not find this barcode. Please fill in the details.'}
          </p>
        )}
        <p className="add-item-required-note">
          <span aria-hidden="true">*</span> Required
        </p>

        {/* disabled={isSubmitting} locks the fields while the save is in progress. */}
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

        <TextField
          label="Quantity"
          required
          type="number"
          min={1}
          step={1}
          disabled={isSubmitting}
          error={errors.quantity?.message}
          // valueAsNumber converts the input's text to a number before validation.
          {...register('quantity', { valueAsNumber: true })}
        />

        <TextField
          label="Date bought"
          required
          type="date"
          disabled={isSubmitting}
          error={errors.purchaseDate?.message}
          {...register('purchaseDate')}
        />

        <TextField
          label="Best before date"
          required
          type="date"
          // After a scan this date is a guess, so remind the user to check the package.
          hint={fromScan ? 'Estimated from the product type. Check the package.' : undefined}
          disabled={isSubmitting}
          error={errors.bestBefore?.message}
          {...register('bestBefore')}
        />

        {/* Shown when the server request fails. role="alert" lets screen readers announce it. */}
        {submitError && <p role="alert">{submitError}</p>}

        <div className="add-item-actions">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save Item'}
          </Button>
          <Button
            variant="secondary"
            disabled={isSubmitting}
            onClick={() => navigate(returnTo ?? '/items')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}