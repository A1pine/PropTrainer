export type InstrumentCategory = 'micro-future' | 'mini-future' | 'commodity-future'

/**
 * Futures contract specification. Sizing is expressed in contracts, so every
 * P&L calculation flows through tickSize / tickValue rather than notional
 * leverage — the way a prop futures account actually works.
 */
export interface InstrumentSpec {
  symbol: string
  name: string
  exchange: string
  category: InstrumentCategory
  /** Minimum price increment. */
  tickSize: number
  /** Dollars per tick per contract. */
  tickValue: number
  /** Dollars per full 1.0 price move per contract. */
  pointValue: number
  pricePrecision: number
  /** Round-turn commission per contract, in USD. */
  feePerContract: number
  /** Approximate intraday margin requirement per contract, in USD. */
  intradayMargin: number
  sessionLabel: string
  /** Typical price level used to anchor generated scenarios; never shown in blind mode. */
  anchorPrice: number
  /** Relative volatility factor (1 = MNQ baseline). */
  volatility: number
  /** Mask shown in blind mode, e.g. "M???". */
  mask: string
}

export function assertValidInstrument(spec: InstrumentSpec): InstrumentSpec {
  if (!/^[A-Z0-9]{2,10}$/.test(spec.symbol)) {
    throw new Error(`Invalid instrument symbol: ${spec.symbol}`)
  }
  if (spec.tickSize <= 0) throw new Error(`${spec.symbol}: tickSize must be positive`)
  if (spec.tickValue <= 0) throw new Error(`${spec.symbol}: tickValue must be positive`)
  const impliedPointValue = spec.tickValue / spec.tickSize
  if (Math.abs(impliedPointValue - spec.pointValue) > 0.01) {
    throw new Error(
      `${spec.symbol}: pointValue ${spec.pointValue} does not match tickValue/tickSize (${impliedPointValue})`,
    )
  }
  if (spec.anchorPrice <= 0) throw new Error(`${spec.symbol}: anchorPrice must be positive`)
  return spec
}

export function createInstrument(spec: InstrumentSpec): InstrumentSpec {
  return Object.freeze(assertValidInstrument({ ...spec }))
}
