import type { Candle } from '~/domain/market/types'
import { getWasmCore, recordWasmError } from '~/domain/wasm/core'
import type { AnalysisReport } from './types'

/**
 * The analysis stack lives in the Rust core. There is intentionally no
 * TypeScript duplicate: if wasm is unavailable the lab shows an explicit
 * unavailable state instead of a second, drifting implementation.
 */
export function analyzeMarket(candles: readonly Candle[], precision = 2): AnalysisReport | null {
  const core = getWasmCore()
  if (!core || candles.length < 30) return null
  try {
    return core.analyze(candles, precision)
  } catch (error) {
    recordWasmError(error)
    return null
  }
}
