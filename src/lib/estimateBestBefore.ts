// Typical shelf life in days. Order matters: the FIRST match wins,
// so specific products go before general ones (yogurt tags also contain "milk").
const SHELF_LIFE_DAYS: [keyword: string, days: number][] = [
  ['yogurt', 14],
  ['cheese', 30],
  ['milk', 7],
  ['egg', 28],
  ['bread', 5],
  ['meat', 3],
  ['fish', 2],
  ['juice', 10],
  ['canned', 540],
  ['pasta', 540],
  ['rice', 540],
  ['cereal', 270],
  ['snack', 180],
]

// "en:fermented-milk-products" -> ["fermented", "milk", "product"]
function tagWords(categories: string[]): Set<string> {
  const words = categories.flatMap((tag) =>
    tag.replace(/^[a-z]{2}:/, '').split('-').map((w) => w.replace(/s$/, '')),
  )
  return new Set(words)
}

function toIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// Returns a YYYY-MM-DD string for inventory.best_before_date, or null if unknown.
export function estimateBestBefore(categories: string[], purchaseDate: string): string | null {
  const words = tagWords(categories)
  const hit = SHELF_LIFE_DAYS.find(([keyword]) => words.has(keyword))
  if (!hit) return null // unknown category: leave blank rather than guess

  const d = new Date(`${purchaseDate}T00:00:00`) // local time, so no timezone shift
  d.setDate(d.getDate() + hit[1])
  return toIsoDate(d)
}