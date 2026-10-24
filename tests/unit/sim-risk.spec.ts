import { describe, expect, it } from 'vitest'
import { RiskEngine } from '~/domain/sim/risk'
import { sessionOpen } from '~/domain/sim/session'
import type { PropTemplate, RiskState } from '~/domain/sim/types'

const DAY = '2026-10-19'
const OPEN = sessionOpen(DAY)
const NEXT = sessionOpen('2026-10-20')

function template(patch: Partial<PropTemplate> = {}): PropTemplate {
  return {
    id: 'risk-test',
    label: 'Risk test',
    accountSize: 50_000,
    profitTarget: 0,
    drawdown: { mode: 'static', amount: 2_000, basis: 'equity', floorCap: null, includeUnrealized: true },
    dailyLoss: { amount: 0, action: 'warn' },
    maxContracts: 50,
    maxTradesPerDay: 0,
    minTradingDays: 0,
    consistency: null,
    ...patch,
  }
}

function input(equity: number, balance = equity, time = OPEN, openContracts = 1) {
  return { equity, balance, unrealized: equity - balance, bar: 1, time, openContracts }
}

function risk(patch: Partial<PropTemplate> = {}, time = OPEN): RiskEngine {
  return new RiskEngine(template(patch), 50_000, time)
}

function assertStateRoundTrip(engine: RiskEngine): void {
  const state: RiskState = JSON.parse(JSON.stringify(engine.state)) as RiskState
  expect(RiskEngine.fromState(state).state).toEqual(engine.state)
  state.floor -= 1
  expect(engine.state.floor).not.toBe(state.floor)
}

describe('drawdown anchors and monitors', () => {
  it('breaches exactly at the static floor, latches, and cannot revive after a recoverable equity print', () => {
    const engine = risk()
    expect(engine.update(input(48_000.01)).some((event) => event.type === 'breach')).toBe(false)
    expect(engine.update(input(48_000)).some((event) => event.type === 'breach')).toBe(true)
    expect(engine.status).toBe('breached')
    expect(engine.update(input(60_000)).some((event) => event.type === 'breach')).toBe(false)
    expect(engine.status).toBe('breached')
    assertStateRoundTrip(engine)
  })

  it('monitors balance only when unrealized P&L is excluded, regardless of a static basis label', () => {
    const engine = risk({
      drawdown: { mode: 'static', amount: 2_000, basis: 'equity', floorCap: null, includeUnrealized: false },
    })
    expect(engine.update(input(47_000, 49_000)).some((event) => event.type === 'breach')).toBe(false)
    expect(engine.update(input(47_000, 48_000)).some((event) => event.type === 'breach')).toBe(true)
  })

  it('keeps the balance watermark separate from the equity monitor for intraday trailing', () => {
    const engine = risk({
      drawdown: { mode: 'trailing-intraday', amount: 2_000, basis: 'balance', floorCap: null, includeUnrealized: true },
    })
    engine.update(input(53_000, 50_500))
    expect(engine.floor).toBe(48_500)
    expect(engine.update(input(48_499, 50_500)).some((event) => event.type === 'breach')).toBe(true)
  })

  it('raises an equity watermark while a balance monitor stays above the floor', () => {
    const engine = risk({
      drawdown: { mode: 'trailing-intraday', amount: 2_000, basis: 'equity', floorCap: null, includeUnrealized: false },
    })
    engine.update(input(53_000, 51_500))
    expect(engine.floor).toBe(51_000)
    expect(engine.update(input(53_000, 51_001)).some((event) => event.type === 'breach')).toBe(false)
    expect(engine.update(input(53_000, 50_999)).some((event) => event.type === 'breach')).toBe(true)
  })

  it('stops a trailing floor at its cap and still latches the breach', () => {
    const engine = risk({
      drawdown: {
        mode: 'trailing-intraday',
        amount: 2_000,
        basis: 'equity',
        floorCap: 49_000,
        includeUnrealized: true,
      },
    })
    engine.update(input(55_000))
    expect(engine.floor).toBe(49_000)
    expect(engine.update(input(49_000)).some((event) => event.type === 'breach')).toBe(true)
  })

  it('advances an EOD watermark only after finalization and includes losing days in the ledger', () => {
    const engine = risk({
      drawdown: { mode: 'trailing-eod', amount: 2_000, basis: 'balance', floorCap: null, includeUnrealized: true },
    })
    engine.update(input(53_000, 50_500))
    expect(engine.floor).toBe(48_000)
    engine.finalizeCurrentDay()
    expect(engine.floor).toBe(48_500)
    expect(engine.finalizeCurrentDay()).toBe(false)
    expect(engine.floor).toBe(48_500)

    engine.update(input(53_500, 51_500, NEXT))
    engine.recordFill(NEXT, 1_000, 53_500, true)
    engine.finalizeDay('2026-10-20')
    expect(engine.floor).toBe(49_500)
    expect(engine.state.days.find((day) => day.key === '2026-10-20')).toMatchObject({
      realizedPnl: 1_000,
      finalized: true,
    })

    engine.update(input(49_700, 49_700, sessionOpen('2026-10-21')))
    engine.recordFill(sessionOpen('2026-10-21'), -800, 49_700, true)
    engine.finalizeDay('2026-10-21')
    expect(engine.floor).toBe(49_500)
    expect(engine.state.days.map((day) => day.realizedPnl)).toEqual([0, 1_000, -800])
  })

  it('caps an EOD floor even if the finalized balance is far above it', () => {
    const engine = risk({
      drawdown: { mode: 'trailing-eod', amount: 2_000, basis: 'balance', floorCap: 49_000, includeUnrealized: true },
    })
    engine.update(input(60_000, 60_000))
    engine.finalizeCurrentDay()
    expect(engine.floor).toBe(49_000)
  })
})

describe('daily circuit breaker', () => {
  it('warns once per day and resets the warning on a new session', () => {
    const engine = risk({
      drawdown: { mode: 'static', amount: 5_000, basis: 'equity', floorCap: null, includeUnrealized: true },
      dailyLoss: { amount: 1_000, action: 'warn' },
    })
    expect(engine.update(input(49_000)).map((event) => event.type)).toContain('daily-warning')
    expect(engine.update(input(48_500)).map((event) => event.type)).not.toContain('daily-warning')
    expect(engine.status).toBe('active')
    expect(engine.roll(NEXT, 48_500).map((event) => event.type)).toContain('new-day')
    expect(engine.update(input(47_500, 47_500, NEXT)).map((event) => event.type)).toContain('daily-warning')
  })

  it('flattens without locking for flatten, and locks only for flatten-lock', () => {
    const flatten = risk({
      drawdown: { mode: 'static', amount: 5_000, basis: 'equity', floorCap: null, includeUnrealized: true },
      dailyLoss: { amount: 1_000, action: 'flatten' },
    })
    expect(flatten.update(input(49_000)).map((event) => event.type)).toContain('daily-flatten')
    expect(flatten.status).toBe('active')
    expect(flatten.update(input(48_000)).map((event) => event.type)).not.toContain('daily-flatten')

    const lock = risk({
      drawdown: { mode: 'static', amount: 5_000, basis: 'equity', floorCap: null, includeUnrealized: true },
      dailyLoss: { amount: 1_000, action: 'flatten-lock' },
    })
    expect(lock.update(input(49_000)).map((event) => event.type)).toContain('daily-flatten')
    expect(lock.status).toBe('daily-lock')
    expect(lock.update(input(48_000)).map((event) => event.type)).not.toContain('daily-flatten')
    expect(lock.roll(NEXT, 48_000).map((event) => event.type)).toContain('new-day')
    expect(lock.status).toBe('active')
  })

  it('uses the current-day equity anchor after a gap, even if the prior session was not finalized', () => {
    const engine = risk({
      drawdown: { mode: 'static', amount: 5_000, basis: 'equity', floorCap: null, includeUnrealized: true },
      dailyLoss: { amount: 1_000, action: 'warn' },
    })
    engine.update(input(49_500, 49_500))
    engine.roll(NEXT, 49_500)
    expect(engine.update(input(48_400, 48_400, NEXT)).map((event) => event.type)).toContain('daily-warning')
    expect(engine.state.days.find((day) => day.key === DAY)?.finalized).toBe(false)
  })
})

describe('finalized-day gates', () => {
  it('blocks a profit target until flat, finalized, and enough filled days have closed', () => {
    const engine = risk({ profitTarget: 2_000, minTradingDays: 2 })
    engine.update(input(51_000, 51_000))
    engine.recordFill(OPEN, 1_000, 51_000, true)
    expect(engine.checkTarget({ balance: 51_000, openContracts: 1 })).toBe(false)
    expect(engine.checkTarget({ balance: 51_000, openContracts: 0 })).toBe(false)
    engine.finalizeCurrentDay()
    expect(engine.checkTarget({ balance: 51_000, openContracts: 0 })).toBe(false)

    engine.update(input(53_000, 53_000, NEXT))
    engine.recordFill(NEXT, 2_000, 53_000, true)
    engine.finalizeDay('2026-10-20')
    expect(engine.checkTarget({ balance: 53_000, openContracts: 0 })).toBe(true)
    expect(engine.status).toBe('target')
    expect(engine.update(input(1_000, 1_000, NEXT)).map((event) => event.type)).not.toContain('breach')
    expect(engine.status).toBe('target')
  })

  it('only counts finalized days with fills toward the minimum trading days', () => {
    const engine = risk({ profitTarget: 1_000, minTradingDays: 2 })
    engine.update(input(51_000, 51_000))
    engine.recordFill(OPEN, 1_000, 51_000, true)
    engine.finalizeCurrentDay()
    engine.update(input(51_000, 51_000, NEXT))
    engine.roll(sessionOpen('2026-10-21'), 51_000)
    engine.finalizeDay('2026-10-20')
    expect(engine.state.days.find((day) => day.key === '2026-10-20')?.fills).toBe(0)
    expect(engine.checkTarget({ balance: 51_000, openContracts: 0 })).toBe(false)
  })

  it('blocks a target on the pass gate when consistency fails, and never resurrects a breach', () => {
    const engine = risk({ profitTarget: 4_000, minTradingDays: 2, consistency: { maxBestDayRatio: 0.6, gate: 'pass' } })
    engine.update(input(55_000, 55_000))
    engine.recordFill(OPEN, 5_000, 55_000, true)
    engine.finalizeCurrentDay()
    engine.update(input(53_000, 53_000, NEXT))
    engine.recordFill(NEXT, -2_000, 53_000, true)
    engine.finalizeDay('2026-10-20')
    expect(engine.consistency()).toMatchObject({ bestDay: 5_000, totalNetProfit: 3_000, eligible: false })
    expect(engine.checkTarget({ balance: 53_000, openContracts: 0 })).toBe(false)
    expect(engine.status).toBe('active')

    const breached = risk()
    breached.update(input(48_000))
    breached.update(input(60_000))
    expect(breached.status).toBe('breached')
    expect(breached.checkTarget({ balance: 60_000, openContracts: 0 })).toBe(false)
  })
})

describe('consistency and ledger integrity', () => {
  it('computes best and net profit from finalized days only, including losing days', () => {
    const engine = risk({ consistency: { maxBestDayRatio: 0.8, gate: 'pass' } })
    engine.update(input(52_000, 52_000))
    engine.recordFill(OPEN, 2_000, 52_000, true)
    engine.finalizeCurrentDay()
    engine.update(input(53_000, 53_000, NEXT))
    engine.recordFill(NEXT, 1_000, 53_000, true)
    engine.finalizeDay('2026-10-20')
    engine.update(input(52_500, 52_500, sessionOpen('2026-10-21')))
    engine.recordFill(sessionOpen('2026-10-21'), -500, 52_500, true)
    engine.finalizeDay('2026-10-21')
    engine.update(input(60_000, 60_000, sessionOpen('2026-10-22')))
    engine.recordFill(sessionOpen('2026-10-22'), 8_000, 60_000, true)

    expect(engine.consistency()).toMatchObject({
      bestDay: 2_000,
      totalNetProfit: 2_500,
      ratio: 0.8,
      eligible: true,
    })
    expect(engine.state.days.find((day) => day.key === '2026-10-22')?.finalized).toBe(false)
    expect(engine.state.days.find((day) => day.key === '2026-10-21')?.realizedPnl).toBe(-500)
  })

  it('reports an undefined ratio for an empty or nonpositive finalized total', () => {
    const empty = risk({ consistency: { maxBestDayRatio: 0.5, gate: 'pass' } })
    expect(empty.consistency()).toMatchObject({ ratio: null, eligible: false })

    const losing = risk({ consistency: { maxBestDayRatio: 0.5, gate: 'pass' } })
    losing.update(input(49_000, 49_000))
    losing.recordFill(OPEN, -1_000, 49_000, true)
    losing.finalizeCurrentDay()
    expect(losing.consistency()).toMatchObject({ bestDay: 0, totalNetProfit: -1_000, ratio: null, eligible: false })
  })

  it('refuses fills after a session is finalized and is idempotent at the boundary', () => {
    const engine = risk()
    engine.update(input(51_000, 51_000))
    engine.recordFill(OPEN, 1_000, 51_000, true)
    engine.finalizeCurrentDay()
    expect(engine.state.days[0]).toMatchObject({ fills: 1, trades: 1, finalized: true })
    expect(() => engine.recordFill(OPEN, 100, 51_100, false)).toThrow(/finalized/)
    expect(engine.finalizeDay(DAY)).toBe(false)
    expect(engine.state.days[0]?.fills).toBe(1)
  })

  it('rejects invalid risk input and backwards clocks without mutating state', () => {
    const engine = risk()
    const before = engine.state
    expect(() => engine.update(input(50_000, 50_000, OPEN - 1))).toThrow(/Invalid risk input/)
    expect(() => engine.update(input(Number.NaN))).toThrow(/Invalid risk input/)
    expect(() => engine.roll(OPEN - 1, 50_000)).toThrow(/Invalid session clock/)
    expect(engine.state).toEqual(before)
  })

  it('restores a breached or target state exactly and rejects corrupt ledgers', () => {
    const breached = risk()
    breached.update(input(48_000))
    assertStateRoundTrip(breached)
    const locked = risk({ dailyLoss: { amount: 1_000, action: 'flatten-lock' } })
    locked.update(input(49_000))
    assertStateRoundTrip(locked)

    const target = risk({ profitTarget: 1_000 })
    target.update(input(51_000, 51_000))
    target.recordFill(OPEN, 1_000, 51_000, true)
    target.finalizeCurrentDay()
    expect(target.checkTarget({ balance: 51_000, openContracts: 0 })).toBe(true)
    assertStateRoundTrip(target)

    const state = breached.state
    const variants: Array<(copy: RiskState) => void> = [
      (copy) => {
        copy.floor -= 1
      },
      (copy) => {
        copy.status = 'breached'
        copy.breach = null
      },
      (copy) => {
        copy.peakEquity = 0
      },
      (copy) => {
        copy.days.push(structuredClone(copy.days[0]!))
      },
      (copy) => {
        copy.status = 'daily-lock'
      },
      (copy) => {
        copy.days[0]!.endEquity = Number.NaN
      },
      (copy) => {
        copy.days[0]!.trades = copy.days[0]!.fills + 1
      },
    ]
    for (const corrupt of variants) {
      const copy = JSON.parse(JSON.stringify(state)) as RiskState
      corrupt(copy)
      expect(() => RiskEngine.fromState(copy)).toThrow()
    }
    expect(breached.state).toEqual(state)
  })
})
