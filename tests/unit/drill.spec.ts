import { describe, expect, it } from 'vitest'
import { createScenarioFactory } from '@/domain/market/scenario'
import { findSwings } from '@/domain/market/generator'
import { simulatePlan, validatePlan, type DrillPlan } from '@/domain/drill/plan'
import { gradeDrill } from '@/domain/drill/grade'

const factory = createScenarioFactory({ now: new Date('2026-03-10T12:00:00Z') })
const scenario = factory.createFromSeed('drill-grade', 'MNQ', 'uptrend')
const swings = findSwings(scenario.candles.slice(0, scenario.replayStart), 3)
const lastVisible = scenario.replayStart - 1
const lastPrice = scenario.candles[lastVisible]!.close

function plan(overrides: Partial<DrillPlan> = {}): DrillPlan {
  return {
    state: 'uptrend',
    direction: 'long',
    entry: lastPrice,
    stop: lastPrice - 40,
    target: lastPrice + 120,
    thesis: 'Higher lows held above the opening range; I want a retest of the breakout level with the trend.',
    submittedAtBar: lastVisible,
    waitedBars: 4,
    ...overrides,
  }
}

describe('plan validation', () => {
  const context = {
    instrument: scenario.instrument,
    atr: scenario.metrics.atr,
    swings,
    endIndex: lastVisible,
    riskBudget: 500,
    maxContracts: 5,
  }

  it('accepts a symmetric structural plan', () => {
    const validation = validatePlan(plan(), context)
    expect(validation.checks.find((check) => check.id === 'stop.side')?.status).toBe('pass')
    expect(validation.checks.find((check) => check.id === 'rr.ok')).toBeDefined()
    expect(validation.rr).toBeCloseTo(3, 0)
    expect(validation.contracts).toBeGreaterThan(0)
  })

  it('rejects inverted brackets', () => {
    const validation = validatePlan(plan({ stop: lastPrice + 10 }), context)
    expect(validation.checks.find((check) => check.id === 'stop.side')?.status).toBe('fail')
  })

  it('warns when the stop sits inside noise', () => {
    const validation = validatePlan(plan({ stop: lastPrice - scenario.metrics.atr * 0.1 }), context)
    expect(validation.checks.find((check) => check.id === 'stop.tooTight')?.status).toBe('warn')
  })

  it('warns on low reward-to-risk', () => {
    const validation = validatePlan(plan({ target: lastPrice + 30 }), context)
    expect(validation.checks.find((check) => check.id === 'rr.low')?.status).toBe('warn')
  })

  it('allows a no-trade plan without levels', () => {
    const validation = validatePlan(
      plan({ direction: 'none', entry: null, stop: null, target: null, state: 'range' }),
      context,
    )
    expect(validation.checks[0]?.id).toBe('direction.none')
    expect(validation.contracts).toBe(0)
  })
})

describe('plan simulation', () => {
  it('is deterministic and conservative', () => {
    const outcome = simulatePlan(plan(), scenario.candles, scenario.instrument, 260)
    if (outcome.filled) {
      expect(outcome.exitReason === 'stop' || outcome.exitReason === 'target' || outcome.exitReason === 'timeout').toBe(true)
      expect(outcome.entryPrice).not.toBeNull()
    }
    expect(outcome.barsToEntry).toBeGreaterThanOrEqual(0)
  })

  it('reports no fill when the entry is far away', () => {
    const outcome = simulatePlan(plan({ entry: lastPrice * 0.9, stop: lastPrice * 0.85, target: lastPrice * 1.1 }), scenario.candles, scenario.instrument, 60)
    expect(outcome.filled).toBe(false)
    expect(outcome.exitReason).toBe('no-entry')
  })

  it('returns no outcome for a no-trade decision', () => {
    const outcome = simulatePlan(plan({ direction: 'none' }), scenario.candles, scenario.instrument, 100)
    expect(outcome.filled).toBe(false)
    expect(outcome.rMultiple).toBeNull()
  })
})

describe('drill grade', () => {
  const validation = validatePlan(plan(), {
    instrument: scenario.instrument,
    atr: scenario.metrics.atr,
    swings,
    endIndex: lastVisible,
    riskBudget: 500,
    maxContracts: 5,
  })
  const outcome = simulatePlan(plan(), scenario.candles, scenario.instrument, 260)

  it('grades process above outcome', () => {
    const grade = gradeDrill({ plan: plan(), scenario, validation, outcome })
    expect(grade.parts.find((part) => part.id === 'state')?.points).toBe(40)
    expect(grade.parts.find((part) => part.id === 'direction')?.points).toBe(20)
    expect(grade.total).toBeGreaterThanOrEqual(70)
    expect(['A', 'B']).toContain(grade.letter)
  })

  it('penalises a counter-trend read', () => {
    const wrong = plan({ state: 'downtrend', direction: 'short', entry: lastPrice, stop: lastPrice + 40, target: lastPrice - 120 })
    const wrongValidation = validatePlan(wrong, {
      instrument: scenario.instrument,
      atr: scenario.metrics.atr,
      swings,
      endIndex: lastVisible,
      riskBudget: 500,
      maxContracts: 5,
    })
    const grade = gradeDrill({
      plan: wrong,
      scenario,
      validation: wrongValidation,
      outcome: simulatePlan(wrong, scenario.candles, scenario.instrument, 260),
    })
    expect(grade.parts.find((part) => part.id === 'state')?.points).toBe(10)
    expect(grade.parts.find((part) => part.id === 'direction')?.points).toBe(0)
    expect(grade.total).toBeLessThan(55)
    expect(grade.letter).toBe('D')
  })

  it('rewards standing aside in disorder', () => {
    const disordered = factory.createFromSeed('drill-disorder', 'MNQ', 'expansion')
    const nonePlan = plan({ state: 'expansion', direction: 'none', entry: null, stop: null, target: null })
    const noneValidation = validatePlan(nonePlan, {
      instrument: disordered.instrument,
      atr: disordered.metrics.atr,
      swings,
      endIndex: lastVisible,
      riskBudget: 500,
      maxContracts: 5,
    })
    const grade = gradeDrill({
      plan: nonePlan,
      scenario: disordered,
      validation: noneValidation,
      outcome: simulatePlan(nonePlan, disordered.candles, disordered.instrument, 260),
    })
    expect(grade.parts.find((part) => part.id === 'state')?.points).toBe(40)
    expect(grade.parts.find((part) => part.id === 'direction')?.points).toBe(18)
    expect(grade.verdict).toBe('pass')
  })
})
