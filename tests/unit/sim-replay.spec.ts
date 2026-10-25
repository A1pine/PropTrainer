import { afterEach, describe, expect, it, vi } from 'vitest'
import { instruments } from '~/domain/instruments/catalog'
import type { Candle } from '~/domain/market/types'
import { cloneTemplate, templateById } from '~/domain/sim/presets'
import { chicagoToUnix, isMarketOpen, nextSessionOpen, sessionClose, sessionOpen } from '~/domain/sim/session'
import type { SimOrderInput } from '~/domain/sim/types'
import type { ReplayCheckpoint, ReplayRun, SavedReplay } from '~/lib/sim/persistence'
import { ReplaySession } from '~/lib/sim/replay'
import {
  buildReplayMarket,
  REPLAY_BASE_SECONDS,
  REPLAY_WARMUP,
  revealedCount,
  validReplayCandle,
  type ReplayTape,
} from '~/lib/sim/tape'

const DAY = '2026-10-19'
const OPEN = sessionOpen(DAY)
const CLOSE = sessionClose(DAY)
const MNQ = instruments.require('MNQ')
const MES = instruments.require('MES')

function tape(symbol = 'MNQ', bars = 320, omitted: number[] = [], startTime = OPEN): ReplayTape {
  let time = startTime
  const candles: Candle[] = []
  for (let index = 0; index < bars; index += 1) {
    if (!isMarketOpen(time)) time = nextSessionOpen(time)
    const open = (symbol === 'MNQ' ? 1_000 : 2_000) + index * 0.25
    if (!omitted.includes(index)) {
      candles.push({ time, open, high: open + 0.5, low: open - 0.5, close: open + 0.25, volume: 100 + index })
    }
    time += REPLAY_BASE_SECONDS
  }
  expect(candles.every(validReplayCandle)).toBe(true)
  return {
    symbol,
    source: 'synthetic',
    sourceSymbol: symbol,
    provenance: 'Deterministic replay regression fixture',
    fetchedAt: null,
    candles,
  }
}

function run(tapes = [tape('MES'), tape('MNQ')], startIndex?: number): ReplayRun {
  return {
    schemaVersion: 1,
    id: 'replay-regression',
    seed: 'replay-regression',
    createdAt: '2026-10-19T00:00:00.000Z',
    instruments: tapes.map((item) => instruments.require(item.symbol)),
    tapes,
    startIndex: startIndex ?? buildReplayMarket(tapes).startIndex,
  }
}

function session(attempt = run()): ReplaySession {
  return new ReplaySession(attempt, cloneTemplate(templateById('practice')!))
}

function submit(replay: ReplaySession, input: SimOrderInput, symbol = 'MNQ'): string {
  const result = replay.engine.submit(input, symbol)
  expect(result.ok).toBe(true)
  if (!result.ok || !result.orderId) throw new Error('Expected accepted replay order')
  return result.orderId
}

function saved(replay: ReplaySession): SavedReplay {
  return JSON.parse(JSON.stringify({ run: replay.run, checkpoint: replay.checkpoint() })) as SavedReplay
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReplaySession clock and revealed marks', () => {
  it('starts at startIndex + 1 and primes each symbol from its last revealed candle, including sparse tapes', () => {
    const attempt = run([tape('MES', 320, [0, 261]), tape('MNQ', 320, [260])])
    const replay = session(attempt)

    expect(attempt.startIndex).toBe(REPLAY_WARMUP)
    expect(replay.cursor).toBe(attempt.startIndex + 1)
    expect(replay.time).toBe(OPEN + 260 * REPLAY_BASE_SECONDS)
    expect(replay.engine.currentTime).toBe(replay.time)
    expect(replay.ended).toBe(false)
    for (const item of replay.market.tapes) {
      const revealed = item.candles.filter((candle) => candle.time <= replay.time)
      const last = revealed.at(-1)!
      expect(replay.engine.mark(item.symbol)).toEqual({ price: last.close, time: last.time, bar: revealed.length - 1 })
    }
    expect(replay.engine.mark('MNQ')!.time).toBe(replay.time - REPLAY_BASE_SECONDS)
    expect(replay.engine.mark('MES')!.time).toBe(replay.time)
    expect(replay.engine.snapshot()).toMatchObject({ orders: [], fills: [], positions: [], risk: { days: [] } })
  })

  it('advances one shared timeline entry and feeds only symbols with a candle at that time', () => {
    const replay = session(run([tape('MES', 320, [0, 261]), tape('MNQ', 320, [260])]))
    const initialCursor = replay.cursor
    const mesMark = replay.engine.mark('MES')!
    const orderId = submit(replay, { side: 'long', type: 'limit', qty: 1, limitPrice: mesMark.price + 10 }, 'MES')
    const advance = vi.spyOn(replay.engine, 'advance')

    replay.step()

    expect(replay.cursor).toBe(initialCursor + 1)
    expect(replay.time).toBe(OPEN + 261 * REPLAY_BASE_SECONDS)
    expect(advance).toHaveBeenCalledExactlyOnceWith({
      symbol: 'MNQ',
      candle: replay.market.tapes[1]!.candles[260],
      index: 260,
    })
    expect(replay.engine.mark('MNQ')).toMatchObject({ time: replay.time, bar: 260 })
    expect(replay.engine.mark('MES')).toEqual(mesMark)
    expect(replay.engine.snapshot().orders.find((order) => order.id === orderId)?.status).toBe('working')
    expect(replay.engine.snapshot().fills).toEqual([])

    advance.mockClear()
    replay.step()

    expect(replay.cursor).toBe(initialCursor + 2)
    expect(replay.time).toBe(OPEN + 262 * REPLAY_BASE_SECONDS)
    expect(
      advance.mock.calls.map(([context]) => ({
        symbol: context.symbol,
        index: context.index,
        time: context.candle.time,
      })),
    ).toEqual([
      { symbol: 'MES', index: 260, time: replay.time },
      { symbol: 'MNQ', index: 261, time: replay.time },
    ])
    expect(replay.engine.snapshot().fills).toHaveLength(1)
    expect(replay.engine.snapshot().fills[0]).toMatchObject({ orderId, symbol: 'MES', time: replay.time, bar: 260 })
    expect(replay.engine.mark('MES')!.price).toBe(replay.market.tapes[0]!.candles[260]!.close)
  })

  it.each(['mutate', 'replace'] as const)(
    'does not change any checkpoint or account state when hidden candles %s',
    (mode) => {
      const replay = session()
      submit(replay, { side: 'long', type: 'market', qty: 1 })
      submit(replay, { side: 'long', type: 'limit', qty: 1, limitPrice: 1_500, tif: 'gtc' }, 'MES')
      replay.step(2)
      const checkpoint = replay.checkpoint()
      const snapshot = replay.engine.snapshot()
      const time = replay.time
      expect(snapshot.orders).toHaveLength(2)
      expect(snapshot.fills).toHaveLength(1)
      expect(snapshot.risk.days).not.toEqual([])

      for (const item of replay.market.tapes) {
        const count = revealedCount(item.candles, time)
        expect(count).toBeLessThan(item.candles.length)
        const hidden = (candle: Candle): Candle => ({
          ...candle,
          open: 100_000,
          high: 200_000,
          low: -100_000,
          close: 150_000,
          volume: 1_000_000,
        })
        if (mode === 'replace') {
          item.candles = item.candles.map((candle, index) => (index < count ? candle : hidden(candle)))
        } else {
          for (const candle of item.candles.slice(count)) Object.assign(candle, hidden(candle))
        }
        expect(item.candles.every(validReplayCandle)).toBe(true)
      }

      expect(replay.cursor).toBe(checkpoint.cursor)
      expect(replay.time).toBe(time)
      expect(replay.checkpoint()).toEqual(checkpoint)
      expect(replay.engine.snapshot()).toEqual(snapshot)
      const restored = ReplaySession.restore(saved(replay))
      expect(restored.checkpoint()).toEqual(checkpoint)
      expect(restored.engine.snapshot()).toEqual(snapshot)
    },
  )

  it('produces identical full exported states for independent tapes and the same action script', () => {
    const first = session(run())
    const second = session(run())
    expect(first.run.tapes[0]!.candles).not.toBe(second.run.tapes[0]!.candles)
    const script = (replay: ReplaySession) => {
      const entry = replay.engine.mark('MNQ')!.price
      submit(replay, {
        side: 'long',
        type: 'market',
        qty: 2,
        bracket: { stopLoss: entry - 10, targets: [{ price: entry + 10, qty: 1 }] },
      })
      const pending = submit(replay, { side: 'long', type: 'limit', qty: 1, limitPrice: 1_500, tif: 'gtc' }, 'MES')
      replay.step(3)
      expect(replay.engine.modify(pending, { limitPrice: 1_600 }).ok).toBe(true)
      expect(replay.engine.cancel(pending).ok).toBe(true)
      expect(replay.engine.reverse('MNQ').ok).toBe(true)
      replay.step(2)
      replay.engine.flatten('MNQ')
      return replay.engine.exportState()
    }

    const firstState = script(first)
    const secondState = script(second)

    expect(firstState.fills).toHaveLength(4)
    expect(firstState.trades).toHaveLength(2)
    expect(firstState.orders.some((order) => order.status === 'cancelled')).toBe(true)
    expect(firstState.positions).toEqual([])
    expect(secondState).toEqual(firstState)
    expect(second.checkpoint()).toEqual(first.checkpoint())
  })

  it('ignores invalid step counts without moving the clock or accounting state', () => {
    const replay = session()
    const checkpoint = replay.checkpoint()
    for (const count of [0, -1, 1.5, NaN, Infinity, 10_001]) {
      replay.step(count)
      expect(replay.checkpoint()).toEqual(checkpoint)
    }
    replay.step()
    expect(replay.cursor).toBe(checkpoint.cursor + 1)
  })
})

describe('ReplaySession session boundaries and exhaustion', () => {
  it('closes positions and expires DAY orders at the scheduled close exactly once', () => {
    const replay = session(run([tape()], 274))
    expect(replay.time).toBe(CLOSE - 2 * REPLAY_BASE_SECONDS)
    submit(replay, { side: 'long', type: 'market', qty: 1 })
    const dayOrder = submit(replay, { side: 'long', type: 'limit', qty: 1, limitPrice: 500, tif: 'day' })
    const gtcOrder = submit(replay, { side: 'long', type: 'limit', qty: 1, limitPrice: 500, tif: 'gtc' })
    const closeSession = vi.spyOn(replay.engine, 'closeSession')

    replay.step()

    expect(closeSession).toHaveBeenCalledExactlyOnceWith(CLOSE)
    expect(replay.time).toBe(CLOSE - REPLAY_BASE_SECONDS)
    const boundary = replay.engine.snapshot()
    expect(boundary.time).toBe(CLOSE)
    expect(boundary.positions).toEqual([])
    expect(boundary.fills).toHaveLength(2)
    expect(boundary.fills.at(-1)).toMatchObject({
      reason: 'session-end',
      time: CLOSE,
      price: boundary.marks.MNQ!.price,
    })
    expect(boundary.trades).toHaveLength(1)
    expect(boundary.trades[0]).toMatchObject({ exitReason: 'session-end', exitTime: CLOSE })
    expect(boundary.orders.find((order) => order.id === dayOrder)).toMatchObject({
      status: 'expired',
      reason: 'session-end',
    })
    expect(boundary.orders.find((order) => order.id === gtcOrder)?.status).toBe('working')
    expect(boundary.risk.days.find((day) => day.key === DAY)).toMatchObject({ finalized: true, fills: 2, trades: 1 })
    expect(replay.engine.exportState().closedSessions).toEqual([DAY])
    expect(ReplaySession.restore(saved(replay)).checkpoint()).toEqual(replay.checkpoint())

    const checkpoint = replay.checkpoint()
    replay.engine.closeSession(CLOSE)
    expect(replay.checkpoint()).toEqual(checkpoint)

    replay.step()

    expect(closeSession).toHaveBeenCalledTimes(3)
    expect(replay.time).toBe(sessionOpen('2026-10-20'))
    const nextOpen = replay.engine.snapshot()
    expect(nextOpen.fills).toEqual(boundary.fills)
    expect(nextOpen.trades).toEqual(boundary.trades)
    expect(nextOpen.account.balance).toBe(boundary.account.balance)
    expect(nextOpen.events.filter((event) => event.type === 'session-close')).toHaveLength(1)
    expect(nextOpen.events.filter((event) => event.type === 'expired' && event.orderId === dayOrder)).toHaveLength(1)
    expect(nextOpen.risk.days.find((day) => day.key === DAY)).toEqual(boundary.risk.days.find((day) => day.key === DAY))
  })

  it('closes at the last known mark before processing a next-open gap when the closing candle is missing', () => {
    const replay = session(run([tape('MNQ', 320, [275])], 274))
    const previousMark = replay.engine.mark('MNQ')!
    submit(replay, { side: 'long', type: 'market', qty: 1 })
    const dayOrder = submit(replay, { side: 'long', type: 'limit', qty: 1, limitPrice: 500, tif: 'day' })
    const closeSession = vi.spyOn(replay.engine, 'closeSession')

    replay.step()

    expect(closeSession).toHaveBeenCalledExactlyOnceWith(CLOSE)
    expect(replay.time).toBe(sessionOpen('2026-10-20'))
    expect(replay.engine.mark('MNQ')!.price).not.toBe(previousMark.price)
    const snapshot = replay.engine.snapshot()
    expect(snapshot.positions).toEqual([])
    expect(snapshot.fills.at(-1)).toMatchObject({ reason: 'session-end', price: previousMark.price, time: CLOSE })
    expect(snapshot.orders.find((order) => order.id === dayOrder)?.status).toBe('expired')
    expect(snapshot.risk.days.find((day) => day.key === DAY)?.finalized).toBe(true)
  })

  it('clamps at tape exhaustion, marks ended, and does not invent a session close mid-session', () => {
    const replay = session(run([tape('MNQ', 300)], 298))
    submit(replay, { side: 'long', type: 'market', qty: 1 })
    const advance = vi.spyOn(replay.engine, 'advance')
    const closeSession = vi.spyOn(replay.engine, 'closeSession')
    expect(replay.ended).toBe(false)

    replay.step(10_000)

    expect(replay.cursor).toBe(replay.market.timeline.length)
    expect(replay.time).toBe(replay.market.timeline.at(-1))
    expect(replay.ended).toBe(true)
    expect(advance).toHaveBeenCalledTimes(1)
    expect(closeSession).not.toHaveBeenCalled()
    expect(replay.engine.position('MNQ')).not.toBeNull()
    const checkpoint = replay.checkpoint()
    expect(ReplaySession.restore(saved(replay)).ended).toBe(true)
    for (const count of [1, 2, 10_000]) {
      replay.step(count)
      expect(replay.checkpoint()).toEqual(checkpoint)
    }
    expect(advance).toHaveBeenCalledTimes(1)
  })
})

describe('ReplaySession checkpoint validation', () => {
  it('round-trips a newly primed final-candle checkpoint without closing the session', () => {
    const replay = session(run([tape()], 275))
    const checkpoint = replay.checkpoint()
    expect(replay.time).toBe(CLOSE - REPLAY_BASE_SECONDS)
    expect(checkpoint.engine.time).toBe(replay.time)
    expect(checkpoint.engine.closedSessions).toEqual([])
    expect(checkpoint.engine.risk.days).toEqual([])

    const restored = ReplaySession.restore(saved(replay))

    expect(restored.checkpoint()).toEqual(checkpoint)
    expect(restored.engine.snapshot()).toEqual(replay.engine.snapshot())
  })

  it('preserves trading at an initial final candle and closes it only on the first step', () => {
    const replay = session(run([tape()], 275))
    const mark = replay.engine.mark('MNQ')!
    submit(replay, { side: 'long', type: 'market', qty: 1 })
    const dayOrder = submit(replay, { side: 'long', type: 'limit', qty: 1, limitPrice: 500, tif: 'day' })
    const gtcOrder = submit(replay, { side: 'long', type: 'limit', qty: 1, limitPrice: 500, tif: 'gtc' })
    const checkpoint = replay.checkpoint()
    expect(checkpoint.engine.time).toBe(CLOSE - REPLAY_BASE_SECONDS)
    expect(checkpoint.engine.closedSessions).toEqual([])
    expect(checkpoint.engine.risk.days).toMatchObject([{ key: DAY, finalized: false }])

    const restored = ReplaySession.restore(saved(replay))
    expect(restored.checkpoint()).toEqual(checkpoint)
    expect(restored.engine.snapshot()).toEqual(replay.engine.snapshot())
    for (const active of [replay, restored]) {
      active.step()
      const state = active.engine.exportState()
      expect(state.time).toBe(sessionOpen('2026-10-20'))
      expect(state.marks.MNQ!.price).not.toBe(mark.price)
      expect(state.positions).toEqual([])
      expect(state.fills).toHaveLength(2)
      expect(state.fills.at(-1)).toMatchObject({ price: mark.price, time: CLOSE, reason: 'session-end' })
      expect(state.orders.find((order) => order.id === dayOrder)?.status).toBe('expired')
      expect(state.orders.find((order) => order.id === gtcOrder)?.status).toBe('working')
      expect(state.closedSessions).toEqual([DAY])
      expect(state.events.filter((event) => event.type === 'session-close')).toHaveLength(1)
      expect(state.risk.days.find((day) => day.key === DAY)).toMatchObject({ finalized: true, fills: 2, trades: 1 })
      const closed = active.checkpoint()
      active.engine.closeSession(CLOSE)
      expect(active.checkpoint()).toEqual(closed)
      expect(ReplaySession.restore(saved(active)).checkpoint()).toEqual(closed)
    }
    expect(restored.checkpoint()).toEqual(replay.checkpoint())
  })

  const clockCases: {
    name: string
    startTime: number
    time: number
    steppedTime?: number
    closedDay?: string
    omitted?: number[]
  }[] = [
    { name: 'ordinary intraday', startTime: OPEN, time: OPEN + 270 * REPLAY_BASE_SECONDS },
    { name: 'UTC midnight', startTime: OPEN, time: Date.parse('2026-10-20T00:00:00Z') / 1_000 },
    { name: 'Chicago midnight', startTime: OPEN, time: chicagoToUnix(2026, 10, 20, 0) },
    {
      name: 'daylight-time session close',
      startTime: OPEN,
      time: CLOSE - REPLAY_BASE_SECONDS,
      steppedTime: CLOSE,
      closedDay: DAY,
    },
    {
      name: 'standard-time session close',
      startTime: sessionOpen('2026-11-02'),
      time: sessionClose('2026-11-02') - REPLAY_BASE_SECONDS,
      steppedTime: sessionClose('2026-11-02'),
      closedDay: '2026-11-02',
    },
    {
      name: 'spring-forward weekend gap',
      startTime: sessionOpen('2026-03-06'),
      time: sessionOpen('2026-03-09'),
      closedDay: '2026-03-06',
    },
    {
      name: 'fall-back weekend gap',
      startTime: sessionOpen('2026-10-30'),
      time: sessionOpen('2026-11-02'),
      closedDay: '2026-10-30',
    },
    {
      name: 'intraday gap',
      startTime: OPEN,
      time: OPEN + 264 * REPLAY_BASE_SECONDS,
      omitted: [261, 262, 263],
    },
    {
      name: 'missing closing candle',
      startTime: OPEN,
      time: sessionOpen('2026-10-20'),
      closedDay: DAY,
      omitted: [275],
    },
  ]

  it.each(clockCases)('round-trips exact clocks at $name after construction and after step', (fixture) => {
    const { startTime, time, steppedTime = time, closedDay, omitted = [] } = fixture
    const tapes = [tape('MES', 600, omitted, startTime), tape('MNQ', 600, [0, ...omitted], startTime)]
    const market = buildReplayMarket(tapes)
    const index = market.timeline.indexOf(time)
    expect(index).toBeGreaterThan(market.startIndex)

    for (const stepped of [false, true]) {
      const replay = session(run(tapes, index - Number(stepped)))
      if (stepped) replay.step()
      expect(replay.cursor).toBe(index + 1)
      expect(replay.time).toBe(time)
      const checkpoint = replay.checkpoint()
      expect(checkpoint.engine.time).toBe(stepped ? steppedTime : time)
      expect(checkpoint.engine.risk.lastTime).toBe(checkpoint.engine.time)
      expect(checkpoint.engine.closedSessions).toEqual(stepped && closedDay ? [closedDay] : [])
      for (const item of replay.market.tapes) {
        const count = revealedCount(item.candles, time)
        const last = item.candles[count - 1]!
        expect(checkpoint.engine.marks[item.symbol]).toEqual({ price: last.close, time: last.time, bar: count - 1 })
      }
      const restored = ReplaySession.restore(saved(replay))
      expect(restored.checkpoint()).toEqual(checkpoint)
      expect(JSON.stringify(restored.checkpoint())).toBe(JSON.stringify(checkpoint))
      expect(restored.engine.snapshot()).toEqual(replay.engine.snapshot())
      replay.step(2)
      restored.step(2)
      expect(restored.checkpoint()).toEqual(replay.checkpoint())
      expect(ReplaySession.restore(saved(restored)).checkpoint()).toEqual(replay.checkpoint())
    }
  })

  it('round-trips the cursor, pinned rules, marks, account and live orders, then resumes identically', () => {
    const rules = {
      ...cloneTemplate(templateById('practice')!),
      id: 'retired-custom-preset',
      label: 'Pinned custom rules',
    }
    const replay = new ReplaySession(run(), rules)
    const entry = replay.engine.mark('MNQ')!.price
    submit(replay, {
      side: 'long',
      type: 'market',
      qty: 2,
      bracket: { stopLoss: entry - 10, targets: [{ price: entry + 10, qty: 1 }] },
    })
    submit(replay, { side: 'long', type: 'limit', qty: 1, limitPrice: 1_500, tif: 'gtc' }, 'MES')
    replay.step(2)
    const checkpoint = replay.checkpoint()
    expect(checkpoint.cursor).toBe(replay.cursor)
    expect(checkpoint.runId).toBe(replay.run.id)
    expect(checkpoint.engine).toEqual(replay.engine.exportState())

    const restored = ReplaySession.restore(saved(replay))

    expect(restored.run).not.toBe(replay.run)
    expect(restored.cursor).toBe(replay.cursor)
    expect(restored.time).toBe(replay.time)
    expect(restored.engine.templateSpec).toEqual(rules)
    expect(restored.engine.snapshot()).toEqual(replay.engine.snapshot())
    expect(restored.checkpoint()).toEqual(checkpoint)
    for (const active of [replay, restored]) {
      active.step(3)
      active.engine.flatten('MNQ')
    }
    expect(restored.engine.snapshot()).toEqual(replay.engine.snapshot())
    expect(restored.checkpoint()).toEqual(replay.checkpoint())
  })

  it.each([false, true])('does not read hidden prices at a final candle (stepped: %s)', (stepped) => {
    const replay = session(run([tape('MES', 320, [274]), tape('MNQ')], stepped ? 274 : 275))
    if (stepped) replay.step()
    const checkpoint = replay.checkpoint()
    const snapshot = replay.engine.snapshot()
    const changed = saved(replay)
    for (const item of changed.run.tapes) {
      const count = revealedCount(item.candles, replay.time)
      for (const candle of item.candles.slice(count)) {
        Object.assign(candle, { open: 100_000, high: 200_000, low: -100_000, close: 150_000, volume: 1_000_000 })
      }
      expect(item.candles.every(validReplayCandle)).toBe(true)
    }
    expect(session(changed.run).checkpoint()).toEqual(session(replay.run).checkpoint())
    const restored = ReplaySession.restore(changed)
    expect(restored.checkpoint()).toEqual(checkpoint)
    expect(restored.engine.snapshot()).toEqual(snapshot)
  })

  it.each([
    { name: 'intraday initial clock', startIndex: 270, steps: 0, offset: 1 },
    { name: 'initial final candle partway through the interval', startIndex: 275, steps: 0, offset: 1 },
    { name: 'initial final candle at an unprocessed close', startIndex: 275, steps: 0, offset: REPLAY_BASE_SECONDS },
    { name: 'intraday stepped clock', startIndex: 269, steps: 1, offset: 1 },
    { name: 'stepped final candle beyond the close', startIndex: 274, steps: 1, offset: 1 },
  ])('rejects an inexact $name', ({ startIndex, steps, offset }) => {
    const replay = session(run([tape()], startIndex))
    replay.step(steps)
    const changed = saved(replay)
    changed.checkpoint.engine.time += offset
    expect(() => ReplaySession.restore(changed)).toThrow('Replay checkpoint clock does not match the tape')
  })

  it('rejects an unclosed final candle at a stepped cursor instead of accepting either boundary clock', () => {
    const changed = saved(session(run([tape()], 275)))
    changed.run.startIndex = 274
    expect(() => ReplaySession.restore(changed)).toThrow('Replay checkpoint clock does not match the tape')
  })

  const corruptions: {
    name: string
    corrupt: (checkpoint: ReplayCheckpoint, replay: ReplaySession) => void
    error: string
  }[] = [
    {
      name: 'wrong run id',
      corrupt: (checkpoint) => {
        checkpoint.runId = 'another-run'
      },
      error: 'Invalid replay cursor',
    },
    {
      name: 'cursor before the start',
      corrupt: (checkpoint, replay) => {
        checkpoint.cursor = replay.run.startIndex
      },
      error: 'Invalid replay cursor',
    },
    {
      name: 'cursor past the end',
      corrupt: (checkpoint, replay) => {
        checkpoint.cursor = replay.market.timeline.length + 1
      },
      error: 'Invalid replay cursor',
    },
    {
      name: 'fractional cursor',
      corrupt: (checkpoint) => {
        checkpoint.cursor += 0.5
      },
      error: 'Invalid replay cursor',
    },
    {
      name: 'cursor ahead of its marks',
      corrupt: (checkpoint) => {
        checkpoint.cursor += 1
      },
      error: 'Replay marks do not match the pinned cursor',
    },
    {
      name: 'incorrect mark price',
      corrupt: (checkpoint) => {
        checkpoint.engine.marks.MNQ!.price += MNQ.tickSize
      },
      error: 'Replay marks do not match the pinned cursor',
    },
    {
      name: 'incorrect mark bar',
      corrupt: (checkpoint) => {
        checkpoint.engine.marks.MNQ!.bar -= 1
      },
      error: 'Replay marks do not match the pinned cursor',
    },
    {
      name: 'missing instrument mark',
      corrupt: (checkpoint) => {
        delete checkpoint.engine.marks[MES.symbol]
      },
      error: 'Replay marks do not match the pinned cursor',
    },
    {
      name: 'incorrect mark timestamp',
      corrupt: (checkpoint) => {
        checkpoint.engine.marks.MNQ!.time -= REPLAY_BASE_SECONDS
      },
      error: 'Replay marks do not match the pinned cursor',
    },
    {
      name: 'engine time ahead of the revealed interval',
      corrupt: (checkpoint, replay) => {
        checkpoint.engine.time = replay.time + REPLAY_BASE_SECONDS + 1
      },
      error: 'Replay checkpoint clock does not match the tape',
    },
  ]

  it.each(corruptions)('rejects a checkpoint with $name', ({ corrupt, error }) => {
    const replay = session()
    const original = replay.checkpoint()
    const checkpoint = structuredClone(original)
    corrupt(checkpoint, replay)

    expect(() => ReplaySession.restore({ run: replay.run, checkpoint })).toThrow(error)
    expect(replay.checkpoint()).toEqual(original)
  })
})
