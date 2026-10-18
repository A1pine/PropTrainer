import type { ExitReason, Side } from '~/domain/trading/types'
import type { Regime } from '~/domain/market/types'
import type { GradeLetter } from '~/domain/drill/grade'

export type SessionMode = 'trainer' | 'drill' | 'daily' | 'pk'

export interface TradeRecord {
  id: string
  sessionId: string
  roundIndex: number
  mode: SessionMode
  symbol: string
  side: Side
  qty: number
  entryPrice: number
  exitPrice: number
  entryBar: number
  exitBar: number
  entryTime: number
  exitTime: number
  pnl: number
  fees: number
  rMultiple: number | null
  mae: number
  mfe: number
  exitReason: ExitReason
  regime: Regime
  followedPlan: boolean
  createdAt: string
}

export interface RoundRecord {
  id: string
  sessionId: string
  index: number
  mode: SessionMode
  symbol: string
  sessionDate: string
  regime: Regime
  timeframeMinutes: number
  startBalance: number
  endBalance: number
  netPnl: number
  fees: number
  rMultiple: number | null
  trades: TradeRecord[]
  grade: GradeLetter | null
  processScore: number | null
  status: 'active' | 'breached' | 'target' | 'ended'
  startedAt: string
  endedAt: string
  reveal: boolean
}

export interface SessionRecord {
  id: string
  mode: SessionMode
  startedAt: string
  endedAt: string | null
  rounds: RoundRecord[]
  startBalance: number
  endBalance: number
  netPnl: number
  fees: number
  ruleStatus: 'active' | 'breached' | 'target' | 'ended'
  targetRounds: number
  completed: boolean
}
