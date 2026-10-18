export interface Rect {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

export interface PriceScale {
  min: number
  max: number
  y: (price: number) => number
  price: (y: number) => number
  ticks: number[]
}

export interface IndexGeometry {
  start: number
  span: number
  slot: number
  x: (index: number) => number
  indexAt: (x: number) => number
}

export interface Viewport {
  /** Index of the rightmost visible bar (can be fractional while panning). */
  end: number
  /** Number of bars across the plot. */
  span: number
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { left: x, top: y, width, height, right: x + width, bottom: y + height }
}

export function createPriceScale(min: number, max: number, area: Rect, padRatio = 0.06): PriceScale {
  const safeMin = Number.isFinite(min) ? min : 0
  const safeMax = Number.isFinite(max) ? max : 1
  const span = safeMax - safeMin || Math.abs(safeMax) * 0.01 || 1
  const paddedMin = safeMin - span * padRatio
  const paddedMax = safeMax + span * padRatio
  const range = paddedMax - paddedMin || 1
  return {
    min: paddedMin,
    max: paddedMax,
    y: (price: number) => area.bottom - ((price - paddedMin) / range) * area.height,
    price: (y: number) => paddedMin + ((area.bottom - y) / area.height) * range,
    ticks: niceTicks(paddedMin, paddedMax, 5),
  }
}

export function createIndexGeometry(viewport: Viewport, area: Rect): IndexGeometry {
  const span = Math.max(2, viewport.span)
  const start = viewport.end - span + 1
  const slot = area.width / span
  return {
    start,
    span,
    slot,
    x: (index: number) => area.left + (index - start + 0.5) * slot,
    indexAt: (x: number) => start + (x - area.left) / slot - 0.5,
  }
}

export function clampViewport(viewport: Viewport, total: number, minSpan = 24): Viewport {
  const maxSpan = Math.max(2, total)
  const span = Math.min(maxSpan, Math.max(Math.min(minSpan, maxSpan), viewport.span))
  const end = Math.min(maxSpan - 1, Math.max(span - 1, viewport.end))
  return { end, span }
}

export function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return []
  const raw = (max - min) / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const residual = raw / magnitude
  const step = (residual >= 7.5 ? 10 : residual >= 3.5 ? 5 : residual >= 1.5 ? 2 : 1) * magnitude
  const first = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let value = first; value <= max + step * 0.001; value += step) {
    ticks.push(Math.round(value * 1e8) / 1e8)
  }
  return ticks
}

export function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

export const FIB_LEVELS = [
  { ratio: 0, label: '0' },
  { ratio: 0.236, label: '23.6' },
  { ratio: 0.382, label: '38.2' },
  { ratio: 0.5, label: '50.0' },
  { ratio: 0.618, label: '61.8' },
  { ratio: 0.786, label: '78.6' },
  { ratio: 1, label: '100' },
] as const

/** Fib retracement levels between two anchor prices (high/low normalised). */
export function fibLevels(a: number, b: number): { ratio: number; label: string; price: number }[] {
  const high = Math.max(a, b)
  const low = Math.min(a, b)
  return FIB_LEVELS.map((level) => ({
    ratio: level.ratio,
    label: level.label,
    price: high - (high - low) * level.ratio,
  }))
}

export function clampPriceToTick(price: number, tickSize: number): number {
  if (tickSize <= 0) return price
  const decimals = Math.max(0, Math.round(-Math.log10(tickSize)) + 2)
  return Number((Math.round(price / tickSize) * tickSize).toFixed(decimals))
}

export function formatRelativeBars(offset: number, timeframeMinutes: number): string {
  if (offset === 0) return 'now'
  const minutes = Math.abs(offset) * timeframeMinutes
  const sign = offset < 0 ? '−' : '+'
  if (minutes < 60) return `${sign}${Math.round(minutes)}m`
  const hours = minutes / 60
  if (hours < 24) return `${sign}${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)}h`
  return `${sign}${(hours / 24).toFixed(1)}d`
}
