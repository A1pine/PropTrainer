import type { InstrumentSpec } from '~/domain/instruments/types'
import type { LocalDataset } from '~/lib/market/types'

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

export type ScenarioSource = 'synthetic' | 'local'

/** Provenance attached to a real-data sample; null for generated tape. */
export interface ScenarioDatasetMeta {
  source: string
  sourceSymbol: string
  fetchedAt: string
  license: string
  /** Unix seconds of the first bar in the window. */
  windowStart: number
  /** Unix seconds of the last bar in the window. */
  windowEnd: number
  bars: number
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
  source: ScenarioSource
  /** Real-data provenance, or null when the tape was generated. */
  dataset: ScenarioDatasetMeta | null
}

export interface ScenarioRequest {
  symbol?: string
  seed?: string
  regime?: Regime
  timeframeMinutes?: number
  /** When present, the sample is cut from a local pack instead of generated. */
  dataset?: LocalDataset
}

export interface ScenarioFactory {
  create(request?: ScenarioRequest): Scenario
  /** Deterministic sample, used by daily challenges and PK links. */
  createFromSeed(seed: string, symbol?: string, regime?: Regime, dataset?: LocalDataset): Scenario
  universe(): InstrumentSpec[]
}

export const REGIME_LABELS: Record<Regime, string> = {
  uptrend: 'Uptrend',
  downtrend: 'Downtrend',
  range: 'Range',
  expansion: 'Disorder',
}
