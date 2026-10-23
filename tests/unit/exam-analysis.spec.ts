import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { effectScope, nextTick, shallowRef, type EffectScope } from 'vue'
import * as analysis from '@/domain/analysis/analyze'
import type { AnalysisReport } from '@/domain/analysis/types'
import type { Candle } from '@/domain/market/types'
import { createScenarioFactory } from '@/domain/market/scenario'
import * as loader from '@/domain/wasm/loader'
import { getWasmCore, setWasmCore, type WasmCore } from '@/domain/wasm/core'
import { useExamAnalysis } from '@/composables/useExamAnalysis'
import { defaultAnalysisFrameworks, defaultAnalysisLayers } from '@/lib/chart/analysis'

const factory = createScenarioFactory({ now: new Date('2026-03-10T12:00:00Z') })
const scenario = factory.createFromSeed('exam-analysis', 'MNQ', 'uptrend')
const otherScenario = factory.createFromSeed('exam-analysis-other', 'MNQ', 'downtrend')
const baseCandles = scenario.candles
const baseCount = scenario.replayStart

let shared: WasmCore | null = null
let scope: EffectScope | null = null
let analyze: MockInstance<typeof analysis.analyzeMarket>

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function mount(
  options: {
    candles?: Candle[]
    visibleCount?: number
    precision?: number
    active?: boolean
  } = {},
) {
  const candles = shallowRef<readonly Candle[]>(options.candles ?? baseCandles)
  const visibleCount = shallowRef(options.visibleCount ?? baseCount)
  const precision = shallowRef(options.precision ?? 2)
  const active = shallowRef(options.active ?? true)
  scope = effectScope()
  const exam = scope.run(() =>
    useExamAnalysis({
      candles,
      visibleCount: () => visibleCount.value,
      precision,
      active: () => active.value,
    }),
  )
  if (!exam) throw new Error('useExamAnalysis did not run inside the effect scope')
  return { exam, candles, visibleCount, precision, active }
}

function requireReport(): AnalysisReport {
  const report = analyze.mock.results.at(-1)?.value
  if (!report) throw new Error('Expected the wasm analysis core to produce a report')
  return report
}

function visibleSlice(count: number, candles: readonly Candle[] = baseCandles) {
  return candles.slice(0, count)
}

beforeEach(() => {
  shared = getWasmCore()
  setWasmCore(shared)
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/test-exam/' } }))
  analyze = vi.spyOn(analysis, 'analyzeMarket')
})

afterEach(() => {
  scope?.stop()
  scope = null
  setWasmCore(shared)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useExamAnalysis', () => {
  it('stays off by default without analyzing or publishing a report', async () => {
    const { exam, visibleCount } = mount()

    expect(exam.enabled.value).toBe(false)
    expect(exam.status.value).toBe('off')
    expect(exam.report.value).toBeNull()
    expect(exam.overlay.value).toBeNull()
    expect(exam.frameworks.value).toEqual(defaultAnalysisFrameworks)
    expect(exam.layers.value).toEqual(defaultAnalysisLayers)
    expect(exam.count.value).toBe(baseCount)
    expect(analyze).not.toHaveBeenCalled()

    visibleCount.value += 10
    await nextTick()
    expect(exam.count.value).toBe(baseCount + 10)
    expect(exam.report.value).toBeNull()
    expect(exam.overlay.value).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('analyzes only the visible prefix, ignoring a mutated or replaced hidden suffix', async () => {
    const { exam, candles, visibleCount } = mount()
    exam.enabled.value = true
    await nextTick()

    expect(exam.status.value).toBe('ready')
    const first = exam.report.value
    const firstOverlay = exam.overlay.value
    expect(first).not.toBeNull()
    expect(firstOverlay).not.toBeNull()
    expect(analyze).toHaveBeenCalledOnce()
    expect(analyze.mock.calls[0]![0]).toEqual(visibleSlice(baseCount))
    expect(analyze.mock.calls[0]![0]).toHaveLength(baseCount)
    expect(analyze.mock.calls[0]![1]).toBe(2)

    const hiddenStart = visibleCount.value
    const mutated = baseCandles.map((candle, index) =>
      index < hiddenStart
        ? candle
        : {
            ...candle,
            time: candle.time + 999_999,
            open: candle.open + 50_000,
            high: candle.high + 60_000,
            low: candle.low - 60_000,
            close: candle.close - 40_000,
            volume: candle.volume * 1_000,
          },
    )
    candles.value = mutated
    await nextTick()
    const second = exam.report.value
    const secondOverlay = exam.overlay.value

    expect(analyze).toHaveBeenCalledTimes(2)
    expect(analyze.mock.calls[1]![0]).toEqual(visibleSlice(baseCount))
    expect(second).toEqual(first)
    expect(secondOverlay).toEqual(firstOverlay)

    const plainSwap = [...mutated]
    candles.value = plainSwap
    expect(exam.report.value).toEqual(first)
    expect(exam.overlay.value).toEqual(firstOverlay)
  })

  it('recomputes when the visible tape advances', async () => {
    const { exam, visibleCount } = mount()
    exam.enabled.value = true
    await nextTick()
    const before = exam.report.value
    const beforeOverlay = exam.overlay.value
    expect(before).not.toBeNull()

    const nextCount = baseCount + 1
    visibleCount.value = nextCount
    const after = exam.report.value

    expect(exam.count.value).toBe(nextCount)
    expect(analyze).toHaveBeenCalledTimes(2)
    expect(analyze.mock.calls[1]![0]).toEqual(visibleSlice(nextCount))
    expect(analyze.mock.calls[1]![0]).toHaveLength(nextCount)
    expect(after).not.toEqual(before)
    expect(exam.overlay.value).not.toEqual(beforeOverlay)
    expect(requireReport()).toBe(after)
  })

  it('cannot retain a prior report when the scenario is replaced or shrunk', async () => {
    const { exam, candles, visibleCount } = mount()
    exam.enabled.value = true
    await nextTick()
    const prior = exam.report.value
    expect(prior).not.toBeNull()

    candles.value = otherScenario.candles
    visibleCount.value = 120
    const next = exam.report.value

    expect(analyze).toHaveBeenCalledTimes(2)
    expect(analyze.mock.calls[1]![0]).toEqual(otherScenario.candles.slice(0, 120))
    expect(next).not.toBeNull()
    expect(next).not.toEqual(prior)

    visibleCount.value = 29
    expect(exam.count.value).toBe(29)
    expect(exam.status.value).toBe('insufficient')
    expect(exam.report.value).toBeNull()
    expect(exam.overlay.value).toBeNull()
    expect(analyze).toHaveBeenCalledTimes(2)
  })

  it('re-renders layers and frameworks without rerunning the wasm analysis', async () => {
    const { exam } = mount()
    exam.enabled.value = true
    await nextTick()
    const report = exam.report.value
    const full = exam.overlay.value
    expect(full?.series.map((item) => item.id)).toContain('ema20')
    expect(analyze).toHaveBeenCalledOnce()

    exam.layers.value.ema = false
    const withoutEma = exam.overlay.value
    expect(withoutEma?.series.map((item) => item.id)).not.toContain('ema20')
    expect(withoutEma).not.toEqual(full)
    expect(analyze).toHaveBeenCalledOnce()

    exam.frameworks.value.flow = false
    const withoutFlow = exam.overlay.value
    expect(withoutFlow?.levels.some((item) => item.id === 'poc')).toBe(false)
    expect(withoutFlow?.profile).toEqual([])
    expect(analyze).toHaveBeenCalledOnce()
    expect(exam.report.value).toBe(report)
    expect(exam.status.value).toBe('ready')
  })

  it('clears the report and stops analyzing when disabled or when every framework is off', async () => {
    const { exam, visibleCount } = mount()
    exam.enabled.value = true
    await nextTick()
    expect(exam.report.value).not.toBeNull()

    exam.enabled.value = false
    expect(exam.status.value).toBe('off')
    expect(exam.report.value).toBeNull()
    expect(exam.overlay.value).toBeNull()
    visibleCount.value += 5
    expect(exam.report.value).toBeNull()
    expect(exam.overlay.value).toBeNull()
    expect(analyze).toHaveBeenCalledOnce()

    exam.enabled.value = true
    exam.frameworks.value = { pa: false, ict: false, flow: false, indicators: false }
    expect(exam.status.value).toBe('empty')
    expect(exam.report.value).toBeNull()
    expect(exam.overlay.value).toBeNull()
    visibleCount.value += 5
    expect(exam.report.value).toBeNull()
    expect(analyze).toHaveBeenCalledOnce()
  })

  it('clamps visibleCount and rejects short or invalid prefixes without analyzing', async () => {
    const { exam, visibleCount } = mount()
    exam.enabled.value = true
    await nextTick()

    visibleCount.value = baseCandles.length + 500
    expect(exam.count.value).toBe(baseCandles.length)
    expect(exam.report.value).not.toBeNull()
    expect(analyze.mock.calls.at(-1)![0]).toHaveLength(baseCandles.length)

    visibleCount.value = 45.9
    expect(exam.count.value).toBe(45)
    expect(exam.report.value).not.toBeNull()
    expect(analyze.mock.calls.at(-1)![0]).toHaveLength(45)
    const calls = analyze.mock.calls.length

    for (const [value, expected] of [
      [-10, 0],
      [0, 0],
      [29, 29],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
    ] as const) {
      visibleCount.value = value
      expect(exam.count.value).toBe(expected)
      expect(exam.status.value).toBe('insufficient')
      expect(exam.report.value).toBeNull()
      expect(exam.overlay.value).toBeNull()
    }
    expect(analyze).toHaveBeenCalledTimes(calls)

    const empty = mount({ candles: [], visibleCount: 40 })
    empty.exam.enabled.value = true
    await nextTick()
    expect(empty.exam.count.value).toBe(0)
    expect(empty.exam.status.value).toBe('insufficient')
    expect(empty.exam.report.value).toBeNull()
    expect(analyze).toHaveBeenCalledTimes(calls)
  })

  it('does not analyze while the scenario is inactive', async () => {
    const { exam, active, visibleCount } = mount({ active: false })
    exam.enabled.value = true
    await nextTick()

    expect(exam.status.value).toBe('loading')
    expect(exam.report.value).toBeNull()
    expect(analyze).not.toHaveBeenCalled()

    active.value = true
    await nextTick()
    expect(exam.status.value).toBe('ready')
    expect(exam.report.value).not.toBeNull()
    expect(analyze).toHaveBeenCalledOnce()

    active.value = false
    visibleCount.value += 3
    expect(exam.report.value).toBeNull()
    expect(exam.overlay.value).toBeNull()
    expect(analyze).toHaveBeenCalledOnce()
  })

  it('tracks a delayed load without blocking tape steps, then retries a failed load', async () => {
    setWasmCore(null)
    const load = deferred<WasmCore | null>()
    const ensure = vi.spyOn(loader, 'ensureWasmCore').mockReturnValueOnce(load.promise)
    const { exam, visibleCount } = mount({ candles: baseCandles.slice(0, 240) })
    exam.enabled.value = true
    await nextTick()

    expect(ensure).toHaveBeenCalledOnce()
    expect(ensure).toHaveBeenCalledWith('/test-exam/')
    expect(exam.status.value).toBe('loading')
    expect(exam.report.value).toBeNull()
    expect(analyze).not.toHaveBeenCalled()

    visibleCount.value += 2
    expect(exam.count.value).toBe(baseCount + 2)
    expect(exam.report.value).toBeNull()
    expect(exam.status.value).toBe('loading')
    expect(analyze).not.toHaveBeenCalled()

    load.resolve(null)
    await load.promise
    await nextTick()

    expect(exam.status.value).toBe('unavailable')
    expect(exam.report.value).toBeNull()
    expect(exam.overlay.value).toBeNull()
    expect(analyze).not.toHaveBeenCalled()

    ensure.mockImplementationOnce(async () => {
      setWasmCore(shared)
      return shared
    })
    const retried = exam.retry()
    expect(exam.status.value).toBe('loading')
    await retried
    await nextTick()

    expect(exam.status.value).toBe('ready')
    expect(analyze).toHaveBeenCalledOnce()
    expect(analyze.mock.calls[0]![0]).toHaveLength(baseCount + 2)
    expect(exam.report.value).not.toBeNull()
    expect(exam.overlay.value).not.toBeNull()
  })

  it('retries a failed analysis even when the core and visible prefix have not changed', async () => {
    const ensure = vi.spyOn(loader, 'ensureWasmCore')
    analyze.mockReturnValueOnce(null)
    const { exam } = mount()
    exam.enabled.value = true
    await nextTick()

    expect(exam.status.value).toBe('unavailable')
    expect(exam.overlay.value).toBeNull()
    expect(analyze).toHaveBeenCalledOnce()

    await exam.retry()
    expect(exam.status.value).toBe('ready')
    expect(exam.overlay.value).not.toBeNull()
    expect(analyze).toHaveBeenCalledTimes(2)
    expect(analyze.mock.calls[1]![0]).toEqual(visibleSlice(baseCount))
    expect(ensure).not.toHaveBeenCalled()
  })

  it('stays null when disabled while the wasm load is still pending', async () => {
    setWasmCore(null)
    const load = deferred<WasmCore | null>()
    vi.spyOn(loader, 'ensureWasmCore').mockReturnValueOnce(load.promise)
    const { exam } = mount()
    exam.enabled.value = true
    await nextTick()
    expect(exam.status.value).toBe('loading')

    exam.enabled.value = false
    load.resolve(shared)
    await load.promise
    await nextTick()

    expect(exam.status.value).toBe('off')
    expect(exam.report.value).toBeNull()
    expect(exam.overlay.value).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('does not touch disposed state when a pending load resolves', async () => {
    setWasmCore(null)
    const load = deferred<WasmCore | null>()
    const ensure = vi.spyOn(loader, 'ensureWasmCore').mockReturnValueOnce(load.promise)
    const { exam } = mount()
    exam.enabled.value = true
    await nextTick()
    expect(ensure).toHaveBeenCalledOnce()

    scope?.stop()
    scope = null
    load.resolve(shared)
    await load.promise
    await nextTick()

    expect(exam.status.value).toBe('loading')
    expect(exam.report.value).toBeNull()
    expect(exam.overlay.value).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })
})
