import type { QuaggaJSResultObject } from '@ericblade/quagga2'

export type Point = [number, number]

/** One luminance value per pixel, row by row. */
export type GrayImage = { width: number; height: number; data: ArrayLike<number> }

export function toGray({ width, height, data }: ImageData): GrayImage {
  const gray = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  return { width, height, data: gray }
}

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

// Below this correlation with the starting line's pattern, the bars have ended.
const MIN_CORRELATION = 0.5
// How far the bars may lean relative to the read line (shift along it per step away from it).
const MAX_LEAN = 0.6
// Bars measured shorter than this fraction of their width aren't a convincing measurement.
const MIN_HEIGHT = 0.15
// How far from the starting line to look for the ends of the bars, as a fraction of the width.
const MAX_REACH = 1.2
// Breathing room so the outline doesn't sit on the bars, as a fraction of the width.
const PAD = 0.03

type Trace = { above: number; below: number; lean: number }

/**
 * Follows the bar pattern on `line` outward on both sides, on parallel lines, until it
 * fades out. Returns how far it carried on each side (perpendicular to the line) and how
 * much it drifted along the line per unit of that distance (`lean`), which is how far the
 * bars are from square to the line. `maxLean` bounds the drift searched for.
 */
function trace(image: GrayImage, [s, e]: [Point, Point], maxLean: number): Trace | null {
  const width = Math.hypot(e[0] - s[0], e[1] - s[1])
  const u: Point = [(e[0] - s[0]) / width, (e[1] - s[1]) / width]
  const n: Point = [-u[1], u[0]]
  const samples = Math.round(Math.min(Math.max(width, 48), 320))

  // The pattern along the line moved `offset` across it and `shift` along it, normalized
  // so patterns compare regardless of lighting. Null off the image or where it's flat.
  const profile = (offset: number, shift: number): Float64Array | null => {
    const values = new Float64Array(samples)
    let sum = 0
    for (let i = 0; i < samples; i++) {
      const t = (i / (samples - 1)) * width + shift
      const x = Math.round(s[0] + u[0] * t + n[0] * offset)
      const y = Math.round(s[1] + u[1] * t + n[1] * offset)
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null
      values[i] = image.data[y * image.width + x]
      sum += values[i]
    }
    const mean = sum / samples
    let variance = 0
    for (let i = 0; i < samples; i++) {
      values[i] -= mean
      variance += values[i] * values[i]
    }
    const deviation = Math.sqrt(variance / samples)
    if (deviation < 1) return null
    for (let i = 0; i < samples; i++) values[i] /= deviation
    return values
  }

  const reference = profile(0, 0)
  if (!reference) return null
  const correlation = (other: Float64Array) => {
    let total = 0
    for (let i = 0; i < samples; i++) total += reference[i] * other[i]
    return total / samples
  }

  const step = Math.max(2, width / 60)
  const reach = Math.ceil(step * maxLean)
  const drift: Point[] = [] // (offset, shift) wherever the pattern was found

  const extent = (side: 1 | -1) => {
    let shift = 0
    let last = 0
    for (let k = 1; k * step <= MAX_REACH * width; k++) {
      const offset = side * k * step
      let best = -Infinity
      let bestShift = shift
      for (let candidate = shift - reach; candidate <= shift + reach; candidate++) {
        const values = profile(offset, candidate)
        const score = values ? correlation(values) : -Infinity
        if (score > best) {
          best = score
          bestShift = candidate
        }
      }
      if (best < MIN_CORRELATION) break
      shift = bestShift
      last = k * step
      drift.push([offset, shift])
    }
    // The bars end somewhere before the next step.
    return last ? last + step / 2 : 0
  }

  const above = extent(1)
  const below = extent(-1)

  // Least-squares drift, through the starting line.
  let shiftByOffset = 0
  let offsetSquared = 0
  for (const [offset, shift] of drift) {
    shiftByOffset += offset * shift
    offsetSquared += offset * offset
  }
  return { above, below, lean: offsetSquared ? shiftByOffset / offsetSquared : 0 }
}

/**
 * Measures the bars in the decoded frame and returns the rectangle around them, or null
 * when the measurement isn't convincing.
 *
 * The read line is exact about where the bars start and end, but crosses them at whatever
 * angle Quagga guessed. Tracing its pattern outward shows how the bars lean, and so their
 * angle. Their height is then traced again from a line square to the bars through the same
 * middle, since a slanted line slides out of the bars gradually and blurs where they end.
 */
export function measureBars(image: GrayImage, line: [Point, Point]): Point[] | null {
  const [s, e] = line
  const width = Math.hypot(e[0] - s[0], e[1] - s[1])
  if (width < 20) return null
  const u: Point = [(e[0] - s[0]) / width, (e[1] - s[1]) / width]
  const n: Point = [-u[1], u[0]]

  const slanted = trace(image, line, MAX_LEAN)
  if (!slanted || slanted.above + slanted.below < MIN_HEIGHT * width) return null
  if (Math.abs(slanted.lean) > MAX_LEAN) return null

  // Following a bar means moving across the read line and `lean` along it at once.
  const { lean } = slanted
  const length = Math.hypot(1, lean)
  const along: Point = [(n[0] + lean * u[0]) / length, (n[1] + lean * u[1]) / length]
  const across: Point = [along[1], -along[0]]
  // Across the bars, the read line's length shrinks to the barcode's true width.
  const half = (width * (u[0] * across[0] + u[1] * across[1])) / 2
  const mid: Point = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2]
  const at = (a: number, b: number): Point => [
    mid[0] + across[0] * a + along[0] * b,
    mid[1] + across[1] * a + along[1] * b,
  ]

  // Square to the bars, so a small search is enough to absorb rounding in the angle.
  const square = trace(image, [at(-half, 0), at(half, 0)], 0.1)
  if (!square || square.above + square.below < MIN_HEIGHT * width) return null

  const pad = PAD * width
  const top = square.above + pad
  const bottom = square.below + pad
  return [
    at(-half - pad, -bottom),
    at(half + pad, -bottom),
    at(half + pad, top),
    at(-half - pad, top),
  ]
}
