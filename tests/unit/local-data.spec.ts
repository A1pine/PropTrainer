import { describe, expect, it, vi } from 'vitest'
import { instruments } from '@/domain/instruments/catalog'
import { DATASET_WINDOW, canUseDataset, classifyRegime, createDatasetScenario } from '@/domain/market/dataset'
import { roundToTick } from '@/domain/shared/math'
import { clearLocalMarketCache, parseDataset, parseManifest, prepareLocalScenarioInput } from '@/lib/market/local-data'
import { parseTimeframeMinutes } from '@/lib/market/types'
import type { LocalDataset, LocalManifest } from '@/lib/market/types'

function makeDataset(bars = 2000, drift = 0.02, tickSize = 0.25): LocalDataset {
  const t: number[] = []
  const o: number[] = []
  const h: number[] = []
  const l: number[] = []
  const c: number[] = []
  const v: number[] = []
  let price = 100
  for (let index = 0; index < bars; index += 1) {
    const open = roundToTick(price, tickSize)
    const close = roundToTick(price + drift + Math.sin(index / 9) * 0.35, tickSize)
    const high = roundToTick(Math.max(open, close) + tickSize * 2, tickSize)
    const low = roundToTick(Math.min(open, close) - tickSize * 2, tickSize)
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

function cloneDataset(dataset: LocalDataset): LocalDataset {
  return {
    ...dataset,
    t: [...dataset.t],
    o: [...dataset.o],
    h: [...dataset.h],
    l: [...dataset.l],
    c: [...dataset.c],
    v: [...dataset.v],
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

  it('uses a pack that is exactly one window long', () => {
    const exact = makeDataset(DATASET_WINDOW.warmup + DATASET_WINDOW.future + DATASET_WINDOW.reveal)
    expect(canUseDataset(exact)).toBe(true)
    const scenario = createDatasetScenario({ seed: 'exact-window', instrument, dataset: exact })
    expect(scenario.candles).toHaveLength(DATASET_WINDOW.warmup + DATASET_WINDOW.future + DATASET_WINDOW.reveal)
    expect(scenario.dataset?.windowStart).toBe(exact.t[0])
    expect(scenario.dataset?.windowEnd).toBe(exact.t[exact.bars - 1])
    expect(canUseDataset(makeDataset(exact.bars - 1))).toBe(false)
  })

  it('refuses a pack that cannot fill a round', () => {
    const short = makeDataset(200)
    expect(canUseDataset(short)).toBe(false)
    expect(() => createDatasetScenario({ seed: 'short', instrument, dataset: short })).toThrow()
  })

  it('propagates the dataset timeframe and rejects a mismatched round', () => {
    const hourly = { ...makeDataset(), timeframe: '1h' }
    hourly.t = hourly.t.map((_, index) => hourly.t[0]! + index * 3600)
    expect(parseTimeframeMinutes('5m')).toBe(5)
    expect(parseTimeframeMinutes('1h')).toBe(60)
    expect(parseTimeframeMinutes('banana')).toBeNull()
    expect(createDatasetScenario({ seed: 'hourly', instrument, dataset: hourly }).timeframeMinutes).toBe(60)
    expect(
      createDatasetScenario({ seed: 'hourly', instrument, dataset: hourly, timeframeMinutes: 60 }).timeframeMinutes,
    ).toBe(60)
    expect(() => createDatasetScenario({ seed: 'hourly', instrument, dataset: hourly, timeframeMinutes: 5 })).toThrow(
      /timeframe|1h|5m/,
    )
  })

  it('keeps the rebase offset independent of the hidden future', () => {
    // A low anchor makes the additive offset negative, so a hidden low near
    // zero would have forced the old whole-sample floor adjustment to shift
    // the visible tape after peeking at the future.
    const lowAnchor = { ...instrument, anchorPrice: instrument.anchorPrice * 0.001 }
    const base = makeDataset()
    const scenario = createDatasetScenario({ seed: 'future-blind', instrument: lowAnchor, dataset: base })
    const start = base.t.indexOf(scenario.dataset!.windowStart)
    const offset = scenario.candles[0]!.close - base.c[start]!
    expect(offset).toBeLessThan(0)

    const mutated = cloneDataset(base)
    const hiddenStart = start + DATASET_WINDOW.warmup
    mutated.l[hiddenStart] = instrument.tickSize
    const changed = createDatasetScenario({ seed: 'future-blind', instrument: lowAnchor, dataset: mutated })
    const changedOffset = changed.candles[0]!.close - mutated.c[start]!
    expect(changedOffset).toBeCloseTo(offset, 9)
    expect(changed.dataset?.windowStart).toBe(scenario.dataset?.windowStart)
    expect(changed.metrics.atr).toBe(scenario.metrics.atr)
    expect(changed.candles.slice(0, DATASET_WINDOW.warmup)).toEqual(scenario.candles.slice(0, DATASET_WINDOW.warmup))

    // No clipping: the hidden low keeps the same additive shift even though it
    // translates below zero. Only the visible warm-up is protected by the
    // offset floor.
    expect(changed.candles[DATASET_WINDOW.warmup]!.low).toBe(instrument.tickSize + offset)
    expect(changed.candles[DATASET_WINDOW.warmup]!.low).toBeLessThan(0)
  })

  it('keeps direction and metrics honest when the rebased window trades below zero', () => {
    // Warm-up near 200 with an anchor near 1 forces a large negative offset.
    // The hidden tape then starts at 150 and falls monotonically, so every
    // hidden price is negative after rebasing. This is the crude-2020 shape:
    // the grader must still call it a downtrend, not flip the sign of the move.
    const lowAnchor = { ...instrument, anchorPrice: 1 }
    const bars = 710
    const dataset = makeDataset(bars, 0, instrument.tickSize)
    for (let index = 0; index < bars; index += 1) {
      const close = index < 150 ? 200 : 150 - (index - 150) * 0.25
      dataset.o[index] = close
      dataset.h[index] = close + instrument.tickSize
      dataset.l[index] = close - instrument.tickSize
      dataset.c[index] = close
    }

    const scenario = createDatasetScenario({ seed: 'below-zero', instrument: lowAnchor, dataset })
    expect(scenario.candles[150]!.close).toBeLessThan(0)
    expect(scenario.candles[bars - 1]!.close).toBeLessThan(0)
    expect(scenario.metrics.changePct).toBeLessThan(0)
    expect(scenario.regime).toBe('downtrend')
  })

  it('keeps every rebased price on a clean tick grid', () => {
    const m2k = instruments.require('M2K')
    const datasetTick = { ...makeDataset(2000, 0.02, m2k.tickSize), symbol: m2k.symbol, sourceSymbol: 'M2K=F' }
    const cleanScenario = createDatasetScenario({ seed: 'tick-grid', instrument: m2k, dataset: datasetTick })
    for (const column of [datasetTick.o, datasetTick.h, datasetTick.l, datasetTick.c]) {
      for (let index = 0; index < column.length; index += 1) {
        column[index] = column[index]! + (index % 2 === 0 ? 1e-12 : -1e-12)
      }
    }
    expect(parseDataset(datasetTick)).not.toBeNull()
    const scenario = createDatasetScenario({ seed: 'tick-grid', instrument: m2k, dataset: datasetTick })
    expect(scenario.candles).toEqual(cleanScenario.candles)
    const start = datasetTick.t.indexOf(scenario.dataset!.windowStart)
    const offset = scenario.candles[0]!.close - datasetTick.c[start]!
    for (let index = 0; index < scenario.candles.length; index += 1) {
      const candle = scenario.candles[index]!
      for (const price of [candle.open, candle.high, candle.low, candle.close]) {
        const ticks = price / m2k.tickSize
        expect(Math.abs(ticks - Math.round(ticks))).toBeLessThan(1e-9)
      }
      expect(Math.abs(candle.close - datasetTick.c[start + index]! - offset)).toBeLessThan(1e-9)
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close))
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close))
    }
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

  it('rejects fractional timestamps instead of rounding them into duplicates', () => {
    const fractional = makeDataset(50)
    fractional.t[10] = fractional.t[10]! + 0.1
    expect(parseDataset(fractional)).toBeNull()

    // Rounding this pair would have produced two bars at the same second.
    const pair = makeDataset(2)
    pair.t = [1000.1, 1000.2]
    expect(parseDataset(pair)).toBeNull()
  })

  it('rejects unsupported pack timeframes', () => {
    expect(parseDataset({ ...makeDataset(50), timeframe: 'banana' })).toBeNull()
    expect(parseDataset({ ...makeDataset(50), timeframe: '' })).toBeNull()
    expect(
      parseManifest({
        ...manifest,
        datasets: [{ ...manifest.datasets[0]!, timeframe: 'banana' }],
      }),
    ).toBeNull()
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
