import type { QuaggaJSResultObject } from '@ericblade/quagga2'
import { barcodeOutline, type Point } from '../lib/barcodeOutline'

// A loose locator box, as Quagga's patches produce, around bars spanning x 300–500 at y 200.
const looseBox = [
  [240, 120],
  [560, 120],
  [560, 290],
  [240, 290],
]

function result(fields: Partial<Record<'line' | 'box', unknown>> & { start?: number; end?: number }) {
  const { start, end, ...rest } = fields
  return { codeResult: { code: '012345678905', start, end }, ...rest } as QuaggaJSResultObject
}

function expectPoints(actual: Point[] | null, expected: Point[]) {
  expect(actual).toHaveLength(expected.length)
  actual!.forEach(([x, y], i) => {
    expect(x).toBeCloseTo(expected[i][0], 5)
    expect(y).toBeCloseTo(expected[i][1], 5)
  })
}

describe('barcodeOutline', () => {
  it('fits the outline to the decoded bars instead of the loose locator box', () => {
    // The scanline runs x 200 → 600; the bars are samples 100–300 along it, i.e. x 300–500.
    const outline = barcodeOutline(
      result({ line: [{ x: 200, y: 200 }, { x: 600, y: 200 }], start: 100, end: 300, box: looseBox }),
    )

    // Width 200, so 8px of padding along and 6px across; height from the box (y 120–290).
    expectPoints(outline, [
      [292, 120 - 6],
      [508, 120 - 6],
      [508, 290 + 6],
      [292, 290 + 6],
    ])
  })

  it('maps a reversed read the same way', () => {
    const forward = barcodeOutline(
      result({ line: [{ x: 200, y: 200 }, { x: 600, y: 200 }], start: 100, end: 300, box: looseBox }),
    )
    const reversed = barcodeOutline(
      result({ line: [{ x: 200, y: 200 }, { x: 600, y: 200 }], start: 300, end: 100, box: looseBox }),
    )

    expect(reversed).toEqual(forward)
  })

  it('samples from the lower end like Quagga, whichever way the line points', () => {
    const outline = barcodeOutline(
      result({ line: [{ x: 600, y: 200 }, { x: 200, y: 200 }], start: 100, end: 300, box: looseBox }),
    )

    const xs = outline!.map(([x]) => x)
    expect(Math.min(...xs)).toBeCloseTo(292, 5)
    expect(Math.max(...xs)).toBeCloseTo(508, 5)
  })

  it('follows the angle of a tilted barcode', () => {
    // A 45° scanline: 200 samples along the major axis cover 200√2 px of barcode.
    const outline = barcodeOutline(
      result({ line: [{ x: 100, y: 100 }, { x: 500, y: 500 }], start: 50, end: 250 }),
    )!

    const [a, b] = outline
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
    expect(angle).toBeCloseTo(Math.PI / 4, 5)
    // Bars run from (150,150) to (350,350); with padding the edge is a bit longer.
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(200 * Math.SQRT2 * 1.08, 3)
  })

  it('caps the height when the locator box is far taller than the bars', () => {
    const tallBox = [
      [240, -400],
      [560, -400],
      [560, 800],
      [240, 800],
    ]
    const outline = barcodeOutline(
      result({ line: [{ x: 200, y: 200 }, { x: 600, y: 200 }], start: 100, end: 300, box: tallBox }),
    )!

    const ys = outline.map(([, y]) => y)
    // At most 0.6 × width (120px) either side of the line, plus padding.
    expect(Math.min(...ys)).toBeCloseTo(200 - 120 - 6, 5)
    expect(Math.max(...ys)).toBeCloseTo(200 + 120 + 6, 5)
  })

  it("falls back to Quagga's box without a usable decode line", () => {
    expect(barcodeOutline(result({ box: looseBox }))).toEqual(looseBox)
    expect(
      barcodeOutline(result({ line: [{ x: 300, y: 200 }, { x: 300, y: 200 }], start: 0, end: 0, box: looseBox })),
    ).toEqual(looseBox)
  })

  it('returns null with neither a decode line nor a box', () => {
    expect(barcodeOutline(result({}))).toBeNull()
  })
})
