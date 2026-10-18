import { average, sum } from '~/domain/shared/math'
import type { TradeRecord } from './types'

export interface TradeStats {
  count: number
  wins: number
  losses: number
  breakEven: number
  winRate: number
  netPnl: number
  grossWin: number
  grossLoss: number
  fees: number
  avgPnl: number
  avgR: number | null
  expectancyR: number | null
  profitFactor: number | null
  bestTrade: TradeRecord | null
  worstTrade: TradeRecord | null
  maxWinStreak: number
  maxLossStreak: number
  avgHoldBars: number
  followedPlanRate: number | null
  maxDrawdown: number
}

export interface InstrumentEdge {
  symbol: string
  trades: number
  winRate: number
  avgR: number | null
  netPnl: number
  fees: number
}

export interface EquityPoint {
  index: number
  time: number
  cumulative: number
  drawdown: number
}

export interface RBucket {
  label: string
  from: number
  to: number
  count: number
}

export interface TradeAggregate extends TradeStats {
  byInstrument: InstrumentEdge[]
  byRegime: { regime: string; trades: number; winRate: number; avgR: number | null; netPnl: number }[]
  equityCurve: EquityPoint[]
  rDistribution: RBucket[]
  bySide: { side: string; trades: number; winRate: number; netPnl: number }[]
}

export function aggregateTrades(trades: readonly TradeRecord[]): TradeAggregate {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime)
  const wins = sorted.filter((trade) => trade.pnl > 0)
  const losses = sorted.filter((trade) => trade.pnl < 0)
  const breakEven = sorted.filter((trade) => trade.pnl === 0)
  const rValues = sorted.map((trade) => trade.rMultiple).filter((value): value is number => value != null)
  const grossWin = sum(wins.map((trade) => trade.pnl))
  const grossLoss = Math.abs(sum(losses.map((trade) => trade.pnl)))

  let streak = 0
  let maxWinStreak = 0
  let maxLossStreak = 0
  for (const trade of sorted) {
    if (trade.pnl > 0) {
      streak = streak > 0 ? streak + 1 : 1
      maxWinStreak = Math.max(maxWinStreak, streak)
    } else if (trade.pnl < 0) {
      streak = streak < 0 ? streak - 1 : -1
      maxLossStreak = Math.min(maxLossStreak, streak)
    } else {
      streak = 0
    }
  }

  const equityCurve = buildEquityCurve(sorted)
  const maxDrawdown = equityCurve.reduce((worst, point) => Math.min(worst, point.drawdown), 0)

  return {
    count: sorted.length,
    wins: wins.length,
    losses: losses.length,
    breakEven: breakEven.length,
    winRate: sorted.length ? Math.round((wins.length / sorted.length) * 1000) / 10 : 0,
    netPnl: round(sum(sorted.map((trade) => trade.pnl))),
    grossWin: round(grossWin),
    grossLoss: round(grossLoss),
    fees: round(sum(sorted.map((trade) => trade.fees))),
    avgPnl: sorted.length ? round(sum(sorted.map((trade) => trade.pnl)) / sorted.length) : 0,
    avgR: rValues.length ? round(average(rValues)) : null,
    expectancyR: rValues.length ? round(average(rValues)) : null,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : grossWin > 0 ? null : 0,
    bestTrade: sorted.reduce<TradeRecord | null>((best, trade) => (!best || trade.pnl > best.pnl ? trade : best), null),
    worstTrade: sorted.reduce<TradeRecord | null>((worst, trade) => (!worst || trade.pnl < worst.pnl ? trade : worst), null),
    maxWinStreak,
    maxLossStreak: Math.abs(maxLossStreak),
    avgHoldBars: sorted.length ? round(average(sorted.map((trade) => trade.exitBar - trade.entryBar + 1))) : 0,
    followedPlanRate: sorted.length
      ? Math.round((sorted.filter((trade) => trade.followedPlan).length / sorted.length) * 1000) / 10
      : null,
    byInstrument: groupBy(sorted, (trade) => trade.symbol).map(([symbol, group]) => ({
      symbol,
      trades: group.length,
      winRate: winRateOf(group),
      avgR: avgROf(group),
      netPnl: round(sum(group.map((trade) => trade.pnl))),
      fees: round(sum(group.map((trade) => trade.fees))),
    })),
    byRegime: groupBy(sorted, (trade) => trade.regime).map(([regime, group]) => ({
      regime,
      trades: group.length,
      winRate: winRateOf(group),
      avgR: avgROf(group),
      netPnl: round(sum(group.map((trade) => trade.pnl))),
    })),
    bySide: groupBy(sorted, (trade) => trade.side).map(([side, group]) => ({
      side,
      trades: group.length,
      winRate: winRateOf(group),
      netPnl: round(sum(group.map((trade) => trade.pnl))),
    })),
    equityCurve,
    rDistribution: buildRDistribution(rValues),
    maxDrawdown,
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const group = map.get(key(item))
    if (group) group.push(item)
    else map.set(key(item), [item])
  }
  return [...map.entries()]
}

function winRateOf(trades: readonly TradeRecord[]): number {
  if (!trades.length) return 0
  return Math.round((trades.filter((trade) => trade.pnl > 0).length / trades.length) * 1000) / 10
}

function avgROf(trades: readonly TradeRecord[]): number | null {
  const values = trades.map((trade) => trade.rMultiple).filter((value): value is number => value != null)
  return values.length ? round(average(values)) : null
}

export function buildEquityCurve(trades: readonly TradeRecord[]): EquityPoint[] {
  let cumulative = 0
  let peak = 0
  return trades.map((trade, index) => {
    cumulative += trade.pnl
    peak = Math.max(peak, cumulative)
    return {
      index: index + 1,
      time: trade.exitTime,
      cumulative: round(cumulative),
      drawdown: round(cumulative - peak),
    }
  })
}

export function buildRDistribution(rValues: readonly number[]): RBucket[] {
  const buckets: RBucket[] = []
  for (let from = -3; from < 3; from += 0.5) {
    const to = from + 0.5
    const count = rValues.filter((value) => value >= from && value < to).length
    buckets.push({ label: `${from > 0 ? '+' : ''}${from.toFixed(1)}`, from, to, count })
  }
  const tail = rValues.filter((value) => value >= 3).length
  buckets.push({ label: '+3.0', from: 3, to: 99, count: tail })
  return buckets
}

export function filterTradesByDays(trades: readonly TradeRecord[], days: number, now = Date.now()): TradeRecord[] {
  if (!Number.isFinite(days) || days <= 0) return [...trades]
  const cutoff = now - days * 24 * 60 * 60 * 1000
  return trades.filter((trade) => trade.exitTime * 1000 >= cutoff)
}

export function maxDrawdownOf(trades: readonly TradeRecord[]): number {
  const curve = buildEquityCurve(trades)
  return round(curve.reduce((worst, point) => Math.min(worst, point.drawdown), 0))
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
