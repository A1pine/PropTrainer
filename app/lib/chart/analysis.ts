import type { AnalysisReport } from '~/domain/analysis/types'
import type { ChartAnalysis } from '~/lib/chart/types'

export type AnalysisFramework = 'pa' | 'ict' | 'flow' | 'indicators'

export type AnalysisFrameworks = Record<AnalysisFramework, boolean>

export const defaultAnalysisFrameworks: AnalysisFrameworks = {
  pa: true,
  ict: true,
  flow: true,
  indicators: true,
}

export const defaultAnalysisLayers = {
  ema: true,
  vwap: true,
  bb: false,
  fvg: true,
  ob: true,
  liquidity: true,
  profile: true,
}

export type AnalysisLayers = typeof defaultAnalysisLayers

function emptyAnalysis(): ChartAnalysis {
  return { series: [], zones: [], levels: [], markers: [], profile: [] }
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/** Items are only drawn when their anchor candle is inside the visible prefix. */
function isVisible(index: number, count: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < count
}

/**
 * Translate an analysis report into chart overlay primitives.
 *
 * The report itself must already be computed from the visible candle prefix;
 * this adapter only slices and filters defensively, it cannot make a report
 * that was computed from future candles causal.
 */
export function buildChartAnalysis(
  report: AnalysisReport | null,
  visibleCount: number,
  layers: AnalysisLayers = defaultAnalysisLayers,
  frameworks: AnalysisFrameworks = defaultAnalysisFrameworks,
): ChartAnalysis {
  const count = clampCount(visibleCount)
  if (!report || count === 0) return emptyAnalysis()

  const end = count - 1
  const series: ChartAnalysis['series'] = []
  if (frameworks.indicators) {
    if (layers.ema) {
      series.push(
        { id: 'ema20', tone: 'clay', width: 1.2, points: report.indicators.ema20.slice(0, count) },
        { id: 'ema50', tone: 'bull', width: 1.1, points: report.indicators.ema50.slice(0, count) },
        { id: 'ema200', tone: 'bear', width: 1.1, points: report.indicators.ema200.slice(0, count) },
      )
    }
    if (layers.vwap) {
      series.push({
        id: 'vwap',
        tone: 'ink',
        width: 1,
        dashed: true,
        points: report.indicators.vwap.slice(0, count),
      })
    }
    if (layers.bb) {
      series.push(
        {
          id: 'bbUpper',
          tone: 'muted',
          width: 1,
          dashed: true,
          points: report.indicators.bbUpper.slice(0, count),
        },
        {
          id: 'bbLower',
          tone: 'muted',
          width: 1,
          dashed: true,
          points: report.indicators.bbLower.slice(0, count),
        },
      )
    }
  }

  const zones: ChartAnalysis['zones'] = []
  if (frameworks.ict) {
    if (layers.fvg) {
      const gaps = report.ict.fvgs.filter((item) => item.filled < 0.95 && isVisible(item.from, count))
      for (const gap of gaps.slice(0, 4)) {
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
    }
    if (layers.ob) {
      const blocks = report.ict.orderBlocks.filter((item) => isVisible(item.index, count))
      for (const block of blocks.slice(0, 4)) {
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
    }
  }

  const levels: ChartAnalysis['levels'] = []
  if (frameworks.ict && layers.liquidity) {
    const liquidity = report.ict.liquidity.filter((item) => isVisible(item.index, count))
    for (const level of liquidity.slice(0, 4)) {
      levels.push({
        id: `liq-${level.index}-${level.kind}`,
        price: level.price,
        tone: 'clay',
        label: `${level.kind.toUpperCase()} · ${level.touches}`,
      })
    }
  }
  // The lab has always used its liquidity switch for PA support/resistance.
  if (frameworks.pa && layers.liquidity) {
    const priceLevels = report.pa.levels.filter((item) => isVisible(item.lastIndex, count))
    for (const level of priceLevels.slice(0, 3)) {
      levels.push({
        id: `sr-${level.lastIndex}-${level.kind}`,
        price: level.price,
        tone: 'muted',
        label: `${level.kind === 'support' ? 'S' : 'R'} · ${level.touches}`,
      })
    }
  }
  if (frameworks.flow && layers.profile) {
    levels.push(
      { id: 'poc', price: report.flow.poc, tone: 'clay', label: 'POC' },
      { id: 'vah', price: report.flow.vah, tone: 'warn', label: 'VAH' },
      { id: 'val', price: report.flow.val, tone: 'warn', label: 'VAL' },
    )
  }

  const markers: ChartAnalysis['markers'] = []
  if (frameworks.pa) {
    const breaks = report.trend.breaks.filter((item) => isVisible(item.index, count))
    for (const item of breaks.slice(0, 6)) {
      markers.push({
        id: `break-${item.index}-${item.kind}`,
        index: item.index,
        price: item.price,
        tone: item.direction === 'bullish' ? 'bull' : 'bear',
        label: item.kind === 'bos' ? 'BOS' : 'CHoCH',
      })
    }
  }
  if (frameworks.ict) {
    const sweeps = report.ict.sweeps.filter((item) => isVisible(item.index, count))
    for (const sweep of sweeps.slice(0, 5)) {
      markers.push({
        id: `sweep-${sweep.index}`,
        index: sweep.index,
        price: sweep.price,
        tone: sweep.direction === 'bullish' ? 'bull' : 'bear',
        label: 'SWEEP',
      })
    }
  }

  return {
    series,
    zones,
    levels,
    markers,
    profile: frameworks.flow && layers.profile ? report.flow.profile : [],
  }
}
