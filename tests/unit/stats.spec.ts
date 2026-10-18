import { describe, expect, it } from 'vitest'
import { aggregateTrades, buildRDistribution, filterTradesByDays, maxDrawdownOf } from '@/domain/stats/aggregate'
import { formatMoney, formatR, formatPercent, maskPrice } from '@/utils/format'
import type { TradeRecord } from '@/domain/stats/types'

function trade(partial: Partial<TradeRecord> & { pnl: number; r: number | null }): TradeRecord {
  const { r, ...rest } = partial
  return {
    id: `t-${Math.random()}`,
    sessionId: 's1',
    roundIndex: 1,
    mode: 'trainer',
    symbol: 'MNQ',
    side: 'long',
    qty: 1,
    entryPrice: 100,
    exitPrice: 101,
    entryBar: 1,
    exitBar: 4,
    entryTime: 1_700_000_000,
    exitTime: 1_700_000_300,
    pnl: partial.pnl,
    fees: 1.24,
    rMultiple: r,
    mae: -20,
    mfe: 60,
    exitReason: 'target',
    regime: 'uptrend',
    followedPlan: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...rest,
  }
}

const trades = [
  trade({ pnl: 120, r: 2, side: 'long', symbol: 'MNQ', regime: 'uptrend' }),
  trade({
    pnl: -60,
    r: -1,
    side: 'short',
    symbol: 'MNQ',
    regime: 'range',
    followedPlan: false,
    exitTime: 1_700_001_000,
  }),
  trade({ pnl: 80, r: 1.5, side: 'long', symbol: 'MES', regime: 'uptrend', exitTime: 1_700_002_000 }),
  trade({ pnl: -40, r: -0.8, side: 'long', symbol: 'MES', regime: 'downtrend', exitTime: 1_700_003_000 }),
]

describe('trade aggregation', () => {
  it('computes win rate, profit factor and R expectancy', () => {
    const stats = aggregateTrades(trades)
    expect(stats.count).toBe(4)
    expect(stats.wins).toBe(2)
    expect(stats.losses).toBe(2)
    expect(stats.winRate).toBe(50)
    expect(stats.netPnl).toBe(100)
    expect(stats.profitFactor).toBeCloseTo(2, 2)
    expect(stats.avgR).toBeCloseTo(0.43, 2)
    expect(stats.followedPlanRate).toBe(75)
    expect(stats.maxDrawdown).toBeLessThan(0)
  })

  it('groups by instrument, regime and side', () => {
    const stats = aggregateTrades(trades)
    const mnq = stats.byInstrument.find((row) => row.symbol === 'MNQ')
    expect(mnq?.trades).toBe(2)
    expect(mnq?.netPnl).toBe(60)
    expect(stats.bySide.find((row) => row.side === 'short')?.netPnl).toBe(-60)
    expect(stats.byRegime.find((row) => row.regime === 'uptrend')?.trades).toBe(2)
  })

  it('builds an equity curve and distribution', () => {
    const stats = aggregateTrades(trades)
    expect(stats.equityCurve.at(-1)?.cumulative).toBe(100)
    expect(stats.equityCurve.length).toBe(4)
    const distribution = buildRDistribution([-3.4, -2, -1, 0.4, 1.2, 3.4])
    expect(distribution[0]?.count).toBe(1)
    expect(distribution.find((bucket) => bucket.from === -2)?.count).toBe(1)
    expect(distribution.at(-1)?.count).toBe(1)
    expect(maxDrawdownOf(trades)).toBeLessThan(0)
  })

  it('filters by day window', () => {
    const filtered = filterTradesByDays(trades, 1, 1_700_003_000_000)
    expect(filtered.length).toBe(4)
    expect(filterTradesByDays(trades, 0).length).toBe(4)
  })

  it('handles an empty book', () => {
    const stats = aggregateTrades([])
    expect(stats.count).toBe(0)
    expect(stats.winRate).toBe(0)
    expect(stats.avgR).toBeNull()
    expect(stats.profitFactor).toBe(0)
  })
})

describe('formatting', () => {
  it('formats money, R and percents', () => {
    expect(formatMoney(12480)).toBe('$12,480.00')
    expect(formatMoney(240, { signed: true })).toBe('+$240.00')
    expect(formatMoney(-125.5)).toBe('-$125.50')
    expect(formatR(1.836)).toBe('+1.84R')
    expect(formatR(-1)).toBe('-1.00R')
    expect(formatPercent(52.34)).toBe('52.3%')
  })

  it('masks prices in blind mode', () => {
    expect(maskPrice(2)).toBe('••.••')
  })
})
