import type { Regime, Scenario } from '~/domain/market/types'
import type { DrillPlan, PlanOutcome, PlanValidation } from './plan'

export type GradeLetter = 'A' | 'B' | 'C' | 'D' | 'F'

export interface GradeNote {
  code: string
  tone: 'positive' | 'warning' | 'critical' | 'neutral'
  params?: Record<string, string | number>
}

export interface GradePart {
  id: 'state' | 'direction' | 'plan' | 'process'
  points: number
  max: number
}

export interface DrillGrade {
  total: number
  letter: GradeLetter
  parts: GradePart[]
  notes: GradeNote[]
  outcome: PlanOutcome
  verdict: 'pass' | 'partial' | 'fail'
}

export interface GradeInput {
  plan: DrillPlan
  scenario: Scenario
  validation: PlanValidation
  outcome: PlanOutcome
}

const opposite: Record<Regime, Regime> = {
  uptrend: 'downtrend',
  downtrend: 'uptrend',
  range: 'expansion',
  expansion: 'range',
}

/**
 * Process grade, deliberately separated from the outcome.
 * A losing trade with a valid read and a structural stop can still grade well;
 * a lucky win with a counter-trend thesis and a stop inside noise cannot.
 */
export function gradeDrill(input: GradeInput): DrillGrade {
  const { plan, scenario, validation, outcome } = input
  const actual = scenario.regime
  const notes: GradeNote[] = []

  let statePoints = 0
  if (plan.state === actual) {
    statePoints = 40
    notes.push({ code: 'grade.state.correct', tone: 'positive', params: { state: actual } })
  } else if (opposite[actual] === plan.state) {
    statePoints = 10
    notes.push({ code: 'grade.state.opposite', tone: 'critical', params: { actual } })
  } else {
    statePoints = 18
    notes.push({ code: 'grade.state.partial', tone: 'warning', params: { actual } })
  }

  let directionPoints = 0
  if (plan.direction === 'none') {
    if (actual === 'range' || actual === 'expansion') {
      directionPoints = 18
      notes.push({ code: 'grade.direction.noneValid', tone: 'positive' })
    } else {
      directionPoints = 8
      notes.push({ code: 'grade.direction.noneTrend', tone: 'warning' })
    }
  } else if (
    (actual === 'uptrend' && plan.direction === 'long') ||
    (actual === 'downtrend' && plan.direction === 'short')
  ) {
    directionPoints = 20
    notes.push({ code: 'grade.direction.aligned', tone: 'positive' })
  } else if (actual === 'expansion' || actual === 'range') {
    directionPoints = 10
    notes.push({ code: 'grade.direction.chop', tone: 'warning', params: { actual } })
  } else {
    notes.push({ code: 'grade.direction.counterTrend', tone: 'critical' })
  }

  let planPoints = 0
  if (plan.direction === 'none') {
    planPoints = 20
  } else {
    const rr = validation.rr
    planPoints += rr != null && rr >= 1.5 && rr <= 8 ? 10 : rr != null && rr >= 1 ? 4 : 0
    const stopCheck = findCheck(validation, 'stop.structure')
    planPoints += stopCheck?.status === 'pass' ? 8 : stopCheck?.status === 'warn' ? 3 : 0
    const targetCheck = findCheck(validation, 'target.structure')
    planPoints += targetCheck?.status === 'pass' ? 7 : targetCheck?.status === 'warn' ? 3 : 0
    if (validation.stopDistanceAtr != null && validation.stopDistanceAtr < 0.25) {
      notes.push({ code: 'grade.stop.tooTight', tone: 'warning', params: { atr: validation.stopDistanceAtr } })
    }
    if (validation.stopToSwingAtr != null && validation.stopToSwingAtr > 0.8) {
      notes.push({ code: 'grade.stop.insideNoise', tone: 'warning', params: { atr: validation.stopToSwingAtr } })
    }
    if (rr != null && rr < 1.5) {
      notes.push({ code: 'grade.rr.low', tone: 'warning', params: { rr } })
    }
    if (rr != null && rr > 8) {
      notes.push({ code: 'grade.rr.unrealistic', tone: 'warning', params: { rr } })
    }
  }

  let processPoints = 0
  const thesisLength = plan.thesis.trim().length
  // The thesis is optional. A detailed one earns process points; leaving it
  // blank is not a mistake and must not produce a "too thin" warning. A short
  // attempt still gets the nudge because the field was used.
  if (thesisLength >= 40) processPoints += 5
  else if (thesisLength >= 20) processPoints += 3
  else if (plan.direction === 'none') processPoints += 5
  else if (thesisLength > 0) notes.push({ code: 'grade.thesis.thin', tone: 'warning' })

  if (plan.waitedBars >= 3) processPoints += 5
  else if (plan.waitedBars >= 1) processPoints += 3
  else if (plan.direction !== 'none') {
    notes.push({ code: 'grade.waited.none', tone: 'warning' })
  } else processPoints += 5

  if (plan.direction === 'none') {
    processPoints += 5
  } else if (validation.contracts >= 1) {
    processPoints += 5
  } else {
    notes.push({ code: 'grade.risk.exceeded', tone: 'critical' })
  }

  if (outcome.exitReason === 'no-entry' && plan.direction !== 'none') {
    notes.push({ code: 'grade.outcome.noFill', tone: 'neutral' })
  } else if (outcome.exitReason === 'stop') {
    notes.push({ code: 'grade.outcome.stop', tone: 'neutral', params: { r: outcome.rMultiple ?? 0 } })
  } else if (outcome.exitReason === 'target') {
    notes.push({ code: 'grade.outcome.target', tone: 'positive', params: { r: outcome.rMultiple ?? 0 } })
  } else if (outcome.exitReason === 'timeout') {
    notes.push({ code: 'grade.outcome.timeout', tone: 'neutral', params: { r: outcome.rMultiple ?? 0 } })
  }

  const total = statePoints + directionPoints + planPoints + processPoints
  const letter = letterFor(total)

  return {
    total,
    letter,
    parts: [
      { id: 'state', points: statePoints, max: 40 },
      { id: 'direction', points: directionPoints, max: 20 },
      { id: 'plan', points: planPoints, max: 25 },
      { id: 'process', points: processPoints, max: 15 },
    ],
    notes,
    outcome,
    verdict: total >= 70 ? 'pass' : total >= 45 ? 'partial' : 'fail',
  }
}

function findCheck(validation: PlanValidation, id: string) {
  return validation.checks.find((check) => check.id === id)
}

export function letterFor(total: number): GradeLetter {
  if (total >= 85) return 'A'
  if (total >= 70) return 'B'
  if (total >= 55) return 'C'
  if (total >= 40) return 'D'
  return 'F'
}
