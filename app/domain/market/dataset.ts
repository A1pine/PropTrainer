import type { InstrumentSpec } from '~/domain/instruments/types'
import { parseTimeframeMinutes } from '~/lib/market/types'
import type { LocalDataset } from '~/lib/market/types'
import { roundToTick } from '~/domain/shared/math'
import { createRng, randomInt } from '~/domain/shared/rng'
import { computeMetrics } from './generator'
import type { Candle, Regime, Scenario, ScenarioDatasetMeta, ScenarioMetrics } from './types'

/**
 * How many bars a real-data round consumes: 150 warm-up, 260 hidden future
 * bars, then 300 bars of reveal context. A 60-day 5m pack holds ~17k bars, so
 * there are thousands of non-trivial windows to draw from.
 */
export const DATASET_WINDOW = { warmup: 150, future: 260, reveal: 300 } as const

export function datasetWindowBars(): number {
  return DATASET_WINDOW.warmup + DATASET_WINDOW.future + DATASET_WINDOW.reveal
}

/**
 * A window of `bars` bars can be cut from a dataset of exactly `bars` bars
 * (the only valid start is 0), so no extra bar is required.
 */
export function canUseDataset(dataset: LocalDataset, bars = datasetWindowBars()): boolean {
  return Number.isInteger(bars) && bars > 0 && dataset.bars >= bars
}

/**
 * Real tape has no injected regime label, so classify the hidden window from
 * its own behaviour. The buckets mirror the synthetic generator's vocabulary;
 * they are a description of the sample, not a promise about the future.
 */
export function classifyRegime(metrics: ScenarioMetrics): Regime {
  if (metrics.efficiency >= 0.4) return metrics.changePct >= 0 ? 'uptrend' : 'downtrend'
  if (metrics.efficiency <= 0.18) return 'range'
  return 'expansion'
}

function sliceCandles(dataset: LocalDataset, start: number, count: number): Candle[] {
  const candles: Candle[] = []
  for (let index = start; index < start + count; index += 1) {
    const time = dataset.t[index]
    const open = dataset.o[index]
    const high = dataset.h[index]
    const low = dataset.l[index]
    const close = dataset.c[index]
    const volume = dataset.v[index]
    if (time == null || open == null || high == null || low == null || close == null || volume == null) {
      throw new Error(`Dataset ${dataset.symbol} has a hole at bar ${index}`)
    }
    candles.push({ time, open, high, low, close, volume })
  }
  return candles
}

/**
 * Blind replay must not leak the era or the contract through absolute price.
 * Shift every price by one tick-aligned constant, which preserves point deltas,
 * ranges, ATR and tick geometry while moving the tape near the instrument's
 * anchor level. Percentage returns are not invariant under an additive shift;
 * metrics are therefore computed after rebasing.
 *
 * The offset depends only on the first candle and the visible warm-up. Hidden
 * bars are never inspected, so the normalisation cannot leak the future. The
 * visible warm-up is kept at or above one tick. Hidden prices can translate
 * below zero; clipping would distort their moves, while choosing an offset
 * from their minimum would reintroduce look-ahead. The metric and broker paths
 * therefore accept nonpositive prices (as real crude futures did in 2020).
 */
function rebaseCandles(
  candles: Candle[],
  instrument: InstrumentSpec,
  targetFirstClose: number,
  visibleBars: number,
): Candle[] {
  const tick = instrument.tickSize
  const first = candles[0]!
  let offset = roundToTick(targetFirstClose - first.close, tick)

  const visibleCount = Math.max(1, Math.min(visibleBars, candles.length))
  let visibleLow = Number.POSITIVE_INFINITY
  for (let index = 0; index < visibleCount; index += 1) {
    visibleLow = Math.min(visibleLow, candles[index]!.low)
  }
  if (visibleLow + offset <= tick) {
    offset += tick * Math.ceil((tick - (visibleLow + offset)) / tick)
  }

  return candles.map((candle) => ({
    time: candle.time,
    open: roundToTick(candle.open + offset, tick),
    high: roundToTick(candle.high + offset, tick),
    low: roundToTick(candle.low + offset, tick),
    close: roundToTick(candle.close + offset, tick),
    volume: candle.volume,
  }))
}

export interface DatasetScenarioOptions {
  seed: string
  instrument: InstrumentSpec
  dataset: LocalDataset
  /**
   * Round spacing in minutes. When omitted, the dataset's own timeframe is
   * used. A mismatch is rejected rather than silently labelling a 1h pack as
   * a 5m round.
   */
  timeframeMinutes?: number
  warmupBars?: number
  futureBars?: number
  revealBars?: number
  now?: Date
}

/**
 * Builds a scenario from a local pack. Deterministic in `seed`: the same seed,
 * pack and window policy always produce the same slice.
 */
export function createDatasetScenario(options: DatasetScenarioOptions): Scenario {
  const { seed, instrument, dataset } = options
  const datasetTimeframe = parseTimeframeMinutes(dataset.timeframe)
  if (datasetTimeframe == null) {
    throw new Error(`Dataset ${dataset.symbol} has an unsupported timeframe: ${dataset.timeframe}`)
  }
  const timeframeMinutes = options.timeframeMinutes ?? datasetTimeframe
  if (timeframeMinutes !== datasetTimeframe) {
    throw new Error(
      `Dataset ${dataset.symbol} is ${dataset.timeframe}; cannot build a ${timeframeMinutes}m scenario from it`,
    )
  }
  const warmupBars = options.warmupBars ?? DATASET_WINDOW.warmup
  const futureBars = options.futureBars ?? DATASET_WINDOW.future
  const revealBars = options.revealBars ?? DATASET_WINDOW.reveal
  const totalBars = warmupBars + futureBars + revealBars
  if (!canUseDataset(dataset, totalBars)) {
    throw new Error(`Dataset ${dataset.symbol} needs ${totalBars} bars, has ${dataset.bars}`)
  }

  const rng = createRng(`${seed}:${dataset.symbol}:local-window`)
  const maxStart = dataset.bars - totalBars
  const windowStart = maxStart === 0 ? 0 : randomInt(rng, 0, maxStart)
  const raw = sliceCandles(dataset, windowStart, totalBars)

  // Only the visible warm-up participates in normalisation (see rebaseCandles).
  const replayStart = warmupBars
  const targetFirstClose = instrument.anchorPrice * (0.96 + rng() * 0.08)
  const candles = rebaseCandles(raw, instrument, targetFirstClose, replayStart)
  const metrics = computeMetrics(candles, replayStart, instrument)
  const regime = classifyRegime(metrics)

  const first = candles[0]!
  const last = candles[candles.length - 1]!
  const revealAt = candles[replayStart]!
  const meta: ScenarioDatasetMeta = {
    source: dataset.source,
    sourceSymbol: dataset.sourceSymbol,
    fetchedAt: dataset.fetchedAt,
    license: dataset.license,
    windowStart: first.time,
    windowEnd: last.time,
    bars: candles.length,
  }

  return {
    id: `${dataset.symbol.toLowerCase()}-local-${windowStart}-${seed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`,
    seed,
    instrument,
    regime,
    timeframeMinutes,
    candles,
    replayStart,
    revealBars,
    metrics,
    sessionDate: new Date(revealAt.time * 1000).toISOString(),
    createdAt: (options.now ?? new Date()).getTime(),
    source: 'local',
    dataset: meta,
  }
}
