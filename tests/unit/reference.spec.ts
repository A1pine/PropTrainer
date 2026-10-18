import { describe, expect, it } from 'vitest'
import { createScenarioFactory, createSeed } from '@/domain/market/scenario'
import { dailyScenarioNow, dailySeed } from '@/domain/market/daily'
import { buildReferenceResults } from '@/domain/drill/reference'
import { simulatePlan } from '@/domain/drill/plan'
import { findSwings } from '@/domain/market/generator'

const factory = createScenarioFactory({ now: new Date('2026-03-10T12:00:00Z') })

describe('daily seeds', () => {
  it('derives a UTC key and a stable calendar anchor', () => {
    const date = new Date('2026-10-19T23:30:00Z')
    expect(dailySeed(date)).toBe('daily-2026-10-19')
    const anchor = dailyScenarioNow('daily-2026-10-19')
    expect(anchor.toISOString()).toBe('2026-10-19T12:00:00.000Z')
    expect(dailyScenarioNow('not-a-daily').getTime()).toBeGreaterThan(0)
  })

  it('produces the same scenario for the same daily key', () => {
    const seed = dailySeed(new Date('2026-10-19T00:00:00Z'))
    const a = createScenarioFactory({ now: dailyScenarioNow(seed) }).createFromSeed(seed)
    const b = createScenarioFactory({ now: dailyScenarioNow(seed) }).createFromSeed(seed)
    expect(a.candles).toEqual(b.candles)
    expect(a.sessionDate).toBe(b.sessionDate)
  })
})

describe('reference plans', () => {
  const scenario = factory.createFromSeed('reference-check', 'MNQ', 'uptrend')
  const results = buildReferenceResults(scenario, { riskBudget: 500, maxContracts: 5 })

  it('builds three labelled baselines', () => {
    expect(results.map((result) => result.id)).toEqual(['trend', 'fade', 'standAside'])
    expect(results.every((result) => result.grade.total >= 0 && result.grade.total <= 100)).toBe(true)
    expect(results.find((result) => result.id === 'standAside')?.plan.direction).toBe('none')
  })

  it('anchors every plan to the decision bar', () => {
    for (const result of results) {
      expect(result.plan.submittedAtBar).toBe(scenario.replayStart - 1)
    }
    const trend = results.find((result) => result.id === 'trend')!
    const direct = simulatePlan(trend.plan, scenario.candles, scenario.instrument, 300)
    expect(direct).toEqual(trend.outcome)
  })

  it('fades a range tape and stands aside in disorder', () => {
    const range = factory.createFromSeed('reference-range', 'MES', 'range')
    const fade = buildReferenceResults(range, { riskBudget: 500, maxContracts: 5 }).find((r) => r.id === 'fade')!
    expect(['long', 'short']).toContain(fade.plan.direction)

    const disorder = factory.createFromSeed('reference-disorder', 'MES', 'expansion')
    const standAside = buildReferenceResults(disorder, { riskBudget: 500, maxContracts: 5 }).find(
      (r) => r.id === 'standAside',
    )!
    expect(standAside.plan.direction).toBe('none')
    expect(standAside.grade.parts.find((part) => part.id === 'state')?.points).toBe(40)
  })

  it('keeps stops beyond structure for the trend plan', () => {
    const trend = results.find((result) => result.id === 'trend')!
    const swings = findSwings(scenario.candles.slice(0, scenario.replayStart), 3)
    expect(trend.validation.stopDistanceAtr).toBeGreaterThan(0)
    expect(trend.validation.checks.find((check) => check.id === 'stop.side')?.status).toBe('pass')
    expect(swings.length).toBeGreaterThan(0)
  })
})

describe('scenario seeds', () => {
  it('creates unique seeds', () => {
    const a = createSeed()
    const b = createSeed()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(6)
  })
})
