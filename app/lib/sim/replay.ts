import type { InstrumentSpec } from '~/domain/instruments/types'
import { assertValidInstrument } from '~/domain/instruments/types'
import { SimEngine } from '~/domain/sim/engine'
import { sessionClose, tradingDayKey } from '~/domain/sim/session'
import type { PropTemplate } from '~/domain/sim/types'
import { buildReplayMarket, REPLAY_BASE_SECONDS, revealedCount, type ReplayMarket } from './tape'
import type { ReplayCheckpoint, ReplayRun, SavedReplay } from './persistence'

function validateInstruments(specs: InstrumentSpec[], market: ReplayMarket): void {
  if (specs.length !== market.tapes.length) throw new Error('Replay instruments do not match pinned tapes')
  const seen = new Set<string>()
  for (const spec of specs) {
    assertValidInstrument(spec)
    if (
      seen.has(spec.symbol) ||
      !market.tapes.some((tape) => tape.symbol === spec.symbol) ||
      ![spec.tickSize, spec.tickValue, spec.pointValue, spec.feePerContract, spec.intradayMargin].every(
        Number.isFinite,
      ) ||
      spec.feePerContract < 0 ||
      spec.intradayMargin < 0 ||
      !Number.isInteger(spec.pricePrecision) ||
      spec.pricePrecision < 0 ||
      spec.pricePrecision > 8
    )
      throw new Error('Invalid pinned instrument')
    seen.add(spec.symbol)
  }
}

export class ReplaySession {
  readonly run: ReplayRun
  readonly market: ReplayMarket
  readonly engine: SimEngine
  private _cursor: number

  constructor(run: ReplayRun, template: PropTemplate, restored?: ReplayCheckpoint) {
    if (run.schemaVersion !== 1 || !run.id || !Array.isArray(run.tapes) || !Array.isArray(run.instruments)) {
      throw new Error('Invalid replay attempt')
    }
    this.run = structuredClone(run)
    this.market = buildReplayMarket(this.run.tapes)
    validateInstruments(this.run.instruments, this.market)
    if (
      !Number.isInteger(run.startIndex) ||
      run.startIndex < this.market.startIndex ||
      run.startIndex >= this.market.timeline.length - 1
    )
      throw new Error('Invalid replay start')

    if (restored) {
      if (
        restored.runId !== run.id ||
        !Number.isInteger(restored.cursor) ||
        restored.cursor < run.startIndex + 1 ||
        restored.cursor > this.market.timeline.length
      )
        throw new Error('Invalid replay cursor')
      this._cursor = restored.cursor
      this.engine = SimEngine.fromState(restored.engine, this.run.instruments)
      const snapshot = this.engine.snapshot()
      if (snapshot.time > this.time + REPLAY_BASE_SECONDS) throw new Error('Replay checkpoint is ahead of the tape')
      for (const tape of this.market.tapes) {
        const mark = snapshot.marks[tape.symbol]
        const count = revealedCount(tape.candles, this.time)
        const last = count > 0 ? tape.candles[count - 1]! : null
        if (!mark || !last || mark.bar !== count - 1 || mark.price !== last.close || mark.time !== last.time) {
          throw new Error('Replay marks do not match the pinned cursor')
        }
      }
    } else {
      this._cursor = run.startIndex + 1
      this.engine = new SimEngine({ instruments: this.run.instruments, template, time: this.time })
      const initial = this.market.tapes
        .map((tape) => {
          const index = revealedCount(tape.candles, this.time) - 1
          return { symbol: tape.symbol, candle: tape.candles[index]!, index }
        })
        .sort((a, b) => a.candle.time - b.candle.time || a.symbol.localeCompare(b.symbol))
      for (const context of initial) this.engine.prime(context)
    }
  }

  static restore(saved: SavedReplay): ReplaySession {
    // The constructor ignores this argument when restoring; rules come only from
    // the validated engine state, never today's editable preset catalog.
    return new ReplaySession(saved.run, {} as PropTemplate, saved.checkpoint)
  }

  get cursor(): number {
    return this._cursor
  }
  get time(): number {
    return this.market.timeline[this._cursor - 1]!
  }
  get ended(): boolean {
    return this._cursor >= this.market.timeline.length
  }

  step(count = 1): void {
    if (!Number.isInteger(count) || count < 1 || count > 10_000) return
    const end = Math.min(this._cursor + count, this.market.timeline.length)
    while (this._cursor < end) {
      const previous = this.time
      const time = this.market.timeline[this._cursor]!
      const close = sessionClose(tradingDayKey(previous))
      if (time >= close) this.engine.closeSession(close)
      // The stable symbol order is part of the OHLC simulation policy. Marks of
      // other instruments are held fixed while this instrument's path executes.
      for (const tape of this.market.tapes) {
        const index = revealedCount(tape.candles, time) - 1
        const candle = tape.candles[index]
        if (candle?.time === time) this.engine.onBar({ symbol: tape.symbol, candle, index })
      }
      this._cursor += 1
      if (time + REPLAY_BASE_SECONDS >= sessionClose(tradingDayKey(time))) {
        this.engine.closeSession(sessionClose(tradingDayKey(time)))
      }
    }
  }

  checkpoint(): ReplayCheckpoint {
    return { runId: this.run.id, cursor: this.cursor, engine: this.engine.exportState() }
  }
}
