import { describe, expect, it } from 'vitest'
import type { Candle } from '~/domain/market/types'
import { chicagoToUnix, sessionClose, sessionOpen } from '~/domain/sim/session'
import { bucketStart } from '~/domain/sim/timeframe'
import type { SimTimeframe } from '~/domain/sim/types'
import { candleIndexAt, isFormingCandle } from '~/lib/sim/chart'

const DAY = '2026-10-19'

function at(hour: number, minute: number, second = 0): number {
  return chicagoToUnix(2026, 10, 19, hour, minute) + second
}

function candle(time: number): Candle {
  return { time, open: 100, high: 101, low: 99, close: 100.5, volume: 10 }
}

describe('candleIndexAt', () => {
  const candles = [candle(at(10, 0)), candle(at(10, 15)), candle(at(10, 30))]

  it('selects the containing aggregate for an intra-bucket fill instead of the next bucket', () => {
    expect(candleIndexAt(candles, at(10, 7))).toBe(0)
    expect(candleIndexAt(candles, at(10, 14, 59))).toBe(0)
    expect(candleIndexAt(candles, at(10, 15))).toBe(1)
    expect(candleIndexAt(candles, at(10, 22))).toBe(1)
  })

  it('returns -1 when there is no previous candle', () => {
    expect(candleIndexAt(candles, at(9, 59, 59))).toBe(-1)
    expect(candleIndexAt([], at(10, 0))).toBe(-1)
  })

  it('returns -1 for non-finite times', () => {
    for (const time of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(candleIndexAt(candles, time)).toBe(-1)
    }
  })
})

describe('isFormingCandle', () => {
  const cases: Array<[SimTimeframe, number, number]> = [
    ['5m', at(10, 2), at(10, 5)],
    ['15m', at(10, 7), at(10, 15)],
    ['45m', at(10, 20), at(11, 0)],
  ]

  it.each(cases)('keeps the %s aggregate forming until its exclusive bucket end', (frame, time, end) => {
    expect(isFormingCandle(time, frame, end - 1)).toBe(true)
    expect(isFormingCandle(time, frame, end)).toBe(false)
    expect(isFormingCandle(time, frame, end + 1)).toBe(false)
  })

  it('keeps the daily candle forming until the session close', () => {
    const close = sessionClose(DAY)
    expect(isFormingCandle(at(10, 0), '1D', close - 1)).toBe(true)
    expect(isFormingCandle(at(10, 0), '1D', close)).toBe(false)
  })

  it('caps the final intraday bucket at the session close', () => {
    const close = sessionClose(DAY)
    const time = close - 10 * 60
    const start = bucketStart(time, '45m')

    expect(start).toBe(close - 30 * 60)
    expect(start + 45 * 60).toBeGreaterThan(close)
    expect(isFormingCandle(time, '45m', close - 1)).toBe(true)
    expect(isFormingCandle(time, '45m', close)).toBe(false)
  })
})

describe('isFormingCandle across DST session boundaries', () => {
  it.each(['2026-03-09', '2026-11-02'])('caps 45m and 1D at the 23-hour session close on %s', (day) => {
    const open = sessionOpen(day)
    const close = sessionClose(day)
    const time = close - 10 * 60

    expect(close - open).toBe(23 * 3_600)
    expect(bucketStart(time, '45m')).toBe(close - 30 * 60)
    expect(isFormingCandle(time, '45m', close - 1)).toBe(true)
    expect(isFormingCandle(time, '45m', close)).toBe(false)
    expect(isFormingCandle(time, '1D', close - 1)).toBe(true)
    expect(isFormingCandle(time, '1D', close)).toBe(false)
  })
})
