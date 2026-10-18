export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Snap a price to the instrument's tick grid, avoiding float drift. */
export function roundToTick(price: number, tickSize: number): number {
  if (tickSize <= 0) return price
  return roundTo(Math.round(price / tickSize) * tickSize, Math.max(0, decimalsFor(tickSize)))
}

export function decimalsFor(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 0
  const text = tickSize.toString()
  if (text.includes('e-')) return Number(text.split('e-')[1])
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

export function average(values: readonly number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

export function percentChange(from: number, to: number): number {
  if (from === 0) return 0
  return ((to - from) / Math.abs(from)) * 100
}

/** Linear interpolation used by chart animation and number tweening. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp(t, 0, 1)
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - clamp(t, 0, 1), 3)
}
