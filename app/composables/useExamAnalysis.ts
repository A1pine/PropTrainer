import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { analyzeMarket } from '~/domain/analysis/analyze'
import { getWasmCore } from '~/domain/wasm/core'
import { ensureWasmCore } from '~/domain/wasm/loader'
import type { Candle } from '~/domain/market/types'
import { buildChartAnalysis, defaultAnalysisFrameworks, defaultAnalysisLayers } from '~/lib/chart/analysis'

export type ExamAnalysisStatus = 'off' | 'loading' | 'ready' | 'unavailable' | 'insufficient' | 'empty'

export function useExamAnalysis(input: {
  candles: MaybeRefOrGetter<readonly Candle[]>
  visibleCount: MaybeRefOrGetter<number>
  precision: MaybeRefOrGetter<number>
  active?: MaybeRefOrGetter<boolean>
}) {
  const config = useRuntimeConfig()
  const enabled = ref(false)
  const frameworks = ref({ ...defaultAnalysisFrameworks })
  const layers = ref({ ...defaultAnalysisLayers })
  const coreReady = ref(false)
  const coreError = ref(false)
  const analysisRevision = ref(0)
  let pending: Promise<void> | null = null
  let disposed = false

  const count = computed(() => {
    const value = toValue(input.visibleCount)
    return Number.isFinite(value) ? Math.max(0, Math.min(toValue(input.candles).length, Math.floor(value))) : 0
  })
  const active = computed(() => input.active === undefined || toValue(input.active))
  const selected = computed(() => Object.values(frameworks.value).some(Boolean))
  const shouldAnalyze = computed(() => enabled.value && selected.value && active.value && count.value >= 30)

  function loadCore(): Promise<void> {
    if (pending) return pending
    coreError.value = false
    if (getWasmCore()) {
      coreReady.value = true
      return Promise.resolve()
    }
    coreReady.value = false
    pending = (async () => {
      try {
        const core = await ensureWasmCore(config.app.baseURL || '/')
        if (disposed) return
        coreReady.value = core != null
        coreError.value = core == null
      } catch {
        if (!disposed) coreError.value = true
      } finally {
        pending = null
      }
    })()
    return pending
  }

  watch(shouldAnalyze, (needed) => {
    if (needed) void loadCore()
  })
  onScopeDispose(() => {
    disposed = true
  })

  // Slice before crossing the WASM boundary. Neither scenario metrics nor the
  // hidden suffix may participate in the exam's helpers.
  const report = computed(() => {
    if (!shouldAnalyze.value || !coreReady.value) return null
    void analysisRevision.value
    const source = toValue(input.candles)
    const visible = count.value >= source.length ? source : source.slice(0, count.value)
    return analyzeMarket(visible, toValue(input.precision))
  })
  const overlay = computed(() =>
    report.value ? buildChartAnalysis(report.value, count.value, layers.value, frameworks.value) : null,
  )
  const status = computed<ExamAnalysisStatus>(() => {
    if (!enabled.value) return 'off'
    if (!selected.value) return 'empty'
    if (!active.value) return 'loading'
    if (count.value < 30) return 'insufficient'
    if (coreError.value) return 'unavailable'
    if (!coreReady.value) return 'loading'
    return report.value ? 'ready' : 'unavailable'
  })

  async function retry() {
    if (disposed) return
    await loadCore()
    if (!disposed) analysisRevision.value += 1
  }

  return { enabled, frameworks, layers, report, overlay, status, count, retry }
}
