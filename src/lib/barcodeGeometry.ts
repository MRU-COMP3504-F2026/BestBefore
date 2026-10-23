import type { QuaggaJSResultObject } from '@ericblade/quagga2'

export type Point = [number, number]

export function toPoints(box: number[][] | undefined): Point[] | null {
  return box?.length ? box.map(([x, y]) => [x, y] as Point) : null
}

/**
 * The stretch of the scanline where the bars were read, in Quagga's canvas coordinates.
 *
 * `line` is the scanline Quagga decoded (extended past the bars), and `codeResult.start`
 * and `end` are where the first and last bars sit along it, as indices of its Bresenham
 * samples. Unlike the locator box, this segment lies exactly on the bars.
 */
export function barsLine(result: QuaggaJSResultObject): [Point, Point] | null {
  const [p1, p2] = result.line ?? []
  const { start, end } = result.codeResult ?? {}
  if (!p1 || !p2 || typeof start !== 'number' || typeof end !== 'number') return null

  // Same endpoints and sample order as Quagga's Bresenham sampling: integer pixels,
  // one sample per step along the major axis, starting from the lower end.
  let a: Point = [Math.trunc(p1.x), Math.trunc(p1.y)]
  let b: Point = [Math.trunc(p2.x), Math.trunc(p2.y)]
  const axis = Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) ? 1 : 0
  if (a[axis] > b[axis]) [a, b] = [b, a]
  const samples = b[axis] - a[axis]
  if (samples <= 0) return null

  const along = (i: number): Point => [
    a[0] + ((b[0] - a[0]) * i) / samples,
    a[1] + ((b[1] - a[1]) * i) / samples,
  ]
  // A reversed read reports start > end; either way they bound the bars.
  return [along(Math.min(start, end)), along(Math.max(start, end))]
}
