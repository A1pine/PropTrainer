import { assertValidInstrument, type InstrumentSpec } from '~/domain/instruments/types'
import type { Candle } from '~/domain/market/types'
import { cloneTemplate } from './presets'
import { RiskEngine, validateTemplate } from './risk'
import { isMarketOpen, parseDayKey, sessionClose, tradingDayKey } from './session'
import type {
  PropTemplate,
  RiskEvent,
  RiskState,
  SimAccount,
  SimAtm,
  SimBarContext,
  SimBracketInput,
  SimEngineCounters,
  SimEngineOptions,
  SimEngineState,
  SimEvent,
  SimExitReason,
  SimFill,
  SimMark,
  SimOrder,
  SimOrderInput,
  SimPosition,
  SimResult,
  SimSide,
  SimSnapshot,
  SimTrade,
} from './types'

const EPS = 1e-9
const TYPES = ['market', 'limit', 'stop', 'stop-limit', 'trailing-stop', 'trailing-stop-limit'] as const
const TIFS = ['day', 'gtc', 'gtd'] as const
const STATUSES = ['suspended', 'working', 'filled', 'cancelled', 'rejected', 'expired']
const ROLES = ['entry', 'exit', 'stop', 'target']
const REASONS = ['stop', 'target', 'manual', 'flatten', 'reverse', 'breach', 'daily-lock', 'session-end']
const EVENT_TYPES = [
  'submitted',
  'filled',
  'cancelled',
  'modified',
  'rejected',
  'expired',
  'released',
  'triggered',
  'trade',
  'breach',
  'daily-lock',
  'daily-flatten',
  'daily-warning',
  'target',
  'new-day',
  'session-close',
]
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const count = (n: unknown): n is number => finite(n) && Number.isSafeInteger(n) && n >= 0
const quantity = (n: unknown): n is number => count(n) && n > 0
const sign = (side: SimSide): number => (side === 'long' ? 1 : -1)
const opposite = (side: SimSide): SimSide => (side === 'long' ? 'short' : 'long')
const live = (order: SimOrder): boolean => order.status === 'working' || order.status === 'suspended'
const trailing = (order: Pick<SimOrder, 'type'>): boolean => order.type.startsWith('trailing-')
const stopLimit = (order: Pick<SimOrder, 'type'>): boolean => order.type.endsWith('stop-limit')
const clone = <T>(value: T): T => structuredClone(value)
const money = (n: number): number => {
  if (!finite(n)) throw new Error('Accounting overflow')
  return Number(n.toFixed(10))
}
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-7
const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message)
}

/**
 * OHLC is not a tape: use O-L-H-C for C >= O, otherwise O-H-L-C. At each
 * path location risk precedes stops, targets, manual exits, then entries (FIFO
 * within a role). Gaps use the open. A stop-limit activates its limit only
 * after its trigger event; earlier path segments are never reused. There is no
 * volume/queue model: each executable level fills all its remaining quantity.
 */
export class SimEngine {
  private readonly instruments = new Map<string, InstrumentSpec>()
  private readonly template: PropTemplate
  private risk: RiskEngine
  private balance: number
  private realizedGross = 0
  private fees = 0
  private bar = 0
  private time: number
  private positions = new Map<string, SimPosition>()
  private orders = new Map<string, SimOrder>()
  private marks = new Map<string, SimMark>()
  private fills: SimFill[] = []
  private trades: SimTrade[] = []
  private events: SimEvent[] = []
  private counters: SimEngineCounters = { order: 0, fill: 0, trade: 0, position: 0, event: 0 }
  private closedSessions: string[] = []
  private halted = false

  constructor(options: SimEngineOptions) {
    validateTemplate(options.template)
    assert(finite(options.time), 'Invalid replay clock')
    assert(Array.isArray(options.instruments) && options.instruments.length > 0, 'Instruments are required')
    for (const spec of options.instruments) {
      assert(spec && !this.instruments.has(spec.symbol), 'Duplicate or invalid instrument')
      assertValidInstrument(spec)
      assert(
        [
          spec.tickSize,
          spec.tickValue,
          spec.pointValue,
          spec.feePerContract,
          spec.intradayMargin,
          spec.anchorPrice,
          spec.volatility,
        ].every(finite) &&
          spec.pointValue > 0 &&
          spec.feePerContract >= 0 &&
          spec.intradayMargin >= 0 &&
          count(spec.pricePrecision) &&
          spec.pricePrecision <= 10,
        'Invalid instrument values',
      )
      this.instruments.set(spec.symbol, clone(spec))
    }
    this.template = cloneTemplate(options.template)
    this.balance = this.template.accountSize
    this.time = options.time
    this.risk = new RiskEngine(this.template, this.balance, this.time)
  }

  get status() {
    return this.risk.status
  }
  get currentBar(): number {
    return this.bar
  }
  get currentTime(): number {
    return this.time
  }
  get riskState(): RiskState {
    return this.risk.state
  }
  get templateSpec(): PropTemplate {
    return cloneTemplate(this.template)
  }
  mark(symbol: string): SimMark | null {
    return clone(this.marks.get(symbol) ?? null)
  }
  position(symbol: string): SimPosition | null {
    return clone(this.positions.get(symbol) ?? null)
  }

  /** Sparse symbols can have older warmup marks; the account clock never rewinds. */
  prime(context: SimBarContext): void {
    this.validateContext(context)
    assert(
      !this.marks.has(context.symbol) && this.fills.length === 0 && this.risk.state.days.length === 0,
      'Cannot prime an active symbol or account',
    )
    this.time = Math.max(this.time, context.candle.time)
    this.bar = context.index
    this.marks.set(context.symbol, { price: context.candle.close, time: context.candle.time, bar: context.index })
    this.risk.prime(this.time)
  }

  onBar(context: SimBarContext): SimSnapshot {
    this.validateContext(context)
    const { symbol, candle, index } = context
    const previous = this.marks.get(symbol)
    assert(candle.time >= this.time, 'Replay clock moved backwards')
    assert(!previous || (candle.time > previous.time && index > previous.bar), 'Duplicate or out-of-order symbol bar')
    this.time = candle.time
    this.bar = index
    this.halted = false
    this.logRisk(this.risk.roll(this.time, this.account().equity))
    this.expireOrders(this.time)
    const path =
      candle.close >= candle.open
        ? [candle.open, candle.low, candle.high, candle.close]
        : [candle.open, candle.high, candle.low, candle.close]
    let price = path[0]!
    this.visit(symbol, price, index)
    for (const end of path.slice(1)) {
      while (!this.halted && Math.abs(end - price) > EPS) {
        const direction = Math.sign(end - price)
        const levels = [end, ...this.orderLevels(symbol), ...this.riskLevels(symbol)]
        const ahead = levels.filter(
          (level) => finite(level) && (level - price) * direction > EPS && (end - level) * direction >= -EPS,
        )
        const next = direction > 0 ? Math.min(...ahead) : Math.max(...ahead)
        assert(finite(next), 'Invalid intrabar path')
        price = next
        this.visit(symbol, price, index)
      }
      if (this.halted) break
    }
    this.marks.set(symbol, { price: candle.close, time: this.time, bar: index })
    // A terminal transition has already liquidated at its live crossing price.
    this.evaluateRisk()
    return this.snapshot()
  }

  submit(input: SimOrderInput, symbol: string): SimResult {
    try {
      assert(this.instruments.has(symbol), `Unknown instrument ${symbol}`)
      const mark = this.marks.get(symbol)
      assert(mark, 'No market price is available yet.')
      assert(isMarketOpen(this.time), 'The market session is closed.')
      const normalized = this.normalizeInput(input, symbol)
      const position = this.positions.get(symbol)
      const reducing = normalized.reduceOnly === true || (!!position && position.side !== normalized.side)
      if (reducing) {
        assert(
          position && position.side !== normalized.side && normalized.qty <= position.qty,
          'Reduce-only quantity must fit an opposite open position.',
        )
        assert(!normalized.bracket, 'A reduce-only order cannot carry a bracket.')
      }
      const order = this.makeOrder(normalized, symbol, reducing)
      if (!reducing) {
        const error = this.entryError(order)
        assert(!error, error ?? '')
      }
      this.orders.set(order.id, order)
      this.counters.order += 1
      this.event('submitted', `${order.side} ${order.qty} ${order.type} ${symbol}`, symbol, order.id)
      if (order.type === 'market' && order.status === 'working') {
        this.fillOrder(order, mark!.price)
        if ((order.status as string) === 'rejected') return { ok: false, error: order.reason! }
      }
      return { ok: true, orderId: order.id }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Invalid order.' }
    }
  }

  cancel(orderId: string, reason = 'cancelled'): SimResult {
    const order = this.orders.get(orderId)
    if (!order || !live(order)) return { ok: false, error: 'Order is not working.' }
    this.endOrder(order, 'cancelled', reason)
    return { ok: true, orderId }
  }

  modify(orderId: string, patch: { limitPrice?: number | null; stopPrice?: number | null; qty?: number }): SimResult {
    const order = this.orders.get(orderId)
    if (!order || !live(order)) return { ok: false, error: 'Order is not working.' }
    try {
      assert(
        patch &&
          typeof patch === 'object' &&
          Object.keys(patch).every((key) => ['limitPrice', 'stopPrice', 'qty'].includes(key)),
        'Invalid modification.',
      )
      assert(!(order.triggered && patch.stopPrice !== undefined), 'Cannot amend an already-triggered stop.')
      const next = clone(order)
      if (patch.qty !== undefined) next.qty = patch.qty
      if (patch.limitPrice !== undefined) next.limitPrice = patch.limitPrice
      if (patch.stopPrice !== undefined) next.stopPrice = patch.stopPrice
      this.validateOrderFields(next)
      const spec = this.instruments.get(next.symbol)!
      if (next.limitPrice !== null) next.limitPrice = this.tick(next.limitPrice, spec)
      if (next.stopPrice !== null) next.stopPrice = this.tick(next.stopPrice, spec)
      if (trailing(next) && patch.stopPrice !== undefined && next.stopPrice !== null) {
        next.trailAnchor = money(next.stopPrice - sign(next.side) * next.trailTicks! * spec.tickSize)
      }
      const position = this.positions.get(next.symbol)
      if (next.reduceOnly) {
        assert(
          position && position.side !== next.side && next.qty <= position.qty,
          'Reduce-only quantity exceeds the open position.',
        )
        if (next.role === 'stop') assert(next.qty === position!.qty, 'The protective stop must cover the position.')
        if (next.role === 'target') {
          const others = position!.targets.filter((leg) => leg.id !== next.id).reduce((sum, leg) => sum + leg.qty, 0)
          assert(others + next.qty <= position!.qty, 'Target quantities exceed the open position.')
        }
      } else {
        const error = this.entryError(next, order.id)
        assert(!error, error ?? '')
      }
      if (next.bracket)
        next.bracket = this.normalizeBracket(next.bracket, next.side, this.reference(next), next.qty, spec)
      Object.assign(order, next)
      if (position && order.role === 'stop') position.stopLoss = order.stopPrice
      if (position && order.role === 'target') {
        const leg = position.targets.find((target) => target.id === order.id)!
        Object.assign(leg, { price: order.limitPrice!, qty: order.qty })
      }
      this.event('modified', `Modified ${order.id}`, order.symbol, order.id)
      return { ok: true, orderId }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Invalid modification.' }
    }
  }

  cancelAll(symbol?: string): void {
    for (const order of this.orders.values())
      if (live(order) && (!symbol || order.symbol === symbol)) {
        this.endOrder(order, 'cancelled', 'cancelled')
      }
  }

  flatten(symbol?: string, reason: SimExitReason = 'manual'): void {
    for (const position of [...this.positions.values()])
      if (!symbol || symbol === position.symbol) {
        this.forceClose(position, reason)
        this.evaluateRisk()
      }
    this.cancelAll(symbol)
  }

  exitAll(): void {
    this.flatten(undefined, 'flatten')
  }

  reverse(symbol: string): SimResult {
    if (this.status !== 'active') return { ok: false, error: 'Account is locked; reverse is disabled.' }
    const position = this.positions.get(symbol)
    if (!position) return { ok: false, error: 'No open position to reverse.' }
    if (!isMarketOpen(this.time)) return { ok: false, error: 'The market session is closed.' }
    const { side, qty } = position
    this.cancelAll(symbol)
    this.forceClose(position, 'reverse')
    const transition = this.evaluateRisk()
    if (transition || this.status !== 'active') return { ok: false, error: 'Closing costs disabled the reverse entry.' }
    // Submission uses the same caps, reservations, buying power and fees as any entry.
    return this.submit({ side: opposite(side), qty, type: 'market' }, symbol)
  }

  /**
   * Caller supplies a real scheduled boundary, not dataset exhaustion. The
   * boundary ledger owns all exit costs, including the last-second fees. No
   * next-open rollover implicitly finalizes a missing/incomplete session.
   */
  closeSession(time: number): SimSnapshot {
    assert(finite(time), 'Invalid session close time')
    const key = tradingDayKey(time - 1)
    assert(sessionClose(key) === time, 'Expected a scheduled session close')
    if (this.closedSessions.includes(key)) return this.snapshot()
    const late = this.time > time
    this.time = Math.max(this.time, time)
    for (const order of this.orders.values())
      if (live(order)) {
        const expired =
          (order.tif === 'gtd' && order.expiresAt! <= time) ||
          (order.tif === 'day' && sessionClose(tradingDayKey(order.createdTime)) <= time)
        if (expired) this.endOrder(order, 'expired', 'session-end')
      }
    for (const order of this.orders.values())
      if (live(order) && order.tif !== 'day' && order.releaseAt !== null && order.releaseAt <= time) {
        order.status = 'working'
        this.event('released', 'Order released at the session boundary', order.symbol, order.id)
      }
    for (const position of [...this.positions.values()]) {
      this.forceClose(position, 'session-end', key)
      this.evaluateRisk(key)
    }
    this.evaluateRisk(key)
    this.risk.finalizeDay(key)
    this.evaluateRisk(key)
    this.closedSessions.push(key)
    this.event(
      'session-close',
      `Session ${key} closed${late ? ' late' : ''}; exits use last-known marks (approximate, not a closing auction).`,
    )
    return this.snapshot()
  }

  account(): SimAccount {
    let unrealized = 0
    let margin = 0
    let contracts = 0
    for (const position of this.positions.values()) {
      const spec = this.instruments.get(position.symbol)!
      const price = this.marks.get(position.symbol)!.price
      unrealized += (price - position.avgPrice) * sign(position.side) * position.qty * spec.pointValue
      margin += position.qty * spec.intradayMargin
      contracts += position.qty
    }
    const equity = money(this.balance + unrealized)
    const pending = this.reservations()
    const state = this.risk.state
    return {
      startBalance: state.startBalance,
      balance: this.balance,
      equity,
      realizedPnl: money(this.balance - state.startBalance),
      unrealizedPnl: money(unrealized),
      fees: this.fees,
      dayPnl: money(equity - state.dayStartEquity),
      openContracts: contracts,
      marginUsed: money(margin),
      buyingPower: money(Math.max(0, equity - margin - pending.margin - pending.fees)),
    }
  }

  snapshot(): SimSnapshot {
    const account = this.account()
    return {
      account,
      positions: clone([...this.positions.values()]),
      orders: clone([...this.orders.values()]),
      fills: clone(this.fills),
      trades: clone(this.trades),
      risk: this.risk.state,
      ruleStatuses: this.risk.ruleStatuses(account.openContracts, account.marginUsed),
      consistency: this.risk.consistency(),
      marks: clone(Object.fromEntries(this.marks)),
      bar: this.bar,
      time: this.time,
      status: this.status,
      events: clone(this.events),
    }
  }

  exportState(): SimEngineState {
    return {
      schemaVersion: 1,
      template: cloneTemplate(this.template),
      symbols: [...this.instruments.keys()],
      balance: this.balance,
      realizedGross: this.realizedGross,
      fees: this.fees,
      bar: this.bar,
      time: this.time,
      risk: this.risk.state,
      positions: clone([...this.positions.values()]),
      orders: clone([...this.orders.values()]),
      marks: clone(Object.fromEntries(this.marks)),
      fills: clone(this.fills),
      trades: clone(this.trades),
      events: clone(this.events),
      counters: { ...this.counters },
      closedSessions: [...this.closedSessions],
    }
  }

  static fromState(state: SimEngineState, instruments: readonly InstrumentSpec[]): SimEngine {
    assert(state && state.schemaVersion === 1, 'Unsupported replay engine state')
    assertFiniteTree(state)
    const engine = new SimEngine({ instruments, template: state.template, time: state.time })
    engine.restore(state)
    return engine
  }

  private validateContext({ symbol, candle, index }: SimBarContext): void {
    assert(this.instruments.has(symbol), `Unknown instrument ${symbol}`)
    assert(
      count(index) &&
        candle &&
        [candle.time, candle.open, candle.high, candle.low, candle.close].every(finite) &&
        candle.high >= Math.max(candle.open, candle.close, candle.low) &&
        candle.low <= Math.min(candle.open, candle.close),
      'Invalid market bar',
    )
    const spec = this.instruments.get(symbol)!
    assert(
      [candle.low, candle.high].every((price) => finite(price * spec.pointValue * this.template.maxContracts)),
      'Unrepresentable market price',
    )
  }

  private tick(price: number, spec: InstrumentSpec): number {
    const value = money(Math.round(price / spec.tickSize) * spec.tickSize)
    assert(finite(value * spec.pointValue * this.template.maxContracts), 'Unrepresentable order price')
    return value
  }

  private normalizeInput(input: SimOrderInput, symbol: string): SimOrderInput {
    assert(input && typeof input === 'object', 'Invalid order.')
    const spec = this.instruments.get(symbol)!
    const next: SimOrderInput = {
      ...input,
      tif: input.tif === undefined ? 'day' : input.tif,
      limitPrice: input.limitPrice ?? null,
      stopPrice: input.stopPrice ?? null,
      trailTicks: input.trailTicks ?? null,
      limitOffsetTicks: input.limitOffsetTicks ?? null,
      expiresAt: input.expiresAt ?? null,
      releaseAt: input.releaseAt ?? null,
      bracket: input.bracket ?? null,
    }
    this.validateOrderFields(next)
    assert(input.reduceOnly === undefined || typeof input.reduceOnly === 'boolean', 'Invalid reduce-only flag.')
    assert(input.tag === undefined || typeof input.tag === 'string', 'Invalid order tag.')
    if (next.limitPrice !== null) next.limitPrice = this.tick(next.limitPrice!, spec)
    if (next.stopPrice !== null) next.stopPrice = this.tick(next.stopPrice!, spec)
    if (next.tif === 'gtd') assert(next.expiresAt! > this.time, 'GTD expiry must be in the future.')
    if (next.releaseAt !== null) {
      assert(next.releaseAt! >= this.time, 'Release time cannot be in the past.')
      if (next.tif === 'gtd') assert(next.expiresAt! >= next.releaseAt!, 'GTD expiry precedes release.')
      if (next.tif === 'day')
        assert(next.releaseAt! < sessionClose(tradingDayKey(this.time)), 'DAY release is outside the session.')
    }
    if (trailing(next) && next.stopPrice === null) {
      next.stopPrice = this.tick(
        this.marks.get(symbol)!.price + sign(next.side) * next.trailTicks! * spec.tickSize,
        spec,
      )
    }
    if (next.bracket)
      next.bracket = this.normalizeBracket(
        next.bracket,
        next.side,
        this.reference({ ...next, symbol } as SimOrder),
        next.qty,
        spec,
      )
    return next
  }

  private validateOrderFields(order: SimOrderInput): void {
    assert(order.side === 'long' || order.side === 'short', 'Invalid order side.')
    assert(TYPES.includes(order.type) && quantity(order.qty), 'Invalid order type or quantity.')
    assert(TIFS.includes(order.tif!), 'Invalid time in force.')
    assert(
      order.bracket === undefined ||
        order.bracket === null ||
        (typeof order.bracket === 'object' && !Array.isArray(order.bracket)),
      'Invalid bracket.',
    )
    for (const value of [order.limitPrice, order.stopPrice, order.releaseAt, order.expiresAt]) {
      assert(value === null || finite(value), 'Prices and timestamps must be finite.')
    }
    const hasLimit = order.type === 'limit' || stopLimit(order)
    const hasStop = order.type === 'stop' || stopLimit(order) || trailing(order)
    assert(hasLimit || order.limitPrice === null, 'This order does not accept a limit price.')
    assert(hasStop || order.stopPrice === null, 'This order does not accept a stop price.')
    if (order.type === 'limit' || order.type === 'stop-limit')
      assert(finite(order.limitPrice), 'A limit price is required.')
    if (order.type === 'stop' || order.type === 'stop-limit')
      assert(finite(order.stopPrice), 'A stop price is required.')
    if (trailing(order)) assert(quantity(order.trailTicks), 'A positive whole trail distance is required.')
    else assert(order.trailTicks === null, 'This order does not accept a trail distance.')
    if (order.type === 'trailing-stop-limit') {
      assert(order.limitOffsetTicks === null || count(order.limitOffsetTicks), 'Invalid limit offset.')
      assert(finite(order.limitPrice) || count(order.limitOffsetTicks), 'A trailing limit price or offset is required.')
    } else assert(order.limitOffsetTicks === null, 'This order does not accept a limit offset.')
    if (order.tif === 'gtd') assert(finite(order.expiresAt), 'GTD expiry is required.')
    else assert(order.expiresAt === null, 'Only GTD orders accept an expiry.')
  }

  private reference(order: SimOrder): number {
    if (order.type === 'limit' || stopLimit(order)) return order.limitPrice ?? order.stopPrice!
    if (order.type === 'stop' || trailing(order)) return order.stopPrice!
    return this.marks.get(order.symbol)!.price
  }

  private normalizeBracket(
    bracket: SimBracketInput,
    side: SimSide,
    reference: number,
    qty: number,
    spec: InstrumentSpec,
  ): SimBracketInput {
    validateBracketShape(bracket, qty)
    const stopLoss = bracket.stopLoss === null ? null : this.tick(bracket.stopLoss, spec)
    assert(
      stopLoss === null || (reference - stopLoss) * sign(side) > EPS,
      'Stop must be on the loss side of the entry.',
    )
    const targets = bracket.targets.map((target) => ({ price: this.tick(target.price, spec), qty: target.qty }))
    assert(
      targets.every((target) => (target.price - reference) * sign(side) > EPS),
      'Targets must be on the profit side of the entry.',
    )
    return { stopLoss, targets, atm: clone(bracket.atm ?? null) }
  }

  /** A better-than-limit entry fill can invalidate a bracket that was legal at submission. */
  private bracketFillError(order: SimOrder, price: number): string | null {
    const bracket = order.bracket
    if (!bracket) return null
    if (bracket.stopLoss !== null && (price - bracket.stopLoss) * sign(order.side) <= EPS) {
      return 'Entry fill is not above the protective stop.'
    }
    if (bracket.targets.some((target) => (target.price - price) * sign(order.side) <= EPS)) {
      return 'Entry fill is not before the profit targets.'
    }
    return null
  }

  private makeOrder(input: SimOrderInput, symbol: string, reducing: boolean): SimOrder {
    return {
      id: `o${this.counters.order + 1}`,
      symbol,
      side: input.side,
      type: input.type,
      qty: input.qty,
      limitPrice: input.limitPrice ?? null,
      stopPrice: input.stopPrice ?? null,
      trailTicks: input.trailTicks ?? null,
      limitOffsetTicks: input.limitOffsetTicks ?? null,
      trailAnchor: trailing(input) ? this.marks.get(symbol)!.price : null,
      triggered: false,
      tif: input.tif ?? 'day',
      expiresAt: input.expiresAt ?? null,
      releaseAt: input.releaseAt ?? null,
      status: input.releaseAt != null && input.releaseAt > this.time ? 'suspended' : 'working',
      role: reducing ? 'exit' : 'entry',
      reduceOnly: reducing,
      parentId: null,
      ocoId: null,
      bracket: clone(input.bracket ?? null),
      createdBar: this.marks.get(symbol)!.bar,
      createdTime: this.time,
      filledBar: null,
      filledTime: null,
      filledPrice: null,
      filledQty: 0,
      cancelledBar: null,
      reason: null,
      tag: input.tag ?? '',
    }
  }

  private reservations(exclude?: string): { qty: number; margin: number; fees: number } {
    let qty = 0,
      margin = 0,
      fees = 0
    for (const order of this.orders.values())
      if (live(order) && !order.reduceOnly && order.id !== exclude) {
        const spec = this.instruments.get(order.symbol)!
        qty += order.qty
        margin += order.qty * spec.intradayMargin
        fees += (order.qty * spec.feePerContract) / 2
      }
    return { qty, margin, fees }
  }

  private entryError(order: SimOrder, exclude?: string): string | null {
    if (this.status !== 'active') return `Account is ${this.status}; new risk is disabled.`
    if (this.template.maxTradesPerDay > 0 && this.risk.day.trades >= this.template.maxTradesPerDay)
      return 'Daily trade limit reached.'
    const account = this.account()
    const pending = this.reservations(exclude)
    const spec = this.instruments.get(order.symbol)!
    // Independent opposite entries reserve gross capacity, never a fictitious net hedge.
    if (account.openContracts + pending.qty + order.qty > this.template.maxContracts) return 'Contract limit exceeded.'
    const required =
      account.marginUsed +
      pending.margin +
      order.qty * spec.intradayMargin +
      pending.fees +
      (order.qty * spec.feePerContract) / 2
    if (!finite(required) || required > account.equity + EPS) return 'Not enough buying power.'
    return null
  }

  private visit(symbol: string, price: number, index: number): void {
    this.marks.set(symbol, { price, time: this.time, bar: index })
    this.advanceProtection(symbol, price)
    if (this.evaluateRisk()) return
    for (;;) {
      const eligible = [...this.orders.values()].filter(
        (order) =>
          order.symbol === symbol &&
          order.status === 'working' &&
          (order.createdTime < this.time || order.parentId !== null) &&
          this.marketable(order, price),
      )
      eligible.sort((a, b) => priority(a) - priority(b) || Number(a.id.slice(1)) - Number(b.id.slice(1)))
      const order = eligible[0]
      if (!order) break
      if (stopLimit(order) && !order.triggered) {
        order.triggered = true
        if (order.limitPrice === null) {
          const spec = this.instruments.get(symbol)!
          order.limitPrice = this.tick(
            order.stopPrice! + sign(order.side) * order.limitOffsetTicks! * spec.tickSize,
            spec,
          )
        }
        this.event('triggered', `Stop triggered; limit ${order.limitPrice} is now live`, symbol, order.id)
        // The next matching event sees only the new limit, never the prior low/high.
        continue
      }
      this.fillOrder(order, price)
      if (this.halted) break
    }
  }

  private level(order: SimOrder): number | null {
    return order.type === 'limit' || (stopLimit(order) && order.triggered) ? order.limitPrice : order.stopPrice
  }

  private marketable(order: SimOrder, price: number): boolean {
    if (order.type === 'market') return true
    const level = this.level(order)
    if (level === null) return false
    const limit = order.type === 'limit' || (stopLimit(order) && order.triggered)
    return limit ? (price - level) * sign(order.side) <= EPS : (price - level) * sign(order.side) >= -EPS
  }

  private orderLevels(symbol: string): number[] {
    return [...this.orders.values()]
      .filter(
        (order) =>
          order.symbol === symbol &&
          order.status === 'working' &&
          (order.createdTime < this.time || order.parentId !== null),
      )
      .map((order) => this.level(order))
      .filter(finite)
  }

  private fillOrder(order: SimOrder, price: number, reason?: SimExitReason, dayKey?: string): void {
    const position = this.positions.get(order.symbol)
    const reducing = order.reduceOnly || (!!position && position.side !== order.side)
    if (reducing && (!position || position.side === order.side)) {
      this.endOrder(order, 'cancelled', 'No opposite position to reduce')
      return
    }
    if (!reducing) {
      const error = this.entryError(order, order.id)
      if (error) {
        this.endOrder(order, 'rejected', error)
        return
      }
      const bracketError = this.bracketFillError(order, price)
      if (bracketError) {
        this.endOrder(order, 'rejected', bracketError)
        return
      }
    }
    const qty = reducing ? Math.min(order.qty, position!.qty) : order.qty
    // Retire the executing leg BEFORE resizing siblings; a filled target must
    // never consume the remaining allocation a second time.
    order.status = 'filled'
    order.filledQty = qty
    order.filledPrice = price
    order.filledBar = this.marks.get(order.symbol)!.bar
    order.filledTime = this.time
    if (reducing) {
      order.reduceOnly = true
      if (order.role === 'entry') order.role = 'exit'
      this.removeLeg(order)
      this.closePosition(
        position!,
        qty,
        price,
        order,
        reason ?? (order.role === 'stop' ? 'stop' : order.role === 'target' ? 'target' : 'manual'),
        dayKey,
      )
    } else this.openPosition(order, price)
    this.event('filled', `${order.side} ${qty} ${order.symbol} at ${price}`, order.symbol, order.id)
    this.evaluateRisk(dayKey)
  }

  private openPosition(order: SimOrder, price: number): void {
    const spec = this.instruments.get(order.symbol)!
    const fee = money((order.qty * spec.feePerContract) / 2)
    this.balance = money(this.balance - fee)
    this.fees = money(this.fees + fee)
    let position = this.positions.get(order.symbol)
    const bracket = order.bracket
    const initialRisk =
      bracket?.stopLoss == null ? 0 : money(Math.abs(price - bracket.stopLoss) * order.qty * spec.pointValue)
    if (position) {
      position.avgPrice = money((position.avgPrice * position.qty + price * order.qty) / (position.qty + order.qty))
      position.qty += order.qty
      position.entryFee = money(position.entryFee + fee)
      position.initialRisk = money(position.initialRisk + initialRisk)
    } else {
      position = {
        id: `p${++this.counters.position}`,
        symbol: order.symbol,
        side: order.side,
        qty: order.qty,
        avgPrice: price,
        entryBar: order.filledBar!,
        entryTime: this.time,
        stopLoss: null,
        targets: [],
        initialRisk,
        entryFee: fee,
        mae: 0,
        mfe: 0,
        bestPrice: price,
        atm: null,
        breakEvenDone: false,
        tag: order.tag,
      }
      this.positions.set(order.symbol, position)
    }
    if (bracket) this.attachBracket(position, bracket)
    this.syncExits(position.symbol)
    this.recordFill(order, order.qty, price, fee, -fee, 'entry', null, false)
  }

  private closePosition(
    position: SimPosition,
    qty: number,
    price: number,
    order: SimOrder,
    reason: SimExitReason,
    dayKey?: string,
  ): void {
    const spec = this.instruments.get(position.symbol)!
    const fraction = qty / position.qty
    const gross = money((price - position.avgPrice) * sign(position.side) * qty * spec.pointValue)
    const entryFee = money(position.entryFee * fraction)
    const exitFee = money((qty * spec.feePerContract) / 2)
    const initialRisk = position.initialRisk * fraction
    const pnl = money(gross - entryFee - exitFee)
    this.balance = money(this.balance + gross - exitFee)
    this.realizedGross = money(this.realizedGross + gross)
    this.fees = money(this.fees + exitFee)
    this.trades.push({
      id: `t${++this.counters.trade}`,
      positionId: position.id,
      symbol: position.symbol,
      side: position.side,
      qty,
      entryPrice: position.avgPrice,
      exitPrice: price,
      entryBar: position.entryBar,
      exitBar: order.filledBar!,
      entryTime: position.entryTime,
      exitTime: this.time,
      exitReason: reason,
      grossPnl: gross,
      fees: money(entryFee + exitFee),
      pnl,
      rMultiple: initialRisk > EPS ? money(pnl / initialRisk) : null,
      mae: position.mae,
      mfe: position.mfe,
      tag: position.tag,
    })
    position.qty -= qty
    position.entryFee = money(position.entryFee - entryFee)
    position.initialRisk = money(position.initialRisk - initialRisk)
    const complete = position.qty === 0
    if (complete) this.positions.delete(position.symbol)
    this.syncExits(position.symbol)
    this.recordFill(order, qty, price, exitFee, money(gross - exitFee), order.role, reason, complete, dayKey)
    this.event('trade', `${position.side} ${qty} closed at ${price} for ${pnl}`, position.symbol, order.id)
  }

  private recordFill(
    order: SimOrder,
    qty: number,
    price: number,
    fee: number,
    cashDelta: number,
    role: SimFill['role'],
    reason: SimExitReason | null,
    complete: boolean,
    dayKey?: string,
  ): void {
    this.fills.push({
      id: `f${++this.counters.fill}`,
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      qty,
      price,
      bar: order.filledBar!,
      time: this.time,
      fee,
      cashDelta,
      role,
      reason,
    })
    this.risk.recordFill(this.time, cashDelta, this.account().equity, complete, dayKey)
  }

  private forceClose(position: SimPosition, reason: SimExitReason, dayKey?: string): void {
    if (this.positions.get(position.symbol) !== position || position.qty <= 0) return
    const order = this.makeOrder(
      { type: 'market', side: opposite(position.side), qty: position.qty, tif: 'gtc' },
      position.symbol,
      true,
    )
    this.counters.order += 1
    this.orders.set(order.id, order)
    // Risk liquidation evaluates its own costs in evaluateRisk's loop, not recursively.
    order.status = 'filled'
    order.filledQty = position.qty
    order.filledPrice = this.marks.get(position.symbol)!.price
    order.filledBar = this.marks.get(position.symbol)!.bar
    order.filledTime = this.time
    this.closePosition(position, position.qty, order.filledPrice, order, reason, dayKey)
    this.event('filled', `${reason}: ${order.side} ${order.filledQty} at ${order.filledPrice}`, order.symbol, order.id)
  }

  private attachBracket(position: SimPosition, bracket: SimBracketInput): void {
    if (bracket.stopLoss !== null) {
      const old = this.stopFor(position)
      if (old) this.endOrder(old, 'cancelled', 'Replaced by new bracket')
      this.addLeg(position, 'stop', bracket.stopLoss, position.qty)
      position.stopLoss = bracket.stopLoss
    }
    for (const leg of bracket.targets) {
      const order = this.addLeg(position, 'target', leg.price, leg.qty)
      position.targets.push({ id: order.id, price: leg.price, qty: leg.qty })
    }
    if (bracket.atm) {
      position.atm = clone(bracket.atm)
      position.breakEvenDone = false
      position.bestPrice = this.marks.get(position.symbol)!.price
    }
  }

  private addLeg(position: SimPosition, role: 'stop' | 'target', price: number, qty: number): SimOrder {
    const order = this.makeOrder(
      {
        type: role === 'stop' ? 'stop' : 'limit',
        side: opposite(position.side),
        qty,
        stopPrice: role === 'stop' ? price : null,
        limitPrice: role === 'target' ? price : null,
        tif: 'gtc',
      },
      position.symbol,
      true,
    )
    this.counters.order += 1
    Object.assign(order, { role, parentId: position.id, ocoId: position.id })
    this.orders.set(order.id, order)
    return order
  }

  private syncExits(symbol: string): void {
    const position = this.positions.get(symbol)
    for (const order of this.orders.values())
      if (live(order) && order.symbol === symbol && order.reduceOnly) {
        if (!position || position.side === order.side) this.endOrder(order, 'cancelled', 'Position closed')
        else order.qty = order.role === 'stop' ? position.qty : Math.min(order.qty, position.qty)
      }
    if (!position) return
    let available = position.qty
    for (const leg of [...position.targets]) {
      const order = this.orders.get(leg.id)!
      if (!live(order)) {
        this.removeLeg(order)
        continue
      }
      if (available === 0) {
        this.endOrder(order, 'cancelled', 'No remaining target quantity')
        continue
      }
      leg.qty = order.qty = Math.min(leg.qty, available)
      available -= leg.qty
    }
  }

  private stopFor(position: SimPosition): SimOrder | undefined {
    return [...this.orders.values()].find(
      (order) => live(order) && order.parentId === position.id && order.role === 'stop',
    )
  }

  private advanceProtection(symbol: string, price: number): void {
    const spec = this.instruments.get(symbol)!
    for (const order of this.orders.values())
      if (order.symbol === symbol && order.status === 'working' && trailing(order) && !order.triggered) {
        const anchor = order.side === 'long' ? Math.min(order.trailAnchor!, price) : Math.max(order.trailAnchor!, price)
        order.trailAnchor = anchor
        const stop = this.tick(anchor + sign(order.side) * order.trailTicks! * spec.tickSize, spec)
        if (order.stopPrice === null || (stop - order.stopPrice) * sign(order.side) < 0) order.stopPrice = stop
      }
    const position = this.positions.get(symbol)
    if (!position) return
    const pnl = money((price - position.avgPrice) * sign(position.side) * position.qty * spec.pointValue)
    position.mae = Math.min(position.mae, pnl)
    position.mfe = Math.max(position.mfe, pnl)
    position.bestPrice =
      position.side === 'long' ? Math.max(position.bestPrice, price) : Math.min(position.bestPrice, price)
    const stop = this.stopFor(position)
    // Cancellation is deliberate: ATM can tighten an existing stop, never resurrect one.
    if (!stop || !position.atm) return
    const favorableTicks = ((position.bestPrice - position.avgPrice) * sign(position.side)) / spec.tickSize
    let next = stop.stopPrice!
    const tighten = (candidate: number): void => {
      if ((candidate - next) * sign(position.side) > EPS) next = candidate
    }
    const be = position.atm.breakEven
    if (be && !position.breakEvenDone && favorableTicks + EPS >= be.triggerTicks) {
      tighten(position.avgPrice + sign(position.side) * be.offsetTicks * spec.tickSize)
      position.breakEvenDone = true
    }
    const trail = position.atm.trailing
    if (trail && favorableTicks + EPS >= trail.triggerTicks) {
      const candidate = position.bestPrice - sign(position.side) * trail.distanceTicks * spec.tickSize
      if ((candidate - next) * sign(position.side) + EPS >= trail.stepTicks * spec.tickSize) tighten(candidate)
    }
    next = this.tick(next, spec)
    if ((next - stop.stopPrice!) * sign(position.side) > EPS) {
      position.stopLoss = stop.stopPrice = next
      this.event('modified', `ATM stop moved to ${next}`, symbol, stop.id)
    }
  }

  private evaluateRisk(dayKey?: string): boolean {
    let transition = false
    for (;;) {
      const account = this.account()
      const events = this.risk.update(
        {
          equity: account.equity,
          balance: this.balance,
          unrealized: account.unrealizedPnl,
          time: this.time,
          bar: this.bar,
          openContracts: account.openContracts,
        },
        dayKey,
      )
      this.logRisk(events)
      const action = events.find((event) => ['breach', 'daily-flatten', 'target'].includes(event.type))
      if (!action) break
      transition = this.halted = true
      const reason = action.type === 'breach' ? 'breach' : action.type === 'daily-flatten' ? 'daily-lock' : 'flatten'
      for (const position of [...this.positions.values()]) this.forceClose(position, reason, dayKey)
      this.cancelAll()
      // Post-liquidation fees can turn a daily flatten into a permanent breach.
    }
    if (this.status === 'breached' || this.status === 'target') this.halted = true
    return transition || this.status === 'breached' || this.status === 'target'
  }

  private riskLevels(symbol: string): number[] {
    const position = this.positions.get(symbol)
    if (!position) return []
    const price = this.marks.get(symbol)!.price
    const slope = position.qty * this.instruments.get(symbol)!.pointValue * sign(position.side)
    const equity = this.account().equity
    return this.risk
      .equityThresholds()
      .map((threshold) => price + (threshold - equity) / slope)
      .filter(finite)
  }

  private logRisk(events: RiskEvent[]): void {
    for (const event of events) this.event(event.type, event.message)
  }

  private expireOrders(time: number): void {
    for (const order of this.orders.values())
      if (live(order)) {
        const expired =
          (order.tif === 'gtd' && order.expiresAt! <= time) ||
          (order.tif === 'day' && sessionClose(tradingDayKey(order.createdTime)) <= time)
        if (expired) this.endOrder(order, 'expired', 'Time in force expired')
        else if (order.status === 'suspended' && order.releaseAt! <= time) {
          order.status = 'working'
          this.event('released', 'Order released', order.symbol, order.id)
        }
      }
  }

  private removeLeg(order: SimOrder): void {
    const position = this.positions.get(order.symbol)
    if (!position || order.parentId !== position.id) return
    if (order.role === 'stop') position.stopLoss = null
    if (order.role === 'target') position.targets = position.targets.filter((leg) => leg.id !== order.id)
  }

  private endOrder(order: SimOrder, status: 'cancelled' | 'expired' | 'rejected', reason: string): void {
    if (!live(order)) return
    order.status = status
    order.reason = reason
    order.cancelledBar = this.marks.get(order.symbol)?.bar ?? this.bar
    this.removeLeg(order)
    this.event(status, reason, order.symbol, order.id)
  }

  private event(
    type: SimEvent['type'],
    message: string,
    symbol: string | null = null,
    orderId: string | null = null,
  ): void {
    this.events.push({
      id: ++this.counters.event,
      time: this.time,
      bar: symbol ? (this.marks.get(symbol)?.bar ?? this.bar) : this.bar,
      type,
      message,
      symbol,
      orderId,
    })
    if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000)
  }

  private restore(state: SimEngineState): void {
    assert(
      Array.isArray(state.symbols) &&
        state.symbols.length === this.instruments.size &&
        new Set(state.symbols).size === state.symbols.length &&
        state.symbols.every((symbol) => this.instruments.has(symbol)),
      'Engine symbols do not match pinned instruments',
    )
    assert(
      [state.balance, state.realizedGross, state.fees].every(finite) && state.fees >= 0 && count(state.bar),
      'Invalid engine accounting',
    )
    assert(
      state.counters &&
        Object.values(state.counters).length === 5 &&
        ['order', 'fill', 'trade', 'position', 'event'].every((key) =>
          count(state.counters[key as keyof SimEngineCounters]),
        ),
      'Invalid engine counters',
    )
    assert(
      [state.positions, state.orders, state.fills, state.trades, state.events, state.closedSessions].every(
        Array.isArray,
      ),
      'Malformed engine collections',
    )
    this.risk = RiskEngine.fromState(state.risk)
    assert(
      JSON.stringify(state.template) === JSON.stringify(state.risk.template) &&
        state.risk.startBalance === this.template.accountSize &&
        state.risk.lastTime <= state.time &&
        near(state.risk.lastBalance, state.balance),
      'Engine/risk state mismatch',
    )
    assert(state.marks && typeof state.marks === 'object' && !Array.isArray(state.marks), 'Invalid engine marks')
    for (const [symbol, mark] of Object.entries(state.marks)) {
      assert(
        this.instruments.has(symbol) &&
          mark &&
          finite(mark.price) &&
          finite(mark.time) &&
          mark.time <= state.time &&
          count(mark.bar),
        'Invalid engine mark',
      )
      this.marks.set(symbol, clone(mark))
    }
    for (const order of state.orders) {
      assert(
        order &&
          validId(order.id, 'o', state.counters.order) &&
          !this.orders.has(order.id) &&
          this.instruments.has(order.symbol),
        'Invalid engine order identity',
      )
      this.validateOrderFields(order)
      assert(
        STATUSES.includes(order.status) &&
          ROLES.includes(order.role) &&
          typeof order.reduceOnly === 'boolean' &&
          typeof order.triggered === 'boolean' &&
          (order.trailAnchor === null || finite(order.trailAnchor)) &&
          count(order.createdBar) &&
          finite(order.createdTime) &&
          order.createdTime <= state.time &&
          count(order.filledQty) &&
          order.filledQty <= order.qty &&
          typeof order.tag === 'string' &&
          (order.reason === null || typeof order.reason === 'string') &&
          (order.parentId === null || validId(order.parentId, 'p', state.counters.position)) &&
          (order.ocoId === null || order.ocoId === order.parentId) &&
          (order.cancelledBar === null || count(order.cancelledBar)),
        'Invalid engine order',
      )
      if (trailing(order)) assert(finite(order.trailAnchor) && finite(order.stopPrice), 'Invalid trailing state')
      assert(!order.triggered || stopLimit(order), 'Invalid trigger state')
      if (order.triggered) assert(finite(order.limitPrice), 'Triggered order has no limit')
      if (order.status === 'filled')
        assert(
          quantity(order.filledQty) &&
            count(order.filledBar) &&
            finite(order.filledPrice) &&
            finite(order.filledTime) &&
            order.filledTime >= order.createdTime &&
            order.filledTime <= state.time,
          'Invalid filled order',
        )
      else
        assert(
          order.filledQty === 0 && order.filledBar === null && order.filledTime === null && order.filledPrice === null,
          'Invalid unfilled order',
        )
      if (order.tif === 'gtd') assert(order.expiresAt! > order.createdTime, 'Invalid GTD state')
      if (order.releaseAt !== null) assert(order.releaseAt >= order.createdTime, 'Invalid release state')
      if (order.status === 'suspended') assert(order.releaseAt !== null, 'Invalid suspended state')
      if (order.bracket) validateBracketShape(order.bracket, order.qty)
      if (['stop', 'target'].includes(order.role))
        assert(
          order.reduceOnly && order.parentId && order.type === (order.role === 'stop' ? 'stop' : 'limit'),
          'Invalid protective order',
        )
      this.orders.set(order.id, clone(order))
    }
    const positionIds = new Set<string>()
    for (const position of state.positions) {
      assert(
        position &&
          validId(position.id, 'p', state.counters.position) &&
          !positionIds.has(position.id) &&
          !this.positions.has(position.symbol) &&
          this.marks.has(position.symbol) &&
          ['long', 'short'].includes(position.side) &&
          quantity(position.qty) &&
          finite(position.avgPrice) &&
          count(position.entryBar) &&
          finite(position.entryTime) &&
          position.entryTime <= state.time &&
          finite(position.initialRisk) &&
          position.initialRisk >= 0 &&
          finite(position.entryFee) &&
          position.entryFee >= 0 &&
          [position.mae, position.mfe, position.bestPrice].every(finite) &&
          position.mae <= 0 &&
          position.mfe >= 0 &&
          (position.stopLoss === null || finite(position.stopLoss)) &&
          Array.isArray(position.targets) &&
          typeof position.breakEvenDone === 'boolean' &&
          typeof position.tag === 'string',
        'Invalid engine position',
      )
      validateAtm(position.atm)
      positionIds.add(position.id)
      this.positions.set(position.symbol, clone(position))
      let targetQty = 0
      const targetIds = new Set<string>()
      for (const target of position.targets) {
        const order = this.orders.get(target.id)
        assert(
          !targetIds.has(target.id) &&
            quantity(target.qty) &&
            finite(target.price) &&
            order &&
            live(order) &&
            order.role === 'target' &&
            order.parentId === position.id &&
            order.symbol === position.symbol &&
            order.limitPrice === target.price &&
            order.qty === target.qty,
          'Invalid position target',
        )
        targetIds.add(target.id)
        targetQty += target.qty
      }
      assert(targetQty <= position.qty, 'Overallocated position targets')
      const stops = [...this.orders.values()].filter(
        (order) => live(order) && order.parentId === position.id && order.role === 'stop',
      )
      assert(
        stops.length <= 1 &&
          (stops[0]?.stopPrice ?? null) === position.stopLoss &&
          (!stops[0] || stops[0].qty === position.qty),
        'Invalid position stop',
      )
    }
    for (const order of this.orders.values())
      if (live(order) && order.reduceOnly) {
        const position = this.positions.get(order.symbol)
        assert(
          position &&
            position.side !== order.side &&
            order.qty <= position.qty &&
            (order.parentId === null || order.parentId === position.id),
          'Orphan reduce-only order',
        )
        if (order.role === 'target')
          assert(
            position!.targets.some((leg) => leg.id === order.id),
            'Orphan target',
          )
      }
    const fillIds = new Set<string>(),
      filledOrders = new Set<string>()
    const net = new Map<string, number>()
    let totalFees = 0,
      cash = 0
    for (const fill of state.fills) {
      const order = this.orders.get(fill.orderId)
      assert(
        validId(fill.id, 'f', state.counters.fill) &&
          !fillIds.has(fill.id) &&
          order &&
          order.status === 'filled' &&
          !filledOrders.has(fill.orderId) &&
          fill.qty === order.filledQty &&
          fill.price === order.filledPrice &&
          fill.bar === order.filledBar &&
          fill.time === order.filledTime &&
          fill.symbol === order.symbol &&
          fill.side === order.side &&
          ROLES.includes(fill.role) &&
          finite(fill.fee) &&
          fill.fee >= 0 &&
          finite(fill.cashDelta) &&
          (fill.reason === null || REASONS.includes(fill.reason)),
        'Invalid engine fill',
      )
      const spec = this.instruments.get(fill.symbol)!
      assert(near(fill.fee, (fill.qty * spec.feePerContract) / 2), 'Fill fee does not match pinned instrument')
      if (fill.role === 'entry') assert(fill.reason === null && near(fill.cashDelta, -fill.fee), 'Invalid entry cash')
      net.set(fill.symbol, (net.get(fill.symbol) ?? 0) + sign(fill.side) * fill.qty)
      totalFees += fill.fee
      cash += fill.cashDelta
      fillIds.add(fill.id)
      filledOrders.add(fill.orderId)
    }
    assert(
      [...this.orders.values()].filter((order) => order.status === 'filled').length === filledOrders.size,
      'Missing order fill',
    )
    for (const symbol of this.instruments.keys()) {
      const position = this.positions.get(symbol)
      assert(
        (net.get(symbol) ?? 0) === (position ? position.qty * sign(position.side) : 0),
        'Position does not match fill ledger',
      )
    }
    let gross = 0,
      tradeFees = 0
    const tradeIds = new Set<string>()
    for (const trade of state.trades) {
      assert(
        validId(trade.id, 't', state.counters.trade) &&
          !tradeIds.has(trade.id) &&
          validId(trade.positionId, 'p', state.counters.position) &&
          this.instruments.has(trade.symbol) &&
          ['long', 'short'].includes(trade.side) &&
          quantity(trade.qty) &&
          count(trade.entryBar) &&
          count(trade.exitBar) &&
          [
            trade.entryPrice,
            trade.exitPrice,
            trade.entryTime,
            trade.exitTime,
            trade.grossPnl,
            trade.fees,
            trade.pnl,
            trade.mae,
            trade.mfe,
          ].every(finite) &&
          trade.entryTime <= trade.exitTime &&
          trade.exitTime <= state.time &&
          trade.fees >= 0 &&
          REASONS.includes(trade.exitReason) &&
          (trade.rMultiple === null || finite(trade.rMultiple)) &&
          typeof trade.tag === 'string',
        'Invalid engine trade',
      )
      assert(
        near(
          trade.grossPnl,
          (trade.exitPrice - trade.entryPrice) *
            sign(trade.side) *
            trade.qty *
            this.instruments.get(trade.symbol)!.pointValue,
        ) && near(trade.pnl, trade.grossPnl - trade.fees),
        'Invalid trade accounting',
      )
      tradeIds.add(trade.id)
      gross += trade.grossPnl
      tradeFees += trade.fees
    }
    assert(
      state.trades.length === state.fills.filter((fill) => fill.role !== 'entry').length &&
        near(state.realizedGross, gross) &&
        near(state.fees, totalFees) &&
        near(state.balance, this.template.accountSize + cash) &&
        near(state.balance, this.template.accountSize + gross - totalFees) &&
        near(totalFees, tradeFees + [...this.positions.values()].reduce((sum, pos) => sum + pos.entryFee, 0)),
      'Engine ledger does not reconcile',
    )
    assert(
      state.risk.days.reduce((sum, day) => sum + day.fills, 0) === state.fills.length &&
        near(
          state.risk.days.reduce((sum, day) => sum + day.realizedPnl, 0),
          cash,
        ),
      'Risk ledger does not reconcile',
    )
    let previousEvent = 0
    for (const event of state.events) {
      assert(
        event &&
          count(event.id) &&
          event.id > previousEvent &&
          event.id <= state.counters.event &&
          count(event.bar) &&
          finite(event.time) &&
          event.time <= state.time &&
          EVENT_TYPES.includes(event.type) &&
          typeof event.message === 'string' &&
          (event.symbol === null || this.instruments.has(event.symbol)) &&
          (event.orderId === null || this.orders.has(event.orderId)),
        'Invalid engine event',
      )
      previousEvent = event.id
    }
    const closed = new Set<string>()
    for (const key of state.closedSessions) {
      parseDayKey(key)
      assert(
        !closed.has(key) &&
          sessionClose(key) <= state.time &&
          state.risk.days.some((day) => day.key === key && day.finalized),
        'Invalid closed session',
      )
      closed.add(key)
    }
    this.balance = state.balance
    this.realizedGross = state.realizedGross
    this.fees = state.fees
    this.bar = state.bar
    this.counters = { ...state.counters }
    this.fills = clone(state.fills)
    this.trades = clone(state.trades)
    this.events = clone(state.events)
    this.closedSessions = [...state.closedSessions]
    const account = this.account()
    assert(
      near(account.equity, state.risk.lastEquity) &&
        account.openContracts + this.reservations().qty <= this.template.maxContracts,
      'Restored account does not reconcile',
    )
    if (this.status !== 'active')
      assert(this.positions.size === 0 && ![...this.orders.values()].some(live), 'Locked state contains live risk')
  }
}

function priority(order: SimOrder): number {
  return order.role === 'stop' ? 0 : order.role === 'target' ? 1 : order.role === 'exit' ? 2 : 3
}

function validateAtm(atm: SimAtm | null | undefined): void {
  if (atm === null || atm === undefined) return
  assert(typeof atm === 'object', 'Invalid ATM settings')
  if (atm.breakEven !== null)
    assert(
      atm.breakEven &&
        count(atm.breakEven.triggerTicks) &&
        count(atm.breakEven.offsetTicks) &&
        atm.breakEven.offsetTicks <= atm.breakEven.triggerTicks,
      'Invalid break-even settings',
    )
  if (atm.trailing !== null)
    assert(
      atm.trailing &&
        count(atm.trailing.triggerTicks) &&
        quantity(atm.trailing.distanceTicks) &&
        count(atm.trailing.stepTicks),
      'Invalid trailing settings',
    )
}

function validateBracketShape(bracket: SimBracketInput, qty: number): void {
  assert(
    bracket &&
      typeof bracket === 'object' &&
      Array.isArray(bracket.targets) &&
      (bracket.stopLoss === null || finite(bracket.stopLoss)),
    'Invalid bracket',
  )
  let total = 0
  for (const target of bracket.targets) {
    assert(target && finite(target.price) && quantity(target.qty), 'Invalid target')
    total += target.qty
  }
  assert(total <= qty && (bracket.stopLoss !== null || total > 0), 'Invalid bracket quantities')
  validateAtm(bracket.atm)
  assert(!bracket.atm || bracket.stopLoss !== null, 'ATM requires a protective stop')
}

function validId(id: unknown, prefix: string, maximum: number): boolean {
  return (
    typeof id === 'string' &&
    new RegExp(`^${prefix}[1-9]\\d*$`).test(id) &&
    quantity(Number(id.slice(1))) &&
    Number(id.slice(1)) <= maximum
  )
}

function assertFiniteTree(value: unknown, seen = new Set<object>()): void {
  if (typeof value === 'number') assert(finite(value), 'Nonfinite engine state')
  if (typeof value === 'object' && value !== null) {
    assert(!seen.has(value), 'Cyclic engine state')
    seen.add(value)
    for (const child of Object.values(value)) assertFiniteTree(child, seen)
    seen.delete(value)
  }
}
