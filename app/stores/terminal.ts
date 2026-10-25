import { instruments } from '~/domain/instruments/catalog'
import type { Candle } from '~/domain/market/types'
import { PROP_TEMPLATES, templateById } from '~/domain/sim/presets'
import { aggregateCandles, isTimeframeAvailable } from '~/domain/sim/timeframe'
import { isMarketOpen } from '~/domain/sim/session'
import { roundTowardBreach } from '~/domain/sim/risk'
import type { PropTemplate, SimOrderInput, SimResult, SimSnapshot, SimTimeframe } from '~/domain/sim/types'
import { loadLocalDataset } from '~/lib/market/local-data'
import {
  buildReplayMarket,
  localReplayTape,
  REPLAY_BASE_SECONDS,
  revealedCount,
  syntheticReplayTape,
  type ReplayTape,
} from '~/lib/sim/tape'
import { ReplaySession } from '~/lib/sim/replay'
import {
  createReplayRepository,
  type ReplayRepository,
  type ReplayRun,
  type ReplayCheckpoint,
} from '~/lib/sim/persistence'

export type TerminalSource = 'loading' | 'local' | 'synthetic'
const TICK_MS = 250
const EMPTY_CANDLES: Candle[] = []
const PREFERENCE_KEY = 'propdesk.terminal.v1'

/** One attempt owns the clock, pinned tapes, rules and instrument specifications. */
export const useTerminalStore = defineStore('terminal', () => {
  const config = useRuntimeConfig()
  const settings = useSettingsStore()
  const symbol = ref('MNQ')
  const timeframe = ref<SimTimeframe>('15m')
  const templateId = ref('eval-50k')
  const sourceMode = ref<'local' | 'synthetic'>(settings.settings.dataSource)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const dataNotice = ref<'fallback' | 'subset' | null>(null)
  const storageStatus = ref<'idle' | 'saving' | 'saved' | 'unavailable'>('idle')
  const storageError = ref<string | null>(null)
  const restoreBlocked = ref(false)
  const run = shallowRef<ReplayRun | null>(null)
  const session = shallowRef<ReplaySession | null>(null)
  const snapshot = shallowRef<SimSnapshot | null>(null)
  const cursor = ref(0)
  const playing = ref(false)
  const speed = ref(1)
  let timer: ReturnType<typeof setInterval> | null = null
  let accumulator = 0
  let generation = 0
  let disposed = false
  let initialized = false
  let initialization: Promise<void> | null = null
  let repository: ReplayRepository | null = null
  let saves: Promise<void> = Promise.resolve()
  let pendingCheckpoint: (() => ReplayCheckpoint) | null = null
  let drain: Promise<void> | null = null
  const persistedRuns = new Set<string>()
  type CandleMemo = { source: Candle[]; frame: SimTimeframe; count: number; result: Candle[] }
  // Per-run prefix cache. Panes and dock helpers ask for the same symbol/frame
  // several times per tick; without this they each re-slice and re-aggregate the
  // full revealed history. Cleared whenever a run is installed.
  const candleMemo = new Map<string, CandleMemo>()

  const ready = computed(() => session.value !== null && !loading.value)
  const specs = computed(() => run.value?.instruments ?? instruments.list())
  const symbols = computed(
    () => run.value?.tapes.map((tape) => tape.symbol) ?? instruments.list().map((item) => item.symbol),
  )
  const instrument = computed(
    () => specs.value.find((item) => item.symbol === symbol.value) ?? instruments.require('MNQ'),
  )
  const template = computed<PropTemplate>(
    () => snapshot.value?.risk.template ?? templateById(templateId.value) ?? PROP_TEMPLATES[0]!,
  )
  const tape = computed(() => run.value?.tapes.find((item) => item.symbol === symbol.value) ?? null)
  const source = computed<TerminalSource>(() => (loading.value || !tape.value ? 'loading' : tape.value.source))
  const baseCandles = computed(() => tape.value?.candles ?? EMPTY_CANDLES)
  const replayTime = computed(() => {
    if (!session.value || !cursor.value) return null
    return session.value.market.timeline[cursor.value - 1] ?? null
  })
  const knownTime = computed(() => (replayTime.value === null ? null : replayTime.value + REPLAY_BASE_SECONDS))
  const totalBars = computed(() => session.value?.market.timeline.length ?? 0)
  const progress = computed(() => (totalBars.value ? cursor.value / totalBars.value : 0))
  const ended = computed(() => ready.value && cursor.value >= totalBars.value)
  const canPlay = computed(() => ready.value && !ended.value)
  const account = computed(() => snapshot.value?.account ?? null)
  const position = computed(() => snapshot.value?.positions.find((item) => item.symbol === symbol.value) ?? null)
  const orders = computed(() => snapshot.value?.orders ?? [])
  const workingOrders = computed(() =>
    orders.value.filter((order) => order.status === 'working' || order.status === 'suspended'),
  )
  const fills = computed(() => snapshot.value?.fills ?? [])
  const trades = computed(() => snapshot.value?.trades ?? [])
  const risk = computed(() => snapshot.value?.risk ?? null)
  const ruleStatuses = computed(() => snapshot.value?.ruleStatuses ?? [])
  const consistency = computed(() => snapshot.value?.consistency ?? null)
  const mark = computed(() => snapshot.value?.marks[symbol.value] ?? null)
  const chartCandles = computed(() => candlesFor(symbol.value, timeframe.value))
  const stale = computed(() => !isFresh(symbol.value))
  const canTrade = computed(
    () =>
      ready.value &&
      !ended.value &&
      risk.value?.status === 'active' &&
      isFresh(symbol.value) &&
      isMarketOpen(knownTime.value ?? 0),
  )
  const quote = computed(() => quotes.value[symbol.value] ?? null)
  const quotes = computed(() =>
    Object.fromEntries(
      (run.value?.tapes ?? []).map((item) => {
        const count = revealedCount(item.candles, replayTime.value ?? -Infinity)
        const last = item.candles[count - 1]
        const previous = item.candles[count - 2]
        return [
          item.symbol,
          last
            ? {
                price: last.close,
                volume: last.volume,
                time: last.time,
                stale: last.time !== replayTime.value,
                change: previous ? last.close - previous.close : 0,
                changePercent:
                  previous && previous.close !== 0
                    ? ((last.close - previous.close) / Math.abs(previous.close)) * 100
                    : null,
              }
            : null,
        ]
      }),
    ),
  )

  function linePrice(floor: number | null, targetSymbol: string): number | null {
    const pos = snapshot.value?.positions.find((item) => item.symbol === targetSymbol)
    const current = snapshot.value?.marks[targetSymbol]
    const spec = specs.value.find((item) => item.symbol === targetSymbol)
    if (!pos || !current || !spec || floor === null || !account.value) return null
    const signed = pos.side === 'long' ? pos.qty : -pos.qty
    const raw = current.price + (floor - account.value.equity) / (signed * spec.pointValue)
    return Number.isFinite(raw) ? roundTowardBreach(raw, pos.side, spec.tickSize) : null
  }
  function breachFor(targetSymbol: string): number | null {
    return linePrice(risk.value?.template.drawdown.includeUnrealized ? risk.value.floor : null, targetSymbol)
  }
  function dailyLineFor(targetSymbol: string): number | null {
    const state = risk.value
    return linePrice(
      state && state.template.dailyLoss.amount > 0 ? state.dayStartEquity - state.template.dailyLoss.amount : null,
      targetSymbol,
    )
  }
  const breachPrice = computed(() => breachFor(symbol.value))
  const cushion = computed(() =>
    risk.value && account.value
      ? (risk.value.template.drawdown.includeUnrealized ? account.value.equity : account.value.balance) -
        risk.value.floor
      : null,
  )

  function candlesFor(targetSymbol: string, frame: SimTimeframe): Candle[] {
    const currentRun = run.value
    const currentTape = currentRun?.tapes.find((item) => item.symbol === targetSymbol)
    if (!currentRun || !currentTape || replayTime.value === null || !isTimeframeAvailable(frame)) {
      return EMPTY_CANDLES
    }
    const count = revealedCount(currentTape.candles, replayTime.value)
    const key = `${currentRun.id}:${targetSymbol}:${frame}`
    const cached = candleMemo.get(key)
    // Never reuse a longer prefix after a rewind, and never reuse a different
    // tape array (restore or a new attempt replaces the pinned market).
    if (cached && cached.source === currentTape.candles && cached.count === count) return cached.result
    const result = aggregateCandles(currentTape.candles.slice(0, count), frame)
    candleMemo.set(key, { source: currentTape.candles, frame, count, result })
    return result
  }

  function isFresh(targetSymbol: string): boolean {
    const currentTape = run.value?.tapes.find((item) => item.symbol === targetSymbol)
    const time = replayTime.value
    if (!currentTape || time === null) return false
    const index = revealedCount(currentTape.candles, time) - 1
    return currentTape.candles[index]?.time === time
  }

  function applySnapshot(): void {
    if (!session.value) return
    snapshot.value = markRaw(session.value.engine.snapshot())
    cursor.value = session.value.cursor
  }

  function failure(cause: unknown): string {
    return cause instanceof Error ? cause.message : 'Replay operation failed'
  }

  async function createCheckpoint(nextRun: ReplayRun, checkpoint: ReplayCheckpoint): Promise<void> {
    if (!repository) return
    storageStatus.value = 'saving'
    const job = saves.then(() => repository!.create(nextRun, checkpoint))
    saves = job.catch(() => {})
    try {
      await job
      persistedRuns.add(nextRun.id)
      if (run.value?.id === nextRun.id) {
        storageStatus.value = 'saved'
        storageError.value = null
      }
    } catch (cause) {
      storageStatus.value = 'unavailable'
      storageError.value = failure(cause)
    }
  }

  function startDrain(): void {
    if (drain) return
    drain = (async () => {
      await saves
      while (pendingCheckpoint) {
        const build = pendingCheckpoint
        pendingCheckpoint = null
        let checkpoint: ReplayCheckpoint
        try {
          checkpoint = build()
        } catch (cause) {
          // exportState() can fail on a future non-cloneable value or OOM.
          // Surface it instead of rejecting the drain and leaving the UI on
          // "saving" forever.
          storageStatus.value = 'unavailable'
          storageError.value = failure(cause)
          continue
        }
        const job = saves.then(() => repository!.save(checkpoint))
        saves = job.catch(() => {})
        try {
          await job
          if (run.value?.id === checkpoint.runId) {
            storageStatus.value = 'saved'
            storageError.value = null
          }
        } catch (cause) {
          storageStatus.value = 'unavailable'
          storageError.value = failure(cause)
        }
      }
    })().finally(() => {
      drain = null
      // A watcher can enqueue a step while this drain is settling. Restart
      // rather than leaving the checkpoint pending with status stuck on
      // "saving".
      if (pendingCheckpoint) startDrain()
    })
  }

  function queueCheckpoint(): void {
    const active = session.value
    if (!active || !repository) return
    if (!persistedRuns.has(active.run.id)) {
      // No checkpoint may point at a tape that failed to persist.
      storageStatus.value = 'unavailable'
      return
    }
    // Defer the expensive exportState() until the drain is ready to write. A
    // burst of steps then coalesces into the latest state instead of cloning a
    // full snapshot per step and immediately superseding it.
    pendingCheckpoint = () => active.checkpoint()
    storageStatus.value = 'saving'
    startDrain()
  }

  async function flush(): Promise<void> {
    // Creates also use `saves`. Recheck its identity because a status watcher
    // can enqueue another write while the current promise is settling.
    for (;;) {
      const writes = saves
      await writes
      if (!drain && pendingCheckpoint) startDrain()
      await drain
      if (!drain && !pendingCheckpoint && writes === saves) return
    }
  }

  function install(next: ReplaySession): void {
    candleMemo.clear()
    session.value = markRaw(next)
    run.value = markRaw(next.run)
    if (!next.run.tapes.some((item) => item.symbol === symbol.value)) symbol.value = next.run.tapes[0]!.symbol
    templateId.value = next.engine.templateSpec.id
    applySnapshot()
  }

  async function initialize(): Promise<void> {
    if (initialized || disposed) return
    if (initialization) return initialization
    initialization = (async () => {
      loading.value = true
      restorePreferences()
      try {
        repository = createReplayRepository()
        const saved = await repository.load()
        if (disposed) return
        if (saved) {
          install(ReplaySession.restore(saved))
          persistedRuns.add(saved.run.id)
          storageStatus.value = 'saved'
          storageError.value = null
          restoreBlocked.value = false
          sourceMode.value = saved.run.tapes[0]?.source ?? 'synthetic'
        } else {
          await newAttempt()
        }
      } catch (cause) {
        // Never silently reset a failed account or overwrite unreadable history.
        restoreBlocked.value = true
        storageStatus.value = 'unavailable'
        storageError.value = failure(cause)
      } finally {
        loading.value = false
        initialized = true
      }
    })().finally(() => {
      initialization = null
    })
    return initialization
  }

  async function retryRestore(): Promise<void> {
    if (!restoreBlocked.value || initialization || loading.value) return
    initialized = false
    await initialize()
  }

  async function retrySave(): Promise<void> {
    if (!session.value || restoreBlocked.value || loading.value) return
    await flush()
    if (persistedRuns.has(session.value.run.id)) {
      queueCheckpoint()
      await flush()
    } else {
      await createCheckpoint(session.value.run, session.value.checkpoint())
    }
  }

  async function newAttempt(
    options: { template?: PropTemplate; source?: 'local' | 'synthetic'; startTime?: number; reuseTapes?: boolean } = {},
  ): Promise<void> {
    pause()
    const token = ++generation
    loading.value = true
    error.value = null
    dataNotice.value = null
    await flush()
    const nextTemplate = options.template ?? template.value
    const nextSource = options.source ?? sourceMode.value
    const id = crypto.randomUUID()
    const seed = options.reuseTapes && run.value ? run.value.seed : id
    try {
      let tapes: ReplayTape[] = []
      if (options.reuseTapes && run.value) {
        tapes = run.value.tapes
      } else if (nextSource === 'local') {
        const results = await Promise.all(
          instruments.list().map(async (spec) => {
            const dataset = await loadLocalDataset(config.app.baseURL || '/', spec.symbol)
            return dataset ? localReplayTape(dataset) : null
          }),
        )
        tapes = results.filter((item): item is ReplayTape => item !== null)
        if (tapes.length && tapes.length < instruments.list().length) dataNotice.value = 'subset'
      }
      if (token !== generation || disposed) return
      if (!tapes.length) {
        if (nextSource === 'local') dataNotice.value = 'fallback'
        tapes = instruments.list().map((spec) => syntheticReplayTape(spec, seed))
      }
      tapes = [...tapes].sort((a, b) => a.symbol.localeCompare(b.symbol))
      const market = buildReplayMarket(tapes)
      let startIndex = options.reuseTapes && run.value ? run.value.startIndex : market.startIndex
      if (options.startTime !== undefined) {
        startIndex = market.timeline.findIndex(
          (time, index) => index >= market.startIndex && time >= options.startTime!,
        )
        if (startIndex < 0 || startIndex >= market.timeline.length - 1)
          throw new Error('Start time is outside the available replay window')
      }
      const pinnedSpecs =
        options.reuseTapes && run.value ? run.value.instruments : tapes.map((item) => instruments.require(item.symbol))
      const nextRun: ReplayRun = {
        schemaVersion: 1,
        id,
        seed,
        createdAt: new Date().toISOString(),
        instruments: pinnedSpecs,
        tapes,
        startIndex,
      }
      const next = new ReplaySession(nextRun, nextTemplate)
      if (token !== generation || disposed) return
      install(next)
      sourceMode.value = nextSource
      restoreBlocked.value = false
      await createCheckpoint(next.run, next.checkpoint())
    } catch (cause) {
      if (token === generation) error.value = failure(cause)
    } finally {
      if (token === generation) loading.value = false
    }
  }

  function selectSymbol(value: string): void {
    if (symbols.value.includes(value)) symbol.value = value
  }

  async function load(nextSymbol = symbol.value): Promise<void> {
    await initialize()
    selectSymbol(nextSymbol)
  }

  function stepBars(count = 1): void {
    if (!ready.value || !session.value || !Number.isInteger(count) || count < 1 || count > 10_000) return
    try {
      session.value.step(count)
      applySnapshot()
      queueCheckpoint()
    } catch (cause) {
      error.value = failure(cause)
      pause()
    }
    if (ended.value) pause()
  }

  function play(): void {
    if (!canPlay.value || playing.value) return
    playing.value = true
    accumulator = 0
    timer = setInterval(() => {
      accumulator += speed.value * 0.5
      const whole = Math.floor(accumulator)
      if (whole < 1) return
      accumulator -= whole
      stepBars(whole)
    }, TICK_MS)
  }

  function pause(): void {
    playing.value = false
    if (timer) clearInterval(timer)
    timer = null
    accumulator = 0
  }

  function toggle(): void {
    if (playing.value) pause()
    else play()
  }
  function setSpeed(value: number): void {
    if ([0.5, 1, 2, 4].includes(value)) speed.value = value
  }
  function setTimeframe(value: SimTimeframe): void {
    if (isTimeframeAvailable(value)) timeframe.value = value
  }
  async function reset(): Promise<void> {
    await newAttempt({ reuseTapes: true })
  }
  async function setTemplate(id: string): Promise<void> {
    const next = templateById(id)
    if (next) await newAttempt({ template: next, reuseTapes: true })
  }

  function command(action: () => SimResult | void): SimResult {
    if (!ready.value || !session.value) return { ok: false, error: 'Replay is not ready.' }
    try {
      const result = action() ?? { ok: true as const }
      applySnapshot()
      queueCheckpoint()
      return result
    } catch (cause) {
      return { ok: false, error: failure(cause) }
    }
  }
  function submit(input: SimOrderInput, targetSymbol = symbol.value): SimResult {
    if (!isFresh(targetSymbol) || ended.value)
      return { ok: false, error: 'No current executable bar for this instrument.' }
    if (!isMarketOpen(knownTime.value ?? 0))
      return { ok: false, error: 'Session is closed. Advance replay to the next open.' }
    return command(() => session.value!.engine.submit(input, targetSymbol))
  }
  function cancel(id: string): SimResult {
    return command(() => session.value!.engine.cancel(id))
  }
  function modify(
    id: string,
    patch: { limitPrice?: number | null; stopPrice?: number | null; qty?: number },
  ): SimResult {
    return command(() => session.value!.engine.modify(id, patch))
  }
  function cancelAll(targetSymbol?: string): SimResult {
    return command(() => session.value!.engine.cancelAll(targetSymbol))
  }
  function flatten(targetSymbol = symbol.value): SimResult {
    return command(() => session.value!.engine.flatten(targetSymbol, 'flatten'))
  }
  function reverse(targetSymbol = symbol.value): SimResult {
    if (!isFresh(targetSymbol) || ended.value || !isMarketOpen(knownTime.value ?? 0))
      return { ok: false, error: 'No current executable bar for this instrument.' }
    return command(() => session.value!.engine.reverse(targetSymbol))
  }
  function exitAll(): SimResult {
    return command(() => session.value!.engine.exitAll())
  }

  function restorePreferences(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? '{}') as Record<string, unknown>
      if (typeof saved.symbol === 'string' && instruments.has(saved.symbol)) symbol.value = saved.symbol
      if (typeof saved.timeframe === 'string' && isTimeframeAvailable(saved.timeframe as SimTimeframe))
        timeframe.value = saved.timeframe as SimTimeframe
    } catch {
      /* Browser storage is optional for display preferences. */
    }
  }
  watch([symbol, timeframe], () => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ symbol: symbol.value, timeframe: timeframe.value }))
    } catch {
      /* Accounting storage has its own visible error state. */
    }
  })
  onScopeDispose(() => {
    disposed = true
    generation += 1
    pause()
  })

  return {
    symbol,
    timeframe,
    templateId,
    template,
    sourceMode,
    source,
    error,
    dataNotice,
    loading,
    storageStatus,
    storageError,
    restoreBlocked,
    run,
    baseCandles,
    cursor,
    playing,
    speed,
    instrument,
    specs,
    symbols,
    chartCandles,
    totalBars,
    progress,
    replayTime,
    knownTime,
    ended,
    quote,
    quotes,
    account,
    position,
    orders,
    workingOrders,
    fills,
    trades,
    risk,
    ruleStatuses,
    consistency,
    mark,
    breachPrice,
    cushion,
    canPlay,
    canTrade,
    stale,
    ready,
    snapshot,
    candlesFor,
    breachFor,
    dailyLineFor,
    initialize,
    retryRestore,
    retrySave,
    load,
    selectSymbol,
    newAttempt,
    flush,
    play,
    pause,
    toggle,
    stepBars,
    setSpeed,
    setTimeframe,
    reset,
    submit,
    cancel,
    modify,
    cancelAll,
    flatten,
    reverse,
    exitAll,
    setTemplate,
  }
})
