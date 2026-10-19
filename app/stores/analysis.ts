import { createScenarioFactory, createSeed } from '~/domain/market/scenario'
import type { Scenario } from '~/domain/market/types'
import { instruments } from '~/domain/instruments/catalog'
import { analyzeMarket } from '~/domain/analysis/analyze'
import type { AnalysisReport } from '~/domain/analysis/types'
import type { ChartAnalysis, ChartTone } from '~/lib/chart/types'
import { ensureWasmCore } from '~/domain/wasm/loader'

export type AnalysisTab = 'overview' | 'pa' | 'ict' | 'flow' | 'indicators'

const defaultToggles = {
  ema: true,
  vwap: true,
  bb: false,
  fvg: true,
  ob: true,
  liquidity: true,
  profile: true,
}

export const useAnalysisStore = defineStore('analysis', () => {
  const settings = useSettingsStore()
  const scenario = ref<Scenario | null>(null)
  const visibleCount = ref(0)
  const playing = ref(false)
  const speed = ref(2)
  const revealed = ref(false)
  const seed = ref('')
  const tab = ref<AnalysisTab>('overview')
  const coreReady = ref(false)
  const coreError = ref(false)
  const toggles = ref({ ...defaultToggles })
  let timer: ReturnType<typeof setInterval> | null = null

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

  const overlay = computed<ChartAnalysis>(() => {
    const data = report.value
    const empty: ChartAnalysis = { series: [], zones: [], levels: [], markers: [], profile: [] }
    if (!data || !scenario.value) return empty
    const end = Math.max(0, visibleCount.value - 1)
    const series: ChartAnalysis['series'] = []
    if (toggles.value.ema) {
      series.push(
        { id: 'ema20', tone: 'clay', width: 1.2, points: data.indicators.ema20 },
        { id: 'ema50', tone: 'bull', width: 1.1, points: data.indicators.ema50 },
        { id: 'ema200', tone: 'bear', width: 1.1, points: data.indicators.ema200 },
      )
    }
    if (toggles.value.vwap) {
      series.push({ id: 'vwap', tone: 'ink', width: 1, dashed: true, points: data.indicators.vwap })
    }
    if (toggles.value.bb) {
      series.push(
        { id: 'bbUpper', tone: 'muted', width: 1, dashed: true, points: data.indicators.bbUpper },
        { id: 'bbLower', tone: 'muted', width: 1, dashed: true, points: data.indicators.bbLower },
      )
    }

    const zones: ChartAnalysis['zones'] = []
    if (toggles.value.fvg) {
      for (const gap of data.ict.fvgs.filter((item) => item.filled < 0.95).slice(0, 4)) {
        zones.push({
          id: `fvg-${gap.from}-${gap.direction}`,
          from: gap.from,
          to: end,
          top: gap.top,
          bottom: gap.bottom,
          tone: gap.direction === 'bullish' ? 'bull' : 'bear',
          label: 'FVG',
        })
      }
    }
    if (toggles.value.ob) {
      for (const block of data.ict.orderBlocks.slice(0, 4)) {
        zones.push({
          id: `ob-${block.index}`,
          from: block.index,
          to: Math.min(end, block.index + 12),
          top: block.top,
          bottom: block.bottom,
          tone: block.direction === 'bullish' ? 'bull' : 'bear',
          label: 'OB',
        })
      }
    }

    const levels: ChartAnalysis['levels'] = []
    if (toggles.value.liquidity) {
      for (const level of data.ict.liquidity.slice(0, 4)) {
        levels.push({
          id: `liq-${level.index}-${level.kind}`,
          price: level.price,
          tone: 'clay',
          label: `${level.kind.toUpperCase()} · ${level.touches}`,
        })
      }
      for (const level of data.pa.levels.slice(0, 3)) {
        levels.push({
          id: `sr-${level.lastIndex}-${level.kind}`,
          price: level.price,
          tone: 'muted',
          label: `${level.kind === 'support' ? 'S' : 'R'} · ${level.touches}`,
        })
      }
    }
    if (toggles.value.profile) {
      levels.push(
        { id: 'poc', price: data.flow.poc, tone: 'clay', label: 'POC' },
        { id: 'vah', price: data.flow.vah, tone: 'warn', label: 'VAH' },
        { id: 'val', price: data.flow.val, tone: 'warn', label: 'VAL' },
      )
    }

    const markers: ChartAnalysis['markers'] = []
    for (const item of data.trend.breaks.slice(0, 6)) {
      markers.push({
        id: `break-${item.index}-${item.kind}`,
        index: item.index,
        price: item.price,
        tone: item.direction === 'bullish' ? 'bull' : 'bear',
        label: item.kind === 'bos' ? 'BOS' : 'CHoCH',
      })
    }
    for (const sweep of data.ict.sweeps.slice(0, 5)) {
      markers.push({
        id: `sweep-${sweep.index}`,
        index: sweep.index,
        price: sweep.price,
        tone: sweep.direction === 'bullish' ? 'bull' : 'bear',
        label: 'SWEEP',
      })
    }

    return {
      series,
      zones,
      levels,
      markers,
      profile: toggles.value.profile ? data.flow.profile : [],
    }
  })

  const maskedSymbol = computed(() => {
    if (!instrument.value) return 'M???'
    return revealed.value ? instrument.value.symbol : instrument.value.mask
  })

  const sampleDate = computed(() => (scenario.value ? new Date(scenario.value.sessionDate) : null))

  async function ensureCore(): Promise<boolean> {
    if (coreReady.value) return true
    const core = await ensureWasmCore(useRuntimeConfig().app.baseURL || '/')
    coreReady.value = core != null
    coreError.value = core == null
    return coreReady.value
  }

  function stopPlayback() {
    if (timer) clearInterval(timer)
    timer = null
    playing.value = false
  }

  function start(options: { seed?: string } = {}) {
    stopPlayback()
    settings.hydrate()
    const universe = instruments.resolve(settings.settings.instruments)
    const factory = createScenarioFactory({ universe: universe.length ? universe : instruments.list() })
    seed.value = options.seed ?? createSeed()
    const next = factory.create({ seed: seed.value })
    scenario.value = next
    visibleCount.value = Math.min(next.candles.length, next.replayStart + 80)
    revealed.value = false
    tab.value = 'overview'
    toggles.value = { ...defaultToggles }
  }

  function newSample() {
    start()
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
