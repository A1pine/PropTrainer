import { describe, expect, it } from 'vitest'
import { createScenarioFactory } from '@/domain/market/scenario'
import { computeAtr, findSwings } from '@/domain/market/generator'
import { instruments } from '@/domain/instruments/catalog'

const factory = createScenarioFactory({ now: new Date('2026-03-10T12:00:00Z') })

describe('market generator', () => {
  it('produces deterministic scenarios for the same seed', () => {
    const first = factory.createFromSeed('unit-test-seed', 'MNQ', 'uptrend')
    const second = factory.createFromSeed('unit-test-seed', 'MNQ', 'uptrend')
    expect(first.candles).toEqual(second.candles)
    expect(first.metrics).toEqual(second.metrics)
    expect(first.sessionDate).toBe(second.sessionDate)
  })

  it('changes the series when the seed changes', () => {
    const a = factory.createFromSeed('seed-a', 'MNQ', 'uptrend')
    const b = factory.createFromSeed('seed-b', 'MNQ', 'uptrend')
    expect(a.candles[10]?.close).not.toBe(b.candles[10]?.close)
  })

  it('respects OHLC invariants and tick alignment for every instrument', () => {
    for (const instrument of instruments.list()) {
      const scenario = factory.createFromSeed(`ohlc-${instrument.symbol}`, instrument.symbol, 'range')
      for (const candle of scenario.candles) {
        expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close))
        expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close))
        expect(candle.low).toBeGreaterThan(0)
        expect(candle.volume).toBeGreaterThan(0)
        const ticks = candle.close / instrument.tickSize
        expect(Math.abs(ticks - Math.round(ticks))).toBeLessThan(1e-6)
      }
    }
  })

  it('starts the replay after the warm-up window', () => {
    const scenario = factory.createFromSeed('replay-window', 'MES', 'range')
    expect(scenario.replayStart).toBe(150)
    expect(scenario.candles.length).toBe(150 + 260 + 300)
    expect(scenario.metrics.atr).toBeGreaterThan(0)
  })

  it('generates all four regimes with their intended drift character', () => {
    const up = factory.createFromSeed('regime-up', 'NQ', 'uptrend')
    const down = factory.createFromSeed('regime-down', 'NQ', 'downtrend')
    const range = factory.createFromSeed('regime-range', 'NQ', 'range')
    const disorder = factory.createFromSeed('regime-disorder', 'NQ', 'expansion')
    expect(up.regime).toBe('uptrend')
    expect(down.regime).toBe('downtrend')
    expect(range.regime).toBe('range')
    expect(disorder.regime).toBe('expansion')
    expect(up.metrics.changePct).toBeGreaterThan(0)
    expect(down.metrics.changePct).toBeLessThan(0)
    expect(Math.abs(range.metrics.changePct)).toBeLessThan(Math.abs(up.metrics.changePct) + 3)
  })

  it('computes ATR only from bars available at the decision point', () => {
    const scenario = factory.createFromSeed('atr-check', 'MNQ', 'uptrend')
    const atr = computeAtr(scenario.candles, 14, scenario.replayStart)
    expect(atr).toBeGreaterThan(0)
    expect(scenario.metrics.atr).toBeCloseTo(atr, 1)
  })

  it('detects fractal swings', () => {
    const scenario = factory.createFromSeed('swing-check', 'MNQ', 'range')
    const swings = findSwings(scenario.candles.slice(0, scenario.replayStart), 3)
    expect(swings.length).toBeGreaterThan(5)
    expect(swings.every((swing) => swing.index >= 3)).toBe(true)
  })
})
