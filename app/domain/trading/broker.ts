import { roundTo } from '~/domain/shared/math'
import type { InstrumentSpec } from '~/domain/instruments/types'
import type { Candle } from '~/domain/market/types'
import { evaluateRules, firstBreach, targetReached } from './rules'
import { riskPerContract } from './sizing'
import type {
  AccountSnapshot,
  BrokerEvent,
  BrokerUpdate,
  ExitReason,
  Order,
  PlaceOrderInput,
  Position,
  PropRules,
  Trade,
} from './types'

export type PlaceOrderResult =
  | { ok: true; order: Order; events: BrokerEvent[] }
  | { ok: false; error: string }

export interface Broker {
  placeOrder(input: PlaceOrderInput, markPrice: number, barIndex: number): PlaceOrderResult
  cancelOrder(id: string): boolean
  closePosition(markPrice: number, barIndex: number, reason?: ExitReason): Trade | null
  updateBrackets(stopLoss: number | null, takeProfit: number | null): boolean
  onBar(candle: Candle, index: number): BrokerUpdate
  prime(price: number, barIndex: number): void
  snapshot(): AccountSnapshot
  reset(rules?: PropRules): void
  getPosition(): Position | null
  getRules(): PropRules
}

export interface BrokerOptions {
  instrument: InstrumentSpec
  rules: PropRules
  feePerContract?: number
  requireStop?: boolean
}

interface ExitDecision {
  price: number
  reason: ExitReason
}

/**
 * Futures broker with bracket orders and prop-firm guardrails.
 * Fills are deliberately conservative: when a bar touches both the stop and
 * the target, the stop is assumed first, and gaps fill at the open.
 */
export function createBroker(options: BrokerOptions): Broker {
  const instrument = options.instrument
  const fee = options.feePerContract ?? instrument.feePerContract
  const requireStop = options.requireStop ?? true

  let rules = { ...options.rules }
  let balance = rules.accountSize
  let startBalance = rules.accountSize
  let peakEquity = rules.accountSize
  let markPrice = instrument.anchorPrice
  let position: Position | null = null
  let orders: Order[] = []
  let trades: Trade[] = []
  let realizedPnl = 0
  let feesPaid = 0
  let realizedR = 0
  let status: AccountSnapshot['status'] = 'active'
  let breach: AccountSnapshot['breach'] = null
  let lastBarIndex = 0
  let orderSeq = 0
  let tradeSeq = 0

  function nextOrderId() {
    orderSeq += 1
    return `ord-${orderSeq}`
  }

  function nextTradeId() {
    tradeSeq += 1
    return `trd-${tradeSeq}`
  }

  function unrealized(): number {
    if (!position) return 0
    const direction = position.side === 'long' ? 1 : -1
    return (markPrice - position.entryPrice) * direction * instrument.pointValue * position.qty
  }

  function equity(): number {
    return balance + unrealized()
  }

  function dailyPnl(): number {
    return equity() - startBalance
  }

  function ruleStatuses() {
    return evaluateRules(
      {
        equity: equity(),
        peakEquity,
        startBalance,
        dailyPnl: dailyPnl(),
        openContracts: position?.qty ?? 0,
        tradeCount: trades.length,
      },
      rules,
    )
  }

  function snapshot(): AccountSnapshot {
    const statuses = ruleStatuses()
    const openR = position && position.initialRisk > 0 ? unrealized() / position.initialRisk : 0
    const hasR = position != null || trades.length > 0
    return {
      startBalance,
      balance: roundTo(balance, 2),
      equity: roundTo(equity(), 2),
      peakEquity: roundTo(peakEquity, 2),
      unrealizedPnl: roundTo(unrealized(), 2),
      realizedPnl: roundTo(realizedPnl, 2),
      netPnl: roundTo(equity() - startBalance, 2),
      fees: roundTo(feesPaid, 2),
      dailyPnl: roundTo(dailyPnl(), 2),
      openContracts: position?.qty ?? 0,
      position: position ? { ...position } : null,
      orders: orders.map((order) => ({ ...order })),
      trades: trades.map((trade) => ({ ...trade })),
      markPrice,
      roundR: hasR ? roundTo(realizedR + openR, 2) : null,
      status,
      breach,
      rules,
      ruleStatuses: statuses,
    }
  }

  function validateBrackets(input: PlaceOrderInput, reference: number): string | null {
    const isLong = input.side === 'long'
    if (requireStop && input.stopLoss == null) return 'A stop loss is required on every trade.'
    if (input.stopLoss != null) {
      if (isLong && input.stopLoss >= reference) return 'Long stop must sit below the entry.'
      if (!isLong && input.stopLoss <= reference) return 'Short stop must sit above the entry.'
    }
    if (input.takeProfit != null) {
      if (isLong && input.takeProfit <= reference) return 'Long target must sit above the entry.'
      if (!isLong && input.takeProfit >= reference) return 'Short target must sit below the entry.'
    }
    if (input.stopLoss != null && input.takeProfit != null) {
      const risk = Math.abs(reference - input.stopLoss)
      const reward = Math.abs(input.takeProfit - reference)
      if (reward / risk < 0.25) return 'Target is closer than 0.25R. Place the invalidation first.'
    }
    return null
  }

  function openPosition(
    input: PlaceOrderInput,
    fillPrice: number,
    barIndex: number,
    orderId: string,
  ): BrokerEvent[] {
    const entryFee = (fee / 2) * input.qty
    balance -= entryFee
    feesPaid += entryFee
    const initialRisk =
      input.stopLoss == null
        ? entryFee
        : riskPerContract({ instrument, entry: fillPrice, stop: input.stopLoss, feePerContract: fee }) * input.qty
    position = {
      id: `pos-${orderId}`,
      side: input.side,
      qty: input.qty,
      entryPrice: fillPrice,
      entryBar: barIndex,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      initialRisk,
      entryFee,
      mae: 0,
      mfe: 0,
    }
    const events: BrokerEvent[] = []
    const order = orders.find((item) => item.id === orderId)
    if (order) events.push({ type: 'filled', order: { ...order } })
    return events
  }

  function realize(
    exitPrice: number,
    reason: ExitReason,
    barIndex: number,
    events: BrokerEvent[],
  ): Trade | null {
    if (!position) return null
    const direction = position.side === 'long' ? 1 : -1
    const exitFee = (fee / 2) * position.qty
    const grossPnl = (exitPrice - position.entryPrice) * direction * instrument.pointValue * position.qty
    balance += grossPnl - exitFee
    feesPaid += exitFee
    realizedPnl += grossPnl
    const pnl = grossPnl - position.entryFee - exitFee
    const rMultiple =
      position.initialRisk > 0 ? roundTo((grossPnl - position.entryFee - exitFee) / position.initialRisk, 2) : null
    if (rMultiple != null) realizedR += rMultiple
    const trade: Trade = {
      id: nextTradeId(),
      side: position.side,
      qty: position.qty,
      entryPrice: position.entryPrice,
      exitPrice,
      entryBar: position.entryBar,
      exitBar: barIndex,
      exitReason: reason,
      grossPnl: roundTo(grossPnl, 2),
      fees: roundTo(position.entryFee + exitFee, 2),
      pnl: roundTo(pnl, 2),
      rMultiple,
      mae: roundTo(position.mae, 2),
      mfe: roundTo(position.mfe, 2),
    }
    trades = [...trades, trade]
    position = null
    events.push({ type: 'exit', trade })
    return trade
  }

  function resolveExit(current: Position, candle: Candle): ExitDecision | null {
    const isLong = current.side === 'long'
    const stop = current.stopLoss
    const target = current.takeProfit

    if (isLong) {
      if (stop != null && candle.open <= stop) return { price: candle.open, reason: 'stop' }
      if (target != null && candle.open >= target) return { price: candle.open, reason: 'target' }
      const hitStop = stop != null && candle.low <= stop
      const hitTarget = target != null && candle.high >= target
      if (hitStop) return { price: stop, reason: 'stop' }
      if (hitTarget) return { price: target, reason: 'target' }
    } else {
      if (stop != null && candle.open >= stop) return { price: candle.open, reason: 'stop' }
      if (target != null && candle.open <= target) return { price: candle.open, reason: 'target' }
      const hitStop = stop != null && candle.high >= stop
      const hitTarget = target != null && candle.low <= target
      if (hitStop) return { price: stop, reason: 'stop' }
      if (hitTarget) return { price: target, reason: 'target' }
    }
    return null
  }

  function updateExcursions(current: Position, candle: Candle) {
    const direction = current.side === 'long' ? 1 : -1
    const adverse =
      direction === 1
        ? (current.entryPrice - candle.low) * instrument.pointValue * current.qty
        : (candle.high - current.entryPrice) * instrument.pointValue * current.qty
    const favorable =
      direction === 1
        ? (candle.high - current.entryPrice) * instrument.pointValue * current.qty
        : (current.entryPrice - candle.low) * instrument.pointValue * current.qty
    current.mae = Math.max(current.mae, adverse)
    current.mfe = Math.max(current.mfe, favorable)
  }

  function checkGuardrails(events: BrokerEvent[]) {
    const statuses = ruleStatuses()
    const breachStatus = firstBreach(statuses)
    if (breachStatus && status === 'active') {
      status = 'breached'
      breach = breachStatus.id
      events.push({
        type: 'breach',
        rule: breachStatus.id,
        message: `Account guardrail breached: ${breachStatus.id}.`,
      })
      if (position) {
        realize(markPrice, 'breach', lastBarIndex, events)
      }
      orders = orders.map((order) =>
        order.status === 'working' ? { ...order, status: 'cancelled', reason: 'Account breached' } : order,
      )
      return
    }
    if (targetReached(statuses) && status === 'active') {
      status = 'target'
      events.push({ type: 'target', netPnl: roundTo(equity() - startBalance, 2) })
    }
  }

  function placeOrder(input: PlaceOrderInput, mark: number, barIndex: number): PlaceOrderResult {
    if (status !== 'active') return { ok: false, error: 'Trading is locked for this account.' }
    if (position) return { ok: false, error: 'Close the open position before placing another order.' }
    if (mark <= 0) return { ok: false, error: 'No market price yet.' }
    if (!Number.isFinite(input.qty) || input.qty < 1 || !Number.isInteger(input.qty)) {
      return { ok: false, error: 'Quantity must be a whole number of contracts.' }
    }
    if (input.qty > rules.maxContracts) {
      return { ok: false, error: `Maximum ${rules.maxContracts} contracts on this account.` }
    }
    if (rules.maxTrades > 0 && trades.length >= rules.maxTrades) {
      return { ok: false, error: 'Round-trip limit reached for this session.' }
    }
    if (orders.some((order) => order.status === 'working')) {
      return { ok: false, error: 'Cancel the working order first.' }
    }

    markPrice = mark
    const reference = input.type === 'limit' && input.limitPrice != null ? input.limitPrice : mark
    const bracketError = validateBrackets(input, reference)
    if (bracketError) return { ok: false, error: bracketError }

    if (input.type === 'limit' && (input.limitPrice == null || input.limitPrice <= 0)) {
      return { ok: false, error: 'A limit price is required.' }
    }

    const order: Order = {
      id: nextOrderId(),
      side: input.side,
      type: input.type,
      qty: input.qty,
      limitPrice: input.type === 'limit' ? (input.limitPrice ?? null) : null,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      status: 'working',
      createdBar: barIndex,
      filledBar: null,
      filledPrice: null,
    }
    orders = [...orders, order]

    const marketable =
      input.type === 'market' ||
      (input.side === 'long' && (input.limitPrice ?? 0) >= mark) ||
      (input.side === 'short' && (input.limitPrice ?? 0) <= mark)

    if (marketable) {
      const fillPrice = mark
      order.status = 'filled'
      order.filledBar = barIndex
      order.filledPrice = fillPrice
      const events = openPosition(input, fillPrice, barIndex, order.id)
      checkGuardrails(events)
      return { ok: true, order: { ...order }, events }
    }

    return { ok: true, order: { ...order }, events: [] }
  }

  function cancelOrder(id: string): boolean {
    const order = orders.find((item) => item.id === id)
    if (!order || order.status !== 'working') return false
    order.status = 'cancelled'
    order.reason = 'Cancelled by trader'
    return true
  }

  function closePosition(mark: number, barIndex: number, reason: ExitReason = 'manual'): Trade | null {
    if (!position) return null
    markPrice = mark
    const events: BrokerEvent[] = []
    const trade = realize(mark, reason, barIndex, events)
    checkGuardrails(events)
    return trade
  }

  function updateBrackets(stopLoss: number | null, takeProfit: number | null): boolean {
    if (!position) return false
    const isLong = position.side === 'long'
    if (stopLoss != null && (isLong ? stopLoss >= markPrice : stopLoss <= markPrice)) return false
    if (takeProfit != null && (isLong ? takeProfit <= markPrice : takeProfit >= markPrice)) return false
    position.stopLoss = stopLoss
    position.takeProfit = takeProfit
    return true
  }

  function onBar(candle: Candle, index: number): BrokerUpdate {
    const events: BrokerEvent[] = []
    lastBarIndex = index
    markPrice = candle.close

    if (position) {
      updateExcursions(position, candle)
      const exit = resolveExit(position, candle)
      if (exit) realize(exit.price, exit.reason, index, events)
    }

    if (!position) {
      const working = orders.find((order) => order.status === 'working')
      if (working) {
        const triggered =
          working.side === 'long'
            ? candle.low <= (working.limitPrice ?? 0)
            : candle.high >= (working.limitPrice ?? 0)
        if (triggered) {
          const fillPrice =
            working.side === 'long'
              ? Math.min(working.limitPrice ?? markPrice, candle.open)
              : Math.max(working.limitPrice ?? markPrice, candle.open)
          working.status = 'filled'
          working.filledBar = index
          working.filledPrice = fillPrice
          events.push(...openPosition(working, fillPrice, index, working.id))
          const filledPosition = position
          if (filledPosition) {
            updateExcursions(filledPosition, candle)
            const exit = resolveExit(filledPosition, candle)
            if (exit) realize(exit.price, exit.reason, index, events)
          }
        }
      }
    }

    const equityNow = equity()
    peakEquity = Math.max(peakEquity, equityNow)
    checkGuardrails(events)

    return { events, snapshot: snapshot() }
  }

  function prime(price: number, barIndex: number) {
    markPrice = price
    lastBarIndex = barIndex
    peakEquity = Math.max(peakEquity, equity())
  }

  function reset(nextRules?: PropRules) {
    rules = { ...(nextRules ?? rules) }
    startBalance = rules.accountSize
    balance = startBalance
    peakEquity = startBalance
    markPrice = instrument.anchorPrice
    position = null
    orders = []
    trades = []
    realizedPnl = 0
    feesPaid = 0
    realizedR = 0
    status = 'active'
    breach = null
    lastBarIndex = 0
    orderSeq = 0
    tradeSeq = 0
  }

  return {
    placeOrder,
    cancelOrder,
    closePosition,
    updateBrackets,
    onBar,
    prime,
    snapshot,
    reset,
    getPosition: () => position,
    getRules: () => ({ ...rules }),
  }
}
