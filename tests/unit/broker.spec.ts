import { describe, expect, it } from 'vitest'
import { createBroker } from '@/domain/trading/broker'
import { computePositionSize } from '@/domain/trading/sizing'
import { evaluateRules } from '@/domain/trading/rules'
import { createRules, PROP_PRESETS, type PropRules } from '@/domain/trading/types'
import { createInstrument } from '@/domain/instruments/types'
import { instruments } from '@/domain/instruments/catalog'
import type { Candle } from '@/domain/market/types'

const unit = createInstrument({
  symbol: 'TEST',
  name: 'Test Future',
  exchange: 'TEST',
  category: 'micro-future',
  tickSize: 1,
  tickValue: 1,
  pointValue: 1,
  pricePrecision: 0,
  feePerContract: 0,
  intradayMargin: 100,
  sessionLabel: 'all',
  anchorPrice: 100,
  volatility: 1,
  mask: 'T???',
})

const rules: PropRules = {
  ...PROP_PRESETS['eval-50k'],
  accountSize: 50_000,
  profitTarget: 1_000,
  maxDrawdown: 2_000,
  dailyLossLimit: 1_000,
  maxContracts: 10,
}

function candle(open: number, high: number, low: number, close: number): Candle {
  return { time: 0, open, high, low, close, volume: 100 }
}

function newBroker(overrides: Partial<PropRules> = {}) {
  return createBroker({
    instrument: unit,
    rules: { ...rules, ...overrides },
    feePerContract: 0,
  })
}

describe('risk sizing', () => {
  it('sizes MNQ contracts from a dollar risk budget', () => {
    const instrument = instruments.require('MNQ')
    const result = computePositionSize({
      instrument,
      entry: 19_450,
      stop: 19_440,
      riskBudget: 500,
      maxContracts: 5,
      target: 19_475,
    })
    // 40 ticks * $0.50 + $1.24 round turn = $21.24 risk per contract.
    expect(result.riskPerContract).toBeCloseTo(21.24, 2)
    expect(result.contracts).toBe(5)
    expect(result.cappedByMax).toBe(true)
    expect(result.stopTicks).toBe(40)
    expect(result.rr).toBeCloseTo(2.35, 2)
  })

  it('returns zero contracts when one contract exceeds the risk budget', () => {
    const result = computePositionSize({
      instrument: instruments.require('NQ'),
      entry: 19_450,
      stop: 19_400,
      riskBudget: 100,
      maxContracts: 5,
    })
    expect(result.contracts).toBe(0)
    expect(result.riskAmount).toBe(0)
  })

  it('handles missing stops without dividing by zero', () => {
    const result = computePositionSize({
      instrument: instruments.require('MNQ'),
      entry: 19_450,
      stop: null,
      riskBudget: 500,
      maxContracts: 5,
    })
    expect(result.contracts).toBe(0)
    expect(result.rr).toBeNull()
  })
})

describe('prop rules', () => {
  it('tracks trailing drawdown and profit progress', () => {
    const statuses = evaluateRules(
      { equity: 51_500, peakEquity: 51_800, startBalance: 50_000, dailyPnl: 1_500, openContracts: 2 },
      rules,
    )
    const drawdown = statuses.find((status) => status.id === 'drawdown')
    const profit = statuses.find((status) => status.id === 'profit')
    expect(drawdown?.remaining).toBeCloseTo(1_700, 2)
    expect(drawdown?.state).toBe('ok')
    expect(profit?.state).toBe('done')
    expect(statuses.find((status) => status.id === 'contracts')?.percent).toBe(20)
  })

  it('derives custom risk from the account size', () => {
    const custom = createRules({ preset: 'custom', accountSize: 80_000, maxContracts: 8 })
    expect(custom.profitTarget).toBe(4_800)
    expect(custom.maxDrawdown).toBe(3_200)
    expect(custom.dailyLossLimit).toBe(1_600)
  })
})

describe('broker', () => {
  it('fills market orders at the reference price and charges fees', () => {
    const broker = createBroker({ instrument: unit, rules, feePerContract: 2 })
    broker.prime(100, 0)
    const result = broker.placeOrder({ side: 'long', type: 'market', qty: 2, stopLoss: 99, takeProfit: 103 }, 100, 0)
    expect(result.ok).toBe(true)
    const snapshot = broker.snapshot()
    expect(snapshot.position?.entryPrice).toBe(100)
    expect(snapshot.fees).toBe(2) // half round-turn per contract on entry
    expect(snapshot.equity).toBe(49_998)
  })

  it('requires a stop and valid bracket geometry', () => {
    const broker = newBroker()
    const noStop = broker.placeOrder({ side: 'long', type: 'market', qty: 1, stopLoss: null, takeProfit: null }, 100, 0)
    expect(noStop.ok).toBe(false)

    const wrongStop = broker.placeOrder(
      { side: 'long', type: 'market', qty: 1, stopLoss: 101, takeProfit: null },
      100,
      0,
    )
    expect(wrongStop.ok).toBe(false)

    const badTarget = broker.placeOrder(
      { side: 'long', type: 'market', qty: 1, stopLoss: 99, takeProfit: 99.5 },
      100,
      0,
    )
    expect(badTarget.ok).toBe(false)
  })

  it('exits at the stop and records an R multiple', () => {
    const broker = newBroker()
    broker.prime(100, 0)
    broker.placeOrder({ side: 'long', type: 'market', qty: 1, stopLoss: 99, takeProfit: 103 }, 100, 0)
    const update = broker.onBar(candle(100, 100.4, 98.6, 99.2), 1)
    expect(update.events.some((event) => event.type === 'exit')).toBe(true)
    const trade = update.snapshot.trades[0]
    expect(trade?.exitReason).toBe('stop')
    expect(trade?.exitPrice).toBe(99)
    expect(trade?.pnl).toBe(-1)
    expect(trade?.rMultiple).toBe(-1)
    expect(update.snapshot.position).toBeNull()
  })

  it('exits at the target and keeps the position flat', () => {
    const broker = newBroker()
    broker.placeOrder({ side: 'long', type: 'market', qty: 2, stopLoss: 99, takeProfit: 103 }, 100, 0)
    const update = broker.onBar(candle(100, 103.2, 99.8, 102.5), 1)
    expect(update.snapshot.trades[0]?.exitReason).toBe('target')
    expect(update.snapshot.trades[0]?.pnl).toBe(6)
    expect(update.snapshot.trades[0]?.rMultiple).toBe(3)
  })

  it('assumes the stop first when a bar touches both levels', () => {
    const broker = newBroker()
    broker.placeOrder({ side: 'long', type: 'market', qty: 1, stopLoss: 99, takeProfit: 103 }, 100, 0)
    const update = broker.onBar(candle(100, 104, 98, 102), 1)
    expect(update.snapshot.trades[0]?.exitReason).toBe('stop')
    expect(update.snapshot.trades[0]?.pnl).toBe(-1)
  })

  it('fills a gap through the stop at the open, not the stop price', () => {
    const broker = newBroker()
    broker.placeOrder({ side: 'long', type: 'market', qty: 1, stopLoss: 99, takeProfit: 110 }, 100, 0)
    const update = broker.onBar(candle(96, 97, 95, 96.5), 1)
    expect(update.snapshot.trades[0]?.exitPrice).toBe(96)
    expect(update.snapshot.trades[0]?.pnl).toBe(-4)
  })

  it('works a limit order until price trades through it', () => {
    const broker = newBroker()
    broker.prime(100, 0)
    const placed = broker.placeOrder(
      { side: 'long', type: 'limit', limitPrice: 98, qty: 1, stopLoss: 97, takeProfit: 101 },
      100,
      0,
    )
    expect(placed.ok).toBe(true)
    const resting = broker.onBar(candle(100, 100.5, 99, 99.5), 1)
    expect(resting.snapshot.position).toBeNull()
    expect(resting.snapshot.orders[0]?.status).toBe('working')
    const filled = broker.onBar(candle(99, 99.2, 97.8, 98.2), 2)
    expect(filled.snapshot.orders[0]?.status).toBe('filled')
    expect(filled.snapshot.orders[0]?.filledPrice).toBe(98)
  })

  it('cancels working orders', () => {
    const broker = newBroker()
    const placed = broker.placeOrder(
      { side: 'short', type: 'limit', limitPrice: 104, qty: 1, stopLoss: 105, takeProfit: 100 },
      100,
      0,
    )
    expect(placed.ok).toBe(true)
    if (!placed.ok) return
    expect(broker.cancelOrder(placed.order.id)).toBe(true)
    expect(broker.snapshot().orders[0]?.status).toBe('cancelled')
  })

  it('locks trading after a drawdown breach', () => {
    const broker = newBroker({ maxDrawdown: 5, dailyLossLimit: 10_000 })
    broker.placeOrder({ side: 'long', type: 'market', qty: 10, stopLoss: 99, takeProfit: 105 }, 100, 0)
    const update = broker.onBar(candle(100, 100, 98.5, 98.5), 1)
    expect(update.snapshot.status).toBe('breached')
    expect(update.snapshot.breach).toBe('drawdown')
    const blocked = broker.placeOrder({ side: 'long', type: 'market', qty: 1, stopLoss: 98, takeProfit: 102 }, 98.5, 2)
    expect(blocked.ok).toBe(false)
  })

  it('marks the evaluation passed when the profit target is reached', () => {
    const broker = newBroker({ profitTarget: 100, maxDrawdown: 5_000 })
    broker.placeOrder({ side: 'long', type: 'market', qty: 2, stopLoss: 99, takeProfit: 210 }, 100, 0)
    const update = broker.onBar(candle(100, 160, 99.5, 158), 1)
    expect(update.snapshot.status).toBe('target')
    expect(update.events.some((event) => event.type === 'target')).toBe(true)
  })

  it('tracks MAE and MFE in dollars', () => {
    const broker = newBroker({ maxDrawdown: 5_000, dailyLossLimit: 5_000 })
    broker.placeOrder({ side: 'long', type: 'market', qty: 1, stopLoss: 90, takeProfit: 130 }, 100, 0)
    broker.onBar(candle(100, 108, 96, 104), 1)
    const snapshot = broker.snapshot()
    expect(snapshot.position?.mfe).toBe(8)
    expect(snapshot.position?.mae).toBe(4)
  })

  it('resets to a clean account', () => {
    const broker = newBroker()
    broker.placeOrder({ side: 'long', type: 'market', qty: 1, stopLoss: 99, takeProfit: 103 }, 100, 0)
    broker.onBar(candle(100, 100, 98, 98.5), 1)
    broker.reset()
    const snapshot = broker.snapshot()
    expect(snapshot.equity).toBe(50_000)
    expect(snapshot.trades).toHaveLength(0)
    expect(snapshot.status).toBe('active')
  })
})
