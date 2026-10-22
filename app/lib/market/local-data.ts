import { createRng } from '~/domain/shared/rng'
import { canUseDataset, datasetWindowBars } from '~/domain/market/dataset'
import { parseTimeframeMinutes } from './types'
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

/**
 * A missing or corrupt pack is cached briefly so a fallback round does not
 * hammer the same 404, while still allowing a refreshed pack to appear without
 * a full page reload. Successful loads stay cached until an explicit refresh.
 */
export const LOCAL_NEGATIVE_CACHE_TTL_MS = 30_000

interface CacheEntry<T> {
  value: T
  storedAt: number
}

const manifestCache = new Map<string, CacheEntry<LocalManifest | null>>()
const datasetCache = new Map<string, CacheEntry<LocalDataset | null>>()
const manifestPending = new Map<string, Promise<LocalManifest | null>>()
const datasetPending = new Map<string, Promise<LocalDataset | null>>()

/**
 * Every base URL has its own generation. A request may only write its result
 * when the generation it started with is still current. `clearLocalMarketCache`
 * and a forced manifest refresh bump the generation, so an older in-flight
 * request can never repopulate the cache with stale pack data.
 */
const generations = new Map<string, number>()

const SYMBOL_PATTERN = /^[A-Z0-9]{2,10}$/

function normalizeBase(baseURL: string): string {
  return (baseURL || '/').replace(/\/+$/, '') || ''
}

function assetUrl(baseURL: string, path: string): string {
  return `${normalizeBase(baseURL)}/${path}`
}

function currentGeneration(base: string): number {
  const generation = generations.get(base)
  if (generation !== undefined) return generation
  generations.set(base, 0)
  return 0
}

function bumpGeneration(base: string): number {
  const next = currentGeneration(base) + 1
  generations.set(base, next)
  return next
}

function requestKey(base: string, generation: number, request: string): string {
  return `${base}\u0000${generation}\u0000${request}`
}

function datasetKey(base: string, symbol: string): string {
  return `${base}\u0000${symbol}`
}

function readCache<T>(
  cache: Map<string, CacheEntry<T | null>>,
  key: string,
  now: number,
): CacheEntry<T | null> | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.value === null && now - entry.storedAt >= LOCAL_NEGATIVE_CACHE_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return entry
}

function invalidateBase(base: string): void {
  bumpGeneration(base)
  manifestCache.delete(base)
  const prefix = `${base}\u0000`
  for (const key of [...datasetCache.keys()]) {
    if (key.startsWith(prefix)) datasetCache.delete(key)
  }
  for (const key of [...manifestPending.keys()]) {
    if (key.startsWith(prefix)) manifestPending.delete(key)
  }
  for (const key of [...datasetPending.keys()]) {
    if (key.startsWith(prefix)) datasetPending.delete(key)
  }
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

function isSymbol(value: unknown): value is string {
  return typeof value === 'string' && SYMBOL_PATTERN.test(value)
}

export function parseManifest(input: unknown): LocalManifest | null {
  if (!isRecord(input) || !Array.isArray(input.datasets)) return null
  if (!isFiniteNumber(input.version) || !isNonEmptyString(input.generatedAt)) return null
  const datasets: LocalDatasetMeta[] = []
  for (const entry of input.datasets) {
    if (!isRecord(entry)) continue
    if (!isSymbol(entry.symbol)) continue
    if (!isNonEmptyString(entry.source)) continue
    if (!isNonEmptyString(entry.timeframe) || parseTimeframeMinutes(entry.timeframe) == null) continue
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
 *
 * Timestamps are integer Unix seconds. Rounding fractional values here would
 * turn `[1000.1, 1000.2]` into a duplicate `1000`, so non-integers are rejected
 * instead of normalized.
 */
export function parseDataset(input: unknown, expectedSymbol?: string): LocalDataset | null {
  if (!isRecord(input)) return null
  if (!isSymbol(input.symbol)) return null
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
  if (!isNonEmptyString(input.timeframe) || parseTimeframeMinutes(input.timeframe) == null) return null

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
    if (!Number.isInteger(time)) return null
    if (low <= 0 || high < low) return null
    if (high < Math.max(open, close) || low > Math.min(open, close)) return null
    if (volume < 0) return null
    if (index > 0 && time <= t[index - 1]!) return null
    t.push(time)
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
    timeframe: input.timeframe,
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
  const base = normalizeBase(baseURL)
  // A refresh of the manifest also invalidates datasets: their provenance and
  // availability are described by this manifest, and a new pack may replace
  // the files underneath the old cache.
  if (force) invalidateBase(base)
  const now = Date.now()
  if (!force) {
    const cached = readCache(manifestCache, base, now)
    if (cached) return cached.value
  }

  const generation = currentGeneration(base)
  const key = requestKey(base, generation, 'manifest')
  const pending = manifestPending.get(key)
  if (pending) return pending

  const request = (async () => {
    const payload = await fetchJson(assetUrl(base, MANIFEST_PATH))
    const manifest = parseManifest(payload)
    if (currentGeneration(base) === generation) {
      manifestCache.set(base, { value: manifest, storedAt: Date.now() })
    }
    return manifest
  })().finally(() => manifestPending.delete(key))
  manifestPending.set(key, request)
  return request
}

export async function loadLocalDataset(baseURL: string, symbol: string): Promise<LocalDataset | null> {
  const base = normalizeBase(baseURL)
  if (!isSymbol(symbol)) return null
  const key = datasetKey(base, symbol)
  const cached = readCache(datasetCache, key, Date.now())
  if (cached) return cached.value

  const generation = currentGeneration(base)
  const pendingKey = requestKey(base, generation, `dataset:${symbol}`)
  const pending = datasetPending.get(pendingKey)
  if (pending) return pending

  const request = (async () => {
    const payload = await fetchJson(assetUrl(base, `${DATASET_PATH}/${symbol}.json`))
    const dataset = parseDataset(payload, symbol)
    if (currentGeneration(base) === generation) {
      datasetCache.set(key, { value: dataset, storedAt: Date.now() })
    }
    return dataset
  })().finally(() => datasetPending.delete(pendingKey))
  datasetPending.set(pendingKey, request)
  return request
}

/** Cached dataset for one pack base; a symbol cached under another base is not reused. */
export function getCachedDataset(baseURL: string, symbol: string): LocalDataset | null {
  return datasetCache.get(datasetKey(normalizeBase(baseURL), symbol))?.value ?? null
}

/**
 * Test seam: drop cached manifests and datasets. With a base URL, only that
 * pack is invalidated (the Settings refresh path); without one, every base is
 * cleared. In-flight requests from an older generation can no longer write.
 */
export function clearLocalMarketCache(baseURL?: string): void {
  if (baseURL !== undefined) {
    invalidateBase(normalizeBase(baseURL))
    return
  }
  for (const base of [...generations.keys()]) bumpGeneration(base)
  manifestCache.clear()
  datasetCache.clear()
  manifestPending.clear()
  datasetPending.clear()
}

/**
 * Picks an enabled instrument that exists in the pack and loads its dataset.
 * Selection is seeded, so a replay link reproduces the same symbol and window.
 *
 * Candidates are filtered before fetching: the symbol must be enabled, the
 * pack must advertise a compatible timeframe, and it must hold enough bars for
 * one round. A short or mismatched pack yields null so the caller can fall back
 * to synthetic tape instead of throwing while building the scenario.
 */
export async function prepareLocalScenarioInput(options: {
  baseURL: string
  symbols: readonly string[]
  seed: string
  timeframeMinutes?: number
}): Promise<LocalScenarioInput | null> {
  const manifest = await loadLocalManifest(options.baseURL)
  if (!manifest) return null
  const timeframeMinutes = options.timeframeMinutes ?? 5
  const requiredBars = datasetWindowBars()
  const available = manifest.datasets.filter(
    (entry) =>
      options.symbols.includes(entry.symbol) &&
      entry.bars >= requiredBars &&
      parseTimeframeMinutes(entry.timeframe) === timeframeMinutes,
  )
  if (!available.length) return null

  const rng = createRng(`${options.seed}:local-symbol`)
  const start = Math.floor(rng() * available.length)
  // Rotate from the seeded pick instead of shuffling: the first choice stays
  // stable, and a corrupt file can still fall through to the next candidate.
  const ordered = available.map((_, index) => available[(start + index) % available.length]!)

  for (const candidate of ordered) {
    const dataset = await loadLocalDataset(options.baseURL, candidate.symbol)
    if (!dataset) continue
    if (parseTimeframeMinutes(dataset.timeframe) !== timeframeMinutes) continue
    if (!canUseDataset(dataset, requiredBars)) continue
    return { symbol: candidate.symbol, dataset }
  }
  return null
}
