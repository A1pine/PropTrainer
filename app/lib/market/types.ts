/**
 * Local market pack contract.
 *
 * A pack is produced by `scripts/fetch-yahoo.mjs` from free Yahoo Finance
 * 5-minute bars and served from `public/data/market/`. Nothing is fetched at
 * runtime: the app reads these JSON files from the same origin, so training
 * works offline once the pack exists.
 *
 * The arrays are column-oriented on purpose: the wasm core consumes columns,
 * and it keeps the payload roughly a third smaller than row objects.
 */
export interface LocalDatasetMeta {
  symbol: string
  /** Upstream provider id, e.g. `yahoo`. */
  source: string
  /** Provider symbol, e.g. `MNQ=F`. */
  sourceSymbol: string
  /** Bar interval, e.g. `5m`. */
  timeframe: string
  /** Always `UTC` for the Unix timestamps below. */
  timezone: string
  /** Human-readable provenance note shown after the reveal. */
  license: string
  /** ISO timestamp of the fetch. */
  fetchedAt: string
  bars: number
}

export interface LocalDataset extends LocalDatasetMeta {
  /** Bar open time, integer Unix seconds, strictly increasing. */
  t: number[]
  o: number[]
  h: number[]
  l: number[]
  c: number[]
  v: number[]
}

export interface LocalManifest {
  version: number
  generatedAt: string
  interval: string
  range: string
  timezone: string
  datasets: LocalDatasetMeta[]
}

export interface LocalScenarioInput {
  symbol: string
  dataset: LocalDataset
}

const TIMEFRAME_UNIT_MINUTES: Record<string, number> = {
  s: 1 / 60,
  m: 1,
  h: 60,
  d: 1_440,
  w: 10_080,
}

/**
 * Parses the pack timeframe (`5m`, `1h`, `1d`) into minutes. Returns null for
 * anything that cannot be mapped onto scenario spacing instead of guessing a
 * default, so a mismatched pack can be rejected before a round starts.
 */
export function parseTimeframeMinutes(timeframe: string): number | null {
  const match = /^([1-9]\d*)([smhdw])$/.exec(timeframe.trim())
  if (!match) return null
  const amount = Number(match[1])
  const unit = TIMEFRAME_UNIT_MINUTES[match[2]!]
  if (!unit) return null
  const minutes = amount * unit
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null
}
