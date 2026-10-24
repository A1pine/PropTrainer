import type { AnalysisLevelLine, ChartAnalysis } from '~/lib/chart/types'
import type { RiskState } from '~/domain/sim/types'

export interface RiskLineInput {
  risk: RiskState | null
  breachPrice: number | null
  dailyPrice: number | null
  labels: { floor: string; breach: string; daily: string }
}

/**
 * Chart lines for the prop rules.
 *
 * The floor is always meaningful, the breach price only exists while a position
 * is open, and the daily-loss line only when the template has a daily limit.
 * Lines are chart overlays, not trading levels: they never gate an order.
 */
export function riskLines({ risk, breachPrice, dailyPrice, labels }: RiskLineInput): ChartAnalysis {
  const levels: AnalysisLevelLine[] = []
  if (risk) levels.push({ id: 'floor', price: risk.floor, tone: 'warn', label: labels.floor })
  if (breachPrice != null) levels.push({ id: 'breach', price: breachPrice, tone: 'bear', label: labels.breach })
  if (dailyPrice != null) levels.push({ id: 'daily', price: dailyPrice, tone: 'clay', label: labels.daily })
  return { series: [], zones: [], levels, markers: [], profile: [] }
}
