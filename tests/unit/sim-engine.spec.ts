import { describe, expect, it } from 'vitest'
import { instruments } from '~/domain/instruments/catalog'
import type { InstrumentSpec } from '~/domain/instruments/types'
import { SimEngine } from '~/domain/sim/engine'
import { sessionClose, sessionOpen } from '~/domain/sim/session'
import type { PropTemplate, SimBarContext, SimEngineState, SimOrderInput } from '~/domain/sim/types'

const DAY = '2026-10-19'
const OPEN = sessionOpen(DAY)
const SPEC: InstrumentSpec = {
  ...instruments.require('MNQ'),
  symbol: 'TEST',
  tickSize: 1,
  tickValue: 1,
  pointValue: 1,
  pricePrecision: 0,
  feePerContract: 2,
  intradayMargin: 10,
}
const OTHER: InstrumentSpec = { ...SPEC, symbol: 'OTHER', pointValue: 2, tickValue: 2 }

function template(patch: Partial<PropTemplate> = {}): PropTemplate {
  return {
    id: 'test',
    label: 'Test',
    accountSize: 1_000,
    profitTarget: 0,
    drawdown: { mode: 'static', amount: 100, basis: 'equity', floorCap: null, includeUnrealized: true },
    dailyLoss: { amount: 0, action: 'warn' },
    maxContracts: 10,
    maxTradesPerDay: 0,
    minTradingDays: 0,
    consistency: null,
    ...patch,
  }
}

function bar(
  index: number,
  open = 100,
  high = open,
  low = open,
  close = open,
  symbol = SPEC.symbol,
  time = OPEN + index * 300,
): SimBarContext {
  return { symbol, index, candle: { time, open, high, low, close, volume: 0 } }
}

function setup(patch: Partial<PropTemplate> = {}, specs: InstrumentSpec[] = [SPEC]): SimEngine {
  const engine = new SimEngine({ instruments: specs, template: template(patch), time: OPEN })
  for (const spec of specs) engine.prime(bar(0, 100, 100, 100, 100, spec.symbol))
  return engine
}

function send(engine: SimEngine, order: Partial<SimOrderInput> = {}, symbol = SPEC.symbol): string {
  const result = engine.submit({ side: 'long', type: 'market', qty: 1, ...order }, symbol)
  expect(result.ok).toBe(true)
  if (!result.ok || !result.orderId) throw new Error('Expected accepted order')
  return result.orderId
}

function restored(engine: SimEngine, specs = [SPEC]): SimEngine {
  return SimEngine.fromState(JSON.parse(JSON.stringify(engine.exportState())) as SimEngineState, specs)
}

function assertLedger(engine: SimEngine): void {
  const snapshot = engine.snapshot()
  expect(snapshot.account.balance).toBeCloseTo(1_000 + snapshot.fills.reduce((sum, fill) => sum + fill.cashDelta, 0), 8)
  expect(snapshot.account.fees).toBeCloseTo(
    snapshot.fills.reduce((sum, fill) => sum + fill.fee, 0),
    8,
  )
  expect(snapshot.risk.days.reduce((sum, day) => sum + day.realizedPnl, 0)).toBeCloseTo(
    snapshot.account.balance - 1_000,
    8,
  )
  expect(restored(engine).snapshot()).toEqual(snapshot)
}

describe('declared OHLC path and causal protection', () => {
  it('fills a new limit and its stop in the same O-L-H-C bar, at touched prices rather than close', () => {
    const engine = setup()
    send(engine, { type: 'limit', limitPrice: 98, bracket: { stopLoss: 96, targets: [{ price: 104, qty: 1 }] } })
    engine.onBar(bar(1, 100, 106, 94, 103))
    expect(engine.snapshot().fills.map((fill) => [fill.price, fill.role, fill.bar])).toEqual([
      [98, 'entry', 1],
      [96, 'stop', 1],
    ])
    expect(engine.position(SPEC.symbol)).toBeNull()
    expect(engine.snapshot().trades[0]).toMatchObject({ pnl: -4, mae: -2, mfe: 0 })
    assertLedger(engine)
  })

  it('uses O-H-L-C for a down candle, so an earlier target beats a later stop', () => {
    const engine = setup()
    send(engine, { bracket: { stopLoss: 97, targets: [{ price: 104, qty: 1 }] } })
    engine.onBar(bar(1, 100, 106, 94, 99))
    expect(engine.snapshot().trades[0]).toMatchObject({ exitPrice: 104, exitReason: 'target' })
  })

  it('never applies a low that occurred before the stop entry activated the bracket', () => {
    const engine = setup()
    send(engine, { type: 'stop', stopPrice: 105, bracket: { stopLoss: 102, targets: [] } })
    engine.onBar(bar(1, 100, 108, 90, 106))
    expect(engine.position(SPEC.symbol)).toMatchObject({ avgPrice: 105, qty: 1, mae: 0, mfe: 3 })
    expect(engine.snapshot().trades).toHaveLength(0)
  })

  it('does not reuse a pre-trigger low for a buy stop-limit; fills on a later retrace only', () => {
    const engine = setup()
    const id = send(engine, { type: 'stop-limit', stopPrice: 105, limitPrice: 103 })
    engine.onBar(bar(1, 100, 108, 90, 106))
    expect(engine.position(SPEC.symbol)).toBeNull()
    expect(engine.snapshot().orders.find((order) => order.id === id)).toMatchObject({
      triggered: true,
      status: 'working',
    })
    const copy = restored(engine)
    engine.onBar(bar(2, 106, 107, 101, 104))
    copy.onBar(bar(2, 106, 107, 101, 104))
    expect(engine.snapshot().fills[0]?.price).toBe(103)
    expect(copy.exportState()).toEqual(engine.exportState())
  })

  it('allows trigger then limit on the same path without exceeding the limit across a gap', () => {
    const engine = setup()
    send(engine, { type: 'stop-limit', stopPrice: 105, limitPrice: 106 })
    engine.onBar(bar(1, 110, 112, 104, 111))
    expect(engine.snapshot().fills[0]?.price).toBe(106)
    const marketable = setup()
    send(marketable, { type: 'stop-limit', stopPrice: 105, limitPrice: 106 })
    marketable.onBar(bar(1, 100, 108, 99, 107))
    expect(marketable.snapshot().fills[0]?.price).toBe(105)
  })

  it('fills favorable limit gaps and adverse stop gaps at the open, not the old level', () => {
    const engine = setup()
    send(engine, { type: 'limit', limitPrice: 98, bracket: { stopLoss: 90, targets: [] } })
    engine.onBar(bar(1, 95, 96, 94, 95))
    engine.onBar(bar(2, 85, 92, 84, 91))
    expect(engine.snapshot().fills.map((fill) => fill.price)).toEqual([95, 85])
  })

  it('supports both trailing types and preserves a triggered limit across restore', () => {
    for (const type of ['trailing-stop', 'trailing-stop-limit'] as const) {
      const engine = setup()
      send(engine)
      send(engine, {
        side: 'short',
        type,
        trailTicks: 5,
        ...(type === 'trailing-stop-limit' ? { limitOffsetTicks: 1 } : {}),
      })
      engine.onBar(bar(1, 100, 110, 99, 108))
      const copy = restored(engine)
      engine.onBar(bar(2, 100, 106, 98, 104))
      copy.onBar(bar(2, 100, 106, 98, 104))
      expect(engine.snapshot().trades[0]?.exitPrice).toBe(type === 'trailing-stop' ? 100 : 104)
      expect(copy.exportState()).toEqual(engine.exportState())
    }
  })

  it('does not replay current-bar history for orders submitted after reveal', () => {
    const engine = setup()
    engine.onBar(bar(1, 100, 120, 80, 105))
    send(engine, { type: 'limit', limitPrice: 90 })
    expect(engine.snapshot().fills).toHaveLength(0)
    engine.onBar(bar(2, 105, 110, 100, 106))
    expect(engine.snapshot().fills).toHaveLength(0)
  })
})

describe('live risk transitions', () => {
  it('liquidates at the floor crossing even if the bar later recovers to a profit', () => {
    const engine = setup()
    send(engine)
    engine.onBar(bar(1, 100, 120, -20, 110))
    expect(engine.snapshot().trades[0]).toMatchObject({ exitPrice: 1, exitReason: 'breach' })
    expect(engine.snapshot().risk.breach?.equity).toBe(900)
    expect(engine.account().balance).toBe(899)
    expect(engine.mark(SPEC.symbol)?.price).toBe(110)
    expect(engine.status).toBe('breached')
  })

  it('evaluates a gap before a protective stop, rather than missing the breach after the exit', () => {
    const engine = setup()
    send(engine, { bracket: { stopLoss: 90, targets: [] } })
    engine.onBar(bar(1, -10, 120, -20, 110))
    expect(engine.snapshot().trades[0]).toMatchObject({ exitPrice: -10, exitReason: 'breach' })
    expect(engine.snapshot().risk.breach?.equity).toBe(889)
  })

  it('raises an intraday watermark on a favorable move and breaches on the later adverse leg', () => {
    const engine = setup({
      drawdown: { mode: 'trailing-intraday', amount: 10, basis: 'equity', floorCap: null, includeUnrealized: true },
    })
    send(engine)
    engine.onBar(bar(1, 100, 120, 90, 99))
    expect(engine.snapshot().risk.peakEquity).toBe(1_019)
    expect(engine.snapshot().trades[0]).toMatchObject({ exitPrice: 110, exitReason: 'breach' })
    expect(engine.account().balance).toBe(1_008)
  })

  it('lets an equity watermark breach a balance monitor on the favorable crossing', () => {
    const engine = setup({
      drawdown: { mode: 'trailing-intraday', amount: 10, basis: 'equity', floorCap: null, includeUnrealized: false },
    })
    send(engine)
    engine.onBar(bar(1, 100, 130, 99, 120))
    expect(engine.snapshot().trades[0]).toMatchObject({ exitPrice: 130, exitReason: 'breach' })
    expect(engine.account().balance).toBe(1_028)
  })

  it('evaluates entry fees immediately, including the forced-exit cost, and latches across restore', () => {
    const engine = setup({
      drawdown: { mode: 'static', amount: 1, basis: 'balance', floorCap: null, includeUnrealized: true },
    })
    send(engine)
    expect(engine.status).toBe('breached')
    expect(engine.account().balance).toBe(998)
    expect(engine.snapshot().trades[0]?.pnl).toBe(-2)
    const copy = restored(engine)
    copy.onBar(bar(1, 100, 1_000, 100, 1_000))
    expect(copy.status).toBe('breached')
    expect(copy.reverse(SPEC.symbol).ok).toBe(false)
    expect(copy.submit({ side: 'long', type: 'market', qty: 1 }, SPEC.symbol).ok).toBe(false)
    assertLedger(engine)
  })

  it.each(['warn', 'flatten', 'flatten-lock'] as const)('distinguishes daily %s behavior at the crossing', (action) => {
    const engine = setup({ dailyLoss: { amount: 10, action } })
    send(engine)
    engine.onBar(bar(1, 100, 101, 85, 100))
    if (action === 'warn') {
      expect(engine.position(SPEC.symbol)?.qty).toBe(1)
      expect(engine.snapshot().events.filter((event) => event.type === 'daily-warning')).toHaveLength(1)
    } else {
      expect(engine.snapshot().trades[0]?.exitPrice).toBe(91)
      expect(engine.position(SPEC.symbol)).toBeNull()
    }
    expect(engine.status).toBe(action === 'flatten-lock' ? 'daily-lock' : 'active')
    expect(engine.submit({ side: 'long', type: 'market', qty: 1 }, SPEC.symbol).ok).toBe(action !== 'flatten-lock')
    if (action === 'flatten-lock') {
      const copy = restored(engine)
      expect(copy.reverse(SPEC.symbol).ok).toBe(false)
      copy.onBar(bar(2, 100, 100, 100, 100, SPEC.symbol, sessionOpen('2026-10-20')))
      expect(copy.status).toBe('active')
    }
  })

  it('lets a daily flatten exit fee cause a permanent drawdown failure', () => {
    const engine = setup({
      dailyLoss: { amount: 10, action: 'flatten' },
      drawdown: {
        mode: 'static',
        amount: 11,
        basis: 'equity',
        floorCap: null,
        includeUnrealized: true,
      },
    })
    send(engine)
    engine.onBar(bar(1, 100, 101, 80, 100))
    expect(engine.status).toBe('breached')
    expect(engine.account().balance).toBe(989)
    expect(
      engine
        .snapshot()
        .events.filter((event) => ['daily-flatten', 'breach'].includes(event.type))
        .map((event) => event.type),
    ).toEqual(['daily-flatten', 'breach'])
  })
})

describe('quantities, independent exits, ATM and reservations', () => {
  it('executes every partial target at its exact quantity, retiring filled legs before sibling allocation', () => {
    const engine = setup()
    send(engine, {
      qty: 6,
      bracket: {
        stopLoss: 95,
        targets: [
          { price: 102, qty: 1 },
          { price: 104, qty: 2 },
          { price: 106, qty: 3 },
        ],
      },
    })
    engine.onBar(bar(1, 100, 103, 99, 102))
    expect(engine.position(SPEC.symbol)?.targets.map((leg) => leg.qty)).toEqual([2, 3])
    expect(engine.snapshot().orders.find((order) => order.status === 'working' && order.role === 'stop')?.qty).toBe(5)
    engine.onBar(bar(2, 102, 108, 101, 107))
    expect(engine.snapshot().trades.map((trade) => [trade.exitPrice, trade.qty])).toEqual([
      [102, 1],
      [104, 2],
      [106, 3],
    ])
    expect(engine.snapshot().orders.filter((order) => order.status === 'working')).toHaveLength(0)
    assertLedger(engine)
  })

  it('matches multiple manual exits, clamps siblings after reductions, and never reverses from reduce-only orders', () => {
    const engine = setup()
    send(engine, { qty: 3 })
    send(engine, { side: 'short', type: 'limit', qty: 1, limitPrice: 102, reduceOnly: true })
    send(engine, { side: 'short', type: 'limit', qty: 3, limitPrice: 104, reduceOnly: true })
    send(engine, { side: 'short', type: 'stop', qty: 3, stopPrice: 95, reduceOnly: true })
    engine.onBar(bar(1, 100, 105, 99, 104))
    expect(engine.snapshot().trades.map((trade) => trade.qty)).toEqual([1, 2])
    expect(engine.position(SPEC.symbol)).toBeNull()
    expect(engine.snapshot().orders.filter((order) => ['working', 'suspended'].includes(order.status))).toHaveLength(0)
    assertLedger(engine)
  })

  it('never recreates a cancelled protective stop through ATM', () => {
    const engine = setup()
    send(engine, {
      bracket: {
        stopLoss: 95,
        targets: [],
        atm: {
          breakEven: { triggerTicks: 2, offsetTicks: 0 },
          trailing: { triggerTicks: 4, distanceTicks: 2, stepTicks: 1 },
        },
      },
    })
    const id = engine.snapshot().orders.find((order) => order.role === 'stop')!.id
    expect(engine.cancel(id).ok).toBe(true)
    engine.onBar(bar(1, 100, 110, 99, 108))
    expect(engine.position(SPEC.symbol)?.stopLoss).toBeNull()
    expect(engine.snapshot().orders.filter((order) => order.role === 'stop')).toHaveLength(1)
    expect(engine.snapshot().orders.find((order) => order.id === id)?.status).toBe('cancelled')
  })

  it('tightens ATM on the favorable path and exits on the subsequent adverse path', () => {
    const engine = setup()
    send(engine, {
      bracket: {
        stopLoss: 90,
        targets: [],
        atm: {
          breakEven: { triggerTicks: 4, offsetTicks: 1 },
          trailing: { triggerTicks: 5, distanceTicks: 3, stepTicks: 1 },
        },
      },
    })
    engine.onBar(bar(1, 100, 110, 95, 99))
    expect(engine.snapshot().trades[0]).toMatchObject({ exitPrice: 107, exitReason: 'stop' })
  })

  it('reserves opposite pending entries gross, including suspended orders, at submission and amendment', () => {
    const engine = setup({ maxContracts: 3 })
    const id = send(engine, { type: 'limit', qty: 2, limitPrice: 90 })
    send(engine, { side: 'short', type: 'limit', limitPrice: 110, releaseAt: OPEN + 600 })
    expect(engine.submit({ side: 'long', type: 'limit', qty: 1, limitPrice: 80 }, SPEC.symbol).ok).toBe(false)
    expect(engine.modify(id, { qty: 3 }).ok).toBe(false)
    expect(engine.snapshot().orders.find((order) => order.id === id)?.qty).toBe(2)
  })

  it('reserves buying power and revalidates it at fill after another symbol loses value', () => {
    const expensive = { ...SPEC, intradayMargin: 400 }
    const engine = setup({}, [expensive, OTHER])
    const id = send(engine, { type: 'limit', qty: 2, limitPrice: 90 })
    expect(engine.modify(id, { qty: 3 }).ok).toBe(false)
    expect(engine.submit({ side: 'short', type: 'limit', qty: 1, limitPrice: 110 }, SPEC.symbol).ok).toBe(false)
    send(engine, { qty: 1 }, OTHER.symbol)
    engine.onBar(bar(1, 100, 100, 90, 90, OTHER.symbol))
    engine.onBar(bar(1, 100, 100, 90, 90))
    expect(engine.snapshot().orders.find((order) => order.id === id)?.status).toBe('filled')

    const tight = setup(
      { drawdown: { mode: 'static', amount: 500, basis: 'equity', floorCap: null, includeUnrealized: true } },
      [{ ...SPEC, intradayMargin: 480 }, OTHER],
    )
    const pending = send(tight, { type: 'limit', qty: 2, limitPrice: 90 })
    send(tight, {}, OTHER.symbol)
    tight.onBar(bar(1, 100, 100, 80, 80, OTHER.symbol))
    tight.onBar(bar(1, 100, 100, 90, 90))
    expect(tight.snapshot().orders.find((order) => order.id === pending)?.status).toBe('rejected')
    expect(tight.position(SPEC.symbol)).toBeNull()
  })

  it('uses symbol-local bars in fills and trades under a shared monotone clock', () => {
    const engine = setup({}, [SPEC, OTHER])
    send(engine, { type: 'limit', limitPrice: 99 })
    send(engine, { type: 'limit', limitPrice: 99 }, OTHER.symbol)
    engine.onBar(bar(20, 100, 101, 98, 100, SPEC.symbol, OPEN + 300))
    engine.onBar(bar(7, 100, 101, 98, 100, OTHER.symbol, OPEN + 300))
    engine.exitAll()
    expect(engine.snapshot().fills.map((fill) => [fill.symbol, fill.bar])).toEqual([
      ['TEST', 20],
      ['OTHER', 7],
      ['TEST', 20],
      ['OTHER', 7],
    ])
    expect(engine.snapshot().trades.map((trade) => [trade.entryBar, trade.exitBar])).toEqual([
      [20, 20],
      [7, 7],
    ])
    expect(restored(engine, [SPEC, OTHER]).exportState()).toEqual(engine.exportState())
    expect(() => engine.onBar(bar(8, 100, 100, 100, 100, OTHER.symbol, OPEN + 299))).toThrow(/backwards/)
  })
})

describe('order validation and time in force', () => {
  it('releases a suspended market order only on the first eligible symbol bar, with expiry winning ties', () => {
    const engine = setup()
    const id = send(engine, { releaseAt: OPEN + 600, tif: 'gtc' })
    engine.onBar(bar(1, 101))
    expect(engine.snapshot().fills).toHaveLength(0)
    engine.onBar(bar(2, 103))
    expect(engine.snapshot().orders.find((order) => order.id === id)).toMatchObject({ filledPrice: 103, filledBar: 2 })

    const expired = setup()
    send(expired, { releaseAt: OPEN + 600, expiresAt: OPEN + 600, tif: 'gtd' })
    expired.onBar(bar(2, 103))
    expect(expired.snapshot().fills).toHaveLength(0)
    expect(expired.snapshot().orders[0]?.status).toBe('expired')
  })

  it('restores a released market order after another symbol advanced the shared clock', () => {
    const engine = setup({}, [SPEC, OTHER])
    const id = send(engine, { releaseAt: OPEN + 600, tif: 'gtc' }, OTHER.symbol)
    engine.onBar(bar(2, 100, 100, 100, 100, SPEC.symbol, OPEN + 600))
    expect(engine.snapshot().orders.find((order) => order.id === id)?.status).toBe('working')
    expect(engine.snapshot().fills).toHaveLength(0)

    const restoredEngine = restored(engine, [SPEC, OTHER])
    restoredEngine.onBar(bar(1, 103, 103, 103, 103, OTHER.symbol, OPEN + 600))
    expect(restoredEngine.snapshot().orders.find((order) => order.id === id)).toMatchObject({
      filledPrice: 103,
      filledBar: 1,
      releaseAt: OPEN + 600,
    })
  })

  it('accepts finite signed and zero prices for energy-style contracts', () => {
    const engine = setup()
    send(engine, { type: 'limit', limitPrice: 0, bracket: { stopLoss: -3, targets: [{ price: 2, qty: 1 }] } })
    engine.onBar(bar(1, 1, 3, -1, 2))
    expect(engine.snapshot().fills.map((fill) => fill.price)).toEqual([0, 2])
    send(engine, { type: 'limit', limitPrice: -5 })
    engine.onBar(bar(2, -6, -4, -7, -6))
    expect(engine.position(SPEC.symbol)?.avgPrice).toBe(-6)
  })

  it.each([
    { qty: 1.5 },
    { qty: Number.NaN },
    { qty: Number.POSITIVE_INFINITY },
    { qty: 0 },
    { type: 'limit', limitPrice: Number.NaN },
    { type: 'stop', stopPrice: Number.NEGATIVE_INFINITY },
    { type: 'limit' },
    { type: 'stop-limit', stopPrice: 105 },
    { type: 'trailing-stop', trailTicks: 0 },
    { type: 'trailing-stop-limit', trailTicks: 5, limitOffsetTicks: -1 },
    { tif: 'ioc' },
    { tif: null },
    { tif: 'gtd' },
    { tif: 'gtd', expiresAt: OPEN },
    { tif: 'gtc', expiresAt: OPEN + 600 },
    { releaseAt: Number.NaN },
    { releaseAt: OPEN + 900, tif: 'gtd', expiresAt: OPEN + 600 },
    { bracket: false },
    { bracket: { stopLoss: 99, targets: [{ price: 105, qty: 2 }] } },
    { bracket: { stopLoss: 101, targets: [] } },
    { bracket: { stopLoss: 99, targets: [{ price: 98, qty: 1 }] } },
    { bracket: { stopLoss: 99, targets: [], atm: { breakEven: { triggerTicks: 1, offsetTicks: 2 }, trailing: null } } },
    {
      bracket: {
        stopLoss: 99,
        targets: [],
        atm: { breakEven: null, trailing: { triggerTicks: 1, distanceTicks: Number.NaN, stepTicks: 1 } },
      },
    },
    { reduceOnly: true },
  ])('rejects malformed input without a partial order or fee: %j', (patch) => {
    const engine = setup()
    const before = engine.exportState()
    expect(engine.submit({ side: 'long', type: 'market', qty: 1, ...patch } as SimOrderInput, SPEC.symbol).ok).toBe(
      false,
    )
    expect(engine.exportState()).toEqual(before)
  })

  it('validates modifications atomically, including price, quantity and bracket allocation', () => {
    const engine = setup()
    const id = send(engine, {
      type: 'limit',
      qty: 2,
      limitPrice: 95,
      bracket: { stopLoss: 90, targets: [{ price: 105, qty: 2 }] },
    })
    const before = engine.exportState()
    for (const patch of [
      { qty: 1 },
      { qty: 1.5 },
      { limitPrice: Number.NaN },
      { limitPrice: null },
      { limitPrice: 89 },
    ]) {
      expect(engine.modify(id, patch).ok).toBe(false)
      expect(engine.exportState()).toEqual(before)
    }
  })
})

describe('explicit session accounting and persistence', () => {
  it('primes warmup marks without matching, events, days, fees or a backwards global clock', () => {
    const engine = new SimEngine({ instruments: [SPEC, OTHER], template: template(), time: OPEN + 600 })
    engine.prime(bar(20, 100, 120, 80, 105, SPEC.symbol, OPEN))
    engine.prime(bar(7, 100, 110, 90, 102, OTHER.symbol, OPEN + 300))
    expect(engine.currentTime).toBe(OPEN + 600)
    expect(engine.snapshot().risk.days).toEqual([])
    expect(engine.snapshot().events).toEqual([])
    expect(engine.snapshot().fills).toEqual([])
    expect(engine.account().fees).toBe(0)
    expect(restored(engine, [SPEC, OTHER]).exportState()).toEqual(engine.exportState())
  })

  it('deeply isolates inputs, snapshots, exports, template getters and restored state', () => {
    const config = template()
    const spec = { ...SPEC }
    const engine = new SimEngine({ instruments: [spec], template: config, time: OPEN })
    engine.prime(bar(0))
    const bracket = {
      stopLoss: 95,
      targets: [{ price: 105, qty: 1 }],
      atm: { breakEven: { triggerTicks: 3, offsetTicks: 1 }, trailing: null },
    }
    send(engine, { bracket })
    const expected = engine.exportState()
    config.drawdown.amount = 1
    spec.feePerContract = 200
    bracket.targets[0]!.price = 500
    const snapshot = engine.snapshot()
    snapshot.positions[0]!.targets[0]!.price = 900
    snapshot.orders[0]!.bracket!.atm!.breakEven!.triggerTicks = 0
    snapshot.risk.template.drawdown.amount = 1
    snapshot.marks.TEST!.price = 1
    engine.templateSpec.drawdown.amount = 1
    const state = engine.exportState()
    const copy = SimEngine.fromState(state, [SPEC])
    state.positions[0]!.atm!.breakEven!.triggerTicks = 0
    state.template.drawdown.amount = 1
    expect(engine.exportState()).toEqual(expected)
    expect(copy.exportState()).toEqual(expected)
    engine.onBar(bar(1, 100, 104, 99, 103))
    copy.onBar(bar(1, 100, 104, 99, 103))
    expect(copy.exportState()).toEqual(engine.exportState())
  })

  it('books scheduled close fees to the prior ledger before EOD trailing, preserves GTC and is idempotent', () => {
    const engine = setup({
      drawdown: { mode: 'trailing-eod', amount: 100, basis: 'balance', floorCap: null, includeUnrealized: true },
    })
    send(engine)
    const gtc = send(engine, { type: 'limit', limitPrice: 50, tif: 'gtc' })
    const day = send(engine, { type: 'limit', limitPrice: 40, tif: 'day' })
    engine.onBar(bar(1, 100, 120, 100, 120))
    engine.closeSession(sessionClose(DAY))
    const snapshot = engine.snapshot()
    expect(snapshot.trades[0]).toMatchObject({
      exitPrice: 120,
      exitReason: 'session-end',
      exitTime: sessionClose(DAY),
      pnl: 18,
    })
    expect(snapshot.risk.days).toEqual([
      expect.objectContaining({ key: DAY, realizedPnl: 18, fills: 2, finalized: true }),
    ])
    expect(snapshot.risk.floor).toBe(918)
    expect(snapshot.orders.find((order) => order.id === gtc)?.status).toBe('working')
    expect(snapshot.orders.find((order) => order.id === day)?.status).toBe('expired')
    expect(engine.closeSession(sessionClose(DAY))).toEqual(snapshot)
    expect(snapshot.events.at(-1)?.message).toContain('last-known marks')
    assertLedger(engine)
  })

  it('detects a session close fee breach before finalization', () => {
    const engine = setup({
      drawdown: { mode: 'static', amount: 2, basis: 'balance', floorCap: null, includeUnrealized: true },
    })
    send(engine)
    engine.closeSession(sessionClose(DAY))
    expect(engine.status).toBe('breached')
    expect(engine.snapshot().risk.days[0]).toMatchObject({ realizedPnl: -2, finalized: true })
    assertLedger(engine)
  })

  it('does not pass mid-session or silently finalize an incomplete day on the next open', () => {
    const engine = setup({ profitTarget: 5, minTradingDays: 1 })
    send(engine)
    engine.onBar(bar(1, 100, 110, 100, 110))
    engine.exitAll()
    expect(engine.status).toBe('active')
    expect(engine.snapshot().ruleStatuses.find((rule) => rule.id === 'profit')?.state).toBe('gated')
    engine.onBar(bar(2, 110, 110, 110, 110, SPEC.symbol, sessionOpen('2026-10-20')))
    expect(engine.snapshot().risk.days[0]?.finalized).toBe(false)
    expect(engine.status).toBe('active')
    expect(restored(engine).status).toBe('active')

    const completed = setup({ profitTarget: 5, minTradingDays: 1 })
    send(completed)
    completed.onBar(bar(1, 100, 110, 100, 110))
    completed.closeSession(sessionClose(DAY))
    expect(completed.status).toBe('target')
    expect(restored(completed).status).toBe('target')
  })

  it('keeps delayed GTC market orders restorable at a scheduled close without filling in the break', () => {
    const engine = setup()
    send(engine, { tif: 'gtc', releaseAt: OPEN + 600 })
    engine.closeSession(sessionClose(DAY))
    expect(engine.snapshot().fills).toHaveLength(0)
    const copy = restored(engine)
    copy.onBar(bar(1, 110, 110, 110, 110, SPEC.symbol, sessionOpen('2026-10-20')))
    expect(copy.snapshot().fills[0]?.price).toBe(110)
  })

  it.each([
    (state: SimEngineState) => {
      state.schemaVersion = 2 as 1
    },
    (state: SimEngineState) => {
      state.balance += 1
    },
    (state: SimEngineState) => {
      state.marks.TEST!.price = Number.NaN
    },
    (state: SimEngineState) => {
      state.counters.order = 0
    },
    (state: SimEngineState) => {
      state.positions[0]!.qty += 1
    },
    (state: SimEngineState) => {
      state.orders.push(structuredClone(state.orders[0]!))
    },
    (state: SimEngineState) => {
      state.fills[0]!.fee = 0
    },
    (state: SimEngineState) => {
      state.risk.status = 'breached'
    },
    (state: SimEngineState) => {
      state.closedSessions.push(DAY)
    },
    (state: SimEngineState) => {
      state.risk.days[0]!.endBalance = 'bad' as unknown as number
    },
  ])('rejects corrupt checkpoints rather than partially restoring them', (corrupt) => {
    const engine = setup()
    send(engine)
    const state = engine.exportState()
    corrupt(state)
    expect(() => SimEngine.fromState(state, [SPEC])).toThrow()
  })
})
