import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, platform, arch } from 'node:os'
import { dirname, resolve } from 'node:path'
import { instruments } from '../app/domain/instruments/catalog'
import { generateMarketData, generateMarketDataTs } from '../app/domain/market/generator'
import { createDatasetScenario } from '../app/domain/market/dataset'
import { analyzeMarket } from '../app/domain/analysis/analyze'
import { simulatePlan, type DrillPlan } from '../app/domain/drill/plan'
import { createWasmCoreFromInstance, setWasmCore } from '../app/domain/wasm/core'
import { parseDataset, prepareLocalScenarioInput, clearLocalMarketCache } from '../app/lib/market/local-data'

const samples = Number(process.env.PERF_SAMPLES ?? 200)
const output = resolve(process.env.PERF_OUTPUT ?? 'profile_output/compute.json')
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4173/'
const check = process.argv.includes('--check')
const { instance } = await WebAssembly.instantiate(readFileSync('public/wasm/prop_core.wasm'), {})
setWasmCore(createWasmCoreFromInstance(instance))
const instrument = instruments.require('MNQ')
const options = {
  seed: 'perf:MNQ:uptrend',
  instrument,
  regime: 'uptrend' as const,
  bars: 710,
  startPrice: 19450,
  startTime: 1700000000,
  timeframeMinutes: 5,
  replayStart: 150,
}
const generated = generateMarketData(options)
const candles = generated.candles
const decision = 149
const price = candles[decision]!.close
const plan: DrillPlan = {
  state: 'uptrend',
  direction: 'long',
  entry: price,
  stop: price - 40,
  target: price + 80,
  thesis: 'benchmark',
  submittedAtBar: decision,
  waitedBars: 0,
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!
  return { n: values.length, p50: quantile(0.5), p95: quantile(0.95), max: sorted.at(-1)!, samples: values }
}

function measure(run: () => unknown) {
  for (let i = 0; i < 20; i++) run()
  const times: number[] = []
  for (let i = 0; i < samples; i++) {
    const start = performance.now()
    const result = run()
    times.push(performance.now() - start)
    assert(result != null)
  }
  return stats(times)
}

const metrics = {
  'wasm.generate': measure(() => generateMarketData(options)),
  'wasm.analyze': measure(() => analyzeMarket(candles, 2)),
  'wasm.simulate': measure(() => simulatePlan(plan, candles, instrument, 300)),
  'ts.generate': measure(() => generateMarketDataTs(options)),
} as Record<string, ReturnType<typeof stats>>

const pack = JSON.parse(readFileSync('public/data/market/MNQ.json', 'utf8'))
const dataset = parseDataset(pack, 'MNQ')
assert(dataset, 'Fetch the local pack first: bun run data:fetch')
metrics['local.validate'] = measure(() => parseDataset(pack, 'MNQ'))
metrics['local.window'] = measure(() => createDatasetScenario({ seed: 'perf-window', instrument, dataset }))
clearLocalMarketCache()
const coldStart = performance.now()
const prepared = await prepareLocalScenarioInput({ baseURL: base, symbols: ['MNQ'], seed: 'perf-window' })
const coldPrepare = performance.now() - coldStart
assert(prepared, 'Production server must expose the MNQ data pack')
const hotPrepare: number[] = []
for (let i = 0; i < samples; i++) {
  const start = performance.now()
  const result = await prepareLocalScenarioInput({ baseURL: base, symbols: ['MNQ'], seed: `perf-${i}` })
  hotPrepare.push(performance.now() - start)
  assert(result)
}
metrics['local.cachedPrepare'] = stats(hotPrepare)
const report = {
  environment: {
    timestamp: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    runtime: process.versions,
    samples,
    candleCount: candles.length,
    packBars: dataset.bars,
    method:
      '20 warmups, sequential iterations. Entire public wrapper call including column packing, JSON encoding, WASM alloc/copy/compute, decoding/parsing. Validation excludes JSON.parse; local.window includes tick rebasing and metrics. cachedPrepare includes repository + seed selection; first fetch reported separately.',
  },
  coldPrepare,
  metrics,
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
for (const [name, timing] of Object.entries(metrics)) {
  console.log(`${name.padEnd(22)} P50 ${timing.p50.toFixed(3)} ms · P95 ${timing.p95.toFixed(3)} ms`)
  if (check && name !== 'local.validate' && name !== 'ts.generate') assert(timing.p95 <= 10, `${name} P95 > 10ms`)
}
console.log(`Saved ${output}`)
