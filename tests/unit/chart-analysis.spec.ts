import { describe, expect, it } from 'vitest'
import { analyzeMarket } from '@/domain/analysis/analyze'
import type { AnalysisReport } from '@/domain/analysis/types'
import { createScenarioFactory } from '@/domain/market/scenario'
import { buildChartAnalysis, defaultAnalysisFrameworks, defaultAnalysisLayers } from '@/lib/chart/analysis'
import type { AnalysisFramework, AnalysisFrameworks, AnalysisLayers } from '@/lib/chart/analysis'
import type { ChartAnalysis } from '@/lib/chart/types'

const scenario = createScenarioFactory({ now: new Date('2026-03-10T12:00:00Z') }).createFromSeed(
  'analysis-test',
  'MNQ',
  'uptrend',
)
const candles = scenario.candles.slice(0, scenario.replayStart + 80)

function requireReport(): AnalysisReport {
  const result = analyzeMarket(candles)
  if (!result) throw new Error('Expected the wasm analysis core to produce a report')
  return result
}

const report = requireReport()

const empty: ChartAnalysis = { series: [], zones: [], levels: [], markers: [], profile: [] }

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** Verbatim mapping from the original analysis store overlay, used as a regression oracle. */
function legacyOverlay(data: AnalysisReport, visibleCount: number): ChartAnalysis {
  const end = Math.max(0, visibleCount - 1)
  const series: ChartAnalysis['series'] = [
    { id: 'ema20', tone: 'clay', width: 1.2, points: data.indicators.ema20 },
    { id: 'ema50', tone: 'bull', width: 1.1, points: data.indicators.ema50 },
    { id: 'ema200', tone: 'bear', width: 1.1, points: data.indicators.ema200 },
    { id: 'vwap', tone: 'ink', width: 1, dashed: true, points: data.indicators.vwap },
  ]

  const zones: ChartAnalysis['zones'] = []
  for (const gap of data.ict.fvgs.filter((item) => item.filled < 0.95).slice(0, 4)) {
    zones.push({
      id: `fvg-${gap.from}-${gap.direction}`,
      from: gap.from,
      to: end,
      top: gap.top,
      bottom: gap.bottom,
      tone: gap.direction === 'bullish' ? 'bull' : 'bear',
      label: 'FVG',
    })
  }
  for (const block of data.ict.orderBlocks.slice(0, 4)) {
    zones.push({
      id: `ob-${block.index}`,
      from: block.index,
      to: Math.min(end, block.index + 12),
      top: block.top,
      bottom: block.bottom,
      tone: block.direction === 'bullish' ? 'bull' : 'bear',
      label: 'OB',
    })
  }

  const levels: ChartAnalysis['levels'] = []
  for (const level of data.ict.liquidity.slice(0, 4)) {
    levels.push({
      id: `liq-${level.index}-${level.kind}`,
      price: level.price,
      tone: 'clay',
      label: `${level.kind.toUpperCase()} · ${level.touches}`,
    })
  }
  for (const level of data.pa.levels.slice(0, 3)) {
    levels.push({
      id: `sr-${level.lastIndex}-${level.kind}`,
      price: level.price,
      tone: 'muted',
      label: `${level.kind === 'support' ? 'S' : 'R'} · ${level.touches}`,
    })
  }
  levels.push(
    { id: 'poc', price: data.flow.poc, tone: 'clay', label: 'POC' },
    { id: 'vah', price: data.flow.vah, tone: 'warn', label: 'VAH' },
    { id: 'val', price: data.flow.val, tone: 'warn', label: 'VAL' },
  )

  const markers: ChartAnalysis['markers'] = []
  for (const item of data.trend.breaks.slice(0, 6)) {
    markers.push({
      id: `break-${item.index}-${item.kind}`,
      index: item.index,
      price: item.price,
      tone: item.direction === 'bullish' ? 'bull' : 'bear',
      label: item.kind === 'bos' ? 'BOS' : 'CHoCH',
    })
  }
  for (const sweep of data.ict.sweeps.slice(0, 5)) {
    markers.push({
      id: `sweep-${sweep.index}`,
      index: sweep.index,
      price: sweep.price,
      tone: sweep.direction === 'bullish' ? 'bull' : 'bear',
      label: 'SWEEP',
    })
  }

  return { series, zones, levels, markers, profile: data.flow.profile }
}

function frameworksWithout(disabled: AnalysisFramework): AnalysisFrameworks {
  return { ...defaultAnalysisFrameworks, [disabled]: false }
}

describe('buildChartAnalysis', () => {
  it('exposes the contracted defaults and matches the legacy lab overlay', () => {
    expect(defaultAnalysisFrameworks).toEqual({ pa: true, ict: true, flow: true, indicators: true })
    expect(defaultAnalysisLayers).toEqual({
      ema: true,
      vwap: true,
      bb: false,
      fvg: true,
      ob: true,
      liquidity: true,
      profile: true,
    })

    const result = buildChartAnalysis(report, candles.length)

    expect(result).toEqual(legacyOverlay(report, candles.length))
    // Guard the fixture: every gated group must actually contribute output.
    expect(result.series.map((item) => item.id)).toEqual(['ema20', 'ema50', 'ema200', 'vwap'])
    expect(result.zones.some((item) => item.label === 'FVG')).toBe(true)
    expect(result.zones.some((item) => item.label === 'OB')).toBe(true)
    expect(result.levels.some((item) => item.id.startsWith('liq-'))).toBe(true)
    expect(result.levels.some((item) => item.id.startsWith('sr-'))).toBe(true)
    expect(result.levels.some((item) => item.id === 'poc')).toBe(true)
    expect(result.markers.some((item) => item.id.startsWith('break-'))).toBe(true)
    expect(result.markers.some((item) => item.id.startsWith('sweep-'))).toBe(true)
    expect(result.profile.length).toBeGreaterThan(0)
  })

  it('removes only price-action output when PA is disabled', () => {
    const base = buildChartAnalysis(report, candles.length)
    const result = buildChartAnalysis(report, candles.length, defaultAnalysisLayers, frameworksWithout('pa'))

    expect(result.series).toEqual(base.series)
    expect(result.zones).toEqual(base.zones)
    expect(result.levels).toEqual(base.levels.filter((item) => !item.id.startsWith('sr-')))
    expect(result.markers).toEqual(base.markers.filter((item) => !item.id.startsWith('break-')))
    expect(result.profile).toEqual(base.profile)
    expect(result.markers.every((item) => item.id.startsWith('sweep-'))).toBe(true)
    expect(result.levels.some((item) => item.id.startsWith('liq-'))).toBe(true)
    expect(result.levels.some((item) => item.id === 'poc')).toBe(true)
  })

  it('removes only ICT output when ICT is disabled', () => {
    const base = buildChartAnalysis(report, candles.length)
    const result = buildChartAnalysis(report, candles.length, defaultAnalysisLayers, frameworksWithout('ict'))

    expect(result.series).toEqual(base.series)
    expect(result.zones).toEqual([])
    expect(result.levels).toEqual(base.levels.filter((item) => !item.id.startsWith('liq-')))
    expect(result.markers).toEqual(base.markers.filter((item) => !item.id.startsWith('sweep-')))
    expect(result.profile).toEqual(base.profile)
    expect(result.levels.some((item) => item.id.startsWith('sr-'))).toBe(true)
    expect(result.markers.some((item) => item.id.startsWith('break-'))).toBe(true)
  })

  it('removes only flow output when flow is disabled', () => {
    const base = buildChartAnalysis(report, candles.length)
    const result = buildChartAnalysis(report, candles.length, defaultAnalysisLayers, frameworksWithout('flow'))

    expect(result.series).toEqual(base.series)
    expect(result.zones).toEqual(base.zones)
    expect(result.levels).toEqual(base.levels.filter((item) => !['poc', 'vah', 'val'].includes(item.id)))
    expect(result.markers).toEqual(base.markers)
    expect(result.profile).toEqual([])
    expect(result.levels.some((item) => item.id.startsWith('liq-'))).toBe(true)
    expect(result.levels.some((item) => item.id.startsWith('sr-'))).toBe(true)
  })

  it('removes only indicator output when indicators are disabled', () => {
    const base = buildChartAnalysis(report, candles.length)
    const result = buildChartAnalysis(report, candles.length, defaultAnalysisLayers, frameworksWithout('indicators'))

    expect(result.series).toEqual([])
    expect(result.zones).toEqual(base.zones)
    expect(result.levels).toEqual(base.levels)
    expect(result.markers).toEqual(base.markers)
    expect(result.profile).toEqual(base.profile)
  })

  it('returns empty arrays when every framework is disabled', () => {
    const result = buildChartAnalysis(report, candles.length, defaultAnalysisLayers, {
      pa: false,
      ict: false,
      flow: false,
      indicators: false,
    })

    expect(result).toEqual(empty)
  })

  it('toggles each indicator layer independently', () => {
    const noEma = buildChartAnalysis(report, candles.length, { ...defaultAnalysisLayers, ema: false })
    expect(noEma.series.map((item) => item.id)).toEqual(['vwap'])

    const noVwap = buildChartAnalysis(report, candles.length, { ...defaultAnalysisLayers, vwap: false })
    expect(noVwap.series.map((item) => item.id)).toEqual(['ema20', 'ema50', 'ema200'])

    const withBands = buildChartAnalysis(report, candles.length, { ...defaultAnalysisLayers, bb: true })
    expect(withBands.series.map((item) => item.id)).toEqual(['ema20', 'ema50', 'ema200', 'vwap', 'bbUpper', 'bbLower'])
    expect(withBands.series.filter((item) => item.id.startsWith('bb')).every((item) => item.dashed)).toBe(true)
  })

  it('toggles ICT zones without touching the other frameworks', () => {
    const noFvg = buildChartAnalysis(report, candles.length, { ...defaultAnalysisLayers, fvg: false })
    expect(noFvg.zones.length).toBeGreaterThan(0)
    expect(noFvg.zones.every((item) => item.label === 'OB')).toBe(true)

    const noOb = buildChartAnalysis(report, candles.length, { ...defaultAnalysisLayers, ob: false })
    expect(noOb.zones.length).toBeGreaterThan(0)
    expect(noOb.zones.every((item) => item.label === 'FVG')).toBe(true)
  })

  it('keeps the liquidity layer in charge of PA levels for lab compatibility', () => {
    const result = buildChartAnalysis(report, candles.length, { ...defaultAnalysisLayers, liquidity: false })

    expect(result.levels.some((item) => item.id.startsWith('liq-'))).toBe(false)
    expect(result.levels.some((item) => item.id.startsWith('sr-'))).toBe(false)
    expect(result.levels.filter((item) => ['poc', 'vah', 'val'].includes(item.id))).toHaveLength(3)
    expect(result.markers.some((item) => item.id.startsWith('break-'))).toBe(true)
    expect(result.markers.some((item) => item.id.startsWith('sweep-'))).toBe(true)
  })

  it('toggles the volume profile layer independently', () => {
    const result = buildChartAnalysis(report, candles.length, { ...defaultAnalysisLayers, profile: false })

    expect(result.levels.some((item) => ['poc', 'vah', 'val'].includes(item.id))).toBe(false)
    expect(result.profile).toEqual([])
    expect(result.levels.some((item) => item.id.startsWith('liq-'))).toBe(true)
    expect(result.levels.some((item) => item.id.startsWith('sr-'))).toBe(true)
  })

  it('returns empty arrays for a null report, including when the core has too little history', () => {
    expect(buildChartAnalysis(null, candles.length)).toEqual(empty)
    expect(buildChartAnalysis(null, 0)).toEqual(empty)

    const shortReport = analyzeMarket(candles.slice(0, 20))
    expect(shortReport).toBeNull()
    expect(buildChartAnalysis(shortReport, 20)).toEqual(empty)
  })

  it('handles a report whose structural collections are empty', () => {
    const blank = structuredClone(report)
    blank.trend.breaks = []
    blank.pa.levels = []
    blank.ict.fvgs = []
    blank.ict.orderBlocks = []
    blank.ict.liquidity = []
    blank.ict.sweeps = []
    blank.flow.profile = []

    const result = buildChartAnalysis(blank, candles.length)

    expect(result.series).toHaveLength(4)
    expect(result.zones).toEqual([])
    expect(result.markers).toEqual([])
    expect(result.levels.map((item) => item.id)).toEqual(['poc', 'vah', 'val'])
    expect(result.profile).toEqual([])
  })

  it('clips items indexed beyond the visible prefix and slices series to the count', () => {
    const count = 60
    const fixture = structuredClone(report)
    fixture.trend.breaks = [
      { index: 5, price: 1, kind: 'bos', direction: 'bullish' },
      { index: count, price: 1, kind: 'bos', direction: 'bullish' },
      { index: -1, price: 1, kind: 'choch', direction: 'bearish' },
    ]
    fixture.ict.sweeps = [
      { index: 6, price: 2, direction: 'bearish', kind: 'above' },
      { index: count + 10, price: 2, direction: 'bearish', kind: 'above' },
    ]
    fixture.ict.fvgs = [
      { from: 7, to: 9, top: 3, bottom: 2, direction: 'bullish', filled: 0 },
      { from: count, to: count + 1, top: 3, bottom: 2, direction: 'bullish', filled: 0 },
    ]
    fixture.ict.orderBlocks = [
      { index: 8, top: 4, bottom: 3, direction: 'bearish' },
      { index: count, top: 4, bottom: 3, direction: 'bearish' },
    ]
    fixture.ict.liquidity = [
      { price: 5, kind: 'bsl', touches: 2, index: 9 },
      { price: 5, kind: 'bsl', touches: 2, index: count },
    ]
    fixture.pa.levels = [
      { price: 6, kind: 'support', touches: 2, lastIndex: 10 },
      { price: 6, kind: 'support', touches: 2, lastIndex: count },
    ]

    const result = buildChartAnalysis(fixture, count)

    expect(result.series.every((item) => item.points.length === count)).toBe(true)
    expect(result.markers.map((item) => item.id)).toEqual(['break-5-bos', 'sweep-6'])
    expect(result.zones.map((item) => item.id)).toEqual(['fvg-7-bullish', 'ob-8'])
    expect(result.zones.every((item) => item.to <= count - 1)).toBe(true)
    expect(result.levels.map((item) => item.id)).toEqual(['liq-9-bsl', 'sr-10-support', 'poc', 'vah', 'val'])

    const prefix = buildChartAnalysis(report, count)
    expect(prefix.series.every((item) => item.points.length === count)).toBe(true)
    expect(prefix.markers.every((item) => item.index >= 0 && item.index < count)).toBe(true)
    expect(prefix.zones.every((item) => item.from >= 0 && item.from < count && item.to <= count - 1)).toBe(true)
  })

  it('clamps non-finite and negative counts to an empty overlay', () => {
    expect(buildChartAnalysis(report, -10)).toEqual(empty)
    expect(buildChartAnalysis(report, Number.NaN)).toEqual(empty)
    expect(buildChartAnalysis(report, Number.POSITIVE_INFINITY)).toEqual(empty)
    expect(buildChartAnalysis(report, 0)).toEqual(empty)
  })

  it('floors fractional counts', () => {
    const fixture = structuredClone(report)
    fixture.trend.breaks = [{ index: 9, price: 1, kind: 'bos', direction: 'bullish' }]
    fixture.ict.sweeps = []
    fixture.ict.fvgs = [{ from: 9, to: 10, top: 2, bottom: 1, direction: 'bullish', filled: 0 }]
    fixture.ict.orderBlocks = []
    fixture.ict.liquidity = []
    fixture.pa.levels = []
    fixture.flow.profile = []

    const result = buildChartAnalysis(fixture, 10.9)

    expect(result.series.every((item) => item.points.length === 10)).toBe(true)
    expect(result.markers).toHaveLength(1)
    expect(result.markers[0]!.index).toBe(9)
    expect(result.zones).toHaveLength(1)
    expect(result.zones[0]!.to).toBe(9)
  })

  it('does not mutate the report or the default layer/framework objects', () => {
    const reportSnapshot = structuredClone(report)
    const layersSnapshot = { ...defaultAnalysisLayers }
    const frameworksSnapshot = { ...defaultAnalysisFrameworks }

    const frozenReport = deepFreeze(structuredClone(report))
    const frozenLayers = deepFreeze(structuredClone(defaultAnalysisLayers)) as AnalysisLayers
    const frozenFrameworks = deepFreeze(structuredClone(defaultAnalysisFrameworks)) as AnalysisFrameworks

    expect(() => buildChartAnalysis(frozenReport, candles.length)).not.toThrow()
    expect(() => buildChartAnalysis(frozenReport, 40, frozenLayers, frozenFrameworks)).not.toThrow()

    const result = buildChartAnalysis(report, candles.length)
    expect(result).toEqual(legacyOverlay(report, candles.length))
    expect(report).toEqual(reportSnapshot)
    expect(defaultAnalysisLayers).toEqual(layersSnapshot)
    expect(defaultAnalysisFrameworks).toEqual(frameworksSnapshot)
  })
})
