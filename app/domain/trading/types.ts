import type { AccountPresetId } from '~/domain/settings/schema'

export type Side = 'long' | 'short'
export type OrderType = 'market' | 'limit'
export type OrderStatus = 'working' | 'filled' | 'cancelled' | 'rejected'
export type ExitReason = 'stop' | 'target' | 'manual' | 'flatten' | 'breach' | 'end'

export interface BracketInput {
  stopLoss: number | null
  takeProfit: number | null
}

export interface PlaceOrderInput extends BracketInput {
  side: Side
  type: OrderType
  qty: number
  limitPrice?: number | null
}

export interface Order extends BracketInput {
  id: string
  side: Side
  type: OrderType
  qty: number
  limitPrice: number | null
  status: OrderStatus
  createdBar: number
  filledBar: number | null
  filledPrice: number | null
  reason?: string
}

export interface Position extends BracketInput {
  id: string
  side: Side
  qty: number
  entryPrice: number
  entryBar: number
  /** Initial risk in USD including round-turn fees. */
  initialRisk: number
  entryFee: number
  mae: number
  mfe: number
}

export interface Trade {
  id: string
  side: Side
  qty: number
  entryPrice: number
  exitPrice: number
  entryBar: number
  exitBar: number
  exitReason: ExitReason
  grossPnl: number
  fees: number
  pnl: number
  rMultiple: number | null
  mae: number
  mfe: number
}

export interface PropRules {
  phase: 'evaluation' | 'funded'
  accountSize: number
  /** Profit target in USD; 0 disables the target. */
  profitTarget: number
  /** Trailing drawdown in USD from the equity high-water mark. */
  maxDrawdown: number
  /** Daily loss limit in USD; 0 disables it. */
  dailyLossLimit: number
  maxContracts: number
  /** Maximum number of round trips per session; 0 = unlimited. */
  maxTrades: number
}

export type RuleId = 'profit' | 'drawdown' | 'daily' | 'contracts' | 'trades'
export type RuleState = 'ok' | 'near' | 'breached' | 'done'

export interface RuleStatus {
  id: RuleId
  value: number
  limit: number
  /** 0–100, used for progress meters. */
  percent: number
  remaining: number
  state: RuleState
}

export interface AccountSnapshot {
  startBalance: number
  balance: number
  equity: number
  peakEquity: number
  unrealizedPnl: number
  realizedPnl: number
  netPnl: number
  fees: number
  dailyPnl: number
  openContracts: number
  position: Position | null
  orders: Order[]
  trades: Trade[]
  markPrice: number
  /** Realized + unrealized R for the current round. */
  roundR: number | null
  status: 'active' | 'breached' | 'target'
  breach: RuleId | null
  rules: PropRules
  ruleStatuses: RuleStatus[]
}

export type BrokerEvent =
  | { type: 'filled'; order: Order }
  | { type: 'exit'; trade: Trade }
  | { type: 'cancelled'; orderId: string; reason: string }
  | { type: 'breach'; rule: RuleId; message: string }
  | { type: 'target'; netPnl: number }

export interface BrokerUpdate {
  events: BrokerEvent[]
  snapshot: AccountSnapshot
}

export const PROP_PRESETS: Record<Exclude<AccountPresetId, 'custom'>, PropRules> = {
  'eval-50k': {
    phase: 'evaluation',
    accountSize: 50_000,
    profitTarget: 3_000,
    maxDrawdown: 2_000,
    dailyLossLimit: 1_000,
    maxContracts: 5,
    maxTrades: 0,
  },
  'eval-100k': {
    phase: 'evaluation',
    accountSize: 100_000,
    profitTarget: 6_000,
    maxDrawdown: 3_000,
    dailyLossLimit: 1_500,
    maxContracts: 10,
    maxTrades: 0,
  },
  'funded-50k': {
    phase: 'funded',
    accountSize: 50_000,
    profitTarget: 0,
    maxDrawdown: 2_000,
    dailyLossLimit: 1_000,
    maxContracts: 5,
    maxTrades: 0,
  },
}

export function createRules(input: {
  preset: AccountPresetId
  accountSize: number
  maxContracts: number
  riskPerTrade?: number
}): PropRules {
  if (input.preset === 'custom') {
    return {
      phase: 'evaluation',
      accountSize: input.accountSize,
      profitTarget: Math.round(input.accountSize * 0.06),
      maxDrawdown: Math.round(input.accountSize * 0.04),
      dailyLossLimit: Math.round(input.accountSize * 0.02),
      maxContracts: input.maxContracts,
      maxTrades: 0,
    }
  }
  const preset = PROP_PRESETS[input.preset]
  return { ...preset, accountSize: input.accountSize, maxContracts: input.maxContracts }
}
