/**
 * Repeatable performance baseline for the Rust/WASM core.
 *
 * Reports artifact sizes (raw, gzip, brotli), module compile + instantiate
 * time, JSON boundary sizes and core compute timings. Run with:
 *
 *   bun run bench:wasm
 *   bun run bench:wasm --json   # machine-readable output
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const artifactPath = resolve(root, 'public/wasm/prop_core.wasm')
const bytes = readFileSync(artifactPath)
const json = process.argv.includes('--json')

const gzip = gzipSync(bytes, { level: 9 })
const brotli = brotliCompressSync(bytes, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length },
})

const { instance } = await WebAssembly.instantiate(bytes, {})
const api = instance.exports
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function call(name, payload) {
  const request = encoder.encode(JSON.stringify(payload))
  const pointer = api.prop_alloc(request.length)
  new Uint8Array(api.memory.buffer, pointer, request.length).set(request)
  const started = performance.now()
  const status = api[name](pointer, request.length)
  const elapsed = performance.now() - started
  const output = decoder.decode(new Uint8Array(api.memory.buffer, api.prop_result_ptr(), api.prop_result_len()))
  api.prop_dealloc(pointer, request.length)
  if (!status) throw new Error(`${name} failed: ${output}`)
  return { output, elapsed, bytes: output.length }
}

const generateRequest = {
  seed: 'bench:MNQ:uptrend',
  anchorPrice: 19450,
  volatility: 1,
  tickSize: 0.25,
  regime: 'uptrend',
  bars: 710,
  startPrice: 19000,
  startTime: 1_750_000_000,
  timeframeMinutes: 5,
  replayStart: 150,
  baseVolume: 5400,
}

const timings = { compile: [], instantiate: [], generate: [], analyze: [], simulate: [] }

// Compile is measured separately from instantiation; repeat to get a stable median.
for (let index = 0; index < 7; index += 1) {
  const compileStart = performance.now()
  const module = await WebAssembly.compile(bytes)
  const compileEnd = performance.now()
  const instanceStart = performance.now()
  await WebAssembly.instantiate(module, {})
  const instanceEnd = performance.now()
  timings.compile.push(compileEnd - compileStart)
  timings.instantiate.push(instanceEnd - instanceStart)
}

const generated = call('prop_generate', generateRequest)
const candles = JSON.parse(generated.output).candles
for (let index = 0; index < 9; index += 1) {
  timings.generate.push(call('prop_generate', generateRequest).elapsed)
}
const analyzed = call('prop_analyze', { candles })
for (let index = 0; index < 9; index += 1) {
  timings.analyze.push(call('prop_analyze', { candles }).elapsed)
}

const last = candles[candles.length - 1]
const plan = {
  plan: {
    state: 'uptrend',
    direction: 'long',
    entry: last.close,
    stop: last.close - 40,
    target: last.close + 120,
    submittedAtBar: candles.length - 1,
    waitedBars: 0,
  },
  candles,
  instrument: { tickSize: 0.25, tickValue: 0.5, pointValue: 2, feePerContract: 1.24 },
  horizonBars: 300,
}
for (let index = 0; index < 9; index += 1) {
  timings.simulate.push(call('prop_simulate_plan', plan).elapsed)
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const summary = Object.fromEntries(
  Object.entries(timings).map(([key, values]) => [key, Number(median(values).toFixed(3))]),
)

const report = {
  artifact: {
    rawBytes: bytes.length,
    gzipBytes: gzip.length,
    brotliBytes: brotli.length,
    rawKib: Number((bytes.length / 1024).toFixed(1)),
    gzipKib: Number((gzip.length / 1024).toFixed(1)),
    brotliKib: Number((brotli.length / 1024).toFixed(1)),
    compressionRatio: Number((bytes.length / brotli.length).toFixed(2)),
  },
  ms: summary,
  boundary: {
    generateResponseBytes: generated.bytes,
    analyzeResponseBytes: analyzed.bytes,
    analyzeRequestBytes: encoder.encode(JSON.stringify({ candles })).length,
  },
  candleCount: candles.length,
}

if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const { artifact, ms, boundary } = report
  console.log('WASM performance baseline')
  console.log('------------------------')
  console.log(
    `artifact   ${artifact.rawKib} KiB raw · ${artifact.gzipKib} KiB gzip · ${artifact.brotliKib} KiB brotli (${artifact.compressionRatio}× smaller)`,
  )
  console.log(`compile    ${ms.compile.toFixed(2)} ms (median of 7)`)
  console.log(`instantiate ${ms.instantiate.toFixed(2)} ms`)
  console.log(
    `generate   ${ms.generate.toFixed(2)} ms · ${(boundary.generateResponseBytes / 1024).toFixed(1)} KiB JSON`,
  )
  console.log(`analyze    ${ms.analyze.toFixed(2)} ms · ${(boundary.analyzeResponseBytes / 1024).toFixed(1)} KiB JSON`)
  console.log(`simulate   ${ms.simulate.toFixed(2)} ms`)
  console.log(`candles    ${report.candleCount}`)
}
