import type { Candle } from '~/domain/market/types'
import type { InstrumentSpec } from '~/domain/instruments/types'

export type SimSide = 'long' | 'short'
export type SimOrderType = 'market' | 'limit' | 'stop' | 'stop-limit' | 'trailing-stop' | 'trailing-stop-limit'
export type SimTimeInForce = 'day' | 'gtc' | 'gtd'
export type SimOrderStatus = 'suspended' | 'working' | 'filled' | 'cancelled' | 'rejected' | 'expired'
export type SimOrderRole = 'entry' | 'stop' | 'target' | 'exit'
export type SimExitReason =
  'stop' | 'target' | 'manual' | 'flatten' | 'reverse' | 'breach' | 'daily-lock' | 'session-end'
export type SimTimeframe = `${number}m` | `${number}h` | '1D'
export type SimChartStyle = 'candles' | 'ohlc' | 'line' | 'heikin-ashi'

export interface SimAtm {
  breakEven: { triggerTicks: number; offsetTicks: number } | null
  trailing: { triggerTicks: number; distanceTicks: number; stepTicks: number } | null
}

export interface SimTargetInput {
  price: number
  qty: number
}

export interface SimBracketInput {
  stopLoss: number | null
  targets: SimTargetInput[]
  atm?: SimAtm | null
}

export interface SimOrderInput {
  side: SimSide
  type: SimOrderType
  qty: number
  limitPrice?: number | null
  stopPrice?: number | null
  trailTicks?: number | null
  limitOffsetTicks?: number | null
  tif?: SimTimeInForce
  expiresAt?: number | null
  releaseAt?: number | null
  bracket?: SimBracketInput | null
  /**
   * Explicitly request a reduce-only exit. An order whose side is opposite an
   * open position is always treated as reduce-only, even when this is omitted.
   */
  reduceOnly?: boolean
  tag?: string
}

export interface SimOrder {
  id: string
  symbol: string
  side: SimSide
  type: SimOrderType
  qty: number
  limitPrice: number | null
  stopPrice: number | null
  trailTicks: number | null
  limitOffsetTicks: number | null
  trailAnchor: number | null
  triggered: boolean
  tif: SimTimeInForce
  expiresAt: number | null
  releaseAt: number | null
  status: SimOrderStatus
  role: SimOrderRole
  reduceOnly: boolean
  parentId: string | null
  ocoId: string | null
  bracket: SimBracketInput | null
  createdBar: number
  createdTime: number
  filledBar: number | null
  filledTime: number | null
  filledPrice: number | null
  filledQty: number
  cancelledBar: number | null
  reason: string | null
  tag: string
}

export interface SimFill {
  id: string
  orderId: string
  symbol: string
  side: SimSide
  qty: number
  price: number
  bar: number
  time: number
  role: SimOrderRole
  fee: number
  /** Cash change on this fill, including its fee (entry fees are negative). */
  cashDelta: number
  reason: SimExitReason | null
}

export interface SimTargetLeg extends SimTargetInput {
  id: string
}

export interface SimPosition {
  id: string
  symbol: string
  side: SimSide
  qty: number
  avgPrice: number
  entryBar: number
  entryTime: number
  stopLoss: number | null
  targets: SimTargetLeg[]
  initialRisk: number
  entryFee: number
  mae: number
  mfe: number
  bestPrice: number
  atm: SimAtm | null
  breakEvenDone: boolean
  tag: string
}

export interface SimTrade {
  id: string
  positionId: string
  symbol: string
  side: SimSide
  qty: number
  entryPrice: number
  exitPrice: number
  entryBar: number
  exitBar: number
  entryTime: number
  exitTime: number
  exitReason: SimExitReason
  grossPnl: number
  fees: number
  pnl: number
  rMultiple: number | null
  mae: number
  mfe: number
  tag: string
}

export type DrawdownMode = 'static' | 'trailing-intraday' | 'trailing-eod'
export type DrawdownBasis = 'balance' | 'equity'
export type DailyLossAction = 'warn' | 'flatten' | 'flatten-lock'

export interface DrawdownRule {
  mode: DrawdownMode
  amount: number
  /** Basis of the trailing watermark, independent of breach monitoring. */
  basis: DrawdownBasis
  /** The trailing floor stops rising here; null means uncapped. */
  floorCap: number | null
  /** Monitor equity when true, balance when false; does not select the watermark. */
  includeUnrealized: boolean
}

export interface DailyLossRule {
  /** Zero disables the circuit breaker. */
  amount: number
  action: DailyLossAction
}

export interface ConsistencyRule {
  maxBestDayRatio: number
  gate: 'pass' | 'payout'
}

export interface PropTemplate {
  id: string
  label: string
  accountSize: number
  profitTarget: number
  drawdown: DrawdownRule
  dailyLoss: DailyLossRule
  maxContracts: number
  /** Completed flat-to-flat positions per trading day; zero is unlimited. */
  maxTradesPerDay: number
  minTradingDays: number
  consistency: ConsistencyRule | null
  source?: string
}

export type SimRuleId = 'profit' | 'drawdown' | 'daily' | 'contracts' | 'trades' | 'days' | 'consistency' | 'margin'
export type SimRuleState = 'ok' | 'near' | 'breached' | 'done' | 'gated'
export type SimAccountStatus = 'active' | 'daily-lock' | 'breached' | 'target'

export interface SimRuleStatus {
  id: SimRuleId
  value: number
  limit: number
  percent: number
  remaining: number
  state: SimRuleState
}

export interface SimBreach {
  rule: SimRuleId
  bar: number
  time: number
  equity: number
  floor: number
  message: string
}

export interface SimDayLedger {
  key: string
  /** Realized cash changes, including fees on the day they were charged. */
  realizedPnl: number
  trades: number
  fills: number
  startEquity: number
  /** Last mark-to-market values seen before the session closed (optional for old checkpoints). */
  endEquity?: number
  endBalance?: number
  /** A day is final only after its session has closed. */
  finalized: boolean
}

export interface ConsistencyStatus {
  bestDay: number
  totalNetProfit: number
  ratio: number | null
  limit: number
  eligible: boolean
  gate: 'pass' | 'payout'
}

export interface RiskState {
  template: PropTemplate
  startBalance: number
  /** Peak of the configured balance/equity basis, not necessarily equity. */
  peakEquity: number
  floor: number
  status: SimAccountStatus
  breach: SimBreach | null
  days: SimDayLedger[]
  currentDay: string
  dayStartEquity: number
  lastEquity: number
  lastBalance: number
  lastTime: number
  dailyTriggered: boolean
  dailyWarned: boolean
}

export interface RiskInput {
  equity: number
  balance: number
  unrealized: number
  bar: number
  time: number
  openContracts: number
}

export interface RiskEvent {
  type: 'breach' | 'daily-lock' | 'daily-flatten' | 'daily-warning' | 'target' | 'new-day'
  rule?: SimRuleId
  message: string
  day?: string
}

export interface SimAccount {
  startBalance: number
  balance: number
  equity: number
  /** Net realized cash since inception, including open-position entry fees. */
  realizedPnl: number
  unrealizedPnl: number
  fees: number
  dayPnl: number
  openContracts: number
  marginUsed: number
  buyingPower: number
}

export interface SimMark {
  price: number
  time: number
  bar: number
}

export interface SimSnapshot {
  account: SimAccount
  positions: SimPosition[]
  orders: SimOrder[]
  fills: SimFill[]
  trades: SimTrade[]
  risk: RiskState
  ruleStatuses: SimRuleStatus[]
  consistency: ConsistencyStatus | null
  marks: Record<string, SimMark>
  bar: number
  time: number
  status: SimAccountStatus
  events: SimEvent[]
}

export interface SimEvent {
  id: number
  bar: number
  time: number
  type:
    | 'submitted'
    | 'filled'
    | 'cancelled'
    | 'modified'
    | 'rejected'
    | 'expired'
    | 'released'
    | 'triggered'
    | 'trade'
    | 'breach'
    | 'daily-lock'
    | 'daily-flatten'
    | 'daily-warning'
    | 'target'
    | 'new-day'
    | 'session-close'
  symbol: string | null
  orderId: string | null
  message: string
}

export type SimResult = { ok: true; orderId?: string } | { ok: false; error: string }

export interface SimBarContext {
  symbol: string
  candle: Candle
  index: number
}

export interface SimEngineOptions {
  instruments: readonly InstrumentSpec[]
  template: PropTemplate
  time: number
}

export interface SimEngineCounters {
  order: number
  fill: number
  trade: number
  position: number
  event: number
}

/** Serialized accounting state. Tapes and instrument specs live in the run. */
export interface SimEngineState {
  schemaVersion: 1
  template: PropTemplate
  symbols: string[]
  balance: number
  realizedGross: number
  fees: number
  bar: number
  time: number
  risk: RiskState
  positions: SimPosition[]
  orders: SimOrder[]
  marks: Record<string, SimMark>
  fills: SimFill[]
  trades: SimTrade[]
  events: SimEvent[]
  counters: { order: number; fill: number; trade: number; position: number; event: number }
  closedSessions: string[]
}
