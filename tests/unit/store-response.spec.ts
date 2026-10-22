import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, isProxy, isReactive, markRaw, reactive, ref, shallowRef } from 'vue'
import { createPinia, defineStore, disposePinia, setActivePinia } from 'pinia'
import * as planDomain from '@/domain/drill/plan'
import { instruments } from '@/domain/instruments/catalog'
import { datasetWindowBars } from '@/domain/market/dataset'
import * as generator from '@/domain/market/generator'
import * as scenarios from '@/domain/market/scenario'
import { defaultSettings, type Settings } from '@/domain/settings/schema'
import type { SessionRecord } from '@/domain/stats/types'
import { getWasmCore } from '@/domain/wasm/core'
import { prepareLocalScenarioInput } from '@/lib/market/local-data'
import type { LocalScenarioInput } from '@/lib/market/types'

vi.mock('@/lib/market/local-data', () => ({ prepareLocalScenarioInput: vi.fn() }))
vi.mock('@/lib/audio', () => ({ playCue: vi.fn() }))

vi.stubGlobal('defineStore', defineStore)
const [{ useTrainerStore }, { useDrillStore }, { useAnalysisStore }] = await Promise.all([
  import('@/stores/trainer'),
  import('@/stores/drill'),
  import('@/stores/analysis'),
])

const settings = {
  settings: reactive<Settings>({ ...defaultSettings, instruments: ['MNQ'] }),
  hydrate: vi.fn(),
}
const history = {
  hydrate: vi.fn(),
  saveSession: vi.fn<(session: SessionRecord) => void>(),
  sessions: [] as SessionRecord[],
}
const toasts = { push: vi.fn(), error: vi.fn(), success: vi.fn() }
const prepareLocal = vi.mocked(prepareLocalScenarioInput)
let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
  Object.assign(settings.settings, defaultSettings, { instruments: ['MNQ'], feePerContract: 2 })
  history.sessions.length = 0
  prepareLocal.mockReset().mockResolvedValue(null)
  vi.spyOn(scenarios, 'createSeed').mockReturnValue('store-response')
  for (const [name, value] of Object.entries({ defineStore, ref, shallowRef, computed, markRaw })) {
    vi.stubGlobal(name, value)
  }
  vi.stubGlobal('useSettingsStore', () => settings)
  vi.stubGlobal('useHistoryStore', () => history)
  vi.stubGlobal('useToastStore', () => toasts)
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/test-market/' } }))
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  disposePinia(pinia)
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function localInput(source: string): LocalScenarioInput {
  const bars = datasetWindowBars() + 40
  const c = Array.from({ length: bars }, (_, index) => 100 + index * 0.25 + Math.round(Math.sin(index / 4) * 8) * 0.25)
  const o = c.map((_, index) => c[Math.max(0, index - 1)]!)
  return {
    symbol: 'MNQ',
    dataset: {
      symbol: 'MNQ',
      source,
      sourceSymbol: 'MNQ=F',
      timeframe: '5m',
      timezone: 'UTC',
      license: 'test fixture',
      fetchedAt: '2026-10-22T00:00:00.000Z',
      bars,
      t: c.map((_, index) => 1_760_000_000 + index * 300),
      o,
      h: c.map((close, index) => Math.max(close, o[index]!) + 0.5),
      l: c.map((close, index) => Math.min(close, o[index]!) - 0.5),
      c,
      v: c.map((_, index) => 1000 + (index % 37)),
    },
  }
}

const sampleStores = [
  {
    name: 'trainer',
    useStore: useTrainerStore,
    start: (_seed: string) => useTrainerStore().startSession(),
    advance: () => useTrainerStore().waitBar(),
  },
  {
    name: 'drill',
    useStore: useDrillStore,
    start: (seed: string) => useDrillStore().start({ seed }),
    advance: () => useDrillStore().wait(),
  },
  {
    name: 'analysis',
    useStore: useAnalysisStore,
    start: (seed: string) => useAnalysisStore().start({ seed }),
    advance: () => useAnalysisStore().step(),
  },
]

const planningStores = [
  {
    name: 'trainer',
    useStore: useTrainerStore,
    start: () => useTrainerStore().startSession(),
    wait: () => useTrainerStore().waitBar(),
    finish: () => useTrainerStore().finishRound(),
  },
  {
    name: 'drill',
    useStore: useDrillStore,
    start: () => useDrillStore().start({ seed: 'store-response' }),
    wait: () => useDrillStore().wait(),
    finish: () => useDrillStore().submit(),
  },
]

function enterPlan(store: ReturnType<typeof useTrainerStore> | ReturnType<typeof useDrillStore>) {
  const tick = store.instrument!.tickSize
  store.updatePlan({
    direction: 'long',
    entry: store.lastPrice,
    stop: store.lastPrice - tick * 20,
    target: store.lastPrice + tick * 40,
  })
}

function openPosition(store: ReturnType<typeof useTrainerStore>) {
  store.placeTicketOrder({
    side: 'long',
    type: 'market',
    qty: 1,
    stopLoss: store.lastPrice - store.instrument!.tickSize * 20,
    takeProfit: null,
  })
  expect(store.account?.position).toMatchObject({ side: 'long', qty: 1, entryPrice: store.lastPrice })
  expect(store.phase).toBe('live')
  expect(toasts.error).not.toHaveBeenCalled()
}

describe.each(sampleStores)('$name scenario responses', ({ name, useStore, start, advance }) => {
  it.each(['synthetic', 'local'] as const)(
    'keeps the %s scenario and every candle outside deep reactivity',
    async (source) => {
      settings.settings.dataSource = source
      prepareLocal.mockResolvedValue(localInput('raw-tape'))
      const store = useStore()
      await start('raw-tape')

      expect(store.scenario).not.toBeNull()
      expect(store.scenarioSource).toBe(source)
      expect(store.scenario!.source).toBe(source)
      expect(store.candles).toBe(store.scenario!.candles)
      expect(store.candles.length).toBeGreaterThan(store.visibleCount)
      for (const value of [store.scenario, store.candles, ...store.candles]) {
        expect(isReactive(value)).toBe(false)
        expect(isProxy(value)).toBe(false)
      }
      expect(isReactive(store)).toBe(true)

      const tape = store.candles
      const visibleCount = store.visibleCount
      advance()
      expect(store.visibleCount).toBe(visibleCount + 1)
      expect(store.candles).toBe(tape)
    },
  )

  it.each(['older-first', 'newer-first'] as const)(
    'only publishes the newest local start when loads settle %s',
    async (order) => {
      settings.settings.dataSource = 'local'
      vi.mocked(scenarios.createSeed).mockReturnValueOnce('older').mockReturnValueOnce('newer')
      const older = deferred<LocalScenarioInput | null>()
      const newer = deferred<LocalScenarioInput | null>()
      prepareLocal.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
      const store = useStore()
      const olderStart = start('older')
      const newerStart = start('newer')

      expect(prepareLocal).toHaveBeenNthCalledWith(1, {
        baseURL: '/test-market/',
        symbols: ['MNQ'],
        seed: 'older',
      })
      expect(prepareLocal).toHaveBeenNthCalledWith(2, {
        baseURL: '/test-market/',
        symbols: ['MNQ'],
        seed: 'newer',
      })
      expect(store.scenario).toBeNull()
      if ('seed' in store) expect(store.seed).toBe('')

      if (order === 'older-first') {
        older.resolve(localInput('older-pack'))
        const result = await olderStart
        if (name !== 'trainer') expect(result).toBe(false)
        expect(store.scenario).toBeNull()
        if ('seed' in store) expect(store.seed).toBe('')
      }

      newer.resolve(localInput('newer-pack'))
      await newerStart
      expect(store.scenario?.seed).toBe('newer')
      expect(store.scenario?.dataset?.source).toBe('newer-pack')
      expect(store.scenarioSource).toBe('local')
      if ('seed' in store) expect(store.seed).toBe('newer')
      const scenario = store.scenario
      advance()
      const visibleCount = store.visibleCount

      if (order === 'newer-first') {
        older.resolve(localInput('older-pack'))
        const result = await olderStart
        if (name !== 'trainer') expect(result).toBe(false)
      }

      expect(store.scenario).toBe(scenario)
      expect(store.visibleCount).toBe(visibleCount)
      expect(store.scenario?.seed).toBe('newer')
      if ('seed' in store) expect(store.seed).toBe('newer')
      expect(toasts.push).not.toHaveBeenCalled()
      expect(history.saveSession).not.toHaveBeenCalled()
    },
  )
})

describe.each(planningStores)('$name plan response budget', ({ useStore, start, wait, finish }) => {
  it('does not extract swings for a no-trade or incomplete plan', async () => {
    await start()
    const store = useStore()
    const validate = vi.spyOn(planDomain, 'validatePlan')
    const swings = vi.spyOn(generator, 'findSwings')

    store.updateValidation()
    expect(store.validation?.checks).toEqual([{ id: 'direction.none', status: 'pass' }])
    store.setDirection('long')
    store.updatePlan({ entry: store.lastPrice, stop: store.lastPrice - store.instrument!.tickSize * 20 })

    expect(validate).toHaveBeenCalledTimes(3)
    expect(store.validation?.checks).toEqual([{ id: 'levels.missing', status: 'fail' }])
    expect(swings).not.toHaveBeenCalled()
    expect(validate.mock.calls.every(([, context]) => context.swings.length === 0)).toBe(true)
  })

  it('does not revalidate or rescan swings for thesis-only and unchanged level updates', async () => {
    await start()
    const store = useStore()
    const validate = vi.spyOn(planDomain, 'validatePlan')
    const swings = vi.spyOn(generator, 'findSwings')
    enterPlan(store)
    const validation = store.validation
    const { entry, stop, target } = store.plan

    store.updatePlan({ thesis: 'Wait for the retest before committing risk.' })
    store.updatePlan({ state: 'uptrend' })
    store.setDirection('long')
    store.updatePlan({ entry, stop, target })
    store.updateLevel('entry', entry!)
    store.updateLevel('stop', stop!)
    store.updateLevel('target', target!)

    expect(store.plan.thesis).toBe('Wait for the retest before committing risk.')
    expect(store.plan.state).toBe('uptrend')
    expect(store.validation).toBe(validation)
    expect(validate).toHaveBeenCalledOnce()
    expect(swings).toHaveBeenCalledOnce()
  })

  it('validates changed levels while reusing the same visible-prefix swing scan', async () => {
    await start()
    const store = useStore()
    const validate = vi.spyOn(planDomain, 'validatePlan')
    const swings = vi.spyOn(generator, 'findSwings')
    enterPlan(store)
    const cachedSwings = validate.mock.calls[0]![1].swings
    const tick = store.instrument!.tickSize

    expect(cachedSwings.length).toBeGreaterThan(0)
    expect(swings).toHaveBeenCalledWith(store.candles.slice(0, store.visibleCount), 3)
    expect(swings.mock.calls[0]![0]).toHaveLength(store.visibleCount)
    store.updateLevel('target', store.plan.target! + tick * 5)
    expect(store.validation?.rr).toBe(2.25)
    store.updateLevel('stop', store.plan.stop! - tick * 5)
    expect(store.validation?.rr).toBe(1.8)
    store.updateLevel('entry', store.plan.entry! + tick)
    expect(store.validation?.rr).toBe(1.69)

    expect(validate).toHaveBeenCalledTimes(4)
    expect(swings).toHaveBeenCalledOnce()
    for (const [, context] of validate.mock.calls) {
      expect(context.swings).toBe(cachedSwings)
      expect(context.endIndex).toBe(store.visibleCount - 1)
    }
  })

  it('rescans only when the visible prefix advances and reuses that new scan for later level edits', async () => {
    await start()
    const store = useStore()
    const validate = vi.spyOn(planDomain, 'validatePlan')
    const swings = vi.spyOn(generator, 'findSwings')
    enterPlan(store)
    const previousSwings = validate.mock.calls[0]![1].swings
    const previousCount = store.visibleCount

    wait()

    expect(store.visibleCount).toBe(previousCount + 1)
    expect(store.plan.waitedBars).toBe(1)
    expect(store.plan.submittedAtBar).toBe(store.visibleCount - 1)
    expect(validate).toHaveBeenCalledTimes(2)
    expect(swings).toHaveBeenCalledTimes(2)
    expect(swings.mock.calls[1]![0]).toEqual(store.candles.slice(0, store.visibleCount))
    expect(swings.mock.calls[1]![0]).toHaveLength(store.visibleCount)
    const nextContext = validate.mock.calls[1]![1]
    expect(nextContext.endIndex).toBe(store.visibleCount - 1)
    expect(nextContext.swings).not.toBe(previousSwings)

    store.updateLevel('target', store.plan.target! + store.instrument!.tickSize)
    expect(validate).toHaveBeenCalledTimes(3)
    expect(swings).toHaveBeenCalledTimes(2)
    expect(validate.mock.calls[2]![1].swings).toBe(nextContext.swings)
  })

  it.each(['no-trade', 'missing-stop', 'missing-target'] as const)(
    'finishes a %s plan without sending the tape to WASM simulation',
    async (kind) => {
      await start()
      const store = useStore()
      if (kind !== 'no-trade') {
        enterPlan(store)
        store.updatePlan(kind === 'missing-stop' ? { stop: null } : { target: null })
      }
      store.commitRead()
      const core = getWasmCore()
      expect(core).not.toBeNull()
      const wasmSimulation = vi.spyOn(core!, 'simulatePlan')
      const simulation = vi.spyOn(planDomain, 'simulatePlan')

      finish()

      expect(store.phase).toBe('review')
      expect(store.outcome).toMatchObject({ filled: false, exitReason: 'no-entry', rMultiple: null })
      expect(simulation).toHaveBeenCalledOnce()
      expect(wasmSimulation).not.toHaveBeenCalled()
    },
  )
})

describe('trainer session responses', () => {
  it('completes startSession without advancing a fake 600ms loading timer', async () => {
    const store = useTrainerStore()
    const completed = vi.fn()
    const now = Date.now()
    const pending = store.startSession({ rounds: 2 }).then(completed)

    // Drain promise continuations only; never advance the fake clock.
    for (let index = 0; index < 12; index += 1) await Promise.resolve()

    expect(completed).toHaveBeenCalledOnce()
    expect(Date.now()).toBe(now)
    expect(vi.getTimerCount()).toBe(0)
    expect(store.phase).toBe('judging')
    expect(store.totalRounds).toBe(2)
    expect(history.hydrate).toHaveBeenCalledOnce()
    await pending
  })

  it('waitBar updates the displayed price and real broker mark before a ticket can fill', async () => {
    const store = useTrainerStore()
    await store.startSession()
    const swings = vi.spyOn(generator, 'findSwings')
    const validate = vi.spyOn(planDomain, 'validatePlan')
    const initialCount = store.visibleCount
    const initialPrice = store.lastPrice
    const nextPrice = store.candles[initialCount]!.close
    expect(nextPrice).not.toBe(initialPrice)

    store.waitBar()

    expect(store.visibleCount).toBe(initialCount + 1)
    expect(store.lastPrice).toBe(nextPrice)
    expect(store.lastCandle?.close).toBe(nextPrice)
    expect(store.account?.markPrice).toBe(nextPrice)
    expect(store.plan.submittedAtBar).toBe(initialCount)
    expect(store.plan.waitedBars).toBe(1)
    expect(validate).not.toHaveBeenCalled()
    expect(swings).not.toHaveBeenCalled()
    openPosition(store)
    expect(store.account?.position?.entryPrice).toBe(nextPrice)
    expect(store.account?.position?.entryBar).toBe(initialCount)
  })

  it('grades with the decision-time prefix after waiting, not the original warm-up or revealed future', async () => {
    const store = useTrainerStore()
    await store.startSession()
    store.waitBar()
    store.waitBar()
    enterPlan(store)
    store.commitRead()
    const decisionCount = store.visibleCount
    const swings = vi.spyOn(generator, 'findSwings')
    const validate = vi.spyOn(planDomain, 'validatePlan')

    store.finishRound()

    expect(swings).toHaveBeenCalledOnce()
    expect(swings).toHaveBeenCalledWith(store.candles.slice(0, decisionCount), 3)
    expect(validate.mock.calls[0]![1].endIndex).toBe(decisionCount - 1)
    expect(store.visibleCount).toBe(store.candles.length)
    expect(store.phase).toBe('review')
    expect(store.grade).not.toBeNull()
  })

  it('counts completed and current round P&L exactly once through review and summary', async () => {
    const store = useTrainerStore()
    await store.startSession({ rounds: 2 })
    for (let round = 1; round <= 2; round += 1) {
      if (round > 1) await store.nextRound()
      openPosition(store)
      store.closePosition()
      expect(store.account?.netPnl).toBe(-2)
      expect(store.sessionNet).toBe(-2 * round)
      store.finishRound()
      expect(store.rounds).toHaveLength(round)
      expect(store.phase).toBe('review')
      expect(store.sessionNet).toBe(-2 * round)
    }
    history.saveSession.mockClear()

    store.endSession()

    expect(store.phase).toBe('summary')
    expect(store.account?.netPnl).toBe(-2)
    expect(store.roundStats.netPnl).toBe(-4)
    expect(store.sessionNet).toBe(-4)
    expect(history.saveSession).toHaveBeenCalledOnce()
    expect(history.saveSession.mock.calls[0]![0]).toMatchObject({ netPnl: -4, completed: true, ruleStatus: 'ended' })
  })

  it('ends a live round with one final persist and no redundant simulation for an executed trade', async () => {
    const store = useTrainerStore()
    await store.startSession({ rounds: 1 })
    openPosition(store)
    const simulation = vi.spyOn(planDomain, 'simulatePlan')

    store.endSession()

    expect(simulation).not.toHaveBeenCalled()
    expect(store.phase).toBe('summary')
    expect(store.sessionEnded).toBe(true)
    expect(store.account?.position).toBeNull()
    expect(store.rounds).toHaveLength(1)
    expect(store.rounds[0]!.trades).toHaveLength(1)
    expect(store.outcome).toMatchObject({ filled: true, exitReason: 'timeout' })
    expect(store.sessionNet).toBe(-2)
    expect(history.saveSession).toHaveBeenCalledOnce()
    expect(history.saveSession.mock.calls[0]![0]).toMatchObject({
      endedAt: new Date().toISOString(),
      netPnl: -2,
      endBalance: settings.settings.accountSize - 2,
      completed: true,
      ruleStatus: 'ended',
    })
  })

  it.each(['resetSession', 'endSession'] as const)('%s invalidates an in-flight local start', async (action) => {
    settings.settings.dataSource = 'local'
    const load = deferred<LocalScenarioInput | null>()
    prepareLocal.mockReturnValue(load.promise)
    const store = useTrainerStore()
    const pending = store.startSession()

    store[action]()
    load.resolve(localInput('cancelled-pack'))
    await pending

    expect(store.phase).toBe(action === 'resetSession' ? 'idle' : 'summary')
    expect(store.scenario).toBeNull()
    expect(store.account).toBeNull()
    expect(store.rounds).toEqual([])
    expect(history.saveSession).not.toHaveBeenCalled()
  })
})

const sharedModes = [
  { mode: 'daily' as const, seed: 'daily-2026-10-23', now: '2026-10-23T12:00:00Z' },
  { mode: 'pk' as const, seed: 'shared-pk-response', now: '2024-01-01T12:00:00Z' },
]

describe.each(sharedModes)('$mode reproducible responses', ({ mode, seed, now }) => {
  it('uses the full synthetic universe and fixed seed calendar regardless of local preferences or current date', async () => {
    settings.settings.dataSource = 'local'
    prepareLocal.mockResolvedValue(localInput('must-not-be-used'))
    const store = useDrillStore()
    await store.start({ mode, seed })
    const original = store.scenario
    const expected = scenarios
      .createScenarioFactory({ universe: instruments.list(), now: new Date(now) })
      .createFromSeed(seed)

    expect(original).toEqual(expected)
    expect(store.scenarioSource).toBe('synthetic')
    expect(original?.dataset).toBeNull()
    expect(original?.createdAt).toBe(new Date(now).getTime())

    vi.setSystemTime(new Date('2031-04-05T23:59:00Z'))
    settings.settings.instruments = ['MCL']
    await store.start({ mode, seed })
    expect(store.scenario).not.toBe(original)
    expect(store.scenario).toEqual(original)

    vi.setSystemTime(new Date('2023-01-01T00:01:00Z'))
    settings.settings.instruments = ['MES']
    settings.settings.dataSource = 'synthetic'
    await store.start({ mode, seed })
    expect(store.scenario).toEqual(original)
    expect(store.mode).toBe(mode)
    expect(store.seed).toBe(seed)
    expect(prepareLocal).not.toHaveBeenCalled()
  })

  it('cannot be replaced by a stale local practice completion', async () => {
    settings.settings.dataSource = 'local'
    const load = deferred<LocalScenarioInput | null>()
    prepareLocal.mockReturnValueOnce(load.promise)
    const store = useDrillStore()
    const pendingPractice = store.start({ mode: 'drill', seed: 'stale-practice' })
    await store.start({ mode, seed })
    const sharedScenario = store.scenario
    store.wait()
    const visibleCount = store.visibleCount

    load.resolve(localInput('stale-practice'))
    expect(await pendingPractice).toBe(false)

    expect(store.mode).toBe(mode)
    expect(store.seed).toBe(seed)
    expect(store.scenario).toBe(sharedScenario)
    expect(store.scenarioSource).toBe('synthetic')
    expect(store.visibleCount).toBe(visibleCount)
    expect(prepareLocal).toHaveBeenCalledOnce()
  })
})
