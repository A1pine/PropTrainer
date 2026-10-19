#!/usr/bin/env node
/**
 * Fetch free 5-minute futures bars from Yahoo Finance into a local market pack.
 *
 *   bun run data:fetch
 *   bun run data:fetch --symbols MNQ,MES --range 60d
 *
 * Output (gitignored):
 *   public/data/market/manifest.json
 *   public/data/market/<SYMBOL>.json
 *
 * Yahoo's chart endpoint is undocumented and rate-limited; this script is for
 * local evaluation only. Do not commit or redistribute the downloaded bars.
 */

import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const DEFAULTS = {
  symbols: ['MNQ', 'MES', 'NQ', 'ES', 'MYM', 'M2K', 'MGC', 'MCL'],
  interval: '5m',
  range: '60d',
  out: 'public/data/market',
}

const LICENSE = 'Yahoo Finance (unofficial) — local evaluation only, do not redistribute'
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']

function parseArgs(argv) {
  const options = { ...DEFAULTS }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--symbols')
      options.symbols = String(argv[++index] ?? '')
        .split(',')
        .map((value) => value.trim())
    else if (arg === '--interval') options.interval = String(argv[++index] ?? options.interval)
    else if (arg === '--range') options.range = String(argv[++index] ?? options.range)
    else if (arg === '--out') options.out = String(argv[++index] ?? options.out)
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: bun run data:fetch [--symbols MNQ,MES] [--interval 5m] [--range 60d] [--out dir]')
      process.exit(0)
    }
  }
  options.symbols = options.symbols.filter(Boolean)
  if (!options.symbols.length) throw new Error('No symbols selected')
  return options
}

function yahooSymbol(symbol) {
  return `${symbol}=F`
}

async function requestChart(symbol, interval, range) {
  const params = new URLSearchParams({
    interval,
    range,
    includePrePost: 'true',
    events: 'div,splits',
  })
  let lastError = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const host = HOSTS[attempt % HOSTS.length]
    const url = `${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?${params.toString()}`
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 PropDesk/1.0',
        },
      })
      if (response.status === 429) throw new Error('rate limited (429)')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      const error = payload?.chart?.error
      if (error) throw new Error(error.description ?? error.code ?? 'chart error')
      const result = payload?.chart?.result?.[0]
      if (!result?.timestamp?.length) throw new Error('empty series')
      return result
    } catch (error) {
      lastError = error
      if (attempt < 3) await sleep(600 * (attempt + 1))
    }
  }
  throw lastError ?? new Error('request failed')
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function toBars(result) {
  const quote = result.indicators?.quote?.[0]
  if (!quote) return []
  const rows = []
  for (let index = 0; index < result.timestamp.length; index += 1) {
    const time = result.timestamp[index]
    const open = quote.open?.[index]
    const high = quote.high?.[index]
    const low = quote.low?.[index]
    const close = quote.close?.[index]
    if (![time, open, high, low, close].every((value) => typeof value === 'number' && Number.isFinite(value))) continue
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue
    if (high < Math.max(open, close) || low > Math.min(open, close)) continue
    rows.push({
      t: Math.round(time),
      o: open,
      h: high,
      l: low,
      c: close,
      v: Math.max(0, Math.round(Number.isFinite(quote.volume?.[index]) ? quote.volume[index] : 0)),
    })
  }
  rows.sort((a, b) => a.t - b.t)
  // Yahoo occasionally repeats a timestamp across a contract roll; keep the
  // later row so the series stays strictly increasing.
  const deduped = []
  for (const row of rows) {
    const previous = deduped[deduped.length - 1]
    if (previous && previous.t === row.t) deduped[deduped.length - 1] = row
    else deduped.push(row)
  }
  return deduped
}

function columnar(symbol, result, bars, interval) {
  return {
    symbol,
    source: 'yahoo',
    sourceSymbol: yahooSymbol(symbol),
    timeframe: result.meta?.dataGranularity ?? interval,
    timezone: 'UTC',
    license: LICENSE,
    fetchedAt: new Date().toISOString(),
    bars: bars.length,
    t: bars.map((bar) => bar.t),
    o: bars.map((bar) => bar.o),
    h: bars.map((bar) => bar.h),
    l: bars.map((bar) => bar.l),
    c: bars.map((bar) => bar.c),
    v: bars.map((bar) => bar.v),
  }
}

async function writeJson(path, value, pretty = false) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  await writeFile(temp, pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value))
  await rename(temp, path)
}

function isoDate(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const outDir = resolve(process.cwd(), options.out)
  const manifestPath = resolve(outDir, 'manifest.json')
  console.log(`Fetching ${options.symbols.length} symbols · ${options.interval} · ${options.range}`)
  console.log(`Output: ${outDir}\n`)

  const manifestEntries = []
  const failures = []
  for (const symbol of options.symbols) {
    process.stdout.write(`${symbol.padEnd(5)} `)
    try {
      const result = await requestChart(symbol, options.interval, options.range)
      const bars = toBars(result)
      if (bars.length < 1000) throw new Error(`only ${bars.length} clean bars`)
      const dataset = columnar(symbol, result, bars, options.interval)
      await writeJson(resolve(outDir, `${symbol}.json`), dataset)
      manifestEntries.push({
        symbol,
        source: dataset.source,
        sourceSymbol: dataset.sourceSymbol,
        timeframe: dataset.timeframe,
        timezone: dataset.timezone,
        license: dataset.license,
        fetchedAt: dataset.fetchedAt,
        bars: dataset.bars,
      })
      const first = isoDate(bars[0].t)
      const last = isoDate(bars[bars.length - 1].t)
      console.log(`${String(bars.length).padStart(6)} bars  ${first} → ${last}`)
    } catch (error) {
      failures.push({ symbol, error: error instanceof Error ? error.message : String(error) })
      console.log(`FAILED  ${failures[failures.length - 1].error}`)
    }
    await sleep(350)
  }

  if (!manifestEntries.length) {
    console.error('\nNo datasets written. Yahoo may be rate limiting or unreachable.')
    process.exit(1)
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    interval: options.interval,
    range: options.range,
    timezone: 'UTC',
    datasets: manifestEntries,
  }
  await writeJson(manifestPath, manifest, true)

  const totalBars = manifestEntries.reduce((sum, entry) => sum + entry.bars, 0)
  console.log(`\nWrote ${manifestEntries.length} datasets · ${totalBars.toLocaleString('en-US')} bars`)
  console.log(`Manifest: ${manifestPath}`)
  if (failures.length) {
    console.log(`Skipped: ${failures.map((failure) => failure.symbol).join(', ')}`)
    process.exitCode = 0
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
