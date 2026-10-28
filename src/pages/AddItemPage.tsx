import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import Button from '../components/Button'
import PageHeader from '../components/PageHeader'
import TextField from '../components/TextField'
import { formatDate, todayIsoDate } from '../lib/dates'
import { mockAddItem } from '../lib/mockItems'
import '../styles/AddItemPage.css'
import { useEffect } from 'react'

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
  // ISO dates (YYYY-MM-DD) compare correctly as strings.
  .refine((values) => !values.purchaseDate || values.bestBefore >= values.purchaseDate, {
    message: 'You should probably not be eating this',
    path: ['bestBefore'],
  })

type AddItemValues = z.infer<typeof addItemSchema>

export default function AddItemPage() {
  useEffect(() => {
    document.title = 'BestBefore | Add Item'
  }, [])
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddItemValues>({
    resolver: zodResolver(addItemSchema),
    defaultValues: { quantity: 1, purchaseDate: todayIsoDate() },
  })

  const onSubmit = async (values: AddItemValues) => {
    const result = await mockAddItem(values)
    navigate('/scan/added', {
      state: {
        product: { name: result.item.name, expires: formatDate(result.item.bestBefore) },
        source: 'manual',
      },
    })
  }

  return (
    <div className="add-item">
      <PageHeader title="Add Item" backTo="/items" />

      <form className="add-item-form" onSubmit={handleSubmit(onSubmit)} noValidate>
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
          {...register('purchaseDate')}
        />

        <TextField
          label="Best before date"
          required
          type="date"
          disabled={isSubmitting}
          error={errors.bestBefore?.message}
          {...register('bestBefore')}
        />

        <div className="add-item-actions">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save Item'}
          </Button>
          <Button variant="secondary" disabled={isSubmitting} onClick={() => navigate('/items')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
