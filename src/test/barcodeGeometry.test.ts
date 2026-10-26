import type { QuaggaJSResultObject } from '@ericblade/quagga2'
import { barsLine, measureBars, toPoints, type GrayImage, type Point } from '../lib/barcodeGeometry'

function result(line?: { x: number; y: number }[], start?: number, end?: number) {
  return { codeResult: { code: '012345678905', start, end }, line } as QuaggaJSResultObject
}

describe('barsLine', () => {
  it('trims the scanline to the decoded bars', () => {
    // The scanline runs x 200 → 600; the bars are samples 100–300 along it.
    expect(barsLine(result([{ x: 200, y: 200 }, { x: 600, y: 200 }], 100, 300))).toEqual([
      [300, 200],
      [500, 200],
    ])
  })

  it('maps a reversed read the same way', () => {
    const line = [
      { x: 200, y: 200 },
      { x: 600, y: 200 },
    ]
    expect(barsLine(result(line, 300, 100))).toEqual(barsLine(result(line, 100, 300)))
  })

  it('samples from the lower end like Quagga, whichever way the line points', () => {
    expect(barsLine(result([{ x: 600, y: 200 }, { x: 200, y: 200 }], 100, 300))).toEqual([
      [300, 200],
      [500, 200],
    ])
  })

  it('follows a tilted scanline along its major axis', () => {
    expect(barsLine(result([{ x: 100, y: 100 }, { x: 500, y: 300 }], 100, 300))).toEqual([
      [200, 150],
      [400, 250],
    ])
  })

  it('uses steep lines’ vertical axis for samples', () => {
    expect(barsLine(result([{ x: 100, y: 500 }, { x: 100, y: 100 }], 50, 250))).toEqual([
      [100, 150],
      [100, 350],
    ])
  })

  it('returns null without a usable decode line', () => {
    expect(barsLine(result())).toBeNull()
    expect(barsLine(result([{ x: 300, y: 200 }, { x: 300, y: 200 }], 0, 0))).toBeNull()
  })
})

describe('toPoints', () => {
  it('copies a box into points, or null without one', () => {
    expect(toPoints([[1, 2], [3, 4]])).toEqual([[1, 2], [3, 4]])
    expect(toPoints(undefined)).toBeNull()
    expect(toPoints([])).toBeNull()
  })
})

describe('measureBars', () => {
  // 95 modules like a UPC-A: guard bars at both ends, a fixed pseudo-random middle.
  const modules = (() => {
    let seed = 7
    const bits = [1, 0, 1]
    for (let i = 0; i < 89; i++) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      bits.push(seed % 3 === 0 ? 1 : 0)
    }
    return [...bits, 1, 0, 1]
  })()

  type Bars = { center: Point; angle: number; width: number; height: number }

  // A light 800×450 frame with dark bars drawn in the given rectangle.
  function frame({ center, angle, width, height }: Bars): GrayImage {
    const data = new Float32Array(800 * 450).fill(230)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    for (let y = 0; y < 450; y++) {
      for (let x = 0; x < 800; x++) {
        const dx = x - center[0]
        const dy = y - center[1]
        const across = dx * cos + dy * sin
        const along = -dx * sin + dy * cos
        if (Math.abs(across) >= width / 2 || Math.abs(along) >= height / 2) continue
        const module = Math.floor(((across + width / 2) / width) * modules.length)
        if (modules[module]) data[y * 800 + x] = 20
      }
    }
    return { width: 800, height: 450, data }
  }

  // Where a read line at `slant` to the barcode's axis, `offset` from its middle, meets the
  // first and last bars.
  function readLine({ center, angle, width }: Bars, slant = 0, offset = 0): [Point, Point] {
    const t = Math.tan(slant)
    const at = (across: number): Point => {
      const along = offset + across * t
      return [
        center[0] + across * Math.cos(angle) - along * Math.sin(angle),
        center[1] + across * Math.sin(angle) + along * Math.cos(angle),
      ]
    }
    return [at(-width / 2), at(width / 2)]
  }

  function edgeAngle(outline: Point[]) {
    const [a, b] = outline
    return Math.atan2(b[1] - a[1], b[0] - a[0])
  }

  function expectNear(actual: Point[] | null, expected: Point[], tolerance: number) {
    expect(actual).toHaveLength(4)
    actual!.forEach(([x, y], i) => {
      expect(Math.abs(x - expected[i][0])).toBeLessThanOrEqual(tolerance)
      expect(Math.abs(y - expected[i][1])).toBeLessThanOrEqual(tolerance)
    })
  }

  const upright: Bars = { center: [400, 225], angle: 0, width: 240, height: 160 }
  // The bars span x 280–520 and y 145–305; padding adds 3% of the width (7.2px).
  const uprightOutline: Point[] = [
    [272.8, 137.8],
    [527.2, 137.8],
    [527.2, 312.2],
    [272.8, 312.2],
  ]

  it('finds the full height of the bars from a read line off their middle', () => {
    const outline = measureBars(frame(upright), readLine(upright, 0, 30))

    expectNear(outline, uprightOutline, 6)
  })

  it('squares up to the bars when the read line crosses them at a slant', () => {
    const outline = measureBars(frame(upright), readLine(upright, (15 * Math.PI) / 180))

    expect(edgeAngle(outline!)).toBeCloseTo(0, 2)
    expectNear(outline, uprightOutline, 4)
  })

  it('handles a barcode on its side', () => {
    const sideways: Bars = { ...upright, angle: Math.PI / 2 }

    const outline = measureBars(frame(sideways), readLine(sideways, (12 * Math.PI) / 180))!

    expect(edgeAngle(outline)).toBeCloseTo(Math.PI / 2, 2)
    const [a, , c] = outline
    expect((a[0] + c[0]) / 2).toBeCloseTo(400, 0)
    expect((a[1] + c[1]) / 2).toBeCloseTo(225, 0)
  })

  it('follows a rotated barcode', () => {
    const rotated: Bars = { ...upright, angle: (20 * Math.PI) / 180 }

    const outline = measureBars(frame(rotated), readLine(rotated, (10 * Math.PI) / 180))!

    expect(edgeAngle(outline)).toBeCloseTo(rotated.angle, 1)
    const [a, b, c] = outline
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(240 + 2 * 7.2, -1)
    expect(Math.hypot(c[0] - b[0], c[1] - b[1])).toBeCloseTo(160 + 2 * 7.2, -1)
  })

  it('gives up when there are no bars to follow', () => {
    const blank: GrayImage = { width: 800, height: 450, data: new Float32Array(800 * 450).fill(230) }

    expect(measureBars(blank, [[280, 225], [520, 225]])).toBeNull()
  })

  it('gives up on bars too short to be convincing', () => {
    const sliver: Bars = { ...upright, height: 12 }

    expect(measureBars(frame(sliver), readLine(sliver))).toBeNull()
  })
})
