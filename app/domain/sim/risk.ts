import { parseDayKey, tradingDayKey } from './session'
import { cloneTemplate } from './presets'
import type {
  ConsistencyStatus,
  PropTemplate,
  RiskEvent,
  RiskInput,
  RiskState,
  SimDayLedger,
  SimRuleStatus,
  SimSide,
} from './types'

const EPSILON = 1e-9
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0

export function validateTemplate(template: PropTemplate): void {
  if (
    !template ||
    typeof template.id !== 'string' ||
    typeof template.label !== 'string' ||
    !finite(template.accountSize) ||
    template.accountSize <= 0 ||
    !finite(template.profitTarget) ||
    template.profitTarget < 0 ||
    !count(template.maxContracts) ||
    template.maxContracts === 0 ||
    !count(template.maxTradesPerDay) ||
    !count(template.minTradingDays)
  )
    throw new Error('Invalid account template')
  const rule = template.drawdown
  if (
    !rule ||
    !['static', 'trailing-intraday', 'trailing-eod'].includes(rule.mode) ||
    !['balance', 'equity'].includes(rule.basis) ||
    typeof rule.includeUnrealized !== 'boolean' ||
    !finite(rule.amount) ||
    rule.amount <= 0 ||
    (rule.floorCap !== null && !finite(rule.floorCap))
  )
    throw new Error('Invalid drawdown rule')
  if (
    !template.dailyLoss ||
    !finite(template.dailyLoss.amount) ||
    template.dailyLoss.amount < 0 ||
    !['warn', 'flatten', 'flatten-lock'].includes(template.dailyLoss.action)
  )
    throw new Error('Invalid daily loss rule')
  const consistency = template.consistency
  if (
    consistency !== null &&
    (!consistency ||
      !finite(consistency.maxBestDayRatio) ||
      consistency.maxBestDayRatio <= 0 ||
      consistency.maxBestDayRatio > 1 ||
      !['pass', 'payout'].includes(consistency.gate))
  )
    throw new Error('Invalid consistency rule')
}

function floorFor(state: RiskState): number {
  const rule = state.template.drawdown
  if (rule.mode === 'static') return state.startBalance - rule.amount
  const raw = state.peakEquity - rule.amount
  return rule.floorCap === null ? raw : Math.min(raw, rule.floorCap)
}

/** A replay-clock ledger. Only an explicit session close finalizes a day. */
export class RiskEngine {
  private data: RiskState

  constructor(template: PropTemplate, startBalance = template.accountSize, time = 0) {
    validateTemplate(template)
    if (!finite(startBalance) || startBalance <= 0 || !finite(time)) throw new Error('Invalid initial account values')
    this.data = {
      template: cloneTemplate(template),
      startBalance,
      peakEquity: startBalance,
      floor: startBalance - template.drawdown.amount,
      status: 'active',
      breach: null,
      days: [],
      currentDay: tradingDayKey(time),
      dayStartEquity: startBalance,
      lastEquity: startBalance,
      lastBalance: startBalance,
      lastTime: time,
      dailyTriggered: false,
      dailyWarned: false,
    }
    this.data.floor = floorFor(this.data)
    if (!finite(this.data.floor)) throw new Error('Invalid account floor')
  }

  static fromState(state: RiskState): RiskEngine {
    if (!state || !Array.isArray(state.days)) throw new Error('Invalid risk state')
    const engine = new RiskEngine(state.template, state.startBalance, state.lastTime)
    if (
      ![state.peakEquity, state.floor, state.dayStartEquity, state.lastEquity, state.lastBalance].every(finite) ||
      state.peakEquity < state.startBalance ||
      !['active', 'daily-lock', 'breached', 'target'].includes(state.status) ||
      typeof state.dailyTriggered !== 'boolean' ||
      typeof state.dailyWarned !== 'boolean'
    )
      throw new Error('Invalid risk state')
    parseDayKey(state.currentDay)
    const keys = new Set<string>()
    for (const day of state.days) {
      parseDayKey(day.key)
      if (
        keys.has(day.key) ||
        !finite(day.realizedPnl) ||
        !finite(day.startEquity) ||
        (day.endEquity !== undefined && !finite(day.endEquity)) ||
        (day.endBalance !== undefined && !finite(day.endBalance)) ||
        !count(day.fills) ||
        !count(day.trades) ||
        day.trades > day.fills ||
        typeof day.finalized !== 'boolean'
      )
        throw new Error('Invalid risk ledger')
      keys.add(day.key)
    }
    if (state.breach !== null) {
      const breach = state.breach
      if (
        !breach ||
        breach.rule !== 'drawdown' ||
        !count(breach.bar) ||
        ![breach.time, breach.equity, breach.floor].every(finite) ||
        typeof breach.message !== 'string' ||
        breach.time > state.lastTime ||
        state.status !== 'breached'
      )
        throw new Error('Invalid breach state')
    } else if (state.status === 'breached') throw new Error('Missing breach record')
    if (
      state.status === 'daily-lock' &&
      (!state.dailyTriggered || state.template.dailyLoss.action !== 'flatten-lock')
    ) {
      throw new Error('Invalid daily lock')
    }
    if (Math.abs(state.floor - floorFor(state)) > EPSILON) throw new Error('Invalid risk floor')
    engine.data = structuredClone(state)
    return engine
  }

  get state(): RiskState {
    return structuredClone(this.data)
  }
  get template(): PropTemplate {
    return cloneTemplate(this.data.template)
  }
  get status() {
    return this.data.status
  }
  get floor(): number {
    return this.data.floor
  }
  /** Scalar reads for the engine's hot path; unlike `state`, these do not clone the ledger. */
  get startBalance(): number {
    return this.data.startBalance
  }
  get dayStartEquity(): number {
    return this.data.dayStartEquity
  }
  get day(): SimDayLedger {
    return {
      ...(this.data.days.find((day) => day.key === this.data.currentDay) ?? {
        key: this.data.currentDay,
        realizedPnl: 0,
        trades: 0,
        fills: 0,
        startEquity: this.data.dayStartEquity,
        finalized: false,
      }),
    }
  }

  /** Warmup advances the clock only; it must not manufacture accounting days. */
  prime(time: number): void {
    if (!finite(time) || this.data.days.length) throw new Error('Cannot prime an active risk ledger')
    this.data.lastTime = Math.max(time, this.data.lastTime)
    this.data.currentDay = tradingDayKey(this.data.lastTime)
  }

  /** Roll the replay clock into a new trade date before the bar is matched. */
  roll(time: number, startEquity: number): RiskEvent[] {
    if (!finite(time) || !finite(startEquity) || time < this.data.lastTime) throw new Error('Invalid session clock')
    const events: RiskEvent[] = []
    this.ensureDay(time, startEquity, events)
    this.data.lastTime = time
    return events
  }

  recordFill(time: number, cashDelta: number, equity: number, tradeClosed: boolean, dayKey?: string): void {
    if (![time, cashDelta, equity].every(finite) || time < this.data.lastTime)
      throw new Error('Invalid fill accounting')
    const key = dayKey ?? tradingDayKey(time)
    parseDayKey(key)
    if (key === this.data.currentDay) this.ensureDay(time, this.data.lastEquity, [], key)
    let day = this.data.days.find((entry) => entry.key === key)
    if (!day) {
      day = { key, realizedPnl: 0, trades: 0, fills: 0, startEquity: this.data.lastEquity, finalized: false }
      this.data.days.push(day)
    }
    if (day.finalized) throw new Error('Cannot book a fill into a finalized session')
    if (!finite(day.realizedPnl + cashDelta)) throw new Error('Accounting overflow')
    day.realizedPnl += cashDelta
    day.fills += 1
    if (tradeClosed) day.trades += 1
  }

  finalizeCurrentDay(): boolean {
    return this.finalizeDay(this.data.currentDay)
  }

  /** Finalize exactly one ledger day, including a late boundary for a missed day. */
  finalizeDay(key: string): boolean {
    parseDayKey(key)
    const day = this.data.days.find((entry) => entry.key === key)
    if (!day || day.finalized) return false
    day.finalized = true
    if (this.data.template.drawdown.mode === 'trailing-eod' && this.status !== 'breached' && this.status !== 'target') {
      const rule = this.data.template.drawdown
      const basis =
        rule.basis === 'equity' ? (day.endEquity ?? this.data.lastEquity) : (day.endBalance ?? this.data.lastBalance)
      this.data.peakEquity = Math.max(this.data.peakEquity, basis)
      this.data.floor = Math.max(this.data.floor, floorFor(this.data))
    }
    return true
  }

  /** Evaluated at every path event, including immediately after fees. */
  update(input: RiskInput, dayKey?: string): RiskEvent[] {
    if (
      ![input.equity, input.balance, input.unrealized, input.time].every(finite) ||
      !count(input.bar) ||
      !count(input.openContracts) ||
      input.time < this.data.lastTime
    )
      throw new Error('Invalid risk input')
    const events: RiskEvent[] = []
    const ledgerKey = dayKey ?? tradingDayKey(input.time)
    if (dayKey === undefined) this.ensureDay(input.time, this.data.lastEquity, events)
    else this.ensureLedgerDay(dayKey)
    const state = this.data
    state.lastEquity = input.equity
    state.lastBalance = input.balance
    state.lastTime = input.time
    const activeDay = state.days.find((entry) => entry.key === ledgerKey)
    if (activeDay && !activeDay.finalized) {
      activeDay.endEquity = input.equity
      activeDay.endBalance = input.balance
    }
    if (state.status === 'breached' || state.status === 'target') return events

    const rule = state.template.drawdown
    if (rule.mode === 'trailing-intraday') {
      state.peakEquity = Math.max(state.peakEquity, rule.basis === 'equity' ? input.equity : input.balance)
      state.floor = Math.max(state.floor, floorFor(state))
    }
    const monitored = rule.includeUnrealized ? input.equity : input.balance
    if (monitored <= state.floor + EPSILON) {
      state.breach = {
        rule: 'drawdown',
        bar: input.bar,
        time: input.time,
        equity: input.equity,
        floor: state.floor,
        message: `Account floor breached at ${monitored.toFixed(2)} (floor ${state.floor.toFixed(2)}).`,
      }
      state.status = 'breached'
      events.push({ type: 'breach', rule: 'drawdown', message: state.breach.message })
      return events
    }

    const daily = state.template.dailyLoss
    // A late boundary books the account breach but cannot re-arm or lock a
    // newer session's daily circuit breaker.
    if (ledgerKey === state.currentDay) {
      const dayPnl = input.equity - state.dayStartEquity
      if (daily.amount > 0 && dayPnl <= -daily.amount + EPSILON) {
        if (daily.action === 'warn' && !state.dailyWarned) {
          state.dailyWarned = true
          events.push({ type: 'daily-warning', rule: 'daily', message: `Daily loss warning: ${dayPnl.toFixed(2)}` })
        } else if (daily.action !== 'warn' && !state.dailyTriggered) {
          state.dailyTriggered = true
          if (daily.action === 'flatten-lock') state.status = 'daily-lock'
          events.push({
            type: 'daily-flatten',
            rule: 'daily',
            message: `Daily loss limit reached (${dayPnl.toFixed(2)}); flatten${daily.action === 'flatten-lock' ? ' and lock this session' : ' without locking'}.`,
          })
        }
      }
      this.checkTarget(input, events)
    }
    return events
  }

  checkTarget(input: Pick<RiskInput, 'balance' | 'openContracts'>, events: RiskEvent[] = []): boolean {
    if (!finite(input.balance) || !count(input.openContracts)) throw new Error('Invalid target input')
    if (this.status === 'target') return true
    if (this.status !== 'active') return false
    const state = this.data
    const template = state.template
    const profit = input.balance - state.startBalance
    if (template.profitTarget <= 0 || profit + EPSILON < template.profitTarget || input.openContracts > 0) return false
    if (!this.day.finalized || state.days.some((day) => day.fills > 0 && !day.finalized)) return false
    if (state.days.filter((day) => day.finalized && day.fills > 0).length < template.minTradingDays) return false
    const consistency = this.consistency()
    if (consistency?.gate === 'pass' && !consistency.eligible) return false
    state.status = 'target'
    events.push({ type: 'target', rule: 'profit', message: `Profit target reached (${profit.toFixed(2)}).` })
    return true
  }

  /** Equity levels that can cause a transition along a monotone price segment. */
  equityThresholds(): number[] {
    if (this.status === 'breached' || this.status === 'target') return []
    const state = this.data
    const levels = state.template.drawdown.includeUnrealized ? [state.floor] : []
    const daily = state.template.dailyLoss
    if (daily.amount > 0 && !(daily.action === 'warn' ? state.dailyWarned : state.dailyTriggered)) {
      levels.push(state.dayStartEquity - daily.amount)
    }
    return levels
  }

  ruleStatuses(openContracts = 0, marginUsed = 0): SimRuleStatus[] {
    const state = this.data
    const template = state.template
    const profit = state.lastBalance - state.startBalance
    const cushion = Math.max(
      0,
      (template.drawdown.includeUnrealized ? state.lastEquity : state.lastBalance) - state.floor,
    )
    const statuses: SimRuleStatus[] = [
      makeStatus(
        'profit',
        profit,
        template.profitTarget,
        state.status === 'target'
          ? 'done'
          : template.profitTarget > 0 && profit >= template.profitTarget
            ? 'gated'
            : 'ok',
      ),
      {
        id: 'drawdown',
        value: cushion,
        limit: template.drawdown.amount,
        percent: clamp01(1 - cushion / template.drawdown.amount),
        remaining: cushion,
        state: state.status === 'breached' ? 'breached' : cushion <= template.drawdown.amount * 0.2 ? 'near' : 'ok',
      },
      makeStatus(
        'contracts',
        openContracts,
        template.maxContracts,
        openContracts > template.maxContracts ? 'breached' : 'ok',
      ),
    ]
    const daily = template.dailyLoss
    if (daily.amount > 0) {
      const used = Math.max(0, state.dayStartEquity - state.lastEquity)
      statuses.push(
        makeStatus(
          'daily',
          used,
          daily.amount,
          state.dailyTriggered || state.dailyWarned ? 'breached' : used >= daily.amount * 0.8 ? 'near' : 'ok',
        ),
      )
    }
    if (template.maxTradesPerDay > 0)
      statuses.push(
        makeStatus(
          'trades',
          this.day.trades,
          template.maxTradesPerDay,
          this.day.trades >= template.maxTradesPerDay ? 'gated' : 'ok',
        ),
      )
    const days = state.days.filter((day) => day.finalized && day.fills > 0).length
    if (template.minTradingDays > 0)
      statuses.push(makeStatus('days', days, template.minTradingDays, days >= template.minTradingDays ? 'done' : 'ok'))
    const consistency = this.consistency()
    if (consistency)
      statuses.push(
        makeStatus(
          'consistency',
          (consistency.ratio ?? 0) * 100,
          consistency.limit * 100,
          consistency.eligible ? 'done' : 'gated',
        ),
      )
    if (marginUsed > 0)
      statuses.push(
        makeStatus(
          'margin',
          marginUsed,
          Math.max(0, state.lastEquity),
          marginUsed > state.lastEquity ? 'breached' : 'ok',
        ),
      )
    return statuses
  }

  consistency(): ConsistencyStatus | null {
    const rule = this.data.template.consistency
    if (!rule) return null
    const days = this.data.days.filter((day) => day.finalized)
    const bestDay = days.reduce((best, day) => Math.max(best, day.realizedPnl), 0)
    const totalNetProfit = days.reduce((total, day) => total + day.realizedPnl, 0)
    const ratio = totalNetProfit > 0 ? bestDay / totalNetProfit : null
    return {
      bestDay,
      totalNetProfit,
      ratio,
      limit: rule.maxBestDayRatio,
      eligible: ratio !== null && ratio <= rule.maxBestDayRatio + EPSILON,
      gate: rule.gate,
    }
  }

  breachPrice(input: BreachPriceInput): number | null {
    if (
      ![input.qty, input.pointValue, input.avgPrice, input.mark, input.balance, input.tickSize].every(finite) ||
      input.qty <= 0 ||
      input.pointValue <= 0 ||
      input.tickSize <= 0 ||
      !this.data.template.drawdown.includeUnrealized
    )
      return null
    const signed = input.qty * (input.side === 'long' ? 1 : -1) * input.pointValue
    const price =
      input.equity === undefined
        ? input.avgPrice + (this.floor - input.balance - (input.otherUnrealized ?? 0)) / signed
        : input.mark + (this.floor - input.equity) / signed
    return finite(price) ? roundTowardBreach(price, input.side, input.tickSize) : null
  }

  private ensureDay(time: number, startEquity: number, events: RiskEvent[], dayKey = tradingDayKey(time)): void {
    parseDayKey(dayKey)
    if (dayKey !== this.data.currentDay) {
      // A gap is not evidence that the prior session was completed.
      this.data.currentDay = dayKey
      this.data.dayStartEquity = startEquity
      this.data.dailyTriggered = false
      this.data.dailyWarned = false
      if (this.status === 'daily-lock') this.data.status = 'active'
      events.push({ type: 'new-day', day: dayKey, message: `New trading day ${dayKey}.` })
    }
    this.ensureLedgerDay(dayKey, startEquity)
  }

  /** Create a ledger row without moving the live session clock backwards. */
  private ensureLedgerDay(dayKey: string, startEquity = this.data.lastEquity): void {
    parseDayKey(dayKey)
    if (!this.data.days.some((day) => day.key === dayKey)) {
      this.data.days.push({
        key: dayKey,
        realizedPnl: 0,
        trades: 0,
        fills: 0,
        startEquity,
        finalized: false,
      })
    }
  }
}

export interface BreachPriceInput {
  side: SimSide
  qty: number
  avgPrice: number
  mark: number
  pointValue: number
  tickSize: number
  balance: number
  equity?: number
  otherUnrealized?: number
}

export function roundTowardBreach(price: number, side: SimSide, tickSize: number): number {
  if (!finite(price) || !finite(tickSize) || tickSize <= 0) return price
  return side === 'long'
    ? Math.floor(price / tickSize + EPSILON) * tickSize
    : Math.ceil(price / tickSize - EPSILON) * tickSize
}

function makeStatus(
  id: SimRuleStatus['id'],
  value: number,
  limit: number,
  state: SimRuleStatus['state'],
): SimRuleStatus {
  return {
    id,
    value,
    limit,
    percent: limit > 0 ? clamp01(value / limit) : 0,
    remaining: Math.max(0, limit - value),
    state,
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
