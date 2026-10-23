import type { PlanOutcome, TradeDirection } from '~/domain/drill/plan'
import type { Candle } from '~/domain/market/types'
import type { ExitReason, Side, Trade } from './types'

export interface TradeExecution {
  id: string
  side: Side
  entryBar: number
  entryPrice: number
  entryTime: number
  exitBar: number
  exitPrice: number
  exitTime: number
  exitReason: ExitReason | 'timeout'
}

type Fill = Pick<TradeExecution, 'id' | 'side' | 'entryBar' | 'entryPrice' | 'exitBar' | 'exitPrice' | 'exitReason'>

function withBarTimes(fill: Fill, candles: readonly Candle[]): TradeExecution | null {
  if (
    !Number.isInteger(fill.entryBar) ||
    !Number.isInteger(fill.exitBar) ||
    fill.entryBar < 0 ||
    fill.exitBar < fill.entryBar ||
    !Number.isFinite(fill.entryPrice) ||
    !Number.isFinite(fill.exitPrice)
  )
    return null
  const entry = candles[fill.entryBar]
  const exit = candles[fill.exitBar]
  if (!entry || !exit || !Number.isFinite(entry.time) || !Number.isFinite(exit.time)) return null
  return { ...fill, entryTime: entry.time, exitTime: exit.time }
}

export function tradeExecutions(trades: readonly Trade[], candles: readonly Candle[]): TradeExecution[] {
  return trades.flatMap((trade) => {
    const execution = withBarTimes(
      {
        id: trade.id,
        side: trade.side,
        entryBar: trade.entryBar,
        entryPrice: trade.entryPrice,
        exitBar: trade.exitBar,
        exitPrice: trade.exitPrice,
        exitReason: trade.exitReason,
      },
      candles,
    )
    return execution ? [execution] : []
  })
}

export function planExecutions(
  outcome: PlanOutcome | null,
  direction: TradeDirection,
  candles: readonly Candle[],
): TradeExecution[] {
  if (
    direction === 'none' ||
    !outcome?.filled ||
    outcome.exitReason === 'no-entry' ||
    outcome.entryBar == null ||
    outcome.entryPrice == null ||
    outcome.exitBar == null ||
    outcome.exitPrice == null
  )
    return []
  const execution = withBarTimes(
    {
      id: 'plan-fill',
      side: direction,
      entryBar: outcome.entryBar,
      entryPrice: outcome.entryPrice,
      exitBar: outcome.exitBar,
      exitPrice: outcome.exitPrice,
      exitReason: outcome.exitReason,
    },
    candles,
  )
  return execution ? [execution] : []
}
