import type { Candle } from '~/domain/market/types'
import { getWasmCore, recordWasmError, type AggregateColumns } from '~/domain/wasm/core'
import { isMarketOpen, isSessionTimestamp, nextSessionOpen, sessionOpen, tradingDayKey } from './session'
import type { SimTimeframe } from './types'

/**
 * Timeframes the terminal exposes.
 *
 * The base pack is five minutes, so every higher timeframe is a pure aggregation
 * of the same tape. One-minute and finer intervals are intentionally absent: the
 * data to build them does not exist and synthesising them would invent prices.
 */
export const TERMINAL_TIMEFRAMES: readonly SimTimeframe[] = ['5m', '15m', '30m', '1h', '4h', '1D']

export const BASE_TIMEFRAME: SimTimeframe = '5m'
export const BASE_MINUTES = 5

const TIMEFRAME_PATTERN = /^(\d{1,6})([mh])$/
const MAX_INTRADAY_MINUTES = 24 * 60
/** Bucket starts depend only on timestamp + timeframe, so they are safe to cache. */
const BUCKET_CACHE_LIMIT = 65_536
const bucketStartCaches = new Map<SimTimeframe, Map<number, number>>()

/** Minutes per intraday bar, or null for the session-anchored daily timeframe. */
export function timeframeMinutes(timeframe: SimTimeframe): number | null {
  if (typeof timeframe !== 'string' || timeframe === '1D') return null
  const match = TIMEFRAME_PATTERN.exec(timeframe)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isSafeInteger(value) || value <= 0) return null
  return match[2] === 'h' ? value * 60 : value
}

export function timeframeLabel(timeframe: SimTimeframe): string {
  if (typeof timeframe !== 'string') return String(timeframe)
  if (timeframe === '1D') return '1D'
  return timeframe.toUpperCase()
}

/**
 * Whether `timeframe` can be built from a `baseMinutes` tape.
 *
 * Invalid numbers (NaN, Infinity, zero, fractions, negatives) are unavailable
 * rather than accidentally passing a modulo check.
 */
export function isTimeframeAvailable(timeframe: SimTimeframe, baseMinutes = BASE_MINUTES): boolean {
  if (
    !Number.isFinite(baseMinutes) ||
    !Number.isInteger(baseMinutes) ||
    baseMinutes <= 0 ||
    baseMinutes > MAX_INTRADAY_MINUTES
  ) {
    return false
  }
  if (timeframe === '1D') return true
  const minutes = timeframeMinutes(timeframe)
  if (minutes === null || minutes < baseMinutes || minutes > MAX_INTRADAY_MINUTES) return false
  return minutes % baseMinutes === 0
}

function resolveBucketStart(timestamp: number, timeframe: SimTimeframe): number {
  let cache = bucketStartCaches.get(timeframe)
  if (!cache) {
    cache = new Map()
    bucketStartCaches.set(timeframe, cache)
  }
  const cached = cache.get(timestamp)
  if (cached !== undefined) return cached

  let start: number
  if (!isMarketOpen(timestamp)) {
    // No session contains this bar (maintenance break or weekend), so it joins
    // the next session's first bucket. This keeps bucket starts non-decreasing.
    start = nextSessionOpen(timestamp)
  } else {
    const open = sessionOpen(tradingDayKey(timestamp))
    start = open
    if (timeframe !== '1D') {
      const minutes = timeframeMinutes(timeframe)
      if (minutes === null) throw new Error(`Unsupported timeframe: ${timeframe}`)
      const size = minutes * 60
      start = open + Math.floor((timestamp - open) / size) * size
    }
  }
  if (cache.size >= BUCKET_CACHE_LIMIT) cache.clear()
  cache.set(timestamp, start)
  return start
}

/**
 * Start of the bucket that contains `timestamp`.
 *
 * Intraday buckets are anchored to the Globex session open (17:00 Chicago), not
 * to UTC midnight, so a four-hour candle does not straddle the maintenance break.
 * A timestamp outside a live session (maintenance break or weekend) has no
 * containing bucket, so it anchors to the next session open instead of flooring
 * into a bucket that already closed.
 *
 * Bucket starts are cached per timeframe because they depend only on the
 * timestamp; switching timeframes reuses the same session lookup.
 */
export function bucketStart(timestamp: number, timeframe: SimTimeframe): number {
  if (!Number.isSafeInteger(timestamp)) throw new Error(`Invalid timestamp: ${timestamp}`)
  if (!isTimeframeAvailable(timeframe)) throw new Error(`Unsupported timeframe: ${timeframe}`)
  return resolveBucketStart(timestamp, timeframe)
}

export interface AggregateOptions {
  /** Drop bars outside the Globex session (default true). */
  sessionFilter?: boolean
}

interface NormalizedColumns {
  time: number[]
  open: number[]
  high: number[]
  low: number[]
  close: number[]
  volume: number[]
}

interface PreparedAggregation {
  columns: NormalizedColumns
  /** Null means the input is already at the base timeframe. */
  bucketStarts: number[] | null
}

function positiveZero(value: number): number {
  return value === 0 ? 0 : value
}

/**
 * Validate and normalize once, before any aggregation.
 *
 * The tape is revealed one bar at a time, so this is also the security boundary:
 * missing/non-finite fields, inconsistent OHLC, and non-monotonic timestamps are
 * dropped instead of producing NaN or fake candles. Equal timestamps are
 * deterministic: the first occurrence wins and later duplicates are ignored.
 * Signed and zero prices are valid; volume must be finite and nonnegative.
 */
function normalizeColumns(candles: readonly Candle[], sessionFilter: boolean): NormalizedColumns {
  const time: number[] = []
  const open: number[] = []
  const high: number[] = []
  const low: number[] = []
  const close: number[] = []
  const volume: number[] = []
  let previousTime = Number.NEGATIVE_INFINITY

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]
    if (!candle || typeof candle !== 'object') continue
    const barTime = candle.time
    const barOpen = candle.open
    const barHigh = candle.high
    const barLow = candle.low
    const barClose = candle.close
    const barVolume = candle.volume
    if (!Number.isSafeInteger(barTime) || !isSessionTimestamp(barTime) || barTime <= previousTime) continue
    if (
      !Number.isFinite(barOpen) ||
      !Number.isFinite(barHigh) ||
      !Number.isFinite(barLow) ||
      !Number.isFinite(barClose) ||
      !Number.isFinite(barVolume) ||
      barVolume < 0
    ) {
      continue
    }
    if (!(barHigh >= barLow && barHigh >= barOpen && barHigh >= barClose && barLow <= barOpen && barLow <= barClose)) {
      continue
    }
    // Update monotonicity before the session filter so duplicates and backwards
    // bars stay deterministic even when one of them falls in the break.
    previousTime = barTime
    if (sessionFilter && !isMarketOpen(barTime)) continue
    time.push(barTime)
    open.push(positiveZero(barOpen))
    high.push(positiveZero(barHigh))
    low.push(positiveZero(barLow))
    close.push(positiveZero(barClose))
    volume.push(positiveZero(barVolume))
  }

  return { time, open, high, low, close, volume }
}

function bucketStartsFor(times: readonly number[], timeframe: SimTimeframe): number[] {
  const starts = new Array<number>(times.length)
  for (let index = 0; index < times.length; index += 1) {
    starts[index] = resolveBucketStart(times[index]!, timeframe)
  }
  return starts
}

function columnsToCandles(columns: NormalizedColumns): Candle[] {
  const length = columns.time.length
  const candles = new Array<Candle>(length)
  for (let index = 0; index < length; index += 1) {
    candles[index] = {
      time: columns.time[index]!,
      open: columns.open[index]!,
      high: columns.high[index]!,
      low: columns.low[index]!,
      close: columns.close[index]!,
      volume: columns.volume[index]!,
    }
  }
  return candles
}

function reduceColumns(columns: NormalizedColumns, bucketStarts: readonly number[]): Candle[] {
  const length = columns.time.length
  if (length === 0) return []

  const out: Candle[] = []
  let currentStart = bucketStarts[0]!
  let currentOpen = columns.open[0]!
  let currentHigh = columns.high[0]!
  let currentLow = columns.low[0]!
  let currentClose = columns.close[0]!
  let currentVolume = columns.volume[0]!
  let currentValid = true

  for (let index = 1; index < length; index += 1) {
    const start = bucketStarts[index]!
    if (start === currentStart) {
      const nextHigh = columns.high[index]!
      if (nextHigh > currentHigh) currentHigh = nextHigh
      const nextLow = columns.low[index]!
      if (nextLow < currentLow) currentLow = nextLow
      currentClose = columns.close[index]!
      currentVolume += columns.volume[index]!
      if (!Number.isFinite(currentVolume)) currentValid = false
      continue
    }
    if (currentValid) {
      out.push({
        time: currentStart,
        open: currentOpen,
        high: currentHigh,
        low: currentLow,
        close: currentClose,
        volume: currentVolume,
      })
    }
    currentStart = start
    currentOpen = columns.open[index]!
    currentHigh = columns.high[index]!
    currentLow = columns.low[index]!
    currentClose = columns.close[index]!
    currentVolume = columns.volume[index]!
    currentValid = true
  }

  if (currentValid) {
    out.push({
      time: currentStart,
      open: currentOpen,
      high: currentHigh,
      low: currentLow,
      close: currentClose,
      volume: currentVolume,
    })
  }
  return out
}

/**
 * Validate and resolve the per-bar bucket starts exactly once. Invalid
 * timeframes produce `null` and therefore an empty result, never a partial or
 * silently distorted aggregation.
 */
function prepareAggregation(
  candles: readonly Candle[],
  timeframe: SimTimeframe,
  baseMinutes: number,
  options: AggregateOptions,
): PreparedAggregation | null {
  if (!isTimeframeAvailable(timeframe, baseMinutes)) return null
  const sessionFilter = options.sessionFilter ?? true
  const columns = normalizeColumns(candles, sessionFilter)
  if (columns.time.length === 0) return { columns, bucketStarts: null }
  const minutes = timeframeMinutes(timeframe)
  if (minutes !== null && minutes === baseMinutes) return { columns, bucketStarts: null }
  return { columns, bucketStarts: bucketStartsFor(columns.time, timeframe) }
}

function candlesFromAggregate(result: AggregateColumns): Candle[] {
  if (!result || typeof result !== 'object') throw new Error('WASM aggregate returned no columns')
  const { time, open, high, low, close, volume } = result
  if (!Array.isArray(time) || !Array.isArray(open) || !Array.isArray(high) || !Array.isArray(low)) {
    throw new Error('WASM aggregate returned malformed columns')
  }
  if (!Array.isArray(close) || !Array.isArray(volume)) throw new Error('WASM aggregate returned malformed columns')
  const length = time.length
  if (length === 0) throw new Error('WASM aggregate returned no candles')
  if (open.length !== length || high.length !== length || low.length !== length) {
    throw new Error('WASM aggregate returned mismatched columns')
  }
  if (close.length !== length || volume.length !== length) {
    throw new Error('WASM aggregate returned mismatched columns')
  }

  const candles = new Array<Candle>(length)
  let previousStart = Number.NEGATIVE_INFINITY
  for (let index = 0; index < length; index += 1) {
    const start = time[index]!
    const barOpen = open[index]!
    const barHigh = high[index]!
    const barLow = low[index]!
    const barClose = close[index]!
    const barVolume = volume[index]!
    if (!Number.isSafeInteger(start) || start <= previousStart) {
      throw new Error('WASM aggregate returned non-monotonic buckets')
    }
    if (
      !Number.isFinite(barOpen) ||
      !Number.isFinite(barHigh) ||
      !Number.isFinite(barLow) ||
      !Number.isFinite(barClose) ||
      !Number.isFinite(barVolume) ||
      barVolume < 0
    ) {
      throw new Error('WASM aggregate returned non-finite values')
    }
    if (!(barHigh >= barLow && barHigh >= barOpen && barHigh >= barClose && barLow <= barOpen && barLow <= barClose)) {
      throw new Error('WASM aggregate returned inconsistent OHLC')
    }
    previousStart = start
    candles[index] = {
      time: start,
      open: positiveZero(barOpen),
      high: positiveZero(barHigh),
      low: positiveZero(barLow),
      close: positiveZero(barClose),
      volume: positiveZero(barVolume),
    }
  }
  return candles
}

/**
 * TypeScript reference implementation. It has no WASM dependency and is kept as
 * the parity oracle for the accelerated path.
 */
export function aggregateCandlesTs(
  candles: readonly Candle[],
  timeframe: SimTimeframe,
  baseMinutes = BASE_MINUTES,
  options: AggregateOptions = {},
): Candle[] {
  const prepared = prepareAggregation(candles, timeframe, baseMinutes, options)
  if (!prepared) return []
  if (!prepared.bucketStarts) return columnsToCandles(prepared.columns)
  return reduceColumns(prepared.columns, prepared.bucketStarts)
}

/**
 * Aggregate a revealed base prefix into `timeframe`.
 *
 * The caller passes only bars at or before the cursor. This function never looks
 * ahead: its output depends solely on the supplied prefix. The final bucket may be
 * partially formed; that is the current candle, not a finished one.
 *
 * Calendar/session work happens in TypeScript. When the optional Rust aggregate
 * export exists, the validated OHLCV columns and their bucket starts cross the
 * JSON ABI and Rust performs the O(n) reduce. Any WASM failure records the error
 * and falls back to the identical TypeScript reducer.
 */
export function aggregateCandles(
  candles: readonly Candle[],
  timeframe: SimTimeframe,
  baseMinutes = BASE_MINUTES,
  options: AggregateOptions = {},
): Candle[] {
  const prepared = prepareAggregation(candles, timeframe, baseMinutes, options)
  if (!prepared) return []
  const bucketStarts = prepared.bucketStarts
  if (!bucketStarts) return columnsToCandles(prepared.columns)

  const core = getWasmCore()
  if (core?.aggregate) {
    try {
      return candlesFromAggregate(
        core.aggregate({
          bucketStarts,
          open: prepared.columns.open,
          high: prepared.columns.high,
          low: prepared.columns.low,
          close: prepared.columns.close,
          volume: prepared.columns.volume,
        }),
      )
    } catch (error) {
      recordWasmError(error)
    }
  }
  return reduceColumns(prepared.columns, bucketStarts)
}

/** Number of base bars expected in a complete bucket, if the bucket is intraday. */
export function barsPerBucket(timeframe: SimTimeframe, baseMinutes = BASE_MINUTES): number | null {
  if (!isTimeframeAvailable(timeframe, baseMinutes)) return null
  const minutes = timeframeMinutes(timeframe)
  if (minutes === null) return null
  return Math.max(1, Math.round(minutes / baseMinutes))
}
