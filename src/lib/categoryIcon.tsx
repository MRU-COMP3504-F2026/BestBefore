import type { ReactNode } from 'react'
import { BasketIcon, LeafIcon, MilkIcon } from '../components/icons'

// The picture an item shows while it has none of its own.
export function categoryIcon(category: string | null): ReactNode {
  switch (category?.toLowerCase()) {
    case 'dairy':
      return <MilkIcon />
    case 'produce':
      return <LeafIcon />
    default:
      return <BasketIcon />
  }
}
