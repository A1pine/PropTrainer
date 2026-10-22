import { createScenarioFactory, createSeed } from '~/domain/market/scenario'
import { prepareLocalScenarioInput } from '~/lib/market/local-data'
import type { LocalDataset } from '~/lib/market/types'
import type { ScenarioSource } from '~/domain/market/types'
import { findSwings } from '~/domain/market/generator'
import type { Scenario } from '~/domain/market/types'
import { createBroker, type Broker } from '~/domain/trading/broker'
import { createRules } from '~/domain/trading/types'
import type { AccountSnapshot, PlaceOrderInput } from '~/domain/trading/types'
import { computePositionSize } from '~/domain/trading/sizing'
import { validatePlan, simulatePlan, type DrillPlan, type PlanOutcome, type PlanValidation } from '~/domain/drill/plan'
import { gradeDrill, type DrillGrade } from '~/domain/drill/grade'
import type { ChartDrawing, ChartTool } from '~/lib/chart/types'
import type { RoundRecord, SessionRecord, TradeRecord } from '~/domain/stats/types'
import { instruments } from '~/domain/instruments/catalog'
import { playCue } from '~/lib/audio'

export type TrainerPhase = 'idle' | 'loading' | 'judging' | 'planning' | 'live' | 'review' | 'summary'

function blankPlan(): DrillPlan {
  return {
    state: 'range',
    direction: 'none',
    entry: null,
    stop: null,
    target: null,
    thesis: '',
    submittedAtBar: 0,
    waitedBars: 0,
  }
}

export const useTrainerStore = defineStore('trainer', () => {
  const settings = useSettingsStore()
  const history = useHistoryStore()
  const toasts = useToastStore()
  const config = useRuntimeConfig()

  // Each round replaces an immutable tape; UI state stays reactive separately.
  const scenario = shallowRef<Scenario | null>(null)
  const phase = ref<TrainerPhase>('idle')
  const roundIndex = ref(0)
  const totalRounds = ref(20)
  const sessionId = ref('')
  const sessionStartedAt = ref('')
  const visibleCount = ref(0)
  const revealed = ref(false)
  const drawings = ref<ChartDrawing[]>([])
  const tool = ref<ChartTool>('cursor')
  const plan = ref<DrillPlan>(blankPlan())
  const validation = ref<PlanValidation | null>(null)
  const account = ref<AccountSnapshot | null>(null)
  const broker = shallowRef<Broker | null>(null)
  const rounds = ref<RoundRecord[]>([])
  const playing = ref(false)
  const speed = ref(2)
  const grade = ref<DrillGrade | null>(null)
  const outcome = ref<PlanOutcome | null>(null)
  const sessionEnded = ref(false)
  const orderPending = ref(false)
  const lastPrice = ref(0)
  const scenarioSource = ref<ScenarioSource>('synthetic')

  let timer: ReturnType<typeof setInterval> | null = null
  let loadToken = 0
  let warnedFallback = false

  const rules = computed(() =>
    createRules({
      preset: settings.settings.accountPreset,
      accountSize: settings.settings.accountSize,
      maxContracts: settings.settings.maxContracts,
      riskPerTrade: settings.settings.riskPerTrade,
    }),
  )

  const universe = computed(() => {
    const resolved = instruments.resolve(settings.settings.instruments)
    return resolved.length ? resolved : instruments.list()
  })

  const factory = computed(() => createScenarioFactory({ universe: universe.value }))

  /**
   * `fallback` means the local pack was requested but no dataset could be
   * loaded, so this round silently used the synthetic generator.
   */
  const dataSource = computed<'synthetic' | 'local' | 'fallback'>(() => {
    if (settings.settings.dataSource !== 'local') return 'synthetic'
    return scenarioSource.value === 'local' ? 'local' : 'fallback'
  })

  const instrument = computed(() => scenario.value?.instrument ?? null)
  const candles = computed(() => scenario.value?.candles ?? [])
  const roundEndIndex = computed(() => {
    if (!scenario.value) return 0
    return Math.max(0, scenario.value.candles.length - scenario.value.revealBars - 1)
  })
  const lastCandle = computed(() => candles.value[Math.max(0, visibleCount.value - 1)])
  const atr = computed(() => scenario.value?.metrics.atr ?? 0)
  const riskBudget = computed(() => (settings.settings.accountSize * settings.settings.riskPerTrade) / 100)
  const sizing = computed(() => {
    if (!instrument.value || plan.value.entry == null || plan.value.stop == null) return null
    return computePositionSize({
      instrument: instrument.value,
      entry: plan.value.entry,
      stop: plan.value.stop,
      target: plan.value.target,
      riskBudget: riskBudget.value,
      maxContracts: rules.value.maxContracts,
    })
  })
  const roundStats = computed(() => {
    const closed = rounds.value
    const netPnl = closed.reduce((total, round) => total + round.netPnl, 0)
    const wins = closed.filter((round) => round.netPnl > 0).length
    const rValues = closed
      .flatMap((round) => round.trades.map((trade) => trade.rMultiple))
      .filter((r): r is number => r != null)
    return {
      count: closed.length,
      netPnl,
      wins,
      winRate: closed.length ? Math.round((wins / closed.length) * 1000) / 10 : 0,
      avgR: rValues.length ? rValues.reduce((sum, r) => sum + r, 0) / rValues.length : null,
      fees: closed.reduce((total, round) => total + round.fees, 0),
      breaches: closed.filter((round) => round.status === 'breached').length,
    }
  })
  const sessionNet = computed(
    () =>
      roundStats.value.netPnl +
      (phase.value === 'review' || phase.value === 'summary' ? 0 : (account.value?.netPnl ?? 0)),
  )
  const progress = computed(() =>
    totalRounds.value ? Math.min(100, (rounds.value.length / totalRounds.value) * 100) : 0,
  )

  function stopPlayback() {
    if (timer) clearInterval(timer)
    timer = null
    playing.value = false
  }

  const visibleSwings = computed(() => findSwings(candles.value.slice(0, Math.max(1, visibleCount.value)), 3))

  function updateValidation() {
    if (!scenario.value) return
    validation.value = validatePlan(plan.value, {
      instrument: scenario.value.instrument,
      atr: scenario.value.metrics.atr,
      swings:
        plan.value.direction !== 'none' &&
        plan.value.entry != null &&
        plan.value.stop != null &&
        plan.value.target != null
          ? visibleSwings.value
          : [],
      endIndex: visibleCount.value - 1,
      riskBudget: riskBudget.value,
      maxContracts: rules.value.maxContracts,
    })
  }

  function syncPlanBar() {
    plan.value.submittedAtBar = Math.max(0, visibleCount.value - 1)
  }

  function announce(events: { type: string; [key: string]: unknown }[]) {
    const sound = settings.settings.sound
    for (const event of events) {
      if (event.type === 'filled') playCue('fill', sound)
      if (event.type === 'exit') {
        const trade = (event as { trade?: { pnl: number } }).trade
        if ((trade?.pnl ?? 0) >= 0) playCue('win', sound)
        else playCue('loss', sound)
      }
      if (event.type === 'breach') {
        playCue('breach', sound)
        const rule = String((event as { rule?: string }).rule ?? '')
        toasts.error('Account locked', `Guardrail breached: ${rule}. The round is over.`)
      }
      if (event.type === 'target') {
        playCue('win', sound)
        toasts.success('Evaluation target reached', 'The round closes with the account passed.')
      }
    }
  }

  async function startSession(options: { rounds?: number } = {}) {
    stopPlayback()
    history.hydrate()
    sessionId.value = `s-${Date.now().toString(36)}`
    sessionStartedAt.value = new Date().toISOString()
    totalRounds.value = options.rounds ?? 20
    roundIndex.value = 0
    rounds.value = []
    sessionEnded.value = false
    await nextRound()
  }

  async function nextRound() {
    stopPlayback()
    const token = ++loadToken
    phase.value = 'loading'
    revealed.value = false
    drawings.value = []
    tool.value = 'cursor'
    grade.value = null
    outcome.value = null
    orderPending.value = false
    plan.value = blankPlan()
    validation.value = null
    account.value = null
    broker.value = null
    roundIndex.value += 1

    const seed = createSeed()
    let dataset: LocalDataset | undefined
    if (settings.settings.dataSource === 'local') {
      const prepared = await prepareLocalScenarioInput({
        baseURL: config.app.baseURL,
        symbols: universe.value.map((item) => item.symbol),
        seed,
      })
      dataset = prepared?.dataset
      if (!dataset && !warnedFallback) {
        warnedFallback = true
        toasts.push({
          title: 'Local pack unavailable',
          description: 'Falling back to simulated bars. Run `bun run data:fetch` and re-check in Settings.',
          variant: 'warn',
        })
      }
    }
    if (token !== loadToken) return

    const next = factory.value.create({ seed, dataset })
    scenarioSource.value = next.source
    scenario.value = markRaw(next)
    visibleCount.value = next.replayStart
    syncPlanBar()

    const roundBroker = createBroker({
      instrument: next.instrument,
      rules: rules.value,
      feePerContract: settings.settings.feePerContract > 0 ? settings.settings.feePerContract : undefined,
    })
    const price = next.candles[next.replayStart - 1]?.close ?? next.candles[0]?.close ?? 0
    roundBroker.prime(price, next.replayStart - 1)
    broker.value = roundBroker
    account.value = roundBroker.snapshot()
    lastPrice.value = price
    phase.value = 'judging'
  }

  function waitBar() {
    if (phase.value !== 'judging' || !scenario.value) return
    if (visibleCount.value >= roundEndIndex.value) return
    if (plan.value.waitedBars >= 60) return
    visibleCount.value += 1
    plan.value.waitedBars += 1
    syncPlanBar()
    lastPrice.value = lastCandle.value?.close ?? lastPrice.value
    broker.value?.prime(lastPrice.value, visibleCount.value - 1)
    if (broker.value) account.value = broker.value.snapshot()
    if (validation.value) updateValidation()
  }

  function commitRead() {
    if (!scenario.value) return false
    phase.value = 'planning'
    if (plan.value.direction !== 'none' && plan.value.entry == null) {
      const last = lastCandle.value?.close ?? 0
      const direction = plan.value.direction === 'long' ? 1 : -1
      plan.value.entry = last
      plan.value.stop = last - direction * atr.value * 1.2
      plan.value.target = last + direction * atr.value * 2.4
      updateValidation()
    }
    return true
  }

  function updatePlan(patch: Partial<DrillPlan>) {
    const changed = (['direction', 'entry', 'stop', 'target'] as const).some(
      (key) => key in patch && patch[key] !== plan.value[key],
    )
    Object.assign(plan.value, patch)
    if (changed) updateValidation()
  }

  function setDirection(direction: DrillPlan['direction']) {
    updatePlan({ direction })
  }

  function updateLevel(kind: 'entry' | 'stop' | 'target', price: number) {
    const next = { ...plan.value, [kind]: price }
    if (next.direction === 'long') {
      if (kind === 'stop' && next.entry != null)
        next.stop = Math.min(price, next.entry - (instrument.value?.tickSize ?? 0.25))
      if (kind === 'target' && next.entry != null)
        next.target = Math.max(price, next.entry + (instrument.value?.tickSize ?? 0.25))
    }
    if (next.direction === 'short') {
      if (kind === 'stop' && next.entry != null)
        next.stop = Math.max(price, next.entry + (instrument.value?.tickSize ?? 0.25))
      if (kind === 'target' && next.entry != null)
        next.target = Math.min(price, next.entry - (instrument.value?.tickSize ?? 0.25))
    }
    updatePlan(next)
  }

  function startPlayback() {
    if (timer || !scenario.value) return
    playing.value = true
    timer = setInterval(
      () => {
        if (phase.value !== 'live') {
          stopPlayback()
          return
        }
        step()
      },
      Math.round(1000 / Math.max(1, speed.value)),
    )
  }

  function setSpeed(value: number) {
    speed.value = value
    if (playing.value) {
      stopPlayback()
      startPlayback()
    }
  }

  /** Advance one bar, feed the broker, and resolve round-end conditions. */
  function step() {
    if (!scenario.value || !broker.value) return
    if (phase.value !== 'live') return
    const index = visibleCount.value
    if (index > roundEndIndex.value) {
      finishRound()
      return
    }
    const candle = candles.value[index]
    if (!candle) {
      finishRound()
      return
    }
    visibleCount.value = index + 1
    lastPrice.value = candle.close
    const update = broker.value.onBar(candle, index)
    account.value = update.snapshot
    announce(update.events)
    if (update.snapshot.status !== 'active') {
      finishRound()
    }
  }

  function submitPlan() {
    if (!scenario.value || !broker.value) return
    if (plan.value.direction === 'none') {
      phase.value = 'live'
      orderPending.value = false
      startPlayback()
      return
    }
    updateValidation()
    if (sizing.value == null || sizing.value.contracts < 1) {
      toasts.error(
        'Risk budget too small',
        'One contract risks more than your per-trade budget. Widen the account risk or tighten the stop.',
      )
      return
    }
    const entry = plan.value.entry
    const stop = plan.value.stop
    const target = plan.value.target
    if (entry == null || stop == null) return
    const result = broker.value.placeOrder(
      {
        side: plan.value.direction,
        type: 'limit',
        qty: sizing.value.contracts,
        limitPrice: entry,
        stopLoss: stop,
        takeProfit: target,
      },
      lastPrice.value,
      visibleCount.value - 1,
    )
    if (!result.ok) {
      toasts.error('Order rejected', result.error)
      return
    }
    account.value = broker.value.snapshot()
    if (result.events.length) announce(result.events)
    orderPending.value = result.order.status === 'working'
    phase.value = 'live'
    startPlayback()
  }

  function placeTicketOrder(input: Omit<PlaceOrderInput, 'qty'> & { qty: number }) {
    if (!broker.value || !scenario.value) return
    const result = broker.value.placeOrder(input, lastPrice.value, visibleCount.value - 1)
    if (!result.ok) {
      toasts.error('Order rejected', result.error)
      return
    }
    account.value = broker.value.snapshot()
    orderPending.value = result.order.status === 'working'
    announce(result.events)
    if (phase.value !== 'live') phase.value = 'live'
  }

  function cancelOrder(id: string) {
    if (!broker.value) return
    if (broker.value.cancelOrder(id)) {
      account.value = broker.value.snapshot()
      orderPending.value = false
    }
  }

  function closePosition() {
    if (!broker.value || !account.value?.position) return
    const trade = broker.value.closePosition(lastPrice.value, visibleCount.value - 1, 'manual')
    account.value = broker.value.snapshot()
    if (trade)
      toasts.push({
        title: 'Position closed',
        description: `P&L ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}`,
        variant: trade.pnl >= 0 ? 'success' : 'warn',
      })
  }

  function moveStopToBreakEven() {
    if (!broker.value || !account.value?.position) return
    const position = account.value.position
    if (broker.value.updateBrackets(position.entryPrice, position.takeProfit)) {
      account.value = broker.value.snapshot()
    }
  }

  function finishRound(persist = true) {
    if (phase.value === 'review' || phase.value === 'summary') return
    stopPlayback()
    if (!scenario.value || !broker.value) return
    if (broker.value.getPosition()) {
      broker.value.closePosition(lastPrice.value, visibleCount.value - 1, 'end')
    }
    const snapshot = broker.value.snapshot()
    account.value = snapshot

    const planAtDecision = {
      ...plan.value,
      submittedAtBar: Math.min(plan.value.submittedAtBar, scenario.value.replayStart - 1 + plan.value.waitedBars),
    }
    const firstTrade = snapshot.trades[0]
    const planOutcome: PlanOutcome = firstTrade
      ? {
          filled: true,
          entryBar: firstTrade.entryBar,
          entryPrice: firstTrade.entryPrice,
          exitBar: firstTrade.exitBar,
          exitPrice: firstTrade.exitPrice,
          exitReason:
            firstTrade.exitReason === 'stop' || firstTrade.exitReason === 'target' ? firstTrade.exitReason : 'timeout',
          rMultiple: firstTrade.rMultiple,
          maeR: null,
          mfeR: null,
          barsToEntry: Math.max(0, firstTrade.entryBar - planAtDecision.submittedAtBar),
          barsHeld: firstTrade.exitBar - firstTrade.entryBar + 1,
        }
      : simulatePlan(planAtDecision, scenario.value.candles, scenario.value.instrument, 260)
    outcome.value = planOutcome

    if (planAtDecision.direction !== 'none') {
      const planValidation = validatePlan(planAtDecision, {
        instrument: scenario.value.instrument,
        atr: scenario.value.metrics.atr,
        swings: findSwings(scenario.value.candles.slice(0, planAtDecision.submittedAtBar + 1), 3),
        endIndex: planAtDecision.submittedAtBar,
        riskBudget: riskBudget.value,
        maxContracts: rules.value.maxContracts,
      })
      grade.value = gradeDrill({
        plan: planAtDecision,
        scenario: scenario.value,
        validation: planValidation,
        outcome: planOutcome,
      })
    } else {
      grade.value = null
    }

    const record = buildRoundRecord(snapshot)
    rounds.value = [...rounds.value, record]
    revealed.value = true
    visibleCount.value = scenario.value.candles.length
    phase.value = 'review'
    playCue('reveal', settings.settings.sound)
    if (persist) persistSession()
  }

  function buildRoundRecord(snapshot: AccountSnapshot): RoundRecord {
    const now = new Date().toISOString()
    const trades: TradeRecord[] = snapshot.trades.map((trade) => ({
      id: `${sessionId.value}-r${roundIndex.value}-${trade.id}`,
      sessionId: sessionId.value,
      roundIndex: roundIndex.value,
      mode: 'trainer',
      symbol: scenario.value?.instrument.symbol ?? '',
      side: trade.side,
      qty: trade.qty,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      entryBar: trade.entryBar,
      exitBar: trade.exitBar,
      entryTime: candles.value[trade.entryBar]?.time ?? 0,
      exitTime: candles.value[trade.exitBar]?.time ?? 0,
      pnl: trade.pnl,
      fees: trade.fees,
      rMultiple: trade.rMultiple,
      mae: trade.mae,
      mfe: trade.mfe,
      exitReason: trade.exitReason,
      regime: scenario.value?.regime ?? 'range',
      followedPlan:
        plan.value.direction !== 'none' &&
        plan.value.direction === trade.side &&
        plan.value.entry != null &&
        Math.abs(trade.entryPrice - plan.value.entry) <= (instrument.value?.tickSize ?? 0.25) * 2,
      createdAt: now,
    }))
    return {
      id: `${sessionId.value}-r${roundIndex.value}`,
      sessionId: sessionId.value,
      index: roundIndex.value,
      mode: 'trainer',
      symbol: scenario.value?.instrument.symbol ?? '',
      sessionDate: scenario.value?.sessionDate ?? now,
      regime: scenario.value?.regime ?? 'range',
      timeframeMinutes: scenario.value?.timeframeMinutes ?? 5,
      startBalance: rules.value.accountSize,
      endBalance: snapshot.equity,
      netPnl: snapshot.netPnl,
      fees: snapshot.fees,
      rMultiple: trades.reduce((total, trade) => total + (trade.rMultiple ?? 0), 0),
      trades,
      grade: grade.value?.letter ?? null,
      processScore: grade.value?.total ?? null,
      status: snapshot.status === 'breached' ? 'breached' : snapshot.status === 'target' ? 'target' : 'ended',
      startedAt: sessionStartedAt.value || now,
      endedAt: now,
      reveal: true,
    }
  }

  function buildSessionRecord(): SessionRecord {
    const netPnl = rounds.value.reduce((total, round) => total + round.netPnl, 0)
    return {
      id: sessionId.value,
      mode: 'trainer',
      startedAt: sessionStartedAt.value,
      endedAt: phase.value === 'summary' ? new Date().toISOString() : null,
      rounds: [...rounds.value],
      startBalance: rules.value.accountSize,
      endBalance: rules.value.accountSize + netPnl,
      netPnl,
      fees: rounds.value.reduce((total, round) => total + round.fees, 0),
      ruleStatus:
        account.value?.status === 'breached'
          ? 'breached'
          : account.value?.status === 'target'
            ? 'target'
            : phase.value === 'summary'
              ? 'ended'
              : 'active',
      targetRounds: totalRounds.value,
      completed: rounds.value.length >= totalRounds.value,
    }
  }

  function persistSession() {
    if (!sessionId.value || !rounds.value.length) return
    history.saveSession(buildSessionRecord())
  }

  function endSession() {
    stopPlayback()
    sessionEnded.value = true
    loadToken += 1
    if (phase.value !== 'summary') {
      if (phase.value === 'live') finishRound(false)
      phase.value = 'summary'
    }
    persistSession()
  }

  function resetSession() {
    stopPlayback()
    loadToken += 1
    phase.value = 'idle'
    scenario.value = null
    rounds.value = []
    roundIndex.value = 0
    sessionId.value = ''
    account.value = null
    broker.value = null
    plan.value = blankPlan()
    revealed.value = false
    visibleCount.value = 0
    grade.value = null
    outcome.value = null
    sessionEnded.value = false
    scenarioSource.value = 'synthetic'
  }

  function advanceRound() {
    if (roundIndex.value >= totalRounds.value) {
      endSession()
      return
    }
    void nextRound()
  }

  function revealEverything() {
    if (!scenario.value) return
    revealed.value = true
    visibleCount.value = scenario.value.candles.length
  }

  return {
    // state
    scenario,
    phase,
    roundIndex,
    totalRounds,
    sessionId,
    sessionStartedAt,
    visibleCount,
    revealed,
    drawings,
    tool,
    plan,
    validation,
    account,
    rounds,
    playing,
    speed,
    grade,
    outcome,
    sessionEnded,
    orderPending,
    lastPrice,
    scenarioSource,
    dataSource,
    // derived
    rules,
    universe,
    instrument,
    candles,
    roundEndIndex,
    lastCandle,
    atr,
    riskBudget,
    sizing,
    roundStats,
    sessionNet,
    progress,
    // actions
    startSession,
    nextRound,
    waitBar,
    commitRead,
    updatePlan,
    setDirection,
    updateLevel,
    startPlayback,
    stopPlayback,
    setSpeed,
    step,
    submitPlan,
    placeTicketOrder,
    cancelOrder,
    closePosition,
    moveStopToBreakEven,
    finishRound,
    endSession,
    resetSession,
    advanceRound,
    revealEverything,
    updateValidation,
  }
})
