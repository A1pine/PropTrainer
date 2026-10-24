import type { ChartStyle } from '~/lib/chart/types'
import type { SimTimeframe } from '~/domain/sim/types'
import { isTimeframeAvailable } from '~/domain/sim/timeframe'

/**
 * A workspace is a small list of chart panes that share one replay clock. The
 * active pane drives the ticket, ladder and position panels; the others stay as
 * context. Layouts are display-only, so they live in localStorage next to the
 * symbol/timeframe preferences rather than in the account snapshot.
 */
export interface TerminalPane {
  symbol: string
  timeframe: SimTimeframe
  style: ChartStyle
}

export const LAYOUT_KEY = 'propdesk.terminal.layout.v1'
export const MAX_PANES = 3
export const LAYOUT_SIZES = [1, 2, 3] as const

const STYLES: ChartStyle[] = ['candles', 'ohlc', 'line', 'heikin-ashi']

export function validPane(value: unknown, hasSymbol: (symbol: string) => boolean): value is TerminalPane {
  if (!value || typeof value !== 'object') return false
  const pane = value as Record<string, unknown>
  return (
    typeof pane.symbol === 'string' &&
    hasSymbol(pane.symbol) &&
    typeof pane.timeframe === 'string' &&
    isTimeframeAvailable(pane.timeframe as SimTimeframe) &&
    typeof pane.style === 'string' &&
    STYLES.includes(pane.style as ChartStyle)
  )
}

/**
 * Resize a pane list to `size`, keeping the first panes and filling new slots
 * with unused symbols so two panes never show the same chart. Returns a fresh
 * array; the caller owns persistence.
 */
export function resizePanes(
  panes: readonly TerminalPane[],
  size: number,
  symbols: readonly string[],
  fallback: TerminalPane,
): TerminalPane[] {
  const target = Math.max(1, Math.min(MAX_PANES, Math.trunc(size) || 1))
  const next = panes.slice(0, target).map((pane) => ({ ...pane }))
  while (next.length < target) {
    const used = new Set(next.map((pane) => pane.symbol))
    const symbol = symbols.find((candidate) => !used.has(candidate)) ?? next[0]?.symbol ?? fallback.symbol
    next.push({ ...fallback, symbol })
  }
  return next
}

export function readLayout(hasSymbol: (symbol: string) => boolean): TerminalPane[] | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as unknown
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PANES) return null
    if (!raw.every((pane) => validPane(pane, hasSymbol))) return null
    // The same symbol may appear twice on purpose (two timeframes side by side).
    return (raw as TerminalPane[]).map((pane) => ({
      symbol: pane.symbol,
      timeframe: pane.timeframe,
      style: pane.style,
    }))
  } catch {
    return null
  }
}

export function writeLayout(panes: readonly TerminalPane[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload = panes.slice(0, MAX_PANES).map((pane) => ({
      symbol: pane.symbol,
      timeframe: pane.timeframe,
      style: pane.style,
    }))
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(payload))
  } catch {
    /* Display preferences are optional; accounting storage reports its own errors. */
  }
}
