import { expiryTone } from '../lib/inventoryApi'

describe('expiryTone', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function setToday(date: Date) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(date)
  }

  it('is red once the date has passed, amber from today to 3 days out, green after', () => {
    setToday(new Date(2026, 9, 26, 12))

    expect(expiryTone('2026-10-01')).toBe('red')
    expect(expiryTone('2026-10-25')).toBe('red')
    expect(expiryTone('2026-10-26')).toBe('amber')
    expect(expiryTone('2026-10-27')).toBe('amber')
    expect(expiryTone('2026-10-29')).toBe('amber')
    expect(expiryTone('2026-10-30')).toBe('green')
  })

  it('compares across month and year boundaries', () => {
    setToday(new Date(2027, 0, 1, 12))

    expect(expiryTone('2026-12-31')).toBe('red')
    expect(expiryTone('2027-01-01')).toBe('amber')
    expect(expiryTone('2027-01-02')).toBe('amber')

    setToday(new Date(2026, 2, 1, 12))
    expect(expiryTone('2026-02-28')).toBe('red')
    expect(expiryTone('2026-03-01')).toBe('amber')
  })

  it('uses the local calendar day at the edges of the day', () => {
    // Just after local midnight and just before the next one; in most zones one of these is on
    // a different UTC date, which must not shift the result.
    setToday(new Date(2026, 9, 26, 0, 1))
    expect(expiryTone('2026-10-25')).toBe('red')
    expect(expiryTone('2026-10-26')).toBe('amber')

    setToday(new Date(2026, 9, 26, 23, 59))
    expect(expiryTone('2026-10-25')).toBe('red')
    expect(expiryTone('2026-10-26')).toBe('amber')
    expect(expiryTone('2026-10-27')).toBe('amber')
  })

  describe.each(['America/Edmonton', 'Pacific/Auckland'])('in %s', (zone) => {
    beforeEach(() => {
      vi.stubEnv('TZ', zone)
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('keeps an item due today amber late in the evening, when UTC is already tomorrow', () => {
      // 23:30 local in Edmonton is the next day in UTC; 00:30 in Auckland is the previous one.
      const late = new Date(2026, 9, 26, 23, 30)
      const early = new Date(2026, 9, 26, 0, 30)
      // Proves the zone took effect: one of the two moments falls on another UTC date.
      const utcDates = [late, early].map((d) => d.toISOString().slice(0, 10))
      expect(utcDates.some((d) => d !== '2026-10-26')).toBe(true)

      for (const now of [late, early]) {
        setToday(now)
        expect(expiryTone('2026-10-25')).toBe('red')
        expect(expiryTone('2026-10-26')).toBe('amber')
        expect(expiryTone('2026-10-27')).toBe('amber')
      }
    })
  })
})
