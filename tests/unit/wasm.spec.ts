import { describe, expect, it } from 'vitest'
import { instruments } from '@/domain/instruments/catalog'
import {
  generateMarketData,
  generateMarketDataTs,
  findSwings,
  findSwingsTs,
  type MarketGenerationOptions,
} from '@/domain/market/generator'
import { simulatePlan, simulatePlanTs, type DrillPlan } from '@/domain/drill/plan'
import { createScenarioFactory } from '@/domain/market/scenario'
import { createWasmCoreFromInstance, getWasmCore, setWasmCore } from '@/domain/wasm/core'

const options: MarketGenerationOptions = {
  seed: 'wasm-parity-seed:MNQ:uptrend',
  instrument: instruments.require('MNQ'),
  regime: 'uptrend',
  bars: 710,
  startPrice: 19_450,
  startTime: 1_700_000_000,
  timeframeMinutes: 5,
  replayStart: 150,
}

function withoutCore<T>(run: () => T): T {
  const core = getWasmCore()
  setWasmCore(null)
  try {
    return run()
  } finally {
    setWasmCore(core)
  }
}

describe('rust compute core', () => {
  it('is loaded for the test run', () => {
    expect(getWasmCore()).not.toBeNull()
  })

  it('generates the same candles and metrics as the TypeScript reference', () => {
    const rust = generateMarketData(options)
    const ts = withoutCore(() => generateMarketDataTs(options))
    expect(rust.candles.length).toBe(ts.candles.length)
    expect(rust.metrics).toEqual(ts.metrics)
    // Prices are snapped to the tick grid, so comparison is exact.
    expect(rust.candles).toEqual(ts.candles)
  })

  it('detects the same swings as the TypeScript reference', () => {
    const scenario = createScenarioFactory({ now: new Date('2026-03-10T12:00:00Z') }).createFromSeed(
      'wasm-swings',
      'MES',
      'range',
    )
    const visible = scenario.candles.slice(0, scenario.replayStart)
    const rust = findSwings(visible, 3)
    const ts = withoutCore(() => findSwingsTs(visible, 3))
    expect(rust).toEqual(ts)
  })

  it('simulates plans identically to the TypeScript reference', () => {
    const scenario = createScenarioFactory({ now: new Date('2026-03-10T12:00:00Z') }).createFromSeed(
      'wasm-simulation',
      'MNQ',
      'uptrend',
    )
    const decision = scenario.replayStart - 1
    const price = scenario.candles[decision]!.close
    const plan: DrillPlan = {
      state: 'uptrend',
      direction: 'long',
      entry: price,
      stop: price - scenario.metrics.atr * 1.2,
      target: price + scenario.metrics.atr * 2.4,
      thesis: 'Parity plan',
      submittedAtBar: decision,
      waitedBars: 0,
    }
    const rust = simulatePlan(plan, scenario.candles, scenario.instrument, 300)
    const ts = withoutCore(() => simulatePlanTs(plan, scenario.candles, scenario.instrument, 300))
    expect(rust).toEqual(ts)
    expect(rust.filled).toBe(true)
  })

  it('rejects an outdated artifact missing the analysis export', () => {
    expect(() => createWasmCoreFromInstance({ exports: {} } as unknown as WebAssembly.Instance)).toThrow(/outdated/)
  })

  it('falls back cleanly when the core is unavailable', () => {
    const ts = withoutCore(() => generateMarketData(options))
    expect(ts.candles.length).toBe(710)
  })
})
