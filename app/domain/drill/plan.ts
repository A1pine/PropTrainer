import type { InstrumentSpec } from '~/domain/instruments/types'
import type { Candle, Regime, Scenario, SwingPoint } from '~/domain/market/types'
import { findSwings, nearestSwingDistance } from '~/domain/market/generator'
import { getWasmCore, recordWasmError } from '~/domain/wasm/core'
import { computePositionSize } from '~/domain/trading/sizing'
import type { Side } from '~/domain/trading/types'

export type TradeDirection = Side | 'none'

export interface DrillPlan {
  state: Regime
  direction: TradeDirection
  entry: number | null
  stop: number | null
  target: number | null
  thesis: string
  submittedAtBar: number
  waitedBars: number
}

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface PlanCheck {
  id: string
  status: CheckStatus
  params?: Record<string, string | number>
}

export interface PlanContext {
  instrument: InstrumentSpec
  atr: number
  swings: readonly SwingPoint[]
  endIndex: number
  riskBudget: number
  maxContracts: number
  feePerContract?: number
}

export interface PlanValidation {
  checks: PlanCheck[]
  stopDistanceAtr: number | null
  stopToSwingAtr: number | null
  targetToSwingAtr: number | null
  rr: number | null
  riskAmount: number
  contracts: number
  rewardAmount: number | null
}

/** Structural validation shared by the ticket, the drill wizard and grading. */
export function validatePlan(plan: DrillPlan, context: PlanContext): PlanValidation {
  const checks: PlanCheck[] = []
  const { instrument, atr } = context
  const hasLevels = plan.entry != null && plan.stop != null && plan.target != null
  const direction = plan.direction === 'none' ? null : plan.direction

  if (!direction) {
    checks.push({ id: 'direction.none', status: 'pass' })
    return {
      checks,
      stopDistanceAtr: null,
      stopToSwingAtr: null,
      targetToSwingAtr: null,
      rr: null,
      riskAmount: 0,
      contracts: 0,
      rewardAmount: null,
    }
  }

  if (!hasLevels) {
    checks.push({ id: 'levels.missing', status: 'fail' })
    return {
      checks,
      stopDistanceAtr: null,
      stopToSwingAtr: null,
      targetToSwingAtr: null,
      rr: null,
      riskAmount: 0,
      contracts: 0,
      rewardAmount: null,
    }
  }

  const entry = plan.entry as number
  const stop = plan.stop as number
  const target = plan.target as number
  const isLong = direction === 'long'

  if (isLong ? stop >= entry : stop <= entry) {
    checks.push({ id: 'stop.side', status: 'fail' })
  } else {
    checks.push({ id: 'stop.side', status: 'pass' })
  }
  if (isLong ? target <= entry : target >= entry) {
    checks.push({ id: 'target.side', status: 'fail' })
  } else {
    checks.push({ id: 'target.side', status: 'pass' })
  }

  const riskDistance = Math.abs(entry - stop)
  const rewardDistance = Math.abs(target - entry)
  const rr = riskDistance > 0 ? rewardDistance / riskDistance : null
  const stopDistanceAtr = atr > 0 ? riskDistance / atr : null
  const stopToSwingAtr =
    atr > 0 ? scaleDistance(nearestSwingDistance(context.swings, stop, context.endIndex), atr) : null
  const targetToSwingAtr =
    atr > 0 ? scaleDistance(nearestSwingDistance(context.swings, target, context.endIndex), atr) : null

  if (stopDistanceAtr != null && stopDistanceAtr < 0.25) {
    checks.push({ id: 'stop.tooTight', status: 'warn', params: { atr: round(stopDistanceAtr) } })
  } else {
    checks.push({ id: 'stop.tightness', status: 'pass' })
  }

  if (stopDistanceAtr != null && stopDistanceAtr > 3) {
    checks.push({ id: 'stop.tooWide', status: 'warn', params: { atr: round(stopDistanceAtr) } })
  }

  if (stopToSwingAtr != null && stopToSwingAtr > 0.8) {
    checks.push({ id: 'stop.structure', status: 'warn', params: { atr: round(stopToSwingAtr) } })
  } else {
    checks.push({ id: 'stop.structure', status: 'pass' })
  }

  if (targetToSwingAtr != null && targetToSwingAtr > 0.8) {
    checks.push({ id: 'target.structure', status: 'warn', params: { atr: round(targetToSwingAtr) } })
  } else {
    checks.push({ id: 'target.structure', status: 'pass' })
  }

  if (rr == null) {
    checks.push({ id: 'rr.missing', status: 'fail' })
  } else if (rr < 1.5) {
    checks.push({ id: 'rr.low', status: 'warn', params: { rr: round(rr) } })
  } else if (rr > 8) {
    checks.push({ id: 'rr.unrealistic', status: 'warn', params: { rr: round(rr) } })
  } else {
    checks.push({ id: 'rr.ok', status: 'pass', params: { rr: round(rr) } })
  }

  const sizing = computePositionSize({
    instrument,
    entry,
    stop,
    target,
    riskBudget: context.riskBudget,
    maxContracts: context.maxContracts,
    feePerContract: context.feePerContract,
  })

  if (sizing.contracts < 1) {
    checks.push({ id: 'risk.tooSmall', status: 'fail', params: { atr: round(stopDistanceAtr ?? 0) } })
  } else {
    checks.push({ id: 'risk.ok', status: 'pass', params: { contracts: sizing.contracts } })
  }

  return {
    checks,
    stopDistanceAtr: stopDistanceAtr == null ? null : round(stopDistanceAtr),
    stopToSwingAtr: stopToSwingAtr == null ? null : round(stopToSwingAtr),
    targetToSwingAtr: targetToSwingAtr == null ? null : round(targetToSwingAtr),
    rr: rr == null ? null : round(rr),
    riskAmount: sizing.riskAmount,
    contracts: sizing.contracts,
    rewardAmount: sizing.rewardAmount,
  }
}

function scaleDistance(distance: number | null, atr: number): number | null {
  if (distance == null) return null
  return distance / atr
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export interface PlanOutcome {
  filled: boolean
  entryBar: number | null
  entryPrice: number | null
  exitBar: number | null
  exitPrice: number | null
  exitReason: 'stop' | 'target' | 'timeout' | 'no-entry'
  rMultiple: number | null
  maeR: number | null
  mfeR: number | null
  barsToEntry: number
  barsHeld: number
}

/**
 * Resolve a plan bar by bar with conservative assumptions:
 * - a gap through an entry or stop fills at the open,
 * - if a bar touches both stop and target, the stop is assumed first.
 */
export function simulatePlan(
  plan: DrillPlan,
  candles: readonly Candle[],
  instrument: InstrumentSpec,
  horizonBars = 260,
): PlanOutcome {
  if (plan.direction === 'none' || plan.entry == null || plan.stop == null || plan.target == null) {
    return simulatePlanTs(plan, candles, instrument, horizonBars)
  }
  const core = getWasmCore()
  if (core) {
    try {
      return core.simulatePlan(plan, candles, instrument, horizonBars)
    } catch (error) {
      recordWasmError(error)
    }
  }
  return simulatePlanTs(plan, candles, instrument, horizonBars)
}

export function simulatePlanTs(
  plan: DrillPlan,
  candles: readonly Candle[],
  instrument: InstrumentSpec,
  horizonBars = 260,
): PlanOutcome {
  const empty: PlanOutcome = {
    filled: false,
    entryBar: null,
    entryPrice: null,
    exitBar: null,
    exitPrice: null,
    exitReason: 'no-entry',
    rMultiple: null,
    maeR: null,
    mfeR: null,
    barsToEntry: 0,
    barsHeld: 0,
  }
  if (plan.direction === 'none' || plan.entry == null || plan.stop == null || plan.target == null) return empty
  const entryLevel = plan.entry
  const stopLevel = plan.stop
  const targetLevel = plan.target

  const isLong = plan.direction === 'long'
  const start = plan.submittedAtBar + 1
  const end = Math.min(candles.length, start + horizonBars)
  const riskPerContract =
    (Math.abs(entryLevel - stopLevel) / instrument.tickSize) * instrument.tickValue + (instrument.feePerContract ?? 0)

  for (let index = start; index < end; index += 1) {
    const bar = candles[index]
    if (!bar) continue
    const triggered = isLong ? bar.low <= entryLevel : bar.high >= entryLevel
    if (!triggered) continue

    const entryPrice = isLong ? Math.min(entryLevel, bar.open) : Math.max(entryLevel, bar.open)
    let mae = 0
    let mfe = 0

    const inspect = (candle: Candle, from: number) => {
      const adverse = isLong
        ? (entryPrice - candle.low) * instrument.pointValue
        : (candle.high - entryPrice) * instrument.pointValue
      const favorable = isLong
        ? (candle.high - entryPrice) * instrument.pointValue
        : (entryPrice - candle.low) * instrument.pointValue
      mae = Math.max(mae, adverse)
      mfe = Math.max(mfe, favorable)

      if (isLong) {
        if (candle.open <= stopLevel) return { price: candle.open, reason: 'stop' as const, at: from }
        if (candle.open >= targetLevel) return { price: candle.open, reason: 'target' as const, at: from }
        if (candle.low <= stopLevel) return { price: stopLevel, reason: 'stop' as const, at: from }
        if (candle.high >= targetLevel) return { price: targetLevel, reason: 'target' as const, at: from }
      } else {
        if (candle.open >= stopLevel) return { price: candle.open, reason: 'stop' as const, at: from }
        if (candle.open <= targetLevel) return { price: candle.open, reason: 'target' as const, at: from }
        if (candle.high >= stopLevel) return { price: stopLevel, reason: 'stop' as const, at: from }
        if (candle.low <= targetLevel) return { price: targetLevel, reason: 'target' as const, at: from }
      }
      return null
    }

    const sameBarExit = inspect(bar, index)
    if (sameBarExit) {
      return finish(sameBarExit.price, sameBarExit.reason, index, index)
    }

    for (let cursor = index + 1; cursor < end; cursor += 1) {
      const candle = candles[cursor]
      if (!candle) continue
      const exit = inspect(candle, cursor)
      if (exit) return finish(exit.price, exit.reason, index, cursor)
    }

    const lastIndex = end - 1
    const last = candles[lastIndex]
    return finish(last?.close ?? entryLevel, 'timeout', index, lastIndex)

    function finish(
      exitPrice: number,
      reason: PlanOutcome['exitReason'],
      entryBar: number,
      exitBar: number,
    ): PlanOutcome {
      const gross = (exitPrice - entryPrice) * (isLong ? 1 : -1) * instrument.pointValue
      const rMultiple = riskPerContract > 0 ? (gross - instrument.feePerContract) / riskPerContract : null
      return {
        filled: true,
        entryBar,
        entryPrice,
        exitBar,
        exitPrice,
        exitReason: reason,
        rMultiple: rMultiple == null ? null : round(rMultiple),
        maeR: riskPerContract > 0 ? round(-mae / riskPerContract) : null,
        mfeR: riskPerContract > 0 ? round(mfe / riskPerContract) : null,
        barsToEntry: entryBar - plan.submittedAtBar,
        barsHeld: exitBar - entryBar + 1,
      }
    }
  }

  return empty
}

/** Visible swings at the decision point; never uses hidden bars. */
export function scenarioSwings(scenario: Scenario, strength = 3): SwingPoint[] {
  return findSwings(scenario.candles.slice(0, scenario.replayStart), strength)
}
