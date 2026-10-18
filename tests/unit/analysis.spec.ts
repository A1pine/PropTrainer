import { describe, expect, it } from 'vitest'
import { createScenarioFactory } from '@/domain/market/scenario'
import { analyzeMarket } from '@/domain/analysis/analyze'
import { getWasmCore } from '@/domain/wasm/core'

const scenario = createScenarioFactory({ now: new Date('2026-03-10T12:00:00Z') }).createFromSeed(
  'analysis-test',
  'MNQ',
  'uptrend',
)
const candles = scenario.candles.slice(0, scenario.replayStart + 80)

describe('analysis core', () => {
  it('runs through wasm and returns a complete report', () => {
    expect(getWasmCore()).not.toBeNull()
    const report = analyzeMarket(candles)
    expect(report).not.toBeNull()
    if (!report) return
    expect(report.bias.score).toBeGreaterThanOrEqual(-100)
    expect(report.bias.score).toBeLessThanOrEqual(100)
    expect(report.indicators.ema20).toHaveLength(candles.length)
    expect(report.indicators.ema200).toHaveLength(candles.length)
    expect(report.flow.profile.length).toBeGreaterThan(10)
    expect(report.trend.swings.length).toBeGreaterThan(0)
    expect(report.events.length).toBeGreaterThan(0)
    const last = report.indicators.latest
    expect(last.price).toBeCloseTo(candles[candles.length - 1]!.close, 2)
    expect(last.vwap).not.toBeNull()
    expect(last.rsi).not.toBeNull()
  })

  it('keeps value area and POC inside the recent range', () => {
    const report = analyzeMarket(candles)
    expect(report).not.toBeNull()
    if (!report) return
    const high = Math.max(...candles.map((candle) => candle.high))
    const low = Math.min(...candles.map((candle) => candle.low))
    expect(report.flow.poc).toBeGreaterThanOrEqual(low)
    expect(report.flow.poc).toBeLessThanOrEqual(high)
    expect(report.flow.vah).toBeGreaterThanOrEqual(report.flow.val)
    expect(report.flow.pressure).toBeGreaterThanOrEqual(-1)
    expect(report.flow.pressure).toBeLessThanOrEqual(1)
  })

  it('produces structurally valid ICT zones', () => {
    const report = analyzeMarket(candles)
    expect(report).not.toBeNull()
    if (!report) return
    for (const gap of report.ict.fvgs) {
      expect(gap.top).toBeGreaterThan(gap.bottom)
      expect(gap.filled).toBeGreaterThanOrEqual(0)
      expect(gap.filled).toBeLessThanOrEqual(1)
      expect(gap.to).toBeGreaterThan(gap.from)
    }
    for (const block of report.ict.orderBlocks) {
      expect(block.top).toBeGreaterThan(block.bottom)
      expect(['bullish', 'bearish']).toContain(block.direction)
    }
    for (const level of report.pa.levels) {
      expect(['support', 'resistance']).toContain(level.kind)
      expect(level.touches).toBeGreaterThanOrEqual(2)
    }
  })

  it('sorts the event timeline newest first', () => {
    const report = analyzeMarket(candles)
    expect(report).not.toBeNull()
    if (!report) return
    for (let index = 1; index < report.events.length; index += 1) {
      expect(report.events[index]!.index).toBeLessThanOrEqual(report.events[index - 1]!.index)
    }
  })

  it('returns null when there is not enough history', () => {
    expect(analyzeMarket(candles.slice(0, 20))).toBeNull()
  })
})
