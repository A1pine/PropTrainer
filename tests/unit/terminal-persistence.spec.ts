import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, markRaw, nextTick, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { createPinia, defineStore, disposePinia, setActivePinia } from 'pinia'
import { instruments } from '~/domain/instruments/catalog'
import type { Candle } from '~/domain/market/types'
import { cloneTemplate, templateById } from '~/domain/sim/presets'
import { isMarketOpen, nextSessionOpen, sessionOpen } from '~/domain/sim/session'
import { TERMINAL_TIMEFRAMES } from '~/domain/sim/timeframe'
import * as persistence from '~/lib/sim/persistence'
import type { ReplayRepository, ReplayRun, SavedReplay } from '~/lib/sim/persistence'
import { ReplaySession } from '~/lib/sim/replay'
import {
  buildReplayMarket,
  REPLAY_BASE_SECONDS,
  revealedCount,
  validReplayCandle,
  type ReplayTape,
} from '~/lib/sim/tape'

vi.stubGlobal('defineStore', defineStore)
const { useTerminalStore } = await import('~/stores/terminal')

function fixture(id = 'terminal-persistence', startIndex?: number): ReplaySession {
  const tapes: ReplayTape[] = ['MES', 'MNQ'].map((symbol) => {
    let time = sessionOpen('2026-10-19')
    const candles: Candle[] = Array.from({ length: 320 }, (_, index) => {
      if (!isMarketOpen(time)) time = nextSessionOpen(time)
      const open = (symbol === 'MNQ' ? 1_000 : 2_000) + index * 0.25
      const candle = { time, open, high: open + 0.5, low: open - 0.5, close: open + 0.25, volume: 100 + index }
      time += REPLAY_BASE_SECONDS
      return candle
    })
    expect(candles.every(validReplayCandle)).toBe(true)
    return {
      symbol,
      source: 'synthetic',
      sourceSymbol: symbol,
      provenance: 'Persistence regression fixture',
      fetchedAt: null,
      candles,
    }
  })
  const run: ReplayRun = {
    schemaVersion: 1,
    id,
    seed: 'terminal-regression-seed',
    createdAt: '2026-10-19T00:00:00.000Z',
    instruments: tapes.map((tape) => instruments.require(tape.symbol)),
    tapes,
    startIndex: startIndex ?? buildReplayMarket(tapes).startIndex,
  }
  return new ReplaySession(run, cloneTemplate(templateById('practice')!))
}

let pinia: ReturnType<typeof createPinia>
let repository: ReplayRepository

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
  for (const [name, value] of Object.entries({
    defineStore,
    ref,
    shallowRef,
    computed,
    markRaw,
    watch,
    onScopeDispose,
  })) {
    vi.stubGlobal(name, value)
  }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/test-market/' } }))
  vi.stubGlobal('useSettingsStore', () => ({ settings: { dataSource: 'synthetic' } }))
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() })
  pinia = createPinia()
  setActivePinia(pinia)
  repository = persistence.createMemoryReplayRepository()
  vi.spyOn(persistence, 'createReplayRepository').mockReturnValue(repository)
})

afterEach(() => {
  disposePinia(pinia)
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function initializeStore(replay = fixture()) {
  await repository.create(replay.run, replay.checkpoint())
  const store = useTerminalStore()
  await store.initialize()
  expect(store.ready).toBe(true)
  expect(store.restoreBlocked).toBe(false)
  return store
}

function accounting(store: ReturnType<typeof useTerminalStore>) {
  return structuredClone({
    cursor: store.cursor,
    replayTime: store.replayTime,
    knownTime: store.knownTime,
    snapshot: store.snapshot,
  })
}

describe('createMemoryReplayRepository', () => {
  it('loads null before any attempt has been created', async () => {
    expect(await repository.load()).toBeNull()
  })

  it('creates and loads the same pinned run and checkpoint without sharing caller-owned objects', async () => {
    const replay = fixture()
    const run = structuredClone(replay.run)
    const checkpoint = replay.checkpoint()
    const expected: SavedReplay = structuredClone({ run, checkpoint })

    await repository.create(run, checkpoint)
    const loaded = await repository.load()

    expect(loaded).toEqual(expected)
    expect(loaded!.run).not.toBe(run)
    expect(loaded!.run.tapes[0]!.candles).not.toBe(run.tapes[0]!.candles)
    expect(loaded!.checkpoint).not.toBe(checkpoint)
    run.tapes[0]!.candles[0]!.close = -123
    checkpoint.engine.balance = -456
    loaded!.run.seed = 'caller-edited-seed'
    loaded!.checkpoint.cursor = 1
    expect(await repository.load()).toEqual(expected)
  })

  it('saves only the checkpoint and clones it while leaving the pinned run unchanged', async () => {
    const replay = fixture()
    const pinned = structuredClone(replay.run)
    await repository.create(replay.run, replay.checkpoint())
    expect(replay.engine.submit({ side: 'long', type: 'market', qty: 1 }, 'MNQ').ok).toBe(true)
    replay.step(2)
    const checkpoint = replay.checkpoint()
    const expected = structuredClone(checkpoint)
    replay.run.seed = 'must-not-replace-pinned-seed'

    await repository.save(checkpoint)
    checkpoint.engine.orders[0]!.tag = 'changed-after-save'
    checkpoint.cursor += 1

    expect(await repository.load()).toEqual({ run: pinned, checkpoint: expected })
  })

  it('replaces the active attempt on create and never reactivates an old run when that run is saved', async () => {
    const first = fixture('first-attempt')
    const second = fixture('replacement-attempt', 265)
    await repository.create(first.run, first.checkpoint())
    await repository.create(second.run, second.checkpoint())
    expect(await repository.load()).toEqual({ run: second.run, checkpoint: second.checkpoint() })

    first.step(2)
    await repository.save(first.checkpoint())

    expect(await repository.load()).toEqual({ run: second.run, checkpoint: second.checkpoint() })
  })

  it('does not overwrite pinned data when an existing run id is created again', async () => {
    const replay = fixture()
    await repository.create(replay.run, replay.checkpoint())
    const original = await repository.load()
    replay.step()

    await expect(repository.create(replay.run, replay.checkpoint())).rejects.toThrow('Replay attempt already exists')
    expect(await repository.load()).toEqual(original)
  })

  it('rejects checkpoints for an unknown run without creating an active attempt', async () => {
    const replay = fixture()
    await expect(repository.save(replay.checkpoint())).rejects.toThrow('Replay attempt not found')
    expect(await repository.load()).toBeNull()
  })

  it('preserves invocation order for concurrent saves and loads the later complete checkpoint', async () => {
    const replay = fixture()
    const pinned = structuredClone(replay.run)
    await repository.create(replay.run, replay.checkpoint())
    replay.step()
    const earlier = replay.checkpoint()
    expect(replay.engine.submit({ side: 'long', type: 'market', qty: 1 }, 'MNQ').ok).toBe(true)
    replay.step(2)
    const later = replay.checkpoint()
    expect(later.cursor).toBeGreaterThan(earlier.cursor)
    expect(later.engine.fills).toHaveLength(1)
    expect(earlier.engine.fills).toEqual([])

    await Promise.all([repository.save(earlier), repository.save(later)])

    const loaded = await repository.load()
    expect(loaded).toEqual({ run: pinned, checkpoint: later })
    expect(ReplaySession.restore(loaded!).engine.snapshot()).toEqual(replay.engine.snapshot())
  })
})

describe('terminal store persistence and revealed chart state', () => {
  it('restores the saved clock and account rather than creating a new attempt, and persists the next step', async () => {
    const replay = fixture()
    expect(replay.engine.submit({ side: 'long', type: 'market', qty: 1 }, 'MNQ').ok).toBe(true)
    expect(replay.engine.submit({ side: 'long', type: 'limit', qty: 1, limitPrice: 1_500, tif: 'gtc' }, 'MES').ok).toBe(
      true,
    )
    replay.step(2)
    await repository.create(replay.run, replay.checkpoint())
    const create = vi.spyOn(repository, 'create')
    const save = vi.spyOn(repository, 'save')
    const store = useTerminalStore()

    await store.initialize()

    expect(create).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(store.run).toEqual(replay.run)
    expect(store.cursor).toBe(replay.cursor)
    expect(store.replayTime).toBe(replay.time)
    expect(store.snapshot).toEqual(replay.engine.snapshot())
    expect(store.account).toEqual(replay.engine.account())
    expect(store.storageStatus).toBe('saved')
    expect(store.restoreBlocked).toBe(false)
    expect(store.playing).toBe(false)

    store.stepBars()
    replay.step()
    await store.flush()

    expect(save).toHaveBeenCalledExactlyOnceWith(replay.checkpoint())
    expect(await repository.load()).toEqual({ run: replay.run, checkpoint: replay.checkpoint() })
    expect(store.snapshot).toEqual(replay.engine.snapshot())
    expect(store.error).toBeNull()
  })

  it('changes only chart aggregation when switching timeframes, never cursor, orders, fills, equity or persistence', async () => {
    const store = await initializeStore()
    expect(store.submit({ side: 'long', type: 'market', qty: 1 }).ok).toBe(true)
    expect(store.submit({ side: 'long', type: 'limit', qty: 1, limitPrice: 1_500, tif: 'gtc' }, 'MES').ok).toBe(true)
    store.stepBars(2)
    await store.flush()
    expect(store.fills).toHaveLength(1)
    expect(store.workingOrders).toHaveLength(1)
    expect(store.account!.unrealizedPnl).toBeGreaterThan(0)
    const before = accounting(store)
    const persisted = await repository.load()
    const save = vi.spyOn(repository, 'save')
    const chartLengths: number[] = []

    for (const frame of TERMINAL_TIMEFRAMES) {
      store.setTimeframe(frame)
      await nextTick()
      expect(store.timeframe).toBe(frame)
      chartLengths.push(store.chartCandles.length)
      expect(store.chartCandles.at(-1)!.close).toBe(store.mark!.price)
      expect(accounting(store)).toEqual(before)
    }
    await store.flush()

    expect(new Set(chartLengths).size).toBeGreaterThan(1)
    expect(save).not.toHaveBeenCalled()
    expect(await repository.load()).toEqual(persisted)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['mutate', 'replace'] as const)(
    'keeps chartCandles limited to the revealed prefix when hidden candles %s',
    async (mode) => {
      const store = await initializeStore()
      expect(store.submit({ side: 'long', type: 'market', qty: 1 }).ok).toBe(true)
      await store.flush()
      const activeTape = store.run!.tapes.find((tape) => tape.symbol === store.symbol)!
      const count = revealedCount(activeTape.candles, store.replayTime!)
      const prefix = structuredClone(activeTape.candles.slice(0, count))
      const chart = structuredClone(store.chartCandles)
      const before = accounting(store)
      expect(count % 3).toBe(2)
      expect(chart).toHaveLength(Math.ceil(count / 3))
      expect(chart.at(-1)).toMatchObject({
        close: prefix.at(-1)!.close,
        high: Math.max(prefix.at(-2)!.high, prefix.at(-1)!.high),
        volume: prefix.at(-2)!.volume + prefix.at(-1)!.volume,
      })
      expect(count).toBeLessThan(activeTape.candles.length)
      const change = (candle: Candle): Candle => ({
        ...candle,
        open: 50_000,
        high: 100_000,
        low: -100_000,
        close: 75_000,
        volume: 1_000_000,
      })
      if (mode === 'replace') {
        activeTape.candles = activeTape.candles.map((candle, index) => (index < count ? candle : change(candle)))
      } else {
        for (const candle of activeTape.candles.slice(count)) Object.assign(candle, change(candle))
      }
      expect(activeTape.candles.every(validReplayCandle)).toBe(true)
      expect(activeTape.candles[count]!.close).toBe(75_000)

      expect(store.candlesFor(store.symbol, '15m')).toEqual(chart)
      store.setTimeframe('5m')
      await nextTick()
      expect(store.chartCandles).toEqual(prefix)
      store.setTimeframe('15m')
      await nextTick()

      expect(store.chartCandles).toEqual(chart)
      expect(accounting(store)).toEqual(before)
    },
  )

  it.each(['run id', 'mark price'] as const)(
    'keeps corrupt %s restores blocked across initialize, load and playback calls without resetting history',
    async (corruption) => {
      const replay = fixture()
      const checkpoint = replay.checkpoint()
      if (corruption === 'run id') checkpoint.runId = 'wrong-run'
      else checkpoint.engine.marks.MNQ!.price += 1
      const expectedError =
        corruption === 'run id' ? 'Invalid replay cursor' : 'Replay marks do not match the pinned cursor'
      await repository.create(replay.run, checkpoint)
      const original = await repository.load()
      const load = vi.spyOn(repository, 'load')
      const create = vi.spyOn(repository, 'create')
      const save = vi.spyOn(repository, 'save')
      const store = useTerminalStore()

      await store.initialize()

      expect(store.restoreBlocked).toBe(true)
      expect(store.storageStatus).toBe('unavailable')
      expect(store.storageError).toBe(expectedError)
      expect(store.ready).toBe(false)
      expect(store.loading).toBe(false)
      expect(store.run).toBeNull()
      expect(store.snapshot).toBeNull()
      expect(store.cursor).toBe(0)

      await store.initialize()
      await store.load()
      store.stepBars(10)
      store.play()
      vi.advanceTimersByTime(2_000)
      await store.flush()

      expect(store.restoreBlocked).toBe(true)
      expect(store.storageError).toBe(expectedError)
      expect(store.run).toBeNull()
      expect(store.account).toBeNull()
      expect(store.cursor).toBe(0)
      expect(store.playing).toBe(false)
      expect(load).toHaveBeenCalledTimes(1)
      expect(create).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
      expect(await repository.load()).toEqual(original)
    },
  )

  it('uses only playback ticks to advance and stops the clock while paused', async () => {
    const store = await initializeStore()
    const cursor = store.cursor
    store.play()
    store.play()
    expect(vi.getTimerCount()).toBe(1)

    vi.advanceTimersByTime(250)
    expect(store.cursor).toBe(cursor)
    store.setTimeframe('4h')
    await nextTick()
    expect(store.cursor).toBe(cursor)
    vi.advanceTimersByTime(250)
    expect(store.cursor).toBe(cursor + 1)
    store.pause()
    const paused = accounting(store)
    vi.advanceTimersByTime(5_000)
    await store.flush()

    expect(accounting(store)).toEqual(paused)
    expect(store.playing).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect((await repository.load())!.checkpoint.cursor).toBe(cursor + 1)
  })

  it('stops playback at tape exhaustion and persists the clamped cursor once', async () => {
    const store = await initializeStore(fixture('last-bar', 318))
    expect(store.cursor).toBe(store.totalBars - 1)
    const save = vi.spyOn(repository, 'save')
    store.setSpeed(4)
    store.play()

    vi.advanceTimersByTime(250)
    await store.flush()

    expect(store.cursor).toBe(store.totalBars)
    expect(store.ended).toBe(true)
    expect(store.playing).toBe(false)
    expect(store.canPlay).toBe(false)
    expect(store.canTrade).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(save).toHaveBeenCalledTimes(1)
    expect((await repository.load())!.checkpoint.cursor).toBe(store.totalBars)
    const ended = accounting(store)
    store.play()
    vi.advanceTimersByTime(5_000)
    expect(accounting(store)).toEqual(ended)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
