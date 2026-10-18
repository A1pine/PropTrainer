import { describe, expect, it } from 'vitest'
import {
  clampPriceToTick,
  clampViewport,
  createIndexGeometry,
  createPriceScale,
  distanceToSegment,
  fibLevels,
  formatRelativeBars,
  niceTicks,
  rect,
} from '@/lib/chart/geometry'

const area = rect(0, 0, 400, 300)

describe('chart geometry', () => {
  it('maps prices to the padded plot', () => {
    const scale = createPriceScale(100, 200, area, 0)
    expect(scale.y(100)).toBeCloseTo(300, 5)
    expect(scale.y(200)).toBeCloseTo(0, 5)
    expect(scale.price(150)).toBeCloseTo(150, 5)
  })

  it('keeps prices inside the plot after padding', () => {
    const scale = createPriceScale(100, 200, area, 0.1)
    expect(scale.y(100)).toBeGreaterThan(270)
    expect(scale.y(200)).toBeLessThan(30)
  })

  it('produces human-friendly ticks', () => {
    const ticks = niceTicks(0, 100, 5)
    expect(ticks.length).toBeGreaterThan(3)
    expect(ticks[0]).toBeGreaterThanOrEqual(0)
    expect(ticks.every((tick) => Math.abs(tick % 20) < 1e-6)).toBe(true)
  })

  it('maps bar indices to pixels', () => {
    const geo = createIndexGeometry({ end: 99, span: 50 }, area)
    expect(geo.start).toBe(50)
    expect(geo.x(50)).toBeCloseTo(4, 0)
    expect(Math.round(geo.indexAt(geo.x(75)))).toBe(75)
    expect(geo.indexAt(area.width / 2)).toBeCloseTo(74.5, 1)
  })

  it('clamps viewports to the printed range', () => {
    expect(clampViewport({ end: 999, span: 50 }, 200).end).toBe(199)
    expect(clampViewport({ end: -50, span: 50 }, 200).end).toBe(49)
    expect(clampViewport({ end: 10, span: 1 }, 200).span).toBeGreaterThanOrEqual(24)
  })

  it('computes fib retracement levels from either anchor order', () => {
    const a = fibLevels(100, 200)
    const b = fibLevels(200, 100)
    expect(a).toEqual(b)
    expect(a[0]?.price).toBe(200)
    expect(a.at(-1)?.price).toBe(100)
    expect(a.find((level) => level.ratio === 0.5)?.price).toBe(150)
  })

  it('measures distance to a line segment', () => {
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5)
    expect(distanceToSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5)
  })

  it('snaps prices to the tick grid', () => {
    expect(clampPriceToTick(19450.37, 0.25)).toBe(19450.25)
    expect(clampPriceToTick(78.414, 0.01)).toBe(78.41)
  })

  it('formats relative time labels for blind mode', () => {
    expect(formatRelativeBars(0, 5)).toBe('now')
    expect(formatRelativeBars(-11, 5)).toBe('−55m')
    expect(formatRelativeBars(-24, 5)).toBe('−2h')
    expect(formatRelativeBars(-288, 5)).toBe('−1.0d')
  })
})
