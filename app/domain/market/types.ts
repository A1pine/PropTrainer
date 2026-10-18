import type { InstrumentSpec } from '~/domain/instruments/types'

export type Regime = 'uptrend' | 'downtrend' | 'range' | 'expansion'

export interface Candle {
  /** Unix seconds. Hidden until review. */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SwingPoint {
  index: number
  price: number
  kind: 'high' | 'low'
}

export interface ScenarioMetrics {
  /** Net change across the hidden future window, in percent. */
  changePct: number
  /** Maximum favourable excursion for a long from the replay start, in percent. */
  maxUpPct: number
  /** Maximum adverse excursion for a long from the replay start, in percent. */
  maxDownPct: number
  /** Kaufman efficiency ratio of the future window: 1 = clean trend, 0 = noise. */
  efficiency: number
  /** True range average over the replay window. */
  atr: number
}

export interface Scenario {
  id: string
  seed: string
  instrument: InstrumentSpec
  regime: Regime
  timeframeMinutes: number
  candles: Candle[]
  /** Index of the first hidden bar. Bars before it are visible warm-up. */
  replayStart: number
  /** Number of bars revealed after the round ends. */
  revealBars: number
  metrics: ScenarioMetrics
  sessionDate: string
  createdAt: number
}

export interface ScenarioRequest {
  symbol?: string
  seed?: string
  regime?: Regime
  timeframeMinutes?: number
}

export interface ScenarioFactory {
  create(request?: ScenarioRequest): Scenario
  /** Deterministic sample, used by daily challenges and PK links. */
  createFromSeed(seed: string, symbol?: string, regime?: Regime): Scenario
  universe(): InstrumentSpec[]
}

export const REGIME_LABELS: Record<Regime, string> = {
  uptrend: 'Uptrend',
  downtrend: 'Downtrend',
  range: 'Range',
  expansion: 'Disorder',
}
