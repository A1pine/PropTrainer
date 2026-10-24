import type { Candle } from '~/domain/market/types'
import { sessionClose, tradingDayKey } from '~/domain/sim/session'
import { bucketStart, timeframeMinutes } from '~/domain/sim/timeframe'
import type { SimTimeframe } from '~/domain/sim/types'

/** Locate the containing aggregate, not the next bucket after a fill. */
export function candleIndexAt(candles: readonly Candle[], time: number): number {
  if (!Number.isFinite(time)) return -1
  let left = 0
  let right = candles.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (candles[middle]!.time <= time) left = middle + 1
    else right = middle
  }
  return left - 1
}

export function isFormingCandle(time: number, frame: SimTimeframe, knownTime: number): boolean {
  const end = sessionClose(tradingDayKey(time))
  const minutes = timeframeMinutes(frame)
  const bucketEnd = frame === '1D' ? end : Math.min(end, bucketStart(time, frame) + minutes! * 60)
  return knownTime < bucketEnd
}
