import { createScenarioFactory, createSeed } from '~/domain/market/scenario'
import type { Scenario } from '~/domain/market/types'
import { instruments } from '~/domain/instruments/catalog'
import { analyzeMarket } from '~/domain/analysis/analyze'
import type { AnalysisReport } from '~/domain/analysis/types'
import { buildChartAnalysis, defaultAnalysisLayers } from '~/lib/chart/analysis'
import type { AnalysisLayers } from '~/lib/chart/analysis'
import type { ChartAnalysis } from '~/lib/chart/types'
import { ensureWasmCore } from '~/domain/wasm/loader'
import { prepareLocalScenarioInput } from '~/lib/market/local-data'
import type { LocalDataset } from '~/lib/market/types'
import type { ScenarioSource } from '~/domain/market/types'

export type AnalysisTab = 'overview' | 'pa' | 'ict' | 'flow' | 'indicators'

export const useAnalysisStore = defineStore('analysis', () => {
  const settings = useSettingsStore()
  const config = useRuntimeConfig()
  const scenario = shallowRef<Scenario | null>(null)
  const visibleCount = ref(0)
  const playing = ref(false)
  const speed = ref(2)
  const revealed = ref(false)
  const seed = ref('')
  const tab = ref<AnalysisTab>('overview')
  const coreReady = ref(false)
  const coreError = ref(false)
  const toggles = ref<AnalysisLayers>({ ...defaultAnalysisLayers })
  const scenarioSource = ref<ScenarioSource>('synthetic')
  let timer: ReturnType<typeof setInterval> | null = null
  let loadToken = 0

  const candles = computed(() => scenario.value?.candles ?? [])
  const visible = computed(() => candles.value.slice(0, visibleCount.value))
  const instrument = computed(() => scenario.value?.instrument ?? null)
  const report = computed<AnalysisReport | null>(() => {
    // Depend on coreReady so the report recomputes once the wasm core lands.
    if (!coreReady.value || visible.value.length < 30) return null
    return analyzeMarket(visible.value, instrument.value?.pricePrecision ?? 2)
  })
  const maxVisible = computed(() => {
    if (!scenario.value) return 0
    return Math.max(0, scenario.value.candles.length - scenario.value.revealBars)
  })

  const overlay = computed<ChartAnalysis>(() => buildChartAnalysis(report.value, visibleCount.value, toggles.value))

  const maskedSymbol = computed(() => {
    if (!instrument.value) return 'M???'
    return revealed.value ? instrument.value.symbol : instrument.value.mask
  })

  const sampleDate = computed(() => (scenario.value ? new Date(scenario.value.sessionDate) : null))

  async function ensureCore(): Promise<boolean> {
    if (coreReady.value) return true
    const core = await ensureWasmCore(config.app.baseURL || '/')
    coreReady.value = core != null
    coreError.value = core == null
    return coreReady.value
  }

  function stopPlayback() {
    if (timer) clearInterval(timer)
    timer = null
    playing.value = false
  }

  async function start(options: { seed?: string } = {}) {
    stopPlayback()
    const token = ++loadToken
    settings.hydrate()
    const universe = instruments.resolve(settings.settings.instruments)
    const factory = createScenarioFactory({ universe: universe.length ? universe : instruments.list() })
    const nextSeed = options.seed ?? createSeed()
    let dataset: LocalDataset | undefined
    if (settings.settings.dataSource === 'local') {
      const prepared = await prepareLocalScenarioInput({
        baseURL: config.app.baseURL,
        symbols: (universe.length ? universe : instruments.list()).map((item) => item.symbol),
        seed: nextSeed,
      })
      dataset = prepared?.dataset
    }
    if (token !== loadToken) return false
    const next = factory.create({ seed: nextSeed, dataset })
    seed.value = nextSeed
    scenarioSource.value = next.source
    scenario.value = markRaw(next)
    visibleCount.value = Math.min(next.candles.length, next.replayStart + 80)
    revealed.value = false
    tab.value = 'overview'
    toggles.value = { ...defaultAnalysisLayers }
    return true
  }

  function newSample() {
    return start()
  }

  function step(count = 1) {
    if (!scenario.value) return
    visibleCount.value = Math.min(maxVisible.value, visibleCount.value + count)
  }

  function play() {
    if (timer || !scenario.value) return
    if (visibleCount.value >= maxVisible.value) visibleCount.value = scenario.value.replayStart
    playing.value = true
    timer = setInterval(
      () => {
        if (visibleCount.value >= maxVisible.value) {
          stopPlayback()
          return
        }
        visibleCount.value += 1
      },
      Math.round(1000 / Math.max(1, speed.value)),
    )
  }

  function togglePlayback() {
    if (playing.value) stopPlayback()
    else play()
  }

  function reveal() {
    revealed.value = true
  }

  function setSpeed(value: number) {
    speed.value = value
    if (playing.value) {
      stopPlayback()
      play()
    }
  }

  return {
    scenario,
    visibleCount,
    playing,
    speed,
    revealed,
    seed,
    tab,
    toggles,
    coreReady,
    coreError,
    candles,
    visible,
    instrument,
    report,
    maxVisible,
    overlay,
    maskedSymbol,
    sampleDate,
    scenarioSource,
    start,
    ensureCore,
    newSample,
    step,
    play,
    stopPlayback,
    togglePlayback,
    setSpeed,
    reveal,
  }
})
