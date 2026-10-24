/**
 * Sequential terminal-timeframe benchmark.
 *
 * Run this alone (not while typecheck/tests are running):
 *
 *   bun scripts/bench-timeframes.ts
 *
 * It loads the committed wasm artifact, builds a 13,000-bar synthetic tape, and
 * asserts the P95 timeframe switch stays below 10 ms. The unit suite keeps the
 * correctness/parity checks; real performance acceptance lives here so a busy
 * CI worker cannot turn it into a flaky test.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import type { Candle } from '../app/domain/market/types'
import type { SimTimeframe } from '../app/domain/sim/types'
import { aggregateCandles, aggregateCandlesTs } from '../app/domain/sim/timeframe'
import { isTradeDate, sessionOpen, shiftDayKey } from '../app/domain/sim/session'
import { createWasmCoreFromInstance, setWasmCore } from '../app/domain/wasm/core'
import { wasmArtifactVersion } from '../app/wasm/artifact'

const THRESHOLD_MS = 10
const SAMPLES = 60
const WARMUP = 6
const FRAMES: readonly SimTimeframe[] = ['15m', '30m', '1h', '4h', '1D', '45m']
const BUDGET = { rawKib: 160, brotliKib: 60, gzipKib: 70 } as const

function buildTape(): Candle[] {
  const candles: Candle[] = []
  let day = '2026-10-19'
  let price = 20_000
  let index = 0
  while (candles.length < 13_000) {
    if (isTradeDate(day)) {
      const open = sessionOpen(day)
      for (let offset = 0; offset < 23 * 3_600 && candles.length < 13_000; offset += 300) {
        const change = Math.sin(index / 9) * 3 + Math.cos(index / 31)
        const barOpen = price
        const barClose = price + change
        candles.push({
          time: open + offset,
          open: barOpen,
          high: Math.max(barOpen, barClose) + 1,
          low: Math.min(barOpen, barClose) - 1,
          close: barClose,
          volume: 100 + (index % 13),
        })
        price = barClose
        index += 1
      }
    }
    day = shiftDayKey(day, 1)
  }
  return candles
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.ceil(sorted.length * fraction) - 1]!
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right)
  return {
    min: sorted[0]!,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1]!,
  }
}

function format(summary: ReturnType<typeof summarize>): string {
  return `min=${summary.min.toFixed(2)} p50=${summary.p50.toFixed(2)} p95=${summary.p95.toFixed(2)} p99=${summary.p99.toFixed(2)} max=${summary.max.toFixed(2)} ms`
}

const artifact = readFileSync(new URL('../public/wasm/prop_core.wasm', import.meta.url))
const brotli = brotliCompressSync(artifact, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: artifact.length },
})
const gzip = gzipSync(artifact, { level: 9 })
const { instance } = await WebAssembly.instantiate(artifact, {})
const core = createWasmCoreFromInstance(instance)
setWasmCore(core)

const failures: string[] = []
const sizes = {
  raw: artifact.length / 1024,
  brotli: brotli.length / 1024,
  gzip: gzip.length / 1024,
}
for (const [name, value, budget] of [
  ['raw', sizes.raw, BUDGET.rawKib],
  ['brotli', sizes.brotli, BUDGET.brotliKib],
  ['gzip', sizes.gzip, BUDGET.gzipKib],
] as const) {
  if (value > budget) failures.push(`${name} ${value.toFixed(2)} KiB > ${budget} KiB`)
}
if (typeof core.aggregate !== 'function') failures.push('wasm core has no aggregate export')
if (typeof (instance.exports as Record<string, unknown>).prop_aggregate !== 'function') {
  failures.push('artifact has no prop_aggregate export')
}
const contentHash = createHash('sha256').update(artifact).digest('hex').slice(0, 16)
if (contentHash !== wasmArtifactVersion) {
  failures.push(`artifact version ${wasmArtifactVersion} != ${contentHash}`)
}

const tape = buildTape()
for (let run = 0; run < WARMUP; run += 1) {
  aggregateCandles(tape, FRAMES[run % FRAMES.length]!)
}

const wasmSamples: number[] = []
const wasmByFrame = new Map<SimTimeframe, number[]>()
const tsSamples: number[] = []
for (let run = 0; run < SAMPLES; run += 1) {
  const timeframe = FRAMES[run % FRAMES.length]!
  const start = performance.now()
  const result = aggregateCandles(tape, timeframe)
  const elapsed = performance.now() - start
  if (result.length === 0) failures.push(`empty result for ${timeframe}`)
  wasmSamples.push(elapsed)
  const frameSamples = wasmByFrame.get(timeframe) ?? []
  frameSamples.push(elapsed)
  wasmByFrame.set(timeframe, frameSamples)

  const tsStart = performance.now()
  const reference = aggregateCandlesTs(tape, timeframe)
  tsSamples.push(performance.now() - tsStart)
  if (JSON.stringify(reference) !== JSON.stringify(result)) failures.push(`TS/WASM mismatch for ${timeframe}`)
}

const wasm = summarize(wasmSamples)
const ts = summarize(tsSamples)
if (wasm.p95 >= THRESHOLD_MS) {
  failures.push(`P95 ${wasm.p95.toFixed(2)} ms >= ${THRESHOLD_MS} ms`)
}

console.log('terminal timeframe benchmark')
console.log(
  `  artifact raw=${sizes.raw.toFixed(2)} KiB brotli=${sizes.brotli.toFixed(2)} KiB gzip=${sizes.gzip.toFixed(2)} KiB`,
)
console.log(`  budgets raw<=${BUDGET.rawKib} brotli<=${BUDGET.brotliKib} gzip<=${BUDGET.gzipKib} KiB`)
console.log(`  artifact version=${wasmArtifactVersion} aggregate=${typeof core.aggregate}`)
console.log(`  tape=${tape.length} bars frames=${FRAMES.join(',')} samples=${SAMPLES}`)
console.log(`  wasm ${format(wasm)}`)
console.log(`  ts   ${format(ts)}`)
for (const [frame, samples] of wasmByFrame) {
  console.log(`  ${frame.padEnd(4)} ${format(summarize(samples))}`)
}

if (failures.length) {
  console.error('FAIL')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log(`PASS: wasm P95 ${wasm.p95.toFixed(2)} ms < ${THRESHOLD_MS} ms`)
}
