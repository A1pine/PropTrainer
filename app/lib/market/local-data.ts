import { createRng } from '~/domain/shared/rng'
import type { LocalDataset, LocalDatasetMeta, LocalManifest, LocalScenarioInput } from './types'

/**
 * Local market pack repository.
 *
 * Contract: `scripts/fetch-yahoo.mjs` writes `public/data/market/manifest.json`
 * plus one `<SYMBOL>.json` per instrument. This module only reads them from the
 * same origin. A missing pack is normal, not an error: callers fall back to the
 * synthetic generator.
 */

const MANIFEST_PATH = 'data/market/manifest.json'
const DATASET_PATH = 'data/market'

/** Guard against a malformed or accidentally huge file. */
const MAX_BARS = 500_000

const manifestCache = new Map<string, LocalManifest | null>()
const manifestPending = new Map<string, Promise<LocalManifest | null>>()
const datasetCache = new Map<string, LocalDataset>()
const datasetPending = new Map<string, Promise<LocalDataset | null>>()

function normalizeBase(baseURL: string): string {
  return (baseURL || '/').replace(/\/+$/, '') || ''
}

function assetUrl(baseURL: string, path: string): string {
  return `${normalizeBase(baseURL)}/${path}`.replace(/\/{2,}/g, '/')
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-cache',
    })
    if (!response.ok) return null
    return (await response.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseManifest(input: unknown): LocalManifest | null {
  if (!isRecord(input) || !Array.isArray(input.datasets)) return null
  if (!isFiniteNumber(input.version) || !isNonEmptyString(input.generatedAt)) return null
  const datasets: LocalDatasetMeta[] = []
  for (const entry of input.datasets) {
    if (!isRecord(entry)) continue
    if (!isNonEmptyString(entry.symbol)) continue
    if (!isNonEmptyString(entry.source)) continue
    if (!isNonEmptyString(entry.timeframe)) continue
    if (!isFiniteNumber(entry.bars) || entry.bars <= 0) continue
    datasets.push({
      symbol: entry.symbol,
      source: entry.source,
      sourceSymbol: isNonEmptyString(entry.sourceSymbol) ? entry.sourceSymbol : entry.symbol,
      timeframe: entry.timeframe,
      timezone: isNonEmptyString(entry.timezone) ? entry.timezone : 'UTC',
      license: isNonEmptyString(entry.license) ? entry.license : 'Unknown provenance',
      fetchedAt: isNonEmptyString(entry.fetchedAt) ? entry.fetchedAt : input.generatedAt,
      bars: entry.bars,
    })
  }
  if (!datasets.length) return null
  return {
    version: input.version,
    generatedAt: input.generatedAt,
    interval: isNonEmptyString(input.interval) ? input.interval : '5m',
    range: isNonEmptyString(input.range) ? input.range : '',
    timezone: isNonEmptyString(input.timezone) ? input.timezone : 'UTC',
    datasets,
  }
}

/**
 * Validates a dataset before it reaches the chart. This is deliberately strict:
 * a single out-of-order timestamp or a high below the close would poison every
 * downstream metric, and silent corruption is worse than a fallback.
 */
export function parseDataset(input: unknown, expectedSymbol?: string): LocalDataset | null {
  if (!isRecord(input)) return null
  if (!isNonEmptyString(input.symbol)) return null
  if (expectedSymbol && input.symbol !== expectedSymbol) return null
  const columns = ['t', 'o', 'h', 'l', 'c', 'v'] as const
  const rows: Record<(typeof columns)[number], unknown[]> = { t: [], o: [], h: [], l: [], c: [], v: [] }
  for (const column of columns) {
    const value = input[column]
    if (!Array.isArray(value)) return null
    if (value.length > MAX_BARS) return null
    rows[column] = value
  }
  const bars = rows.t.length
  if (bars < 2) return null
  if (columns.some((column) => rows[column].length !== bars)) return null
  if (isFiniteNumber(input.bars) && input.bars !== bars) return null

  const t: number[] = []
  const o: number[] = []
  const h: number[] = []
  const l: number[] = []
  const c: number[] = []
  const v: number[] = []

  for (let index = 0; index < bars; index += 1) {
    const time = rows.t[index]
    const open = rows.o[index]
    const high = rows.h[index]
    const low = rows.l[index]
    const close = rows.c[index]
    const volume = rows.v[index]
    if (!isFiniteNumber(time) || !isFiniteNumber(open) || !isFiniteNumber(high) || !isFiniteNumber(low)) return null
    if (!isFiniteNumber(close) || !isFiniteNumber(volume)) return null
    if (low <= 0 || high < low) return null
    if (high < Math.max(open, close) || low > Math.min(open, close)) return null
    if (volume < 0) return null
    if (index > 0 && time <= t[index - 1]!) return null
    t.push(Math.round(time))
    o.push(open)
    h.push(high)
    l.push(low)
    c.push(close)
    v.push(volume)
  }

  return {
    symbol: input.symbol,
    source: isNonEmptyString(input.source) ? input.source : 'unknown',
    sourceSymbol: isNonEmptyString(input.sourceSymbol) ? input.sourceSymbol : input.symbol,
    timeframe: isNonEmptyString(input.timeframe) ? input.timeframe : '5m',
    timezone: isNonEmptyString(input.timezone) ? input.timezone : 'UTC',
    license: isNonEmptyString(input.license) ? input.license : 'Unknown provenance',
    fetchedAt: isNonEmptyString(input.fetchedAt) ? input.fetchedAt : new Date(0).toISOString(),
    bars,
    t,
    o,
    h,
    l,
    c,
    v,
  }
}

export async function loadLocalManifest(baseURL: string, force = false): Promise<LocalManifest | null> {
  const key = normalizeBase(baseURL)
  if (!force) {
    const cached = manifestCache.get(key)
    if (cached !== undefined) return cached
    const pending = manifestPending.get(key)
    if (pending) return pending
  }
  const request = (async () => {
    const payload = await fetchJson(assetUrl(key, MANIFEST_PATH))
    const manifest = parseManifest(payload)
    manifestCache.set(key, manifest)
    return manifest
  })().finally(() => manifestPending.delete(key))
  manifestPending.set(key, request)
  return request
}

export async function loadLocalDataset(baseURL: string, symbol: string): Promise<LocalDataset | null> {
  const key = `${normalizeBase(baseURL)}::${symbol}`
  const cached = datasetCache.get(key)
  if (cached) return cached
  const pending = datasetPending.get(key)
  if (pending) return pending

  const request = (async () => {
    const payload = await fetchJson(assetUrl(normalizeBase(baseURL), `${DATASET_PATH}/${symbol}.json`))
    const dataset = parseDataset(payload, symbol)
    if (dataset) datasetCache.set(key, dataset)
    return dataset
  })().finally(() => datasetPending.delete(key))
  datasetPending.set(key, request)
  return request
}

export function getCachedDataset(symbol: string): LocalDataset | null {
  for (const [key, value] of datasetCache) {
    if (key.endsWith(`::${symbol}`)) return value
  }
  return null
}

/** Test seam: drop every cached manifest and dataset. */
export function clearLocalMarketCache(): void {
  manifestCache.clear()
  manifestPending.clear()
  datasetCache.clear()
  datasetPending.clear()
}

/**
 * Picks an enabled instrument that exists in the pack and loads its dataset.
 * Selection is seeded, so a replay link reproduces the same symbol and window.
 */
export async function prepareLocalScenarioInput(options: {
  baseURL: string
  symbols: readonly string[]
  seed: string
}): Promise<LocalScenarioInput | null> {
  const manifest = await loadLocalManifest(options.baseURL)
  if (!manifest) return null
  const available = manifest.datasets.filter((entry) => options.symbols.includes(entry.symbol))
  if (!available.length) return null
  const rng = createRng(`${options.seed}:local-symbol`)
  const picked = available[Math.floor(rng() * available.length)] ?? available[0]!
  const dataset = await loadLocalDataset(options.baseURL, picked.symbol)
  if (!dataset) return null
  return { symbol: picked.symbol, dataset }
}
