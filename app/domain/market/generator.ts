import { roundTo, roundToTick } from '~/domain/shared/math'
import { createRng, gaussian, randomFloat, randomInt, type Rng } from '~/domain/shared/rng'
import type { InstrumentSpec } from '~/domain/instruments/types'
import type { Candle, Regime, ScenarioMetrics, SwingPoint } from './types'

interface GenerateOptions {
  seed: string
  instrument: InstrumentSpec
  regime: Regime
  bars: number
  startPrice: number
  startTime: number
  timeframeMinutes: number
}

/**
 * Generate a deterministic OHLCV path in "sigma units" of volatility.
 * The output is snapped to the instrument tick grid and every bar satisfies
 * low <= min(open, close) <= max(open, close) <= high.
 */
export function generateCandles(options: GenerateOptions): Candle[] {
  const { instrument, regime, bars, startPrice, startTime, timeframeMinutes } = options
  const rng = createRng(options.seed)
  const sigma = instrument.anchorPrice * 0.0009 * instrument.volatility
  const tick = instrument.tickSize
  const volatilityMultiplier = regime === 'expansion' ? 1.45 : regime === 'range' ? 0.85 : 1
  const step = timeframeMinutes * 60

  let price = startPrice
  let center = startPrice
  let phaseLeft = 0
  let phaseDrift = 0
  let phaseVol = volatilityMultiplier
  let impulseDirection: 1 | -1 = regime === 'downtrend' ? -1 : 1
  let rangeBars = randomInt(rng, 24, 52)

  const candles: Candle[] = []

  for (let index = 0; index < bars; index += 1) {
    let drift = 0
    let vol = sigma * volatilityMultiplier

    if (regime === 'uptrend' || regime === 'downtrend') {
      if (phaseLeft <= 0) {
        // Impulse → pullback → chop, repeating. Direction stays with the regime
        // so pullbacks read as continuation patterns, not reversals.
        const roll = rng()
        if (roll < 0.55) {
          phaseLeft = randomInt(rng, 18, 40)
          phaseDrift = impulseDirection * sigma * randomFloat(rng, 0.16, 0.26)
          phaseVol = 1.05
        } else if (roll < 0.82) {
          phaseLeft = randomInt(rng, 7, 16)
          phaseDrift = -impulseDirection * sigma * randomFloat(rng, 0.1, 0.16)
          phaseVol = 0.9
        } else {
          phaseLeft = randomInt(rng, 5, 12)
          phaseDrift = 0
          phaseVol = 0.72
        }
      }
      phaseLeft -= 1
      drift = phaseDrift
      vol = sigma * phaseVol * volatilityMultiplier
      // Slow drift of the pullback reference keeps the trend from looking
      // mechanically linear.
      center += impulseDirection * sigma * 0.02
    } else if (regime === 'range') {
      rangeBars -= 1
      center += gaussian(rng) * sigma * 0.004
      const deviation = price - center
      const band = sigma * 6
      drift = -deviation * 0.045
      if (Math.abs(deviation) > band) {
        // Sweep outside the range, then revert. Keeps range samples honest:
        // edges get tested instead of being perfectly respected.
        drift = -Math.sign(deviation) * sigma * 0.1
      }
      if (rangeBars <= 0 && rng() < 0.05) {
        drift = Math.sign(deviation || 1) * sigma * 0.28
        vol = sigma * 1.15
        rangeBars = randomInt(rng, 24, 52)
      }
      vol = sigma * 0.8
    } else {
      // Disorder: high volatility, weak serial drift, frequent direction flips.
      const flip = rng() < 0.12 ? -1 : 1
      impulseDirection = (impulseDirection * flip) as 1 | -1
      drift = impulseDirection * sigma * 0.035
      vol = sigma * 1.45
    }

    const open = price
    const gap = rng() < 0.012 ? gaussian(rng) * sigma * 0.45 : 0
    const openWithGap = open + gap
    const ret = drift + gaussian(rng) * vol
    const close = openWithGap + ret
    const wickUp = Math.abs(gaussian(rng)) * vol * randomFloat(rng, 0.25, 0.7)
    const wickDown = Math.abs(gaussian(rng)) * vol * randomFloat(rng, 0.25, 0.7)
    const high = Math.max(openWithGap, close) + wickUp
    const low = Math.min(openWithGap, close) - wickDown

    const bar: Candle = {
      time: startTime + index * step,
      open: roundToTick(openWithGap, tick),
      high: roundToTick(high, tick),
      low: roundToTick(low, tick),
      close: roundToTick(close, tick),
      volume: Math.max(1, Math.round(volumeFor(instrument, ret / sigma, rng))),
    }

    // Rounding can flatten a candle; guarantee valid geometry without breaking
    // tick alignment.
    if (bar.high <= Math.max(bar.open, bar.close)) bar.high = Math.max(bar.open, bar.close) + tick
    if (bar.low >= Math.min(bar.open, bar.close)) bar.low = Math.min(bar.open, bar.close) - tick
    if (bar.low <= 0) bar.low = tick

    candles.push(bar)
    price = bar.close
  }

  return candles
}

function volumeFor(instrument: InstrumentSpec, standardizedReturn: number, rng: Rng): number {
  const base = instrument.category === 'commodity-future' ? 1_600 : instrument.category === 'mini-future' ? 3_200 : 5_400
  const noise = 0.65 + rng() * 0.9
  const activity = 1 + Math.min(3.2, Math.abs(standardizedReturn) * 1.4)
  return base * noise * activity
}

export function computeAtr(candles: readonly Candle[], period = 14, endIndex = candles.length): number {
  if (candles.length < 2) return 0
  const start = Math.max(1, Math.min(endIndex, candles.length) - period)
  let total = 0
  let count = 0
  for (let index = start; index < Math.min(endIndex, candles.length); index += 1) {
    const candle = candles[index]
    const previous = candles[index - 1]
    if (!candle || !previous) continue
    const trueRange = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    )
    total += trueRange
    count += 1
  }
  return count ? total / count : 0
}

export function computeMetrics(
  candles: readonly Candle[],
  replayStart: number,
  instrument: InstrumentSpec,
): ScenarioMetrics {
  const start = candles[replayStart]?.open ?? 1
  const window = candles.slice(replayStart)
  if (!window.length) {
    return { changePct: 0, maxUpPct: 0, maxDownPct: 0, efficiency: 0, atr: 0 }
  }
  const highs = Math.max(...window.map((candle) => candle.high))
  const lows = Math.min(...window.map((candle) => candle.low))
  const last = window[window.length - 1]!.close
  const net = Math.abs(last - start)
  const path = window.reduce((total, candle, index) => {
    const previous = index === 0 ? start : window[index - 1]!.close
    return total + Math.abs(candle.close - previous)
  }, 0)
  return {
    changePct: roundTo(((last - start) / start) * 100, 3),
    maxUpPct: roundTo(((highs - start) / start) * 100, 3),
    maxDownPct: roundTo(((lows - start) / start) * 100, 3),
    efficiency: path === 0 ? 0 : roundTo(net / path, 3),
    atr: roundTo(computeAtr(candles, 14, replayStart), instrument.pricePrecision),
  }
}

/**
 * Fractal swing detection (n bars either side). Used for structural stop and
 * target validation in the drill.
 */
export function findSwings(candles: readonly Candle[], strength = 3): SwingPoint[] {
  const swings: SwingPoint[] = []
  for (let index = strength; index < candles.length - strength; index += 1) {
    const candle = candles[index]
    if (!candle) continue
    let isHigh = true
    let isLow = true
    for (let offset = 1; offset <= strength; offset += 1) {
      const left = candles[index - offset]
      const right = candles[index + offset]
      if (!left || !right) continue
      if (candle.high <= left.high || candle.high <= right.high) isHigh = false
      if (candle.low >= left.low || candle.low >= right.low) isLow = false
    }
    if (isHigh) swings.push({ index, price: candle.high, kind: 'high' })
    if (isLow) swings.push({ index, price: candle.low, kind: 'low' })
  }
  return swings
}

export function nearestSwingDistance(
  swings: readonly SwingPoint[],
  price: number,
  endIndex: number,
  kind?: 'high' | 'low',
): number | null {
  const candidates = swings.filter((swing) => swing.index <= endIndex && (kind == null || swing.kind === kind))
  if (!candidates.length) return null
  return Math.min(...candidates.map((swing) => Math.abs(swing.price - price)))
}
