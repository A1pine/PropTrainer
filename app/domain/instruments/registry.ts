import { createInstrument, type InstrumentSpec } from './types'

/**
 * Registry factory: the rest of the app resolves instruments from here instead
 * of importing individual contract constants, so adding a symbol is one edit.
 */
export interface InstrumentRegistry {
  get(symbol: string): InstrumentSpec | undefined
  require(symbol: string): InstrumentSpec
  list(): InstrumentSpec[]
  resolve(symbols: readonly string[]): InstrumentSpec[]
  has(symbol: string): boolean
}

export function createInstrumentRegistry(specs: readonly InstrumentSpec[]): InstrumentRegistry {
  const bySymbol = new Map<string, InstrumentSpec>()
  for (const spec of specs) {
    const instrument = createInstrument(spec)
    if (bySymbol.has(instrument.symbol)) {
      throw new Error(`Duplicate instrument symbol: ${instrument.symbol}`)
    }
    bySymbol.set(instrument.symbol, instrument)
  }

  const all = Object.freeze([...bySymbol.values()])

  return {
    get: (symbol) => bySymbol.get(symbol),
    require(symbol) {
      const instrument = bySymbol.get(symbol)
      if (!instrument) throw new Error(`Unknown instrument: ${symbol}`)
      return instrument
    },
    list: () => [...all],
    resolve: (symbols) =>
      symbols.map((symbol) => bySymbol.get(symbol)).filter((item): item is InstrumentSpec => item != null),
    has: (symbol) => bySymbol.has(symbol),
  }
}
