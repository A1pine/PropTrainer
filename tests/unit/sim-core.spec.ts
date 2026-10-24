import { describe, expect, it } from 'vitest'
import { instruments } from '~/domain/instruments/catalog'
import type { Candle } from '~/domain/market/types'
import { SimEngine } from '~/domain/sim/engine'
import { RiskEngine } from '~/domain/sim/risk'
import { aggregateCandles, bucketStart, timeframeMinutes } from '~/domain/sim/timeframe'
import {
  chicagoToUnix,
  isMarketOpen,
  nextSessionOpen,
  sessionClose,
  sessionOpen,
  tradingDayKey,
} from '~/domain/sim/session'
import type { PropTemplate, SimBracketInput } from '~/domain/sim/types'

const MNQ = instruments.require('MNQ')
const DAY = '2026-10-19'
const OPEN = sessionOpen(DAY)

function bar(index: number, open: number, high: number, low: number, close: number, time = OPEN + index * 300): Candle {
  return { time, open, high, low, close, volume: 100 + index }
}

function template(overrides: Partial<PropTemplate> = {}): PropTemplate {
  return {
    id: 'test',
    label: 'Test',
    accountSize: 50_000,
    profitTarget: 0,
    drawdown: { mode: 'static', amount: 2_000, basis: 'equity', floorCap: null, includeUnrealized: true },
    dailyLoss: { amount: 0, action: 'warn' },
    maxContracts: 50,
    maxTradesPerDay: 0,
    minTradingDays: 0,
    consistency: null,
    ...overrides,
  }
}

function riskInput(equity: number, balance = equity, time = OPEN, openContracts = 1) {
  return { equity, balance, unrealized: equity - balance, bar: 1, time, openContracts }
}

describe('session calendar', () => {
  it('maps a Sunday evening to the Monday trade date in both DST regimes', () => {
    const summer = chicagoToUnix(2026, 10, 18, 17)
    const winter = chicagoToUnix(2026, 11, 1, 17)
    expect(new Date(summer * 1_000).toISOString()).toBe('2026-10-18T22:00:00.000Z')
    expect(new Date(winter * 1_000).toISOString()).toBe('2026-11-01T23:00:00.000Z')
    expect(tradingDayKey(summer + 60)).toBe('2026-10-19')
    expect(tradingDayKey(winter + 60)).toBe('2026-11-02')
    expect(isMarketOpen(summer + 60)).toBe(true)
    expect(isMarketOpen(winter + 60)).toBe(true)
  })

  it('keeps the maintenance break and weekend closed', () => {
    expect(isMarketOpen(sessionClose(DAY) + 1800)).toBe(false)
    const fridayClose = sessionClose('2026-10-23')
    expect(isMarketOpen(fridayClose + 1800)).toBe(false)
    expect(nextSessionOpen(fridayClose)).toBe(sessionOpen('2026-10-26'))
  })
})

describe('timeframe aggregation', () => {
  it('aggregates the revealed prefix into session-anchored buckets', () => {
    const candles = [
      bar(0, 100, 102, 99, 101),
      bar(1, 101, 103, 100, 102),
      bar(2, 102, 104, 101, 103),
      bar(3, 103, 105, 102, 104),
      bar(4, 104, 106, 103, 105),
      bar(5, 105, 107, 104, 106),
    ]
    const fifteen = aggregateCandles(candles, '15m')
    expect(fifteen).toHaveLength(2)
    expect(fifteen[0]).toMatchObject({
      time: bucketStart(candles[0].time, '15m'),
      open: 100,
      high: 104,
      low: 99,
      close: 103,
    })
    expect(fifteen[0].volume).toBe(100 + 101 + 102)
    expect(fifteen[1]).toMatchObject({ open: 103, high: 107, low: 102, close: 106 })
  })

  it('does not change history when the prefix grows', () => {
    const candles = [bar(0, 100, 101, 99, 100), bar(1, 100, 102, 99, 101), bar(2, 101, 103, 100, 102)]
    const first = aggregateCandles(candles.slice(0, 3), '15m')
    const second = aggregateCandles(candles.slice(0, 4), '15m')
    expect(second[0]).toEqual(first[0])
    expect(second[0].close).toBe(102)
  })

  it('drops the maintenance break and exposes only supported intervals', () => {
    const outside = bar(0, 100, 101, 99, 100, chicagoToUnix(2026, 10, 19, 16, 30))
    expect(aggregateCandles([outside], '15m')).toEqual([])
    expect(timeframeMinutes('4h')).toBe(240)
    expect(aggregateCandles([bar(0, 1, 1, 1, 1)], '1m' as never)).toEqual([])
  })
})

describe('risk engine', () => {
  it('latches a static equity breach and never recovers', () => {
    const risk = new RiskEngine(template(), 50_000, OPEN)
    expect(risk.update(riskInput(48_001)).some((event) => event.type === 'breach')).toBe(false)
    expect(risk.update(riskInput(48_000)).some((event) => event.type === 'breach')).toBe(true)
    expect(risk.status).toBe('breached')
    risk.update(riskInput(60_000))
    expect(risk.status).toBe('breached')
  })

  it('trails intraday equity and stops at the cap', () => {
    const risk = new RiskEngine(
      template({
        drawdown: {
          mode: 'trailing-intraday',
          amount: 2_000,
          basis: 'equity',
          floorCap: 49_000,
          includeUnrealized: true,
        },
      }),
      50_000,
      OPEN,
    )
    risk.update(riskInput(53_000))
    expect(risk.floor).toBe(49_000)
    expect(risk.update(riskInput(49_000)).some((event) => event.type === 'breach')).toBe(true)
  })

  it('uses the finalized balance for an EOD watermark, not the intraday equity peak', () => {
    const risk = new RiskEngine(
      template({
        drawdown: { mode: 'trailing-eod', amount: 2_000, basis: 'balance', floorCap: null, includeUnrealized: true },
      }),
      50_000,
      OPEN,
    )
    risk.update(riskInput(53_000, 50_500))
    risk.finalizeCurrentDay()
    expect(risk.floor).toBe(48_500)
    expect(
      risk.update(riskInput(50_500, 50_500, sessionOpen('2026-10-20'))).some((event) => event.type === 'breach'),
    ).toBe(false)
  })

  it('locks the session on a daily loss and unlocks on the next tape session', () => {
    const risk = new RiskEngine(template({ dailyLoss: { amount: 1_000, action: 'flatten-lock' } }), 50_000, OPEN)
    const events = risk.update(riskInput(49_000))
    expect(events.some((event) => event.type === 'daily-flatten')).toBe(true)
    expect(risk.status).toBe('daily-lock')
    const next = risk.update(riskInput(49_000, 49_000, sessionOpen('2026-10-20')))
    expect(next.some((event) => event.type === 'new-day')).toBe(true)
    expect(risk.status).toBe('active')
  })

  it('computes consistency from finalized profitable days and rejects a nonpositive denominator', () => {
    const risk = new RiskEngine(template({ consistency: { maxBestDayRatio: 0.55, gate: 'pass' } }), 50_000, OPEN)
    risk.update(riskInput(52_000, 52_000, OPEN))
    risk.recordFill(OPEN, 2_000, 52_000, true)
    risk.finalizeCurrentDay()
    risk.update(riskInput(53_000, 51_000, sessionOpen('2026-10-20')))
    risk.recordFill(sessionOpen('2026-10-20'), 1_000, 53_000, true)
    risk.finalizeCurrentDay()
    expect(risk.consistency()).toMatchObject({ bestDay: 2_000, totalNetProfit: 3_000, eligible: false })

    const empty = new RiskEngine(template({ consistency: { maxBestDayRatio: 0.55, gate: 'pass' } }), 50_000, OPEN)
    expect(empty.consistency()?.ratio).toBeNull()
  })

  it('computes the conditional breach price and rounds toward the breaching tick', () => {
    const risk = new RiskEngine(template(), 50_000, OPEN)
    expect(
      risk.breachPrice({
        side: 'long',
        qty: 1,
        avgPrice: 5_000,
        mark: 5_000,
        pointValue: 50,
        tickSize: 0.25,
        balance: 50_000,
        equity: 50_000,
      }),
    ).toBe(4_960)
    expect(
      risk.breachPrice({
        side: 'short',
        qty: 1,
        avgPrice: 5_000,
        mark: 5_000,
        pointValue: 50,
        tickSize: 0.25,
        balance: 50_000,
        equity: 50_000,
      }),
    ).toBe(5_040)
  })
})

describe('replay engine', () => {
  it('fills a market entry and a reduce-only exit with fees and net P&L', () => {
    const engine = new SimEngine({ instruments: [MNQ], template: template({ accountSize: 1_000_000 }), time: OPEN })
    engine.onBar({ symbol: 'MNQ', candle: bar(0, 100, 101, 99, 100), index: 0 })
    expect(engine.submit({ side: 'long', type: 'market', qty: 1 }, 'MNQ').ok).toBe(true)
    expect(engine.position('MNQ')).toMatchObject({ side: 'long', qty: 1, avgPrice: 100 })
    engine.onBar({ symbol: 'MNQ', candle: bar(1, 100, 105, 99, 104), index: 1 })
    expect(engine.submit({ side: 'short', type: 'market', qty: 1 }, 'MNQ').ok).toBe(true)
    expect(engine.position('MNQ')).toBeNull()
    expect(engine.snapshot().trades).toHaveLength(1)
    expect(engine.snapshot().trades[0]).toMatchObject({ side: 'long', qty: 1, entryPrice: 100, exitPrice: 104 })
    expect(engine.snapshot().trades[0].pnl).toBeCloseTo(8 - 1.24, 6)
  })

  it('fills a bracket target before the stop when the stop is not touched', () => {
    const engine = new SimEngine({ instruments: [MNQ], template: template({ accountSize: 1_000_000 }), time: OPEN })
    engine.onBar({ symbol: 'MNQ', candle: bar(0, 100, 101, 99, 100), index: 0 })
    const bracket: SimBracketInput = { stopLoss: 98, targets: [{ price: 104, qty: 1 }] }
    engine.submit({ side: 'long', type: 'market', qty: 1, bracket }, 'MNQ')
    engine.onBar({ symbol: 'MNQ', candle: bar(1, 100, 105, 99, 104), index: 1 })
    expect(engine.position('MNQ')).toBeNull()
    expect(engine.snapshot().trades[0]).toMatchObject({ exitReason: 'target' })
    expect(engine.snapshot().trades[0].pnl).toBeCloseTo(6.76, 6)
  })

  it('assumes the protective stop is hit first when one bar spans both levels', () => {
    const engine = new SimEngine({ instruments: [MNQ], template: template({ accountSize: 1_000_000 }), time: OPEN })
    engine.onBar({ symbol: 'MNQ', candle: bar(0, 100, 101, 99, 100), index: 0 })
    engine.submit(
      { side: 'long', type: 'market', qty: 1, bracket: { stopLoss: 99, targets: [{ price: 102, qty: 1 }] } },
      'MNQ',
    )
    engine.onBar({ symbol: 'MNQ', candle: bar(1, 100, 103, 98, 101), index: 1 })
    expect(engine.snapshot().trades[0]).toMatchObject({ exitReason: 'stop', exitPrice: 99 })
  })

  it('fills a resting limit only after its creation bar and gaps a stop through the level', () => {
    const engine = new SimEngine({ instruments: [MNQ], template: template({ accountSize: 1_000_000 }), time: OPEN })
    engine.onBar({ symbol: 'MNQ', candle: bar(0, 100, 101, 99, 100), index: 0 })
    engine.submit({ side: 'long', type: 'limit', qty: 1, limitPrice: 95 }, 'MNQ')
    engine.onBar({ symbol: 'MNQ', candle: bar(1, 99, 100, 94, 96), index: 1 })
    expect(engine.position('MNQ')).toMatchObject({ qty: 1, avgPrice: 95 })

    engine.submit({ side: 'long', type: 'stop', qty: 1, stopPrice: 97 }, 'MNQ')
    engine.onBar({ symbol: 'MNQ', candle: bar(2, 98, 99, 97, 98), index: 2 })
    expect(engine.position('MNQ')?.qty).toBe(2)
  })

  it('reverses a position and flattens everything on exitAll', () => {
    const engine = new SimEngine({ instruments: [MNQ], template: template({ accountSize: 1_000_000 }), time: OPEN })
    engine.onBar({ symbol: 'MNQ', candle: bar(0, 100, 101, 99, 100), index: 0 })
    engine.submit({ side: 'long', type: 'market', qty: 1 }, 'MNQ')
    engine.onBar({ symbol: 'MNQ', candle: bar(1, 100, 102, 99, 101), index: 1 })
    expect(engine.reverse('MNQ').ok).toBe(true)
    expect(engine.position('MNQ')).toMatchObject({ side: 'short', qty: 1 })
    engine.exitAll()
    expect(engine.position('MNQ')).toBeNull()
    expect(engine.snapshot().trades).toHaveLength(2)
  })
})
