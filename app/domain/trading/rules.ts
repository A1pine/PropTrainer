import { clamp, roundTo } from '~/domain/shared/math'
import type { PropRules, RuleStatus } from './types'

export interface RuleInput {
  equity: number
  peakEquity: number
  startBalance: number
  dailyPnl: number
  openContracts: number
  tradeCount?: number
}

/** Evaluate every account guardrail into a UI-friendly status list. */
export function evaluateRules(input: RuleInput, rules: PropRules): RuleStatus[] {
  const statuses: RuleStatus[] = []

  if (rules.profitTarget > 0) {
    const profit = input.equity - input.startBalance
    const percent = clamp((profit / rules.profitTarget) * 100, 0, 100)
    statuses.push({
      id: 'profit',
      value: roundTo(profit, 2),
      limit: rules.profitTarget,
      percent: roundTo(percent, 2),
      remaining: roundTo(Math.max(0, rules.profitTarget - profit), 2),
      state: percent >= 100 ? 'done' : 'ok',
    })
  }

  const drawdownFloor = input.peakEquity - rules.maxDrawdown
  const cushion = input.equity - drawdownFloor
  const drawdownUsed = rules.maxDrawdown - cushion
  statuses.push({
    id: 'drawdown',
    value: roundTo(Math.max(0, drawdownUsed), 2),
    limit: rules.maxDrawdown,
    percent: roundTo(clamp((drawdownUsed / rules.maxDrawdown) * 100, 0, 100), 2),
    remaining: roundTo(Math.max(0, cushion), 2),
    state: cushion <= 0 ? 'breached' : cushion < rules.maxDrawdown * 0.25 ? 'near' : 'ok',
  })

  if (rules.dailyLossLimit > 0) {
    const loss = Math.max(0, -input.dailyPnl)
    statuses.push({
      id: 'daily',
      value: roundTo(loss, 2),
      limit: rules.dailyLossLimit,
      percent: roundTo(clamp((loss / rules.dailyLossLimit) * 100, 0, 100), 2),
      remaining: roundTo(Math.max(0, rules.dailyLossLimit - loss), 2),
      state: loss >= rules.dailyLossLimit ? 'breached' : loss > rules.dailyLossLimit * 0.7 ? 'near' : 'ok',
    })
  }

  const contracts = input.openContracts
  statuses.push({
    id: 'contracts',
    value: contracts,
    limit: rules.maxContracts,
    percent: roundTo(clamp((contracts / rules.maxContracts) * 100, 0, 100), 2),
    remaining: Math.max(0, rules.maxContracts - contracts),
    state: contracts > rules.maxContracts ? 'breached' : contracts === rules.maxContracts ? 'near' : 'ok',
  })

  if (rules.maxTrades > 0) {
    const count = input.tradeCount ?? 0
    statuses.push({
      id: 'trades',
      value: count,
      limit: rules.maxTrades,
      percent: roundTo(clamp((count / rules.maxTrades) * 100, 0, 100), 2),
      remaining: Math.max(0, rules.maxTrades - count),
      state: count >= rules.maxTrades ? 'breached' : count >= rules.maxTrades - 1 ? 'near' : 'ok',
    })
  }

  return statuses
}

export function firstBreach(statuses: readonly RuleStatus[]): RuleStatus | null {
  return statuses.find((status) => status.state === 'breached') ?? null
}

export function targetReached(statuses: readonly RuleStatus[]): boolean {
  return statuses.some((status) => status.id === 'profit' && status.state === 'done')
}
