import type { Scenario } from '~/domain/market/types'
import { findSwings } from '~/domain/market/generator'
import { simulatePlan, validatePlan, type DrillPlan, type PlanOutcome, type PlanValidation } from './plan'
import { gradeDrill, type DrillGrade } from './grade'

export type ReferenceId = 'trend' | 'fade' | 'standAside'

export interface ReferenceResult {
  id: ReferenceId
  labelKey: string
  plan: DrillPlan
  validation: PlanValidation
  outcome: PlanOutcome
  grade: DrillGrade
}

interface ReferenceOptions {
  riskBudget: number
  maxContracts: number
  feePerContract?: number
}

/**
 * Deterministic reference plans evaluated on the same hidden sample.
 * These are labelled as strategy baselines, not human competitors.
 */
export function buildReferenceResults(scenario: Scenario, options: ReferenceOptions): ReferenceResult[] {
  const decisionIndex = scenario.replayStart - 1
  const price = scenario.candles[decisionIndex]?.close ?? scenario.instrument.anchorPrice
  const atr = scenario.metrics.atr || price * 0.001
  const swings = findSwings(scenario.candles.slice(0, scenario.replayStart), 3)
  const window = scenario.candles.slice(Math.max(0, decisionIndex - 30), decisionIndex + 1)
  const midpoint = window.length
    ? (Math.max(...window.map((c) => c.high)) + Math.min(...window.map((c) => c.low))) / 2
    : price

  const trendDirection: DrillPlan['direction'] =
    scenario.regime === 'uptrend' ? 'long' : scenario.regime === 'downtrend' ? 'short' : 'none'
  const fadeDirection: DrillPlan['direction'] =
    scenario.regime === 'range' ? (price >= midpoint ? 'short' : 'long') : 'none'

  const drafts: { id: ReferenceId; plan: DrillPlan }[] = [
    {
      id: 'trend',
      plan: makePlan(scenario.regime, trendDirection, price, atr, 1.2, 2.4, decisionIndex, 'trend'),
    },
    { id: 'fade', plan: makePlan('range', fadeDirection, price, atr, 1, 1.5, decisionIndex, 'fade') },
    { id: 'standAside', plan: makePlan(scenario.regime, 'none', price, atr, 0, 0, decisionIndex, 'standAside') },
  ]

  return drafts.map(({ id, plan }) => {
    const validation = validatePlan(plan, {
      instrument: scenario.instrument,
      atr,
      swings,
      endIndex: decisionIndex,
      riskBudget: options.riskBudget,
      maxContracts: options.maxContracts,
      feePerContract: options.feePerContract,
    })
    const outcome = simulatePlan(plan, scenario.candles, scenario.instrument, 300)
    return {
      id,
      labelKey: `daily.benchmarks.${id}`,
      plan,
      validation,
      outcome,
      grade: gradeDrill({ plan, scenario, validation, outcome }),
    }
  })
}

function makePlan(
  state: DrillPlan['state'],
  direction: DrillPlan['direction'],
  price: number,
  atr: number,
  stopAtr: number,
  targetAtr: number,
  submittedAtBar: number,
  style: 'trend' | 'fade' | 'standAside',
): DrillPlan {
  const sign = direction === 'long' ? 1 : direction === 'short' ? -1 : 0
  return {
    state,
    direction,
    entry: direction === 'none' ? null : price,
    stop: direction === 'none' ? null : price - sign * atr * stopAtr,
    target: direction === 'none' ? null : price + sign * atr * targetAtr,
    thesis:
      style === 'standAside'
        ? 'No directional edge in this tape. Standing aside is the reference decision.'
        : `Reference ${style} plan: entry at the last close, invalidation ${stopAtr.toFixed(1)} ATR away, target ${targetAtr.toFixed(1)} ATR.`,
    submittedAtBar,
    waitedBars: 3,
  }
}
