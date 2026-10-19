import { describe, expect, it, vi } from 'vitest'
import { instruments } from '@/domain/instruments/catalog'
import { DATASET_WINDOW, canUseDataset, classifyRegime, createDatasetScenario } from '@/domain/market/dataset'
import { clearLocalMarketCache, parseDataset, parseManifest, prepareLocalScenarioInput } from '@/lib/market/local-data'
import type { LocalDataset, LocalManifest } from '@/lib/market/types'

function tick(value: number): number {
  return Math.round(value * 4) / 4
}

function makeDataset(bars = 2000, drift = 0.02): LocalDataset {
  const t: number[] = []
  const o: number[] = []
  const h: number[] = []
  const l: number[] = []
  const c: number[] = []
  const v: number[] = []
  let price = 100
  for (let index = 0; index < bars; index += 1) {
    const open = tick(price)
    const close = tick(price + drift + Math.sin(index / 9) * 0.35)
    const high = tick(Math.max(open, close) + 0.5)
    const low = tick(Math.min(open, close) - 0.5)
    t.push(1_760_000_000 + index * 300)
    o.push(open)
    h.push(high)
    l.push(low)
    c.push(close)
    v.push(1000 + (index % 37))
    price = close
  }
  return {
    symbol: 'MNQ',
    source: 'yahoo',
    sourceSymbol: 'MNQ=F',
    timeframe: '5m',
    timezone: 'UTC',
    license: 'test only',
    fetchedAt: '2026-10-20T00:00:00.000Z',
    bars,
    t,
    o,
    h,
    l,
    c,
    v,
  }
}

const instrument = instruments.require('MNQ')

describe('dataset scenarios', () => {
  const dataset = makeDataset()

  it('cuts the configured warm-up, future and reveal window', () => {
    const scenario = createDatasetScenario({ seed: 'dataset-a', instrument, dataset })
    expect(scenario.source).toBe('local')
    expect(scenario.replayStart).toBe(DATASET_WINDOW.warmup)
    expect(scenario.candles.length).toBe(DATASET_WINDOW.warmup + DATASET_WINDOW.future + DATASET_WINDOW.reveal)
    expect(scenario.revealBars).toBe(DATASET_WINDOW.reveal)
    expect(scenario.dataset?.sourceSymbol).toBe('MNQ=F')
    expect(scenario.dataset?.bars).toBe(scenario.candles.length)
    expect(new Date(scenario.sessionDate).getTime()).toBe(scenario.candles[scenario.replayStart]!.time * 1000)
  })

  it('is deterministic for the same seed', () => {
    const first = createDatasetScenario({ seed: 'same-seed', instrument, dataset })
    const second = createDatasetScenario({ seed: 'same-seed', instrument, dataset })
    expect(first.id).toBe(second.id)
    expect(first.candles.map((candle) => candle.close)).toEqual(second.candles.map((candle) => candle.close))
    expect(first.dataset?.windowStart).toBe(second.dataset?.windowStart)
  })

  it('moves with the seed', () => {
    const first = createDatasetScenario({ seed: 'seed-one', instrument, dataset })
    const second = createDatasetScenario({ seed: 'seed-two', instrument, dataset })
    expect(first.dataset?.windowStart).not.toBe(second.dataset?.windowStart)
  })

  it('rebases absolute price without changing deltas or tick alignment', () => {
    const scenario = createDatasetScenario({ seed: 'rebase', instrument, dataset })
    const startIndex = dataset.t.indexOf(scenario.dataset!.windowStart)
    const offset = scenario.candles[0]!.close - dataset.c[startIndex]!
    expect(Math.abs(scenario.candles[0]!.close / instrument.anchorPrice - 1)).toBeLessThan(0.05)
    for (let index = 0; index < scenario.candles.length; index += 1) {
      const candle = scenario.candles[index]!
      expect(candle.close - dataset.c[startIndex + index]!).toBeCloseTo(offset, 6)
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close))
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close))
      expect(candle.low).toBeGreaterThan(0)
      expect(
        Math.abs(candle.close / instrument.tickSize - Math.round(candle.close / instrument.tickSize)),
      ).toBeLessThan(1e-9)
    }
  })

  it('refuses a pack that cannot fill a round', () => {
    const short = makeDataset(200)
    expect(canUseDataset(short)).toBe(false)
    expect(() => createDatasetScenario({ seed: 'short', instrument, dataset: short })).toThrow()
  })

  it('classifies the hidden window from its own behaviour', () => {
    const base = { changePct: 0, maxUpPct: 0, maxDownPct: 0, efficiency: 0.5, atr: 1 }
    expect(classifyRegime({ ...base, changePct: 2 })).toBe('uptrend')
    expect(classifyRegime({ ...base, changePct: -2 })).toBe('downtrend')
    expect(classifyRegime({ ...base, efficiency: 0.1 })).toBe('range')
    expect(classifyRegime({ ...base, efficiency: 0.3 })).toBe('expansion')
  })
})

describe('local pack parsing', () => {
  const manifest: LocalManifest = {
    version: 1,
    generatedAt: '2026-10-20T00:00:00.000Z',
    interval: '5m',
    range: '60d',
    timezone: 'UTC',
    datasets: [
      {
        symbol: 'MNQ',
        source: 'yahoo',
        sourceSymbol: 'MNQ=F',
        timeframe: '5m',
        timezone: 'UTC',
        license: 'test only',
        fetchedAt: '2026-10-20T00:00:00.000Z',
        bars: 2000,
      },
    ],
  }

  it('accepts a valid dataset and manifest', () => {
    expect(parseDataset(makeDataset(50))?.bars).toBe(50)
    expect(parseManifest(manifest)?.datasets[0]?.symbol).toBe('MNQ')
  })

  it('drops corrupt bars instead of plotting them', () => {
    const badHigh = makeDataset(50)
    badHigh.h[10] = badHigh.c[10]! - 1
    expect(parseDataset(badHigh)).toBeNull()

    const duplicate = makeDataset(50)
    duplicate.t[10] = duplicate.t[9]!
    expect(parseDataset(duplicate)).toBeNull()

    const hole = makeDataset(50)
    hole.o.pop()
    expect(parseDataset(hole)).toBeNull()

    expect(parseDataset(makeDataset(50), 'MES')).toBeNull()
  })

  it('skips unusable manifest entries', () => {
    const parsed = parseManifest({
      ...manifest,
      datasets: [...manifest.datasets, { symbol: 'BAD', bars: 0 }],
    })
    expect(parsed?.datasets).toHaveLength(1)
    expect(parseManifest({})).toBeNull()
  })

  it('loads the enabled symbol through the repository seam', async () => {
    clearLocalMarketCache()
    const dataset = makeDataset(1200)
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) {
        return new Response(JSON.stringify(manifest), { status: 200 })
      }
      if (url.endsWith('MNQ.json')) {
        return new Response(JSON.stringify({ ...dataset, bars: dataset.bars }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const prepared = await prepareLocalScenarioInput({
        baseURL: 'https://example.test/',
        symbols: ['MNQ', 'MES'],
        seed: 'repo-seed',
      })
      expect(prepared?.symbol).toBe('MNQ')
      expect(prepared?.dataset.bars).toBe(1200)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
      clearLocalMarketCache()
    }
  })

  it('returns null when the pack is absent', async () => {
    clearLocalMarketCache()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 })),
    )
    try {
      expect(await prepareLocalScenarioInput({ baseURL: '/', symbols: ['MNQ'], seed: 'missing' })).toBeNull()
    } finally {
      vi.unstubAllGlobals()
      clearLocalMarketCache()
    }
  })
})
