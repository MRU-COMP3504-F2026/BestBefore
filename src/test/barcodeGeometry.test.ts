import type { QuaggaJSResultObject } from '@ericblade/quagga2'
import { barsLine, toPoints } from '../lib/barcodeGeometry'

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
