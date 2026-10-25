import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, platform, arch } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { instruments } from '../app/domain/instruments/catalog'
import { PROP_TEMPLATES } from '../app/domain/sim/presets'
import type { SimTimeframe } from '../app/domain/sim/types'
import { aggregateCandles } from '../app/domain/sim/timeframe'
import { buildReplayMarket, syntheticReplayTape, type ReplayTape } from '../app/lib/sim/tape'
import { ReplaySession } from '../app/lib/sim/replay'
import { createWasmCoreFromInstance, setWasmCore } from '../app/domain/wasm/core'
import { captureEvidence, verifyEvidence } from './perf-evidence.mjs'

const wasmBytes = readFileSync('public/wasm/prop_core.wasm')
const { instance } = await WebAssembly.instantiate(wasmBytes, {})
setWasmCore(createWasmCoreFromInstance(instance))

/**
 * Offline cost probe for the terminal replay hot path.
 *
 * It deliberately uses the real replay/session/engine code and a practice
 * template so history can grow without tripping a funded-account rule. Each
 * round trip is a real market entry followed by a flatten; no snapshots are
 * fabricated. Setup time is reported separately and is not part of any budget.
 */

const SYMBOLS = instruments.list().map((item) => item.symbol)
const BARS = Number(process.env.PERF_BARS ?? 1800)
const STEPS = Number(process.env.PERF_STEPS ?? 1200)
const TRADES_EVERY = Number(process.env.PERF_TRADES_EVERY ?? 2)
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 50)
const OUTPUT = resolve(process.env.PERF_OUTPUT ?? 'profile_output/terminal-compute.json')
const practice = PROP_TEMPLATES.find((item) => item.id === 'practice')!
for (const [name, value] of Object.entries({ BARS, STEPS, TRADES_EVERY, SAMPLES })) {
  assert(Number.isInteger(value) && value > 0, `${name} must be a positive integer`)
}
assert(TRADES_EVERY >= 2, 'PERF_TRADES_EVERY must leave a step for the exit')

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!
  return { n: values.length, p50: quantile(0.5), p95: quantile(0.95), max: sorted.at(-1)!, samples: values }
}

function time(run: () => unknown, samples = SAMPLES) {
  for (let index = 0; index < Math.min(10, samples); index += 1) run()
  const values: number[] = []
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now()
    run()
    values.push(performance.now() - start)
  }
  return stats(values)
}

function build(): { session: ReplaySession; tapes: ReplayTape[]; setupMs: number; marketMs: number } {
  const setupStart = performance.now()
  const tapes = instruments.list().map((spec) => syntheticReplayTape(spec, 'perf-terminal', BARS))
  const setupMs = performance.now() - setupStart
  const marketStart = performance.now()
  const market = buildReplayMarket(tapes)
  const marketMs = performance.now() - marketStart
  const run = {
    schemaVersion: 1 as const,
    id: 'perf-terminal-run',
    seed: 'perf-terminal',
    createdAt: new Date().toISOString(),
    instruments: instruments.list(),
    tapes,
    startIndex: market.startIndex,
  }
  const session = new ReplaySession(run, practice)
  return { session, tapes, setupMs, marketMs }
}

const evidenceBefore = captureEvidence(process.cwd(), 'scripts/bench-terminal-compute.ts', false)
const coldStart = performance.now()
const { session, tapes, setupMs, marketMs } = build()
const coldSetupMs = performance.now() - coldStart
const sessionConstructMs = coldSetupMs - setupMs - marketMs
assert(STEPS <= session.market.timeline.length - session.cursor, 'PERF_STEPS exceeds the replay tape')

const stepTimes: number[] = []
const snapshotTimes: number[] = []
const checkpointTimes: number[] = []
const accountTimes: number[] = []
const aggregateTimes: Record<SimTimeframe, number[]> = {
  '5m': [],
  '15m': [],
  '30m': [],
  '1h': [],
  '4h': [],
  '1D': [],
}
const samples: { step: number; trades: number; fills: number; stepMs: number; snapshotMs: number }[] = []
let trades = 0
let pendingEntry = false

const wallStart = performance.now()
for (let step = 0; step < STEPS; step += 1) {
  const start = performance.now()
  // Trade every N steps; entry and exit are one step apart, like a scalper.
  if (step % TRADES_EVERY === 0) {
    const result = session.engine.submit({ side: 'long', qty: 1, type: 'market' }, 'MNQ')
    if (result.ok) pendingEntry = true
  } else if (pendingEntry) {
    session.engine.flatten('MNQ', 'manual')
    pendingEntry = false
    trades += 1
  }
  session.step(1)
  stepTimes.push(performance.now() - start)

  if (step % 50 === 0 || step === STEPS - 1) {
    const snapshotStart = performance.now()
    session.engine.snapshot()
    snapshotTimes.push(performance.now() - snapshotStart)
    const checkpointStart = performance.now()
    session.checkpoint()
    checkpointTimes.push(performance.now() - checkpointStart)
    const accountStart = performance.now()
    session.engine.account()
    accountTimes.push(performance.now() - accountStart)
    const state = session.engine.exportState()
    samples.push({
      step,
      trades,
      fills: state.fills.length,
      stepMs: stepTimes.at(-1)!,
      snapshotMs: snapshotTimes.at(-1)!,
    })
  }
}

const stepLoopMs = performance.now() - wallStart
// Measure the final history separately from the growth samples above.
const finalState = session.engine.exportState()
const stateHash = createHash('sha256').update(JSON.stringify(finalState)).digest('hex')
const finalSnapshot = time(() => session.engine.snapshot())
const finalCheckpoint = time(() => session.checkpoint())
const finalAccount = time(() => session.engine.account())

// Aggregation cost over the revealed prefix, which is what each pane asks for.
const revealed = session.cursor
const visible = tapes[0]!.candles.slice(0, revealed)
const saved = { run: session.run, checkpoint: session.checkpoint() }
const restore = time(() => ReplaySession.restore(saved), 30)
for (const frame of Object.keys(aggregateTimes) as SimTimeframe[]) {
  aggregateTimes[frame] = time(() => aggregateCandles(visible, frame), 30).samples
}

try {
  ;(globalThis as { Bun?: { gc?: (force: boolean) => void } }).Bun?.gc?.(true)
} catch {
  // Heap figures are still useful without a forced collection; label them.
}

const evidenceAfter = captureEvidence(process.cwd(), 'scripts/bench-terminal-compute.ts', false)
verifyEvidence(evidenceBefore, evidenceAfter)
const report = {
  kind: 'terminal-compute-benchmark',
  evidence: { before: evidenceBefore, after: evidenceAfter, verified: true },
  generatedAt: new Date().toISOString(),
  environment: {
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? null,
    runtime: process.versions,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    wasmSha256: createHash('sha256').update(wasmBytes).digest('hex'),
    symbols: SYMBOLS,
    bars: BARS,
    steps: STEPS,
    tradesEvery: TRADES_EVERY,
    samples: SAMPLES,
  },
  setup: {
    generateTapesMs: setupMs,
    buildMarketMs: marketMs,
    replaySessionConstructMs: sessionConstructMs,
    coldSetupMs,
    stepLoopMs,
    finalStateSha256: stateHash,
    finalStateBytes: Buffer.byteLength(JSON.stringify(finalState)),
    runBytes: Buffer.byteLength(JSON.stringify(session.run)),
    runBars: session.market.timeline.length,
    startIndex: session.run.startIndex,
    finalCursor: session.cursor,
    finalTrades: finalState.trades.length,
    finalFills: finalState.fills.length,
    finalOrders: finalState.orders.length,
    finalEvents: finalState.events.length,
    finalDays: finalState.risk.days.length,
    heapUsedBytes: process.memoryUsage().heapUsed,
    heapLabel: 'post-run heapUsed; GC may not have run',
  },
  perStep: stats(stepTimes),
  snapshotsDuringRun: stats(snapshotTimes),
  checkpointsDuringRun: stats(checkpointTimes),
  accountDuringRun: stats(accountTimes),
  finalSnapshot,
  finalCheckpoint,
  finalAccount,
  restore,
  samples,
  aggregate: Object.fromEntries(
    Object.entries(aggregateTimes).map(([frame, values]) => [frame, stats(values)]),
  ) as Record<SimTimeframe, ReturnType<typeof stats>>,
  method: {
    setup:
      'synthetic tapes, buildReplayMarket and ReplaySession construction are timed separately and excluded from per-step figures',
    step: 'one session.step(1) including all symbols (onBar in baseline, advance in optimized), scheduled entry/flatten, and engine matching',
    snapshot:
      'engine.snapshot() alone, including clone of fills/trades/orders/events/risk; excludes Vue rendering and IndexedDB',
    checkpoint:
      'session.checkpoint() alone (engine.exportState deep clone); excludes the IndexedDB put and structured clone inside it',
    account: 'engine.account() alone, including reservations and risk-state access',
    restore:
      'ReplaySession.restore(saved) on an existing in-memory pinned run and checkpoint; excludes IndexedDB read and checkpoint creation',
    aggregate:
      'aggregateCandles over the full revealed prefix per frame, 30 samples after warm-up; includes validation, session filtering and WASM/TS dispatch where applicable',
  },
}

mkdirSync(resolve(OUTPUT, '..'), { recursive: true })
writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`)
console.log(
  `Setup ${coldSetupMs.toFixed(2)} ms · ${finalState.trades.length} trades / ${finalState.orders.length} orders`,
)
for (const [name, measurement] of Object.entries({
  step: report.perStep,
  snapshot: finalSnapshot,
  checkpoint: finalCheckpoint,
  account: finalAccount,
  restore,
  ...report.aggregate,
})) {
  console.log(`${name.padEnd(12)} P50 ${measurement.p50.toFixed(3)} ms · P95 ${measurement.p95.toFixed(3)} ms`)
}
console.log(`State SHA-256 ${stateHash}\nSaved ${OUTPUT}`)
