import type { QuaggaJSResultObject } from '@ericblade/quagga2'

export type Point = [number, number]

// How far the outline may reach above or below the decode line, as a fraction of the
// barcode's width. UPC/EAN symbols are about 0.7 times as tall as they are wide.
const MAX_HALF_HEIGHT = 0.6
// Half-height used when Quagga gives no box to measure the bars against.
const DEFAULT_HALF_HEIGHT = 0.35
// Breathing room so the outline doesn't sit on the bars, as fractions of the width.
const PAD_ALONG = 0.04
const PAD_ACROSS = 0.03

/**
 * Fits an outline to the decoded bars, in Quagga's canvas coordinates.
 *
 * Quagga's `box` is built from ~64px locator patches, so it often overshoots the barcode.
 * The decode itself is exact: `line` is the scanline that was read, and `codeResult.start`
 * and `end` are where the first and last bars sit along it (as Bresenham sample indices).
 * The outline takes its width and angle from those, and only its height from the box.
 * Falls back to Quagga's box when the decode line isn't usable.
 */
export function barcodeOutline(result: QuaggaJSResultObject): Point[] | null {
  const box = result.box?.length === 4 ? result.box.map(([x, y]) => [x, y] as Point) : null
  const [p1, p2] = result.line ?? []
  const { start, end } = result.codeResult ?? {}
  if (!p1 || !p2 || typeof start !== 'number' || typeof end !== 'number') return box

  // Same endpoints and sample order as Quagga's Bresenham sampling: integer pixels,
  // one sample per step along the major axis, starting from the lower end.
  let a: Point = [Math.trunc(p1.x), Math.trunc(p1.y)]
  let b: Point = [Math.trunc(p2.x), Math.trunc(p2.y)]
  const axis = Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) ? 1 : 0
  if (a[axis] > b[axis]) [a, b] = [b, a]
  const samples = b[axis] - a[axis]
  if (samples <= 0) return box

  const along = (i: number): Point => [
    a[0] + ((b[0] - a[0]) * i) / samples,
    a[1] + ((b[1] - a[1]) * i) / samples,
  ]
  // A reversed read reports start > end; either way they bound the bars.
  const first = along(Math.min(start, end))
  const last = along(Math.max(start, end))
  const width = Math.hypot(last[0] - first[0], last[1] - first[1])
  if (!(width > 1)) return box

  const u: Point = [(last[0] - first[0]) / width, (last[1] - first[1]) / width]
  const n: Point = [-u[1], u[0]]

  // The bars' extent across the line, measured from the box and kept within a sane height.
  let low = -DEFAULT_HALF_HEIGHT * width
  let high = DEFAULT_HALF_HEIGHT * width
  if (box) {
    const offsets = box.map(([x, y]) => (x - first[0]) * n[0] + (y - first[1]) * n[1])
    const boxLow = Math.max(Math.min(...offsets), -MAX_HALF_HEIGHT * width)
    const boxHigh = Math.min(Math.max(...offsets), MAX_HALF_HEIGHT * width)
    if (boxLow < 0 && boxHigh > 0) {
      low = boxLow
      high = boxHigh
    }
  }

  const padAlong = PAD_ALONG * width
  const padAcross = PAD_ACROSS * width
  const corner = (from: Point, alongPad: number, across: number): Point => [
    from[0] + u[0] * alongPad + n[0] * across,
    from[1] + u[1] * alongPad + n[1] * across,
  ]
  return [
    corner(first, -padAlong, low - padAcross),
    corner(last, padAlong, low - padAcross),
    corner(last, padAlong, high + padAcross),
    corner(first, -padAlong, high + padAcross),
  ]
}
