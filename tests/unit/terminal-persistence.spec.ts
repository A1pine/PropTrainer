import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, markRaw, nextTick, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { createPinia, defineStore, disposePinia, setActivePinia } from 'pinia'
import { instruments } from '~/domain/instruments/catalog'
import type { Candle } from '~/domain/market/types'
import { SimEngine } from '~/domain/sim/engine'
import { cloneTemplate, templateById } from '~/domain/sim/presets'
import { isMarketOpen, nextSessionOpen, sessionOpen } from '~/domain/sim/session'
import { aggregateCandlesTs, TERMINAL_TIMEFRAMES } from '~/domain/sim/timeframe'
import * as persistence from '~/lib/sim/persistence'
import type { ReplayCheckpoint, ReplayRepository, ReplayRun, SavedReplay } from '~/lib/sim/persistence'
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

/** Prefer microtask/timer progress; fake timers stay installed so flush proves idle. */
async function settle() {
  for (let turn = 0; turn < 12; turn += 1) {
    await nextTick()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
  }
}

interface GatedSave {
  checkpoint: ReplayCheckpoint
  resolve: () => void
  reject: (cause: Error) => void
}

/** Queue every save behind its own promise so completion order is ours to choose. */
function gateSaves(): GatedSave[] {
  const gates: GatedSave[] = []
  const write = repository.save.bind(repository)
  vi.spyOn(repository, 'save').mockImplementation(
    (checkpoint) =>
      new Promise<void>((resolve, reject) => {
        // Snapshot at invocation: the repository contract clones its input.
        const saved = structuredClone(checkpoint)
        gates.push({
          checkpoint: saved,
          resolve: () => {
            write(saved).then(resolve, reject)
          },
          reject: (cause) => reject(cause),
        })
      }),
  )
  return gates
}

function restoreAccounting(saved: SavedReplay) {
  const restored = ReplaySession.restore(saved)
  return {
    cursor: restored.cursor,
    replayTime: restored.time,
    knownTime: restored.time + REPLAY_BASE_SECONDS,
    snapshot: restored.engine.snapshot(),
  }
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

describe('terminal store restore and save recovery', () => {
  it('restores the pinned account and clock on an explicit retry after one load failure', async () => {
    const replay = fixture()
    expect(replay.engine.submit({ side: 'long', type: 'market', qty: 1 }, 'MNQ').ok).toBe(true)
    replay.step(2)
    await repository.create(replay.run, replay.checkpoint())
    const original = await repository.load()
    const load = vi.spyOn(repository, 'load').mockRejectedValueOnce(new Error('Replay storage read failed'))
    const create = vi.spyOn(repository, 'create')
    const save = vi.spyOn(repository, 'save')
    const store = useTerminalStore()

    await store.initialize()

    expect(load).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(store.restoreBlocked).toBe(true)
    expect(store.storageStatus).toBe('unavailable')
    expect(store.storageError).toBe('Replay storage read failed')
    expect(store.ready).toBe(false)
    expect(store.run).toBeNull()
    expect(store.snapshot).toBeNull()
    expect(store.cursor).toBe(0)
    expect(store.totalBars).toBe(0)
    expect(store.chartCandles).toEqual([])

    await store.retryRestore()

    expect(load).toHaveBeenCalledTimes(2)
    expect(create).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(store.restoreBlocked).toBe(false)
    expect(store.storageStatus).toBe('saved')
    expect(store.storageError).toBeNull()
    expect(store.run).toEqual(replay.run)
    expect(store.cursor).toBe(replay.cursor)
    expect(store.replayTime).toBe(replay.time)
    expect(store.knownTime).toBe(replay.time + REPLAY_BASE_SECONDS)
    expect(store.snapshot).toEqual(replay.engine.snapshot())
    expect(store.account).toEqual(replay.engine.account())
    expect(await repository.load()).toEqual(original)
  })

  it.each(['run id', 'mark price'] as const)(
    'keeps a corrupt %s restore blocked across explicit retries without touching history',
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

      await store.retryRestore()
      await store.retryRestore()

      expect(load).toHaveBeenCalledTimes(3)
      expect(create).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
      expect(store.restoreBlocked).toBe(true)
      expect(store.storageStatus).toBe('unavailable')
      expect(store.storageError).toBe(expectedError)
      expect(store.ready).toBe(false)
      expect(store.run).toBeNull()
      expect(store.snapshot).toBeNull()
      expect(store.account).toBeNull()
      expect(store.cursor).toBe(0)
      expect(store.totalBars).toBe(0)
      expect(store.chartCandles).toEqual([])
      expect(store.playing).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
      expect(await repository.load()).toEqual(original)
    },
  )

  it('retries a failed save with the submitted trade without replacing the attempt or account', async () => {
    const replay = fixture()
    await repository.create(replay.run, replay.checkpoint())
    const original = await repository.load()
    const save = vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('Replay checkpoint not saved'))
    const create = vi.spyOn(repository, 'create')
    const store = useTerminalStore()
    await store.initialize()

    expect(store.submit({ side: 'long', type: 'market', qty: 1 }).ok).toBe(true)
    const submitted = accounting(store)
    const pinnedRun = store.run
    const pinnedSnapshot = store.snapshot
    expect(store.fills).toHaveLength(1)
    await store.flush()

    expect(save).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    expect(store.storageStatus).toBe('unavailable')
    expect(store.storageError).toBe('Replay checkpoint not saved')
    expect(store.run).toBe(pinnedRun)
    expect(store.snapshot).toBe(pinnedSnapshot)
    expect(accounting(store)).toEqual(submitted)
    expect(await repository.load()).toEqual(original)

    await store.retrySave()

    expect(save).toHaveBeenCalledTimes(2)
    expect(create).not.toHaveBeenCalled()
    expect(store.run).toBe(pinnedRun)
    expect(store.snapshot).toBe(pinnedSnapshot)
    expect(accounting(store)).toEqual(submitted)
    expect(store.storageStatus).toBe('saved')
    expect(store.storageError).toBeNull()
    const saved = await repository.load()
    expect(saved!.run).toEqual(replay.run)
    expect(saved!.checkpoint.engine.fills).toHaveLength(1)
    const restored = ReplaySession.restore(saved!)
    expect(restored.cursor).toBe(store.cursor)
    expect(restored.engine.snapshot()).toEqual(store.snapshot)
  })

  it('creates the current attempt and checkpoint when the initial create is retried', async () => {
    const create = vi.spyOn(repository, 'create').mockRejectedValueOnce(new Error('Replay storage unavailable'))
    const save = vi.spyOn(repository, 'save')
    const store = useTerminalStore()

    await store.initialize()

    expect(store.ready).toBe(true)
    expect(store.restoreBlocked).toBe(false)
    expect(store.error).toBeNull()
    expect(store.storageStatus).toBe('unavailable')
    expect(store.storageError).toBe('Replay storage unavailable')
    expect(create).toHaveBeenCalledTimes(1)
    expect(await repository.load()).toBeNull()
    const pinnedRun = store.run
    const pinnedSnapshot = store.snapshot
    const before = accounting(store)
    expect(pinnedRun).not.toBeNull()

    await store.retrySave()

    expect(create).toHaveBeenCalledTimes(2)
    expect(save).not.toHaveBeenCalled()
    expect(store.run).toBe(pinnedRun)
    expect(store.snapshot).toBe(pinnedSnapshot)
    expect(accounting(store)).toEqual(before)
    expect(store.storageStatus).toBe('saved')
    expect(store.storageError).toBeNull()
    const saved = await repository.load()
    expect(saved!.run).toEqual(pinnedRun)
    const restored = ReplaySession.restore(saved!)
    expect(restored.cursor).toBe(store.cursor)
    expect(restored.time).toBe(store.replayTime)
    expect(restored.engine.snapshot()).toEqual(store.snapshot)
  })

  it('does not write or fabricate state when retrySave runs while restore is blocked', async () => {
    const replay = fixture()
    const checkpoint = replay.checkpoint()
    checkpoint.runId = 'wrong-run'
    await repository.create(replay.run, checkpoint)
    const original = await repository.load()
    const create = vi.spyOn(repository, 'create')
    const save = vi.spyOn(repository, 'save')
    const store = useTerminalStore()

    await store.initialize()
    expect(store.restoreBlocked).toBe(true)
    await store.retrySave()
    await store.flush()

    expect(create).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(store.run).toBeNull()
    expect(store.snapshot).toBeNull()
    expect(store.account).toBeNull()
    expect(store.cursor).toBe(0)
    expect(store.chartCandles).toEqual([])
    expect(store.restoreBlocked).toBe(true)
    expect(store.storageStatus).toBe('unavailable')
    expect(await repository.load()).toEqual(original)
  })

  it('refuses retrySave writes while restoreBlocked is raised on an installed session', async () => {
    const store = await initializeStore()
    const pinnedRun = store.run
    const before = accounting(store)
    const persisted = await repository.load()
    const create = vi.spyOn(repository, 'create')
    const save = vi.spyOn(repository, 'save')
    store.restoreBlocked = true

    await store.retrySave()
    await store.flush()

    expect(create).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(store.ready).toBe(true)
    expect(store.run).toBe(pinnedRun)
    expect(accounting(store)).toEqual(before)
    expect(store.storageStatus).toBe('saved')
    expect(await repository.load()).toEqual(persisted)
  })
})

describe('terminal chart candle prefix cache', () => {
  it('returns the identical array for repeated same-tape, same-count, same-frame reads', async () => {
    const store = await initializeStore()
    const tape = store.run!.tapes.find((item) => item.symbol === store.symbol)!
    const count = revealedCount(tape.candles, store.replayTime!)
    const first = store.candlesFor(store.symbol, '15m')
    const second = store.candlesFor(store.symbol, '15m')

    expect(second).toBe(first)
    expect(first).toEqual(aggregateCandlesTs(tape.candles.slice(0, count), '15m'))
    expect(first.length).toBeLessThan(count)
  })

  it('keys 5m and 15m separately without recounting sessions', async () => {
    const store = await initializeStore()
    const tape = store.run!.tapes.find((item) => item.symbol === store.symbol)!
    const count = revealedCount(tape.candles, store.replayTime!)
    const five = store.candlesFor(store.symbol, '5m')
    const fifteen = store.candlesFor(store.symbol, '15m')

    expect(five).toHaveLength(count)
    expect(fifteen.length).toBeLessThan(five.length)
    expect(fifteen).not.toBe(five)
    expect(store.candlesFor(store.symbol, '5m')).toBe(five)
    expect(store.candlesFor(store.symbol, '15m')).toBe(fifteen)

    store.setTimeframe('15m')
    await nextTick()
    expect(store.chartCandles).toBe(fifteen)
    store.setTimeframe('5m')
    await nextTick()
    expect(store.chartCandles).toBe(five)
  })

  it('invalidates cached prefixes when the revealed prefix grows', async () => {
    const store = await initializeStore()
    const tape = store.run!.tapes.find((item) => item.symbol === store.symbol)!
    const five = store.candlesFor(store.symbol, '5m')
    const fifteen = store.candlesFor(store.symbol, '15m')
    const count = five.length

    store.stepBars(1)
    const grownCount = revealedCount(tape.candles, store.replayTime!)
    expect(grownCount).toBe(count + 1)
    const grownFive = store.candlesFor(store.symbol, '5m')
    const grownFifteen = store.candlesFor(store.symbol, '15m')
    expect(grownFive).not.toBe(five)
    expect(grownFive).toEqual(aggregateCandlesTs(tape.candles.slice(0, grownCount), '5m'))
    expect(grownFifteen).not.toBe(fifteen)
    expect(grownFifteen).toEqual(aggregateCandlesTs(tape.candles.slice(0, grownCount), '15m'))
  })

  it('recomputes shorter prefixes after a rewind instead of reusing a longer cache', async () => {
    const store = await initializeStore()
    const tape = store.run!.tapes.find((item) => item.symbol === store.symbol)!
    const initialCursor = store.cursor
    store.stepBars(3)
    const grown = store.candlesFor(store.symbol, '5m')
    const grownCount = revealedCount(tape.candles, store.replayTime!)
    expect(grown).toHaveLength(grownCount)

    store.cursor = initialCursor
    const rewoundCount = revealedCount(tape.candles, store.replayTime!)
    expect(rewoundCount).toBeLessThan(grownCount)
    const rewound = store.candlesFor(store.symbol, '5m')
    expect(rewound).not.toBe(grown)
    expect(rewound).toEqual(aggregateCandlesTs(tape.candles.slice(0, rewoundCount), '5m'))
    expect(rewound.length).toBeLessThan(grown.length)
    expect(store.candlesFor(store.symbol, '5m')).toBe(rewound)
  })

  it('uses a replacement tape array even when its revealed length is unchanged', async () => {
    const store = await initializeStore()
    const tape = store.run!.tapes.find((item) => item.symbol === store.symbol)!
    const count = revealedCount(tape.candles, store.replayTime!)
    const before = store.candlesFor(store.symbol, '15m')
    const replacement = tape.candles.map((candle, index) =>
      index < count ? { ...candle, volume: candle.volume + 7 } : { ...candle },
    )
    expect(replacement.every(validReplayCandle)).toBe(true)
    tape.candles = replacement

    const after = store.candlesFor(store.symbol, '15m')

    expect(after).not.toBe(before)
    expect(after).toEqual(aggregateCandlesTs(replacement.slice(0, count), '15m'))
    expect(after.at(-1)!.volume).toBeGreaterThan(before.at(-1)!.volume)
    expect(store.candlesFor(store.symbol, '15m')).toBe(after)
  })

  it('keeps an older cache out of a restored run with a new id and tape arrays', async () => {
    const store = await initializeStore()
    store.stepBars(2)
    await store.flush()
    const oldTape = store.run!.tapes.find((item) => item.symbol === store.symbol)!
    const oldCount = revealedCount(oldTape.candles, store.replayTime!)
    const oldChart = store.candlesFor(store.symbol, '15m')
    const saved = (await repository.load())!
    const persisted = restoreAccounting(saved)

    const clone = structuredClone(saved)
    clone.run.id = 'restored-attempt'
    clone.checkpoint.runId = 'restored-attempt'
    const alternate = fixture('restored-attempt')
    for (const tape of clone.run.tapes) {
      const replacement = alternate.run.tapes.find((item) => item.symbol === tape.symbol)!
      tape.candles = replacement.candles.map((candle, index) =>
        index < oldCount ? { ...candle, volume: candle.volume + 11 } : { ...candle },
      )
    }
    await repository.create(clone.run, clone.checkpoint)
    const restartedPinia = createPinia()
    setActivePinia(restartedPinia)
    try {
      const restarted = useTerminalStore()
      await restarted.initialize()

      const newTape = restarted.run!.tapes.find((item) => item.symbol === restarted.symbol)!
      const count = revealedCount(newTape.candles, restarted.replayTime!)
      const chart = restarted.candlesFor(restarted.symbol, '15m')
      expect(restarted.run!.id).toBe('restored-attempt')
      expect(count).toBe(oldCount)
      expect(chart).toEqual(aggregateCandlesTs(newTape.candles.slice(0, count), '15m'))
      expect(chart).not.toEqual(oldChart)
      expect(accounting(restarted)).toEqual(persisted)
    } finally {
      disposePinia(restartedPinia)
      setActivePinia(pinia)
    }
  })

  it('clears cached prefixes when a new attempt installs different tapes', async () => {
    const store = await initializeStore()
    const firstRunId = store.run!.id
    store.stepBars(2)
    await store.flush()
    const previous = store.candlesFor(store.symbol, '15m')

    await store.newAttempt({ reuseTapes: false, source: 'synthetic' })
    await store.flush()

    expect(store.run!.id).not.toBe(firstRunId)
    const tape = store.run!.tapes.find((item) => item.symbol === store.symbol)!
    const count = revealedCount(tape.candles, store.replayTime!)
    const chart = store.candlesFor(store.symbol, '15m')
    expect(chart).not.toBe(previous)
    expect(chart).toEqual(aggregateCandlesTs(tape.candles.slice(0, count), '15m'))
    expect(store.candlesFor(store.symbol, '15m')).toBe(chart)
  })

  it('leaves the aggregate unchanged when hidden suffix candles mutate', async () => {
    const store = await initializeStore()
    const tape = store.run!.tapes.find((item) => item.symbol === store.symbol)!
    const count = revealedCount(tape.candles, store.replayTime!)
    const prefix = structuredClone(tape.candles.slice(0, count))
    const chart = store.candlesFor(store.symbol, '15m')
    expect(count).toBeLessThan(tape.candles.length)

    for (const candle of tape.candles.slice(count)) {
      Object.assign(candle, { open: 50_000, high: 100_000, low: -100_000, close: 75_000, volume: 1_000_000 })
    }

    expect(store.candlesFor(store.symbol, '15m')).toBe(chart)
    expect(store.candlesFor(store.symbol, '5m')).toEqual(prefix)
  })

  it('invalidates when the tape array is replaced by a shorter revealed prefix', async () => {
    const store = await initializeStore()
    const tape = store.run!.tapes.find((item) => item.symbol === store.symbol)!
    store.stepBars(12)
    const count = revealedCount(tape.candles, store.replayTime!)
    const before = store.candlesFor(store.symbol, '5m')
    expect(before).toHaveLength(count)

    const replacement = tape.candles.slice(0, count - 5)
    expect(replacement.every(validReplayCandle)).toBe(true)
    tape.candles = replacement
    const shorterCount = revealedCount(replacement, store.replayTime!)
    expect(shorterCount).toBe(count - 5)

    const after = store.candlesFor(store.symbol, '5m')
    expect(after).not.toBe(before)
    expect(after).toHaveLength(shorterCount)
    expect(after).toEqual(aggregateCandlesTs(replacement.slice(0, shorterCount), '5m'))
    expect(store.candlesFor(store.symbol, '5m')).toBe(after)
  })
})

describe('terminal checkpoint coalescing and drain', () => {
  it('reports a checkpoint export failure and retries the latest state without a rejected drain', async () => {
    const store = await initializeStore()
    const original = await repository.load()
    const save = vi.spyOn(repository, 'save')
    const checkpoint = vi.spyOn(ReplaySession.prototype, 'checkpoint').mockImplementationOnce(() => {
      throw new Error('Replay checkpoint export failed')
    })

    store.stepBars(1)
    const latest = accounting(store)
    await expect(store.flush()).resolves.toBeUndefined()

    expect(checkpoint).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
    expect(store.storageStatus).toBe('unavailable')
    expect(store.storageError).toBe('Replay checkpoint export failed')
    expect(accounting(store)).toEqual(latest)
    expect(await repository.load()).toEqual(original)

    await store.retrySave()
    await store.flush()

    expect(checkpoint).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledTimes(1)
    expect(store.storageStatus).toBe('saved')
    expect(store.storageError).toBeNull()
    expect(restoreAccounting((await repository.load())!)).toEqual(latest)
  })

  it('waits for an in-flight attempt create even when no checkpoint drain exists', async () => {
    vi.spyOn(repository, 'create').mockRejectedValueOnce(new Error('Replay storage unavailable'))
    const store = useTerminalStore()
    await store.initialize()
    expect(store.storageStatus).toBe('unavailable')
    const latest = accounting(store)
    const write = repository.create.bind(repository)
    let release!: () => void
    vi.spyOn(repository, 'create').mockImplementationOnce(
      (run, checkpoint) =>
        new Promise<void>((resolve, reject) => {
          release = () => {
            write(run, checkpoint).then(resolve, reject)
          }
        }),
    )

    const retry = store.retrySave()
    await settle()
    expect(store.storageStatus).toBe('saving')
    expect(release).toBeTypeOf('function')
    let flushed = false
    const completed = store.flush().then(() => {
      flushed = true
    })
    await settle()
    expect(flushed).toBe(false)
    expect(await repository.load()).toBeNull()

    release()
    await Promise.all([retry, completed])

    expect(flushed).toBe(true)
    expect(store.storageStatus).toBe('saved')
    expect(store.storageError).toBeNull()
    expect(restoreAccounting((await repository.load())!)).toEqual(latest)
  })

  it('exports and saves only the latest state for a synchronous step burst', async () => {
    const store = await initializeStore()
    const save = vi.spyOn(repository, 'save')
    const exportState = vi.spyOn(SimEngine.prototype, 'exportState')

    store.stepBars(1)
    store.stepBars(1)
    store.stepBars(2)
    const latest = accounting(store)
    await store.flush()

    expect(save).toHaveBeenCalledTimes(1)
    expect(exportState).toHaveBeenCalledTimes(1)
    const checkpoint = save.mock.calls[0]![0]
    expect(checkpoint.cursor).toBe(store.cursor)
    expect(restoreAccounting({ run: store.run!, checkpoint })).toEqual(latest)
    expect(store.storageStatus).toBe('saved')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('coalesces a burst during an in-flight save and flush resolves with the latest state', async () => {
    const store = await initializeStore()
    const gates = gateSaves()
    const exportState = vi.spyOn(SimEngine.prototype, 'exportState')

    store.stepBars(1)
    await settle()
    expect(gates).toHaveLength(1)
    const firstCursor = gates[0]!.checkpoint.cursor
    expect(exportState).toHaveBeenCalledTimes(1)

    store.stepBars(1)
    store.stepBars(2)
    const latest = accounting(store)
    await settle()

    expect(gates).toHaveLength(1)
    expect(exportState).toHaveBeenCalledTimes(1)
    expect(store.storageStatus).toBe('saving')

    let flushed = false
    const completed = store.flush().then(() => {
      flushed = true
    })
    await settle()
    expect(gates).toHaveLength(1)
    expect(flushed).toBe(false)

    gates[0]!.resolve()
    await settle()
    expect(gates).toHaveLength(2)
    expect(flushed).toBe(false)
    expect(exportState).toHaveBeenCalledTimes(2)
    const coalesced = gates[1]!.checkpoint
    expect(coalesced.cursor).toBe(store.cursor)
    expect(coalesced.cursor).toBeGreaterThan(firstCursor)
    expect(restoreAccounting({ run: store.run!, checkpoint: coalesced })).toEqual(latest)

    gates[1]!.resolve()
    await completed

    expect(flushed).toBe(true)
    expect(gates).toHaveLength(2)
    expect(store.storageStatus).toBe('saved')
    expect(store.storageError).toBeNull()
    expect(restoreAccounting((await repository.load())!)).toEqual(latest)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports each rejected save, then persists the latest state through retrySave', async () => {
    const store = await initializeStore()
    const gates = gateSaves()

    store.stepBars(1)
    await settle()
    expect(gates).toHaveLength(1)
    const rejected = gates[0]!.checkpoint
    store.stepBars(1)
    const latest = accounting(store)
    await settle()
    expect(gates).toHaveLength(1)

    gates[0]!.reject(new Error('Replay checkpoint not saved'))
    await settle()

    expect(gates).toHaveLength(2)
    expect(store.storageStatus).toBe('unavailable')
    expect(store.storageError).toBe('Replay checkpoint not saved')
    expect(accounting(store)).toEqual(latest)
    expect(gates[1]!.checkpoint.cursor).toBe(store.cursor)
    expect(restoreAccounting({ run: store.run!, checkpoint: gates[1]!.checkpoint })).toEqual(latest)

    gates[1]!.reject(new Error('Replay checkpoint still not saved'))
    await settle()

    expect(gates).toHaveLength(2)
    expect(store.storageStatus).toBe('unavailable')
    expect(store.storageError).toBe('Replay checkpoint still not saved')
    expect(gates[1]!.checkpoint.cursor).toBeGreaterThan(rejected.cursor)

    const retry = store.retrySave()
    await settle()
    expect(gates).toHaveLength(3)
    expect(gates[2]!.checkpoint.cursor).toBe(store.cursor)
    gates[2]!.resolve()
    await retry
    await store.flush()

    expect(store.storageStatus).toBe('saved')
    expect(store.storageError).toBeNull()
    const saved = (await repository.load())!
    expect(saved.run).toEqual(store.run)
    expect(restoreAccounting(saved)).toEqual(latest)
  })

  it('waits for the in-flight drain before replacing the attempt and the pinned run', async () => {
    const store = await initializeStore()
    const gates = gateSaves()
    const firstRunId = store.run!.id

    store.stepBars(1)
    await settle()
    expect(gates).toHaveLength(1)

    let replaced = false
    const replacement = store.newAttempt({ reuseTapes: false, source: 'synthetic' }).then(() => {
      replaced = true
    })
    await settle()

    expect(replaced).toBe(false)
    expect(gates).toHaveLength(1)
    expect(store.run!.id).toBe(firstRunId)

    gates[0]!.resolve()
    await replacement
    await store.flush()

    expect(replaced).toBe(true)
    expect(store.run!.id).not.toBe(firstRunId)
    const saved = (await repository.load())!
    expect(saved.run.id).toBe(store.run!.id)
    expect(restoreAccounting(saved)).toEqual(accounting(store))
    expect(store.storageStatus).toBe('saved')
  })

  it('flushes a checkpoint queued from a saved-status watcher during drain handoff', async () => {
    const store = await initializeStore()
    const gates = gateSaves()
    let armed = true

    // The watcher runs after the final save flips the status but before the
    // drain promise clears, so the step must still be part of this flush.
    watch(
      () => store.storageStatus,
      (status) => {
        if (status === 'saved' && armed) {
          armed = false
          store.stepBars(1)
        }
      },
    )

    store.stepBars(1)
    await settle()
    expect(gates).toHaveLength(1)

    gates[0]!.resolve()
    await settle()

    const flushing = store.flush()
    await settle()
    expect(gates).toHaveLength(2)
    gates[1]!.resolve()
    await flushing

    const saved = (await repository.load())!
    expect({
      savedCursor: saved.checkpoint.cursor,
      cursor: store.cursor,
      status: store.storageStatus,
      gates: gates.length,
    }).toEqual({
      savedCursor: store.cursor,
      cursor: store.cursor,
      status: 'saved',
      gates: 2,
    })
  })
})
