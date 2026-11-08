// Expected length for each format Quagga can report.
const FORMAT_LENGTH: Record<string, number> = {
  ean_13: 13,
  upc_a: 12,
  ean_8: 8,
  upc_e: 8,
}

// Short codes are easier to fake, so they must repeat more times in a row.
export const REQUIRED_REPEATS: Record<number, number> = { 8: 5, 12: 3, 13: 3 }

function checkDigitOk(code: string): boolean {
  const digits = code.split('').map(Number)
  const check = digits.pop()!
  const sum = digits.reverse().reduce((t, d, i) => t + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

// Expand an 8-digit UPC-E into its 12-digit UPC-A form (what product databases use).
export function upcEToUpcA(e: string): string {
  const [ns, a, b, c, d, f, last, check] = e.split('')
  let body: string
  if ('012'.includes(last)) body = `${ns}${a}${b}${last}0000${c}${d}${f}`
  else if (last === '3') body = `${ns}${a}${b}${c}00000${d}${f}`
  else if (last === '4') body = `${ns}${a}${b}${c}${d}00000${f}`
  else body = `${ns}${a}${b}${c}${d}${f}0000${last}`
  return body + check
}

// format: Quagga's result.codeResult.format. Returns the code to use, or null to ignore it.
export function acceptBarcode(code: string, format: string): string | null {
  if (!/^\d+$/.test(code)) return null
  const expected = FORMAT_LENGTH[format]
  if (!expected || code.length !== expected) return null // length must match the format

  if (format === 'upc_e') {
    const full = upcEToUpcA(code)
    return checkDigitOk(full) ? full : null // store and look up the 12-digit form
  }
  return checkDigitOk(code) ? code : null
}