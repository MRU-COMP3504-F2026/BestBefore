// Moves a shelf life onto a purchase date, in the browser. Must land on the same days as predict()
// in expiry-tests/expiry.ts: server/src/test/items.test.ts compares the two across FoodKeeper.

export type ShelfLifeLength = { unit: 'days' | 'months'; min: number; max: number }

// Date's own rollover, as the server: Jan 31 + 1 month is Mar 3, not the end of February.
function addLength(purchaseDate: string, amount: number, unit: ShelfLifeLength['unit']): string {
  const [year, month, day] = purchaseDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (unit === 'days') date.setDate(date.getDate() + amount)
  else date.setMonth(date.getMonth() + amount)
  const paddedMonth = String(date.getMonth() + 1).padStart(2, '0')
  const paddedDay = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${paddedMonth}-${paddedDay}`
}

export function datesFromLength(purchaseDate: string, length: ShelfLifeLength) {
  return {
    earliest: addLength(purchaseDate, length.min, length.unit),
    latest: addLength(purchaseDate, length.max, length.unit),
  }
}
