/**
 * Display formatting. Prices and money are always rendered with tabular
 * numerals in the UI; these helpers keep grouping and signs consistent.
 */

export interface MoneyOptions {
  decimals?: number
  signed?: boolean
  locale?: string
  compact?: boolean
}

export function formatMoney(value: number | null | undefined, options: MoneyOptions = {}): string {
  if (value == null || Number.isNaN(value)) return '—'
  const { decimals = 2, signed = false, locale = 'en-US', compact = false } = options
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: compact ? 0 : decimals,
    maximumFractionDigits: compact ? 0 : decimals,
    notation: compact ? 'compact' : 'standard',
  })
  return signed && value > 0 ? `+${formatter.format(value)}` : formatter.format(value)
}

export function formatNumber(value: number | null | undefined, decimals = 0, locale = 'en-US'): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatPrice(value: number | null | undefined, precision = 2, locale = 'en-US'): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value)
}

export function formatR(value: number | null | undefined, decimals = 2): string {
  if (value == null || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}R`
}

export function formatPercent(value: number | null | undefined, decimals = 1, signed = false): string {
  if (value == null || Number.isNaN(value)) return '—'
  const sign = signed && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

export function formatSigned(value: number | null | undefined, decimals = 2): string {
  if (value == null || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}`
}

export function formatDate(iso: string, locale = 'en-US'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: '2-digit' }).format(date)
}

export function formatTime(timestamp: number, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp * 1000))
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function maskPrice(precision = 2): string {
  return `${'•'.repeat(2)}${'.'}${'•'.repeat(precision)}`
}

export function pnlTone(value: number | null | undefined): 'bull' | 'bear' | 'flat' {
  if (value == null || value === 0) return 'flat'
  return value > 0 ? 'bull' : 'bear'
}
