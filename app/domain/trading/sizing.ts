import { roundTo } from '~/domain/shared/math'
import type { InstrumentSpec } from '~/domain/instruments/types'

export interface RiskSizingInput {
  instrument: InstrumentSpec
  entry: number
  stop: number | null
  riskBudget: number
  maxContracts: number
  feePerContract?: number
  target?: number | null
}

export interface RiskSizingResult {
  riskPerContract: number
  contracts: number
  cappedByMax: boolean
  riskAmount: number
  rewardAmount: number | null
  rr: number | null
  stopDistance: number
  stopTicks: number
  fees: number
  notional: number
  margin: number
}

/**
 * Convert a dollar risk budget into contracts. This is the only place the app
 * turns risk into size, so every surface sizes identically.
 */
export function computePositionSize(input: RiskSizingInput): RiskSizingResult {
  const { instrument } = input
  const fee = input.feePerContract ?? instrument.feePerContract
  if (input.stop == null) {
    return {
      riskPerContract: fee,
      contracts: 0,
      cappedByMax: false,
      riskAmount: 0,
      rewardAmount: null,
      rr: null,
      stopDistance: 0,
      stopTicks: 0,
      fees: 0,
      notional: 0,
      margin: 0,
    }
  }

  const stopDistance = Math.abs(input.entry - input.stop)
  const stopTicks = stopDistance / instrument.tickSize
  const riskPerContract = stopTicks * instrument.tickValue + fee
  const rawContracts = riskPerContract > 0 ? Math.floor(input.riskBudget / riskPerContract) : 0
  const contracts = Math.max(0, Math.min(input.maxContracts, rawContracts))
  const cappedByMax = rawContracts > input.maxContracts && input.maxContracts > 0
  const riskAmount = contracts * riskPerContract
  const direction = input.stop < input.entry ? 1 : -1
  const rewardDistance = input.target == null ? null : (input.target - input.entry) * direction
  const rewardAmount =
    rewardDistance == null || rewardDistance <= 0
      ? null
      : (rewardDistance / instrument.tickSize) * instrument.tickValue * contracts
  const rr = rewardAmount == null || riskAmount <= 0 ? null : roundTo(rewardAmount / (riskPerContract * contracts), 2)

  return {
    riskPerContract: roundTo(riskPerContract, 2),
    contracts,
    cappedByMax,
    riskAmount: roundTo(riskAmount, 2),
    rewardAmount: rewardAmount == null ? null : roundTo(rewardAmount, 2),
    rr,
    stopDistance: roundTo(stopDistance, instrument.pricePrecision),
    stopTicks: Math.round(stopTicks),
    fees: roundTo(contracts * fee, 2),
    notional: roundTo(input.entry * instrument.pointValue * contracts, 2),
    margin: roundTo(instrument.intradayMargin * contracts, 2),
  }
}

export function riskPerContract(input: {
  instrument: InstrumentSpec
  entry: number
  stop: number
  feePerContract?: number
}): number {
  const fee = input.feePerContract ?? input.instrument.feePerContract
  return (Math.abs(input.entry - input.stop) / input.instrument.tickSize) * input.instrument.tickValue + fee
}
