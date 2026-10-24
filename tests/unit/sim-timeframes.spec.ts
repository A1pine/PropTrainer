import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Candle } from '~/domain/market/types'
import { getWasmCore, setWasmCore, type AggregateInput, type WasmCore } from '~/domain/wasm/core'
import {
  aggregateCandles,
  aggregateCandlesTs,
  barsPerBucket,
  bucketStart,
  isTimeframeAvailable,
  timeframeLabel,
  timeframeMinutes,
} from '~/domain/sim/timeframe'
import {
  chicagoToUnix,
  isMarketOpen,
  isTradeDate,
  nextSessionOpen,
  sessionClose,
  sessionOpen,
  shiftDayKey,
  tradingDayKey,
} from '~/domain/sim/session'
import type { SimTimeframe } from '~/domain/sim/types'

const DAY = '2026-10-19'
const OPEN = sessionOpen(DAY)

let pristine: WasmCore | null = null

beforeAll(() => {
  pristine = getWasmCore()
})

afterEach(() => {
  setWasmCore(pristine)
})

function barAt(time: number, base = 100, volume = 10): Candle {
  return { time, open: base, high: base + 2, low: base - 1, close: base + 1, volume }
}

function sessionBar(index: number, base = 100): Candle {
  return barAt(OPEN + index * 300, base, 100 + index)
}

let cachedTape: Candle[] | null = null

/** 13,000 valid five-minute bars across real weekday Globex sessions. */
function syntheticTape(): Candle[] {
  if (cachedTape) return cachedTape
  const candles: Candle[] = []
  let day = '2026-10-19'
  let price = 20_000
  let index = 0
  while (candles.length < 13_000) {
    if (isTradeDate(day)) {
      const open = sessionOpen(day)
      for (let offset = 0; offset < 23 * 3_600 && candles.length < 13_000; offset += 300) {
        const change = Math.sin(index / 9) * 3 + Math.cos(index / 31)
        const barOpen = price
        const barClose = price + change
        candles.push({
          time: open + offset,
          open: barOpen,
          high: Math.max(barOpen, barClose) + 1,
          low: Math.min(barOpen, barClose) - 1,
          close: barClose,
          volume: 100 + (index % 13),
        })
        price = barClose
        index += 1
      }
    }
    day = shiftDayKey(day, 1)
  }
  cachedTape = candles
  return candles
}

describe('session calendar edge cases', () => {
  it('documents the weekly calendar: a weekday holiday is not fabricated', () => {
    // 2026-12-25 is a Friday. There is no holiday feed, so the weekly calendar
    // still calls it a trade date; only the tape's missing bars create the gap.
    const christmas = chicagoToUnix(2026, 12, 25, 10)
    expect(tradingDayKey(christmas)).toBe('2026-12-25')
    expect(isMarketOpen(christmas)).toBe(true)

    const observed = [barAt(chicagoToUnix(2026, 12, 24, 10), 100), barAt(chicagoToUnix(2026, 12, 28, 10), 110)]
    const daily = aggregateCandlesTs(observed, '1D')
    expect(daily.map((candle) => candle.time)).toEqual([sessionOpen('2026-12-24'), sessionOpen('2026-12-28')])
  })

  it('computes session opens from local time, not elapsed +8h, in both DST regimes', () => {
    expect(new Date(sessionOpen('2026-10-19') * 1_000).toISOString()).toBe('2026-10-18T22:00:00.000Z')
    expect(new Date(sessionOpen('2026-11-02') * 1_000).toISOString()).toBe('2026-11-01T23:00:00.000Z')
    expect(sessionClose('2026-10-19') - sessionOpen('2026-10-19')).toBe(23 * 3_600)
    expect(sessionClose('2026-11-02') - sessionOpen('2026-11-02')).toBe(23 * 3_600)

    // The old +8h trick and local-hour logic agree on the date, but the key must
    // flip exactly at the 16:00 close so risk rolls at the same instant.
    const close = sessionClose(DAY)
    expect(tradingDayKey(close - 1)).toBe(DAY)
    expect(tradingDayKey(close)).toBe('2026-10-20')

    const fallBack = chicagoToUnix(2026, 11, 1, 1, 30)
    const afterFallBack = chicagoToUnix(2026, 11, 1, 3, 30)
    expect(tradingDayKey(fallBack)).toBe('2026-11-01')
    expect(tradingDayKey(afterFallBack)).toBe('2026-11-01')
  })

  it('rejects malformed day keys instead of silently shifting dates', () => {
    expect(() => sessionOpen('2026-02-30')).toThrow(/Invalid trading day key/)
    expect(() => sessionOpen('not-a-day')).toThrow(/Invalid trading day key/)
    expect(() => sessionOpen('2026-13-01')).toThrow(/Invalid trading day key/)
    expect(() => sessionClose('2026-00-10')).toThrow(/Invalid trading day key/)
    expect(() => sessionClose('0000-01-10')).toThrow(/Invalid trading day key/)
    expect(() => shiftDayKey(DAY, Number.NaN)).toThrow(/Invalid day shift/)
    expect(() => shiftDayKey(DAY, Number.MAX_SAFE_INTEGER)).toThrow(/Invalid day shift/)
    expect(() => chicagoToUnix(2026, 2, 30, 10)).toThrow(/Invalid Chicago time/)
  })

  it('bounds timestamps that cannot be represented by the calendar', () => {
    expect(() => tradingDayKey(Number.MAX_SAFE_INTEGER)).toThrow(/Invalid timestamp/)
    expect(isMarketOpen(Number.MAX_SAFE_INTEGER)).toBe(false)
    expect(() => nextSessionOpen(Number.MAX_SAFE_INTEGER)).toThrow(/Invalid timestamp/)
  })

  it('anchors intraday buckets to each session open', () => {
    expect(bucketStart(OPEN, '4h')).toBe(OPEN)
    expect(bucketStart(OPEN + 3 * 3_600, '4h')).toBe(OPEN)
    expect(bucketStart(OPEN + 4 * 3_600, '4h')).toBe(OPEN + 4 * 3_600)
    expect(bucketStart(OPEN + 60, '1D')).toBe(OPEN)
    expect(bucketStart(sessionClose(DAY) - 300, '15m')).toBe(sessionClose(DAY) - 900)
    // A break/weekend timestamp has no containing bucket; it anchors forward.
    expect(bucketStart(sessionClose(DAY) + 1_800, '15m')).toBe(sessionOpen('2026-10-20'))
    expect(bucketStart(chicagoToUnix(2026, 10, 24, 12), '15m')).toBe(sessionOpen('2026-10-26'))
  })
})

describe('timeframe parsing and availability', () => {
  it('accepts strict multiples of the five-minute base up to one day', () => {
    expect(timeframeMinutes('5m')).toBe(5)
    expect(timeframeMinutes('45m')).toBe(45)
    expect(timeframeMinutes('4h')).toBe(240)
    expect(timeframeMinutes('1440m')).toBe(1_440)
    expect(timeframeMinutes('1D')).toBeNull()
    expect(timeframeLabel('15m')).toBe('15M')
    expect(timeframeLabel('1D')).toBe('1D')

    expect(isTimeframeAvailable('5m')).toBe(true)
    expect(isTimeframeAvailable('45m')).toBe(true)
    expect(isTimeframeAvailable('90m')).toBe(true)
    expect(isTimeframeAvailable('1440m')).toBe(true)
    expect(isTimeframeAvailable('1D')).toBe(true)
    expect(barsPerBucket('15m')).toBe(3)
    expect(barsPerBucket('4h')).toBe(48)
    expect(barsPerBucket('1D')).toBeNull()
  })

  it('rejects malformed, too-fine, too-large, and non-finite intervals', () => {
    const bad = ['1m', '2m', '7m', '0m', '0h', '5.5m', '-5m', 'abc', '', '1w', '1445m', '25h'] as SimTimeframe[]
    for (const timeframe of bad) {
      expect(isTimeframeAvailable(timeframe)).toBe(false)
      expect(aggregateCandles([sessionBar(0)], timeframe)).toEqual([])
      expect(aggregateCandlesTs([sessionBar(0)], timeframe)).toEqual([])
    }
    for (const timeframe of ['0m', '5.5m', '-5m', 'abc', '', 'NaNm', 'Infinityh'] as SimTimeframe[]) {
      expect(timeframeMinutes(timeframe)).toBeNull()
    }
    expect(timeframeMinutes('1m')).toBe(1)
    expect(isTimeframeAvailable('15m', 0)).toBe(false)
    expect(isTimeframeAvailable('15m', Number.NaN)).toBe(false)
    expect(isTimeframeAvailable('15m', Number.POSITIVE_INFINITY)).toBe(false)
    expect(isTimeframeAvailable('15m', 2.5)).toBe(false)
    expect(isTimeframeAvailable('1D', Number.NaN)).toBe(false)

    expect(() => bucketStart(OPEN, '1m')).toThrow(/Unsupported timeframe/)
    expect(() => bucketStart(Number.NaN, '5m')).toThrow(/Invalid timestamp/)
    expect(() => bucketStart(Number.POSITIVE_INFINITY, '5m')).toThrow(/Invalid timestamp/)
  })
})

describe('aggregation validation', () => {
  it('handles regular and irregular session bars without crossing sessions', () => {
    const nextOpen = sessionOpen('2026-10-20')
    const bars = [
      barAt(OPEN, 100, 10),
      barAt(OPEN + 300, 101, 20),
      barAt(OPEN + 900, 102, 30),
      barAt(OPEN + 3_900, 103, 40),
      barAt(nextOpen, 110, 50),
    ]
    const fifteen = aggregateCandlesTs(bars, '15m')
    expect(fifteen.map((candle) => candle.time)).toEqual([OPEN, OPEN + 900, OPEN + 3_600, nextOpen])
    expect(fifteen[0]).toMatchObject({ open: 100, high: 103, low: 99, close: 102, volume: 30 })
    expect(fifteen[2]).toMatchObject({ open: 103, high: 105, low: 102, close: 104, volume: 40 })
    expect(fifteen[3]).toMatchObject({ open: 110, high: 112, low: 109, close: 111, volume: 50 })
  })

  it('drops the maintenance break and weekend, but can be told to trust the tape', () => {
    const fridayBreak = sessionClose('2026-10-23') + 1_800
    const saturdayNoon = chicagoToUnix(2026, 10, 24, 12)
    const sundayNoon = chicagoToUnix(2026, 10, 25, 12)
    const mondayOpen = sessionOpen('2026-10-26')
    const bars = [barAt(fridayBreak, 90), barAt(saturdayNoon, 91), barAt(sundayNoon, 92), barAt(mondayOpen, 93)]

    expect(aggregateCandlesTs(bars, '5m').map((candle) => candle.time)).toEqual([mondayOpen])
    expect(aggregateCandlesTs(bars, '5m', 5, { sessionFilter: false })).toHaveLength(4)
    expect(aggregateCandles(bars, '5m').map((candle) => candle.time)).toEqual([mondayOpen])
  })

  it('applies the same validation and filtering to the base 5m path', () => {
    const valid = sessionBar(0, 100)
    const invalid = { ...sessionBar(1), high: Number.NaN }
    const inconsistent = { ...sessionBar(2), high: 90, low: 110 }
    const duplicate = sessionBar(0, 500)
    const backwards = sessionBar(-1, 42)
    const outside = barAt(sessionClose(DAY) + 1_800, 77)

    const source: Candle[] = [valid, invalid, inconsistent, duplicate, backwards, outside]
    const result = aggregateCandles(source, '5m')
    expect(result).toEqual([valid])
    expect(result[0]).not.toBe(valid)

    const tsResult = aggregateCandlesTs(source, '5m')
    expect(tsResult).toEqual([valid])
    expect(tsResult[0]).not.toBe(valid)
  })

  it('ignores missing and non-finite fields instead of producing NaN candles', () => {
    const valid = sessionBar(0)
    const malformed = [
      null,
      undefined,
      { ...valid, time: Number.NaN },
      { ...valid, time: Number.POSITIVE_INFINITY },
      { ...valid, time: OPEN + 300, open: Number.NaN },
      { ...valid, time: OPEN + 600, high: Number.POSITIVE_INFINITY },
      { ...valid, time: OPEN + 900, low: Number.NEGATIVE_INFINITY },
      { ...valid, time: OPEN + 1_200, close: Number.NaN },
      { ...valid, time: OPEN + 1_500, volume: Number.NaN },
      { ...valid, time: OPEN + 1_800, open: '100' as never },
      { ...valid, time: OPEN + 2_100, close: undefined as never },
      { ...valid, time: OPEN + 2_400, volume: -1 },
    ] as unknown as Candle[]

    expect(aggregateCandlesTs(malformed, '5m')).toEqual([])
    expect(aggregateCandles(malformed, '5m')).toEqual([])
  })

  it('drops a bucket whose summed volume overflows to infinity', () => {
    const huge = [
      { time: OPEN, open: 100, high: 100, low: 100, close: 100, volume: Number.MAX_VALUE },
      { time: OPEN + 300, open: 100, high: 100, low: 100, close: 100, volume: Number.MAX_VALUE },
      { time: OPEN + 900, open: 101, high: 101, low: 101, close: 101, volume: 5 },
    ]

    expect(aggregateCandlesTs(huge, '15m')).toEqual([
      { time: OPEN + 900, open: 101, high: 101, low: 101, close: 101, volume: 5 },
    ])
    expect(aggregateCandles(huge, '15m')).toEqual(aggregateCandlesTs(huge, '15m'))
  })

  it('keeps signed and zero prices while aggregating volume', () => {
    const negative = [
      { time: OPEN, open: -10, high: -8, low: -11, close: -9, volume: 1 },
      { time: OPEN + 300, open: -9, high: -7, low: -10, close: -8, volume: 2 },
    ]
    expect(aggregateCandlesTs(negative, '15m')).toEqual([
      { time: OPEN, open: -10, high: -7, low: -11, close: -8, volume: 3 },
    ])
    expect(aggregateCandles(negative, '15m')).toEqual(aggregateCandlesTs(negative, '15m'))

    const zero = [{ time: OPEN, open: 0, high: 0, low: 0, close: 0, volume: 0 }]
    expect(aggregateCandlesTs(zero, '5m')).toEqual(zero)
  })

  it('keeps duplicates and non-monotonic bars deterministic: first occurrence wins', () => {
    const first = sessionBar(0, 100)
    const duplicate = sessionBar(0, 500)
    const backwards = sessionBar(-1, 42)
    expect(aggregateCandlesTs([first, duplicate], '5m')).toEqual([first])
    expect(aggregateCandlesTs([first, backwards], '5m')).toEqual([first])
    expect(aggregateCandlesTs([backwards, first], '5m')).toEqual([first])
    expect(aggregateCandlesTs([first, duplicate, backwards], '15m')).toEqual([
      { ...first, time: bucketStart(first.time, '15m') },
    ])
  })

  it('never mutates a revealed prefix and never reads a future bar', () => {
    const prefix = [sessionBar(0, 100), sessionBar(1, 101), sessionBar(2, 102)]
    const first = aggregateCandles(prefix, '15m')
    const snapshot = first.map((candle) => ({ ...candle }))

    prefix.push(sessionBar(3, 103))
    expect(first).toEqual(snapshot)
    expect(first[0]!.close).toBe(103)

    const later = aggregateCandles(prefix, '15m')
    expect(later[0]!.close).toBe(103)
    expect(later[1]!.open).toBe(103)

    const source = [sessionBar(0)]
    const passthrough = aggregateCandles(source, '5m')
    source[0]!.close = 999
    expect(passthrough[0]!.close).toBe(101)
  })

  it('treats custom 1440m as the same session-anchored bucket as 1D', () => {
    const tape = syntheticTape().slice(0, 3_000)
    expect(aggregateCandlesTs(tape, '1440m')).toEqual(aggregateCandlesTs(tape, '1D'))
  })
})

describe('wasm acceleration and parity', () => {
  it('routes non-base aggregation through the optional wasm export once, after filtering', () => {
    const core = pristine
    expect(core).not.toBeNull()
    expect(core!.aggregate).toBeTypeOf('function')

    const calls: AggregateInput[] = []
    setWasmCore({
      ...core!,
      aggregate(input) {
        calls.push(input)
        return core!.aggregate!(input)
      },
    })

    const valid = sessionBar(0)
    const source = [sessionBar(-1), { ...valid, high: Number.NaN }, valid, sessionBar(0, 500)]
    const result = aggregateCandles(source, '15m')
    expect(result).toEqual([{ ...valid, time: bucketStart(valid.time, '15m') }])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.bucketStarts).toEqual([bucketStart(valid.time, '15m')])
    expect(calls[0]!.open).toEqual([valid.open])

    aggregateCandles(source, '5m')
    expect(calls).toHaveLength(1)
  })

  it('matches the TypeScript reference across terminal and custom timeframes', () => {
    const tape = syntheticTape()
    const timeframes: SimTimeframe[] = ['5m', '15m', '30m', '1h', '4h', '1D', '45m', '1440m']
    for (const timeframe of timeframes) {
      expect(aggregateCandles(tape, timeframe)).toEqual(aggregateCandlesTs(tape, timeframe))
    }
  })

  it('falls back to the same TypeScript reducer when wasm is absent or fails', () => {
    const tape = syntheticTape().slice(0, 2_000)
    const expected = aggregateCandlesTs(tape, '15m')
    setWasmCore(null)
    expect(aggregateCandles(tape, '15m')).toEqual(expected)

    const core = pristine!
    setWasmCore({ ...core, aggregate: undefined })
    expect(aggregateCandles(tape, '15m')).toEqual(expected)

    setWasmCore({
      ...core,
      aggregate() {
        throw new Error('synthetic aggregate failure')
      },
    })
    expect(aggregateCandles(tape, '15m')).toEqual(expected)
  })
})
