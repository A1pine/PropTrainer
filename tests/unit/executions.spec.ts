import { describe, expect, it } from 'vitest'
import { planExecutions, tradeExecutions } from '@/domain/trading/executions'
import type { PlanOutcome } from '@/domain/drill/plan'
import type { Candle } from '@/domain/market/types'
import type { Trade } from '@/domain/trading/types'

const candles: Candle[] = [1_700_000_000, 1_700_000_300, 1_700_260_000].map((time) => ({
  time,
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 100,
}))
const trade: Trade = {
  id: 'trade-1',
  side: 'long',
  qty: 1,
  entryPrice: 101.25,
  exitPrice: 99.5,
  entryBar: 1,
  exitBar: 2,
  exitReason: 'manual',
  grossPnl: -3.5,
  fees: 0,
  pnl: -3.5,
  rMultiple: -0.5,
  mae: 2,
  mfe: 0,
}
const outcome: PlanOutcome = {
  filled: true,
  entryBar: 1,
  entryPrice: 101.25,
  exitBar: 2,
  exitPrice: 99.5,
  exitReason: 'stop',
  rMultiple: -1,
  maeR: -1,
  mfeR: 0,
  barsToEntry: 1,
  barsHeld: 2,
}

describe('result executions', () => {
  it('uses broker fills and the indexed candle timestamps, including a session gap', () => {
    const executions = tradeExecutions([trade], candles)
    expect(executions).toEqual([
      {
        id: 'trade-1',
        side: 'long',
        entryPrice: 101.25,
        exitPrice: 99.5,
        entryBar: 1,
        exitBar: 2,
        entryTime: candles[1]!.time,
        exitTime: candles[2]!.time,
        exitReason: 'manual',
      },
    ])
    expect(executions[0]!.exitTime - executions[0]!.entryTime).not.toBe(300)
  })

  it('preserves all fills and their IDs rather than only the graded first trade', () => {
    const short: Trade = { ...trade, id: 'trade-2', side: 'short', entryBar: 2, exitBar: 2, exitReason: 'target' }
    expect(
      tradeExecutions([trade, short], candles).map(({ id, side, exitReason }) => ({ id, side, exitReason })),
    ).toEqual([
      { id: 'trade-1', side: 'long', exitReason: 'manual' },
      { id: 'trade-2', side: 'short', exitReason: 'target' },
    ])
  })

  it('does not fabricate a trade from a plan when the broker has no fills', () => {
    expect(tradeExecutions([], candles)).toEqual([])
  })

  it.each(['long', 'short'] as const)(
    'maps a filled %s drill outcome without changing execution prices',
    (direction) => {
      expect(planExecutions(outcome, direction, candles)[0]).toMatchObject({
        side: direction,
        entryBar: 1,
        entryPrice: outcome.entryPrice,
        exitBar: 2,
        exitPrice: outcome.exitPrice,
        exitReason: 'stop',
      })
    },
  )

  it('preserves timeout exits and same-bar fills, including zero and negative prices', () => {
    const result = planExecutions(
      { ...outcome, entryBar: 0, exitBar: 0, entryPrice: 0, exitPrice: -1.25, exitReason: 'timeout' },
      'short',
      candles,
    )
    expect(result[0]).toMatchObject({
      entryBar: 0,
      exitBar: 0,
      entryTime: candles[0]!.time,
      exitTime: candles[0]!.time,
      entryPrice: 0,
      exitPrice: -1.25,
      exitReason: 'timeout',
    })
    expect(tradeExecutions([{ ...trade, entryPrice: -5, exitPrice: 0 }], candles)).toHaveLength(1)
  })

  it('does not show a pending, unfilled or no-trade drill as a completed execution', () => {
    expect(planExecutions(null, 'long', candles)).toEqual([])
    expect(planExecutions(outcome, 'none', candles)).toEqual([])
    expect(planExecutions({ ...outcome, filled: false }, 'long', candles)).toEqual([])
    expect(planExecutions({ ...outcome, exitReason: 'no-entry' }, 'long', candles)).toEqual([])
    for (const key of ['entryBar', 'entryPrice', 'exitBar', 'exitPrice'] as const) {
      expect(planExecutions({ ...outcome, [key]: null }, 'long', candles)).toEqual([])
    }
  })

  it.each([
    { entryBar: -1 },
    { exitBar: 3 },
    { entryBar: 1.5 },
    { exitBar: 1.5 },
    { entryBar: 2, exitBar: 1 },
    { entryPrice: Number.NaN },
    { exitPrice: Number.POSITIVE_INFINITY },
  ])('ignores invalid execution coordinates: %j', (patch) => {
    expect(tradeExecutions([{ ...trade, ...patch }], candles)).toEqual([])
    expect(planExecutions({ ...outcome, ...patch }, 'long', candles)).toEqual([])
  })

  it('ignores missing or invalid candle times', () => {
    expect(tradeExecutions([trade], [])).toEqual([])
    expect(
      tradeExecutions(
        [trade],
        candles.map((candle) => ({ ...candle, time: Number.NaN })),
      ),
    ).toEqual([])
  })
})
