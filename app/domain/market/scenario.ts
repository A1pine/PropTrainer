import { randomInt, createRng } from '~/domain/shared/rng'
import { instruments } from '~/domain/instruments/catalog'
import type { InstrumentSpec } from '~/domain/instruments/types'
import { computeAtr, computeMetrics, generateCandles } from './generator'
import type { Regime, Scenario, ScenarioFactory, ScenarioRequest } from './types'

const REGIME_WEIGHTS: { regime: Regime; weight: number }[] = [
  { regime: 'uptrend', weight: 0.3 },
  { regime: 'downtrend', weight: 0.3 },
  { regime: 'range', weight: 0.27 },
  { regime: 'expansion', weight: 0.13 },
]

function pickRegime(roll: number): Regime {
  let cursor = 0
  for (const entry of REGIME_WEIGHTS) {
    cursor += entry.weight
    if (roll <= cursor) return entry.regime
  }
  return 'expansion'
}

export function createSeed(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay()
  return day !== 0 && day !== 6
}

function pickSessionDate(rng: ReturnType<typeof createRng>, now: Date): Date {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const daysBack = randomInt(rng, 5, 900)
  date.setUTCDate(date.getUTCDate() - daysBack)
  while (!isWeekday(date)) date.setUTCDate(date.getUTCDate() - 1)
  date.setUTCHours(13, 30, 0, 0)
  return date
}

export interface ScenarioFactoryOptions {
  universe?: readonly InstrumentSpec[]
  warmupBars?: number
  futureBars?: number
  revealBars?: number
  timeframeMinutes?: number
  now?: Date
}

/**
 * Scenario factory: every trainer round, daily challenge, and PK match is
 * produced through the same deterministic pipeline.
 */
export function createScenarioFactory(options: ScenarioFactoryOptions = {}): ScenarioFactory {
  const universe = [...(options.universe ?? instruments.list())]
  if (!universe.length) throw new Error('Scenario factory requires at least one instrument')
  const warmupBars = options.warmupBars ?? 150
  const futureBars = options.futureBars ?? 260
  const revealBars = options.revealBars ?? 300
  const defaultTimeframe = options.timeframeMinutes ?? 5

  function build(seed: string, symbol: string, regime: Regime, timeframeMinutes: number, now: Date): Scenario {
    const instrument = universe.find((item) => item.symbol === symbol)
    if (!instrument) throw new Error(`Instrument ${symbol} is not enabled for this session`)
    const rng = createRng(`${seed}:calendar`)
    const sessionDate = pickSessionDate(rng, now)
    const totalBars = warmupBars + futureBars + revealBars
    const startPrice = instrument.anchorPrice * (0.94 + rng() * 0.12)
    const candles = generateCandles({
      seed: `${seed}:${symbol}:${regime}`,
      instrument,
      regime,
      bars: totalBars,
      startPrice,
      startTime: Math.floor(sessionDate.getTime() / 1000),
      timeframeMinutes,
    })
    const replayStart = warmupBars
    const metrics = computeMetrics(candles, replayStart, instrument)
    // Recompute ATR at the replay decision point so the plan validator only
    // sees information available to the trader.
    metrics.atr = computeAtr(candles, 14, replayStart)

    return {
      id: `${symbol.toLowerCase()}-${seed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}-${replayStart}`,
      seed,
      instrument,
      regime,
      timeframeMinutes,
      candles,
      replayStart,
      revealBars,
      metrics: { ...metrics, atr: Math.round(metrics.atr * 100) / 100 },
      sessionDate: sessionDate.toISOString(),
      createdAt: now.getTime(),
    }
  }

  function create(request: ScenarioRequest = {}): Scenario {
    const seed = request.seed ?? createSeed()
    const now = options.now ?? new Date()
    const rng = createRng(`${seed}:choice`)
    const symbol = request.symbol ?? universe[Math.floor(rng() * universe.length)]!.symbol
    const regime = request.regime ?? pickRegime(rng())
    return build(seed, symbol, regime, request.timeframeMinutes ?? defaultTimeframe, now)
  }

  return {
    create,
    createFromSeed(seed, symbol, regime) {
      const rng = createRng(`${seed}:derive`)
      const fallbackSymbol = universe[Math.floor(rng() * universe.length)]!.symbol
      const fallbackRegime = pickRegime(rng())
      return build(seed, symbol ?? fallbackSymbol, regime ?? fallbackRegime, defaultTimeframe, options.now ?? new Date())
    },
    universe: () => [...universe],
  }
}

export function describeScenario(scenario: Scenario) {
  const date = new Date(scenario.sessionDate)
  return {
    symbol: scenario.instrument.symbol,
    name: scenario.instrument.name,
    date: new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC',
    }).format(date),
    regime: scenario.regime,
    timeframe: `${scenario.timeframeMinutes}m`,
    bars: scenario.candles.length - scenario.replayStart,
  }
}
