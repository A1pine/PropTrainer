export type Direction = 'bullish' | 'bearish' | 'neutral'

export interface AnalysisReason {
  code: string
  points: number
  value: number
}

export interface AnalysisBias {
  direction: Direction
  score: number
  confidence: number
  reasons: AnalysisReason[]
}

export interface AnalysisSwing {
  index: number
  price: number
  kind: 'high' | 'low'
  label: 'HH' | 'HL' | 'LH' | 'LL' | 'H' | 'L'
}

export interface StructureBreak {
  index: number
  price: number
  kind: 'bos' | 'choch'
  direction: Direction
}

export interface AnalysisPattern {
  index: number
  kind: string
  direction: Direction
}

export interface AnalysisLevel {
  price: number
  kind: 'support' | 'resistance'
  touches: number
  lastIndex: number
}

export interface FairValueGap {
  from: number
  to: number
  top: number
  bottom: number
  direction: 'bullish' | 'bearish'
  filled: number
}

export interface OrderBlock {
  index: number
  top: number
  bottom: number
  direction: 'bullish' | 'bearish'
}

export interface LiquidityLevel {
  price: number
  kind: 'bsl' | 'ssl'
  touches: number
  index: number
}

export interface LiquiditySweep {
  index: number
  price: number
  direction: 'bullish' | 'bearish'
  kind: 'above' | 'below'
}

export interface ProfileBar {
  price: number
  volume: number
  inValueArea: boolean
  isPoc: boolean
}

export interface Absorption {
  index: number
  price: number
  direction: Direction
}

export interface AnalysisEvent {
  index: number
  time: number
  kind: string
  direction: Direction
  price: number
}

export interface AnalysisTrend {
  direction: Direction
  structure: 'hh_hl' | 'lh_ll' | 'mixed'
  emaAlignment: 'bullish' | 'bearish' | 'flat'
  adx: number | null
  premiumDiscount: number
  rangeHigh: number
  rangeLow: number
  swings: AnalysisSwing[]
  breaks: StructureBreak[]
}

export interface AnalysisPriceAction {
  patterns: AnalysisPattern[]
  levels: AnalysisLevel[]
}

export interface AnalysisIct {
  fvgs: FairValueGap[]
  orderBlocks: OrderBlock[]
  liquidity: LiquidityLevel[]
  sweeps: LiquiditySweep[]
  premiumDiscount: number
  zone: 'premium' | 'equilibrium' | 'discount'
  session: 'asia' | 'london' | 'newYork' | 'late'
  killzone: boolean
}

export interface AnalysisFlow {
  pressure: number
  delta: (number | null)[]
  profile: ProfileBar[]
  poc: number
  vah: number
  val: number
  absorptions: Absorption[]
  divergence: Direction | 'none'
  imbalance: number
}

export interface IndicatorLatest {
  price: number
  ema20: number | null
  ema50: number | null
  ema200: number | null
  vwap: number | null
  bbUpper: number | null
  bbLower: number | null
  rsi: number | null
  macd: number | null
  macdSignal: number | null
  macdHist: number | null
  atr: number | null
  adx: number | null
  volumeSma: number | null
}

export interface AnalysisIndicators {
  ema20: (number | null)[]
  ema50: (number | null)[]
  ema200: (number | null)[]
  vwap: (number | null)[]
  bbUpper: (number | null)[]
  bbLower: (number | null)[]
  rsi: (number | null)[]
  macd: (number | null)[]
  macdSignal: (number | null)[]
  macdHist: (number | null)[]
  atr: (number | null)[]
  adx: (number | null)[]
  latest: IndicatorLatest
}

export interface AnalysisReport {
  bias: AnalysisBias
  trend: AnalysisTrend
  pa: AnalysisPriceAction
  ict: AnalysisIct
  flow: AnalysisFlow
  indicators: AnalysisIndicators
  events: AnalysisEvent[]
}
