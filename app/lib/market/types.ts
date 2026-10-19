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
  /** Bar open time, Unix seconds, strictly increasing. */
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
