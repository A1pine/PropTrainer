import { createScenarioFactory, createSeed } from '~/domain/market/scenario'
import { prepareLocalScenarioInput } from '~/lib/market/local-data'
import type { LocalDataset } from '~/lib/market/types'
import type { ScenarioSource } from '~/domain/market/types'
import { dailyScenarioNow } from '~/domain/market/daily'
import { findSwings } from '~/domain/market/generator'
import type { Scenario } from '~/domain/market/types'
import {
  simulatePlan,
  validatePlan,
  type DrillPlan,
  type PlanOutcome,
  type PlanValidation,
  type TradeDirection,
} from '~/domain/drill/plan'
import { gradeDrill, type DrillGrade } from '~/domain/drill/grade'
import type { RoundRecord, SessionRecord } from '~/domain/stats/types'
import { computePositionSize } from '~/domain/trading/sizing'
import { instruments } from '~/domain/instruments/catalog'
import type { ChartDrawing, ChartTool } from '~/lib/chart/types'
import { createRules } from '~/domain/trading/types'
import { playCue } from '~/lib/audio'

export type DrillPhase = 'idle' | 'reading' | 'planning' | 'review'

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

export const useDrillStore = defineStore('drill', () => {
  const settings = useSettingsStore()
  const history = useHistoryStore()
  const config = useRuntimeConfig()

  const phase = ref<DrillPhase>('idle')
  const scenario = shallowRef<Scenario | null>(null)
  const seed = ref('')
  const visibleCount = ref(0)
  const plan = ref<DrillPlan>(blankPlan())
  const validation = ref<PlanValidation | null>(null)
  const grade = ref<DrillGrade | null>(null)
  const outcome = ref<PlanOutcome | null>(null)
  const drawings = ref<ChartDrawing[]>([])
  const tool = ref<ChartTool>('cursor')
  const revealed = ref(false)
  const submittedAt = ref('')
  const mode = ref<'drill' | 'daily' | 'pk'>('drill')
  const scenarioSource = ref<ScenarioSource>('synthetic')
  let loadToken = 0

  const instrument = computed(() => scenario.value?.instrument ?? null)
  const candles = computed(() => scenario.value?.candles ?? [])
  const rules = computed(() =>
    createRules({
      preset: settings.settings.accountPreset,
      accountSize: settings.settings.accountSize,
      maxContracts: settings.settings.maxContracts,
    }),
  )
  const riskBudget = computed(() => (settings.settings.accountSize * settings.settings.riskPerTrade) / 100)
  const lastPrice = computed(() => candles.value[Math.max(0, visibleCount.value - 1)]?.close ?? 0)
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
  async function start(options: { seed?: string; mode?: 'drill' | 'daily' | 'pk' } = {}) {
    const token = ++loadToken
    const nextSeed = options.seed ?? createSeed()
    const nextMode = options.mode ?? 'drill'
    const selected = nextMode === 'drill' ? instruments.resolve(settings.settings.instruments) : instruments.list()
    const enabled = selected.length ? selected : instruments.list()
    const factory = createScenarioFactory({
      universe: enabled,
      now:
        nextMode === 'daily'
          ? dailyScenarioNow(nextSeed)
          : nextMode === 'pk'
            ? new Date('2024-01-01T12:00:00Z')
            : new Date(),
    })
    let dataset: LocalDataset | undefined
    if (nextMode === 'drill' && settings.settings.dataSource === 'local') {
      const prepared = await prepareLocalScenarioInput({
        baseURL: config.app.baseURL,
        symbols: enabled.map((item) => item.symbol),
        seed: nextSeed,
      })
      dataset = prepared?.dataset
    }
    if (token !== loadToken) return false
    const next = options.seed
      ? factory.createFromSeed(nextSeed, undefined, undefined, dataset)
      : factory.create({ seed: nextSeed, dataset })
    seed.value = nextSeed
    mode.value = nextMode
    scenario.value = markRaw(next)
    scenarioSource.value = next.source
    visibleCount.value = next.replayStart
    plan.value = blankPlan()
    plan.value.submittedAtBar = visibleCount.value - 1
    validation.value = null
    grade.value = null
    outcome.value = null
    drawings.value = []
    tool.value = 'cursor'
    revealed.value = false
    submittedAt.value = ''
    phase.value = 'reading'
    return true
  }

  function wait() {
    if (phase.value !== 'reading' || !scenario.value) return
    const max = scenario.value.candles.length - 1
    if (visibleCount.value >= Math.min(max, scenario.value.replayStart + 80)) return
    visibleCount.value += 1
    plan.value.waitedBars += 1
    plan.value.submittedAtBar = visibleCount.value - 1
    if (validation.value) updateValidation()
  }

  const visibleSwings = computed(() => findSwings(candles.value.slice(0, Math.max(1, visibleCount.value)), 3))

  function context() {
    if (!scenario.value) return null
    return {
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
    }
  }

  function updateValidation() {
    const ctx = context()
    if (!ctx) return
    validation.value = validatePlan(plan.value, ctx)
  }

  function commitRead() {
    if (!scenario.value) return
    phase.value = 'planning'
    plan.value.submittedAtBar = visibleCount.value - 1
    if (plan.value.direction !== 'none' && plan.value.entry == null) {
      const atr = scenario.value.metrics.atr
      const direction = plan.value.direction === 'long' ? 1 : -1
      plan.value.entry = lastPrice.value
      plan.value.stop = lastPrice.value - direction * atr * 1.2
      plan.value.target = lastPrice.value + direction * atr * 2.4
    }
    updateValidation()
  }

  function setDirection(direction: TradeDirection) {
    updatePlan({ direction })
  }

  function updatePlan(patch: Partial<DrillPlan>) {
    const changed = (['direction', 'entry', 'stop', 'target'] as const).some(
      (key) => key in patch && patch[key] !== plan.value[key],
    )
    Object.assign(plan.value, patch)
    if (changed) updateValidation()
  }

  function updateLevel(kind: 'entry' | 'stop' | 'target', price: number) {
    const tick = instrument.value?.tickSize ?? 0.25
    const next = { ...plan.value, [kind]: price }
    if (next.direction === 'long') {
      if (kind === 'stop' && next.entry != null) next.stop = Math.min(price, next.entry - tick)
      if (kind === 'target' && next.entry != null) next.target = Math.max(price, next.entry + tick)
    } else if (next.direction === 'short') {
      if (kind === 'stop' && next.entry != null) next.stop = Math.max(price, next.entry + tick)
      if (kind === 'target' && next.entry != null) next.target = Math.min(price, next.entry - tick)
    }
    updatePlan(next)
  }

  function backToRead() {
    phase.value = 'reading'
  }

  function submit() {
    if (!scenario.value || phase.value !== 'planning') return
    const ctx = context()
    if (!ctx) return
    const finalValidation = validatePlan(plan.value, ctx)
    validation.value = finalValidation
    const result = simulatePlan(plan.value, candles.value, scenario.value.instrument, 300)
    outcome.value = result
    grade.value = gradeDrill({
      plan: { ...plan.value },
      scenario: scenario.value,
      validation: finalValidation,
      outcome: result,
    })
    revealed.value = true
    visibleCount.value = candles.value.length
    phase.value = 'review'
    submittedAt.value = new Date().toISOString()
    playCue('reveal', settings.settings.sound)
    persist()
  }

  function persist() {
    if (!scenario.value || !grade.value) return
    history.hydrate()
    // The daily is one submission per UTC day: practice replays are allowed,
    // but they cannot overwrite the first committed result.
    if (mode.value === 'daily' && history.sessions.some((session) => session.id === `drill-${seed.value}`)) return
    const now = new Date().toISOString()
    const round: RoundRecord = {
      id: `drill-${seed.value}-${Date.now()}`,
      sessionId: `drill-session-${seed.value}`,
      index: 1,
      mode: mode.value,
      symbol: scenario.value.instrument.symbol,
      sessionDate: scenario.value.sessionDate,
      regime: scenario.value.regime,
      timeframeMinutes: scenario.value.timeframeMinutes,
      startBalance: rules.value.accountSize,
      endBalance: rules.value.accountSize,
      netPnl: 0,
      fees: 0,
      rMultiple: outcome.value?.rMultiple ?? null,
      trades: [],
      grade: grade.value.letter,
      processScore: grade.value.total,
      status: 'ended',
      startedAt: submittedAt.value || now,
      endedAt: now,
      reveal: true,
    }
    const session: SessionRecord = {
      id: `drill-${seed.value}`,
      mode: mode.value,
      startedAt: submittedAt.value || now,
      endedAt: now,
      rounds: [round],
      startBalance: rules.value.accountSize,
      endBalance: rules.value.accountSize,
      netPnl: 0,
      fees: 0,
      ruleStatus: 'ended',
      targetRounds: 1,
      completed: true,
    }
    history.saveSession(session)
  }

  function next() {
    return start()
  }

  return {
    phase,
    scenario,
    seed,
    visibleCount,
    plan,
    validation,
    grade,
    outcome,
    drawings,
    tool,
    revealed,
    submittedAt,
    mode,
    scenarioSource,
    instrument,
    candles,
    rules,
    riskBudget,
    lastPrice,
    sizing,
    start,
    wait,
    commitRead,
    setDirection,
    updatePlan,
    updateLevel,
    backToRead,
    submit,
    next,
    updateValidation,
  }
})
