import type { Candle, ScenarioMetrics, SwingPoint } from '~/domain/market/types'
import type { DrillPlan, PlanOutcome } from '~/domain/drill/plan'
import type { InstrumentSpec } from '~/domain/instruments/types'
import type { AnalysisReport } from '~/domain/analysis/types'

export interface GenerateInput {
  seed: string
  anchorPrice: number
  volatility: number
  tickSize: number
  regime: string
  bars: number
  startPrice: number
  startTime: number
  timeframeMinutes: number
  replayStart: number
  baseVolume: number
}

export interface GeneratedMarket {
  candles: Candle[]
  metrics: ScenarioMetrics
}

/**
 * Aggregation request after the TypeScript layer has validated the bars and
 * resolved every bar's session-anchored bucket start. Timezone and calendar work
 * stays in TypeScript; Rust only does the O(n) OHLCV reduce.
 */
export interface AggregateInput {
  bucketStarts: number[]
  open: number[]
  high: number[]
  low: number[]
  close: number[]
  volume: number[]
}

/** Aggregated columns; `time` is the bucket start carried over from the request. */
export interface AggregateColumns {
  time: number[]
  open: number[]
  high: number[]
  low: number[]
  close: number[]
  volume: number[]
}

export interface WasmCore {
  generate(input: GenerateInput): GeneratedMarket
  findSwings(candles: readonly Candle[], strength: number): SwingPoint[]
  simulatePlan(
    plan: DrillPlan,
    candles: readonly Candle[],
    instrument: InstrumentSpec,
    horizonBars: number,
  ): PlanOutcome
  analyze(candles: readonly Candle[], precision?: number): AnalysisReport
  /** Optional so artifacts that predate `prop_aggregate` keep working. */
  aggregate?(input: AggregateInput): AggregateColumns
}

interface WasmExports {
  memory: WebAssembly.Memory
  prop_alloc(size: number): number
  prop_dealloc(pointer: number, size: number): void
  prop_result_ptr(): number
  prop_result_len(): number
  prop_generate(pointer: number, length: number): number
  prop_find_swings(pointer: number, length: number): number
  prop_simulate_plan(pointer: number, length: number): number
  prop_analyze(pointer: number, length: number): number
  prop_aggregate?(pointer: number, length: number): number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_CODES = Uint8Array.from(BASE64_ALPHABET, (character) => character.charCodeAt(0))

/**
 * Encode an f64 column as base64 of little-endian bytes.
 *
 * JSON numbers are not lossless across serde_json's fast float parser, and the
 * exact-roundtrip parser costs more wasm size than the aggregate export itself.
 * Bytes round-trip every f64 bit-for-bit without pulling a float parser into the
 * binary. The terminal ABI is internal, so base64 columns stay a private detail
 * of this wrapper.
 *
 * The output is built as one byte buffer and decoded once; concatenating a JS
 * string per three bytes is several times slower for a 13k-bar tape.
 */
function encodeFloats(values: readonly number[]): string {
  const buffer = new ArrayBuffer(values.length * 8)
  const view = new DataView(buffer)
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat64(index * 8, values[index]!, true)
  }
  const bytes = new Uint8Array(buffer)
  const full = bytes.length - (bytes.length % 3)
  const encoded = new Uint8Array(((bytes.length + 2) / 3) * 4)
  let offset = 0
  for (let index = 0; index < full; index += 3) {
    const word = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!
    encoded[offset] = BASE64_CODES[word >>> 18]!
    encoded[offset + 1] = BASE64_CODES[(word >>> 12) & 63]!
    encoded[offset + 2] = BASE64_CODES[(word >>> 6) & 63]!
    encoded[offset + 3] = BASE64_CODES[word & 63]!
    offset += 4
  }
  if (full < bytes.length) {
    const first = bytes[full]!
    const second = bytes[full + 1] ?? 0
    encoded[offset] = BASE64_CODES[first >>> 2]!
    encoded[offset + 1] = BASE64_CODES[((first & 3) << 4) | (second >>> 4)]!
    encoded[offset + 2] = full + 1 < bytes.length ? BASE64_CODES[(second & 15) << 2]! : 61
    encoded[offset + 3] = 61
    offset += 4
  }
  return decoder.decode(encoded.subarray(0, offset))
}

let core: WasmCore | null = null
let lastError: string | null = null

export function setWasmCore(next: WasmCore | null) {
  core = next
  if (next) lastError = null
}

export function getWasmCore(): WasmCore | null {
  return core
}

export function getWasmError(): string | null {
  return lastError
}

/**
 * Wrap the raw wasm exports in a typed, JSON-in/JSON-out interface.
 * One instance is shared by the whole app; wasm is single-threaded here.
 */
export function createWasmCore(exports: WasmExports): WasmCore {
  function call<T>(fn: (pointer: number, length: number) => number, payload: unknown): T {
    const bytes = encoder.encode(JSON.stringify(payload))
    const pointer = exports.prop_alloc(bytes.length)
    if (!pointer) throw new Error('WASM out of memory while allocating the request')
    try {
      new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes)
      const status = fn(pointer, bytes.length)
      const resultPointer = exports.prop_result_ptr()
      const resultLength = exports.prop_result_len()
      const text = decoder.decode(new Uint8Array(exports.memory.buffer, resultPointer, resultLength))
      const parsed = JSON.parse(text) as T & { error?: string }
      if (!status) throw new Error(parsed.error ?? 'WASM call failed')
      if (parsed.error) throw new Error(parsed.error)
      return parsed
    } finally {
      exports.prop_dealloc(pointer, bytes.length)
    }
  }

  const api: WasmCore = {
    generate(input) {
      return call<GeneratedMarket>(exports.prop_generate, input)
    },
    findSwings(candles, strength) {
      const result = call<{ swings: SwingPoint[] }>(exports.prop_find_swings, { candles, strength })
      return result.swings
    },
    simulatePlan(plan, candles, instrument, horizonBars) {
      return call<PlanOutcome>(exports.prop_simulate_plan, {
        plan,
        candles,
        instrument: {
          tickSize: instrument.tickSize,
          tickValue: instrument.tickValue,
          pointValue: instrument.pointValue,
          feePerContract: instrument.feePerContract,
        },
        horizonBars,
      })
    },
    analyze(candles, precision = 2) {
      // Keep regular timestamps compact, but preserve session/weekend gaps.
      const length = candles.length
      const startTime = candles[0]?.time ?? 0
      const step = length > 1 ? candles[1]!.time - startTime : 300
      let regular = Number.isSafeInteger(startTime) && Number.isSafeInteger(step) && step > 0
      const open = new Array<number>(length)
      const high = new Array<number>(length)
      const low = new Array<number>(length)
      const close = new Array<number>(length)
      const volume = new Array<number>(length)
      for (let index = 0; index < length; index += 1) {
        const candle = candles[index]!
        open[index] = candle.open
        high[index] = candle.high
        low[index] = candle.low
        close[index] = candle.close
        volume[index] = candle.volume
        regular &&= candle.time === startTime + index * step
      }
      return call<AnalysisReport>(exports.prop_analyze, {
        open,
        high,
        low,
        close,
        volume,
        startTime,
        step,
        time: regular ? undefined : candles.map((candle) => candle.time),
        precision,
      })
    },
  }
  if (typeof exports.prop_aggregate === 'function') {
    const aggregate = exports.prop_aggregate
    api.aggregate = (input) =>
      call<AggregateColumns>(aggregate, {
        bucketStarts: input.bucketStarts,
        open: encodeFloats(input.open),
        high: encodeFloats(input.high),
        low: encodeFloats(input.low),
        close: encodeFloats(input.close),
        volume: encodeFloats(input.volume),
      })
  }
  return api
}

export function createWasmCoreFromInstance(instance: WebAssembly.Instance): WasmCore {
  const exports = instance.exports as unknown as Record<string, unknown>
  const required = ['prop_generate', 'prop_find_swings', 'prop_simulate_plan', 'prop_analyze']
  const missing = required.filter((name) => typeof exports[name] !== 'function')
  if (missing.length) {
    throw new Error(`wasm artifact is outdated (missing ${missing.join(', ')}); run bun run wasm:build and reload`)
  }
  return createWasmCore(exports as unknown as WasmExports)
}

export function recordWasmError(error: unknown) {
  lastError = error instanceof Error ? error.message : String(error)
  if (import.meta.dev) console.warn('[prop-core]', lastError)
}
