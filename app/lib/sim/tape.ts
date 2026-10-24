import type { Candle } from '~/domain/market/types'
import type { InstrumentSpec } from '~/domain/instruments/types'
import { generateMarketData } from '~/domain/market/generator'
import { isMarketOpen, nextSessionOpen, sessionOpen } from '~/domain/sim/session'
import type { LocalDataset } from '~/lib/market/types'
import { parseTimeframeMinutes } from '~/lib/market/types'

export const REPLAY_BASE_SECONDS = 300
export const REPLAY_WARMUP = 260

export interface ReplayTape {
  symbol: string
  source: 'local' | 'synthetic'
  sourceSymbol: string
  provenance: string
  fetchedAt: string | null
  candles: Candle[]
}

export interface ReplayMarket {
  tapes: ReplayTape[]
  timeline: number[]
  startIndex: number
}

export function validReplayCandle(candle: Candle): boolean {
  return (
    Number.isInteger(candle.time) &&
    candle.time % REPLAY_BASE_SECONDS === 0 &&
    [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) &&
    candle.volume >= 0 &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    isMarketOpen(candle.time)
  )
}

export function localReplayTape(dataset: LocalDataset): ReplayTape | null {
  if (parseTimeframeMinutes(dataset.timeframe) !== 5) return null
  const fetched = Date.parse(dataset.fetchedAt) / 1000
  if (!Number.isFinite(fetched)) return null
  const candles: Candle[] = []
  for (let index = 0; index < dataset.t.length; index += 1) {
    const candle: Candle = {
      time: dataset.t[index]!,
      open: dataset.o[index]!,
      high: dataset.h[index]!,
      low: dataset.l[index]!,
      close: dataset.c[index]!,
      volume: dataset.v[index]!,
    }
    if (!validReplayCandle(candle) || candle.time + REPLAY_BASE_SECONDS > fetched) continue
    if (candles.length && candle.time <= candles[candles.length - 1]!.time) return null
    candles.push(candle)
  }
  if (candles.length < REPLAY_WARMUP + 40) return null
  return {
    symbol: dataset.symbol,
    source: 'local',
    sourceSymbol: dataset.sourceSymbol,
    provenance: `${dataset.source} · ${dataset.license}`,
    fetchedAt: dataset.fetchedAt,
    candles,
  }
}

export function syntheticReplayTape(instrument: InstrumentSpec, seed: string, bars = 1800): ReplayTape {
  const startTime = sessionOpen('2026-10-19')
  const generated = generateMarketData({
    seed: `terminal:${seed}:${instrument.symbol}`,
    instrument,
    regime: 'range',
    bars,
    startPrice: instrument.anchorPrice,
    startTime,
    timeframeMinutes: 5,
    replayStart: 0,
  })
  let time = startTime
  const candles = generated.candles.map((bar) => {
    if (!isMarketOpen(time)) time = nextSessionOpen(time)
    const candle = { ...bar, time }
    time += REPLAY_BASE_SECONDS
    return candle
  })
  return {
    symbol: instrument.symbol,
    source: 'synthetic',
    sourceSymbol: instrument.symbol,
    provenance: `Deterministic synthetic OHLCV · ${seed}`,
    fetchedAt: null,
    candles,
  }
}

/** All symbols share a clock. A gap stays a gap, never a forward-filled candle. */
export function buildReplayMarket(tapes: ReplayTape[], warmup = REPLAY_WARMUP): ReplayMarket {
  if (!tapes.length || !Number.isInteger(warmup) || warmup < 1) throw new Error('Invalid replay market')
  const symbols = new Set<string>()
  for (const tape of tapes) {
    if (symbols.has(tape.symbol) || tape.candles.length <= warmup) throw new Error('Invalid replay tape')
    symbols.add(tape.symbol)
    let previous = -Infinity
    for (const candle of tape.candles) {
      if (!validReplayCandle(candle) || candle.time <= previous) throw new Error('Invalid replay candles')
      previous = candle.time
    }
  }
  const startTime = Math.max(...tapes.map((tape) => tape.candles[warmup - 1]!.time))
  const endTime = Math.min(...tapes.map((tape) => tape.candles[tape.candles.length - 1]!.time))
  const timeline = [...new Set(tapes.flatMap((tape) => tape.candles.map((bar) => bar.time)))]
    .filter((time) => time <= endTime)
    .sort((a, b) => a - b)
  const startIndex = timeline.findIndex((time) => time >= startTime)
  if (startIndex < 0 || timeline.length - startIndex < 2) throw new Error('No overlapping replay window')
  return { tapes, timeline, startIndex }
}

/** Count of closed bars available at the clock's last revealed base-bar time. */
export function revealedCount(candles: readonly Candle[], time: number): number {
  let left = 0
  let right = candles.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (candles[middle]!.time <= time) left = middle + 1
    else right = middle
  }
  return left
}
