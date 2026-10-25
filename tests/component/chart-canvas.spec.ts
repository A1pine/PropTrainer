// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChartCanvas from '@/components/chart/ChartCanvas.vue'
import type { Candle } from '@/domain/market/types'
import type { ChartExecution } from '@/lib/chart/types'

const { chart, construct } = vi.hoisted(() => ({
  chart: {
    setCandles: vi.fn(),
    setVisibleCount: vi.fn(),
    setOverlays: vi.fn(),
    setOrderLines: vi.fn(),
    setDrawings: vi.fn(),
    setExecutions: vi.fn(),
    setAnalysis: vi.fn(),
    setTool: vi.fn(),
    setBlind: vi.fn(),
    setPrecision: vi.fn(),
    setOptions: vi.fn(),
    setTheme: vi.fn(),
    fit: vi.fn(),
    zoom: vi.fn(),
    scrollToLatest: vi.fn(),
    focusOn: vi.fn(),
    focusRange: vi.fn(),
    destroy: vi.fn(),
  },
  construct: vi.fn(),
}))
vi.mock('@/lib/chart/engine', () => ({
  ChartEngine: class {
    constructor(...args: unknown[]) {
      construct(...args)
      return chart
    }
  },
}))
vi.mock('@/lib/chart/theme', () => ({ readChartTheme: () => ({}) }))

const candles: Candle[] = [{ time: 0, open: 100, high: 110, low: 90, close: 106, volume: 10 }]
let settings: { settings: { reduceMotion: boolean } }
let media: EventTarget & { matches: boolean; media: string }
let unmount: (() => void) | undefined

beforeEach(() => {
  vi.clearAllMocks()
  settings = reactive({ settings: { reduceMotion: false } })
  media = Object.assign(new EventTarget(), { matches: false, media: '(prefers-reduced-motion: reduce)' })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  )
  for (const [name, value] of Object.entries({
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    shallowRef,
    watch,
    useAppTheme: () => ({ resolved: ref('light') }),
    useSettingsStore: () => settings,
  })) {
    vi.stubGlobal(name, value)
  }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function createChart(props: Record<string, unknown> = {}) {
  const wrapper = mount(ChartCanvas, { props: { candles, visibleCount: 1, ...props } })
  unmount = () => wrapper.unmount()
  return wrapper
}

async function setSystemReducedMotion(matches: boolean) {
  media.matches = matches
  media.dispatchEvent(Object.assign(new Event('change'), { matches }))
  await nextTick()
}

describe('ChartCanvas option wiring', () => {
  it('passes instrument options at mount and watches draggable/timeframe changes independently', async () => {
    const wrapper = createChart({ pricePrecision: 3, tickSize: 0.01 })
    expect(construct.mock.lastCall?.[3]).toMatchObject({
      pricePrecision: 3,
      tickSize: 0.01,
      overlayDraggable: false,
      orderDraggable: false,
      showOverlayLabels: true,
      timeframeMinutes: 5,
      reducedMotion: false,
    })
    await wrapper.setProps({ overlayDraggable: true })
    expect(chart.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overlayDraggable: true,
        orderDraggable: false,
        chartStyle: 'candles',
        timeZone: 'UTC',
        showDates: false,
        timeframeMinutes: 5,
        showOverlayLabels: true,
        reducedMotion: false,
      }),
    )
    await wrapper.setProps({ timeframeMinutes: 15 })
    expect(chart.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overlayDraggable: true,
        orderDraggable: false,
        chartStyle: 'candles',
        timeZone: 'UTC',
        showDates: false,
        timeframeMinutes: 15,
        showOverlayLabels: true,
        reducedMotion: false,
      }),
    )
    await wrapper.setProps({ overlayDraggable: false, pricePrecision: 1, tickSize: 0.1 })
    expect(chart.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overlayDraggable: false,
        orderDraggable: false,
        chartStyle: 'candles',
        timeZone: 'UTC',
        showDates: false,
        timeframeMinutes: 15,
        showOverlayLabels: true,
        reducedMotion: false,
      }),
    )
    await wrapper.setProps({ showOverlayLabels: false })
    expect(chart.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overlayDraggable: false,
        orderDraggable: false,
        chartStyle: 'candles',
        timeZone: 'UTC',
        showDates: false,
        timeframeMinutes: 15,
        showOverlayLabels: false,
        reducedMotion: false,
      }),
    )
    expect(chart.setPrecision).toHaveBeenLastCalledWith(1, 0.1)
  })

  it.each(['app', 'OS'] as const)('honors the initial %s reduced-motion preference', async (source) => {
    settings.settings.reduceMotion = source === 'app'
    media.matches = source === 'OS'
    createChart()
    await nextTick()
    expect(construct.mock.lastCall?.[3]).toMatchObject({ reducedMotion: true })
  })

  it('combines live app and OS motion preferences without one overriding the other', async () => {
    createChart()
    await nextTick()
    settings.settings.reduceMotion = true
    await nextTick()
    expect(chart.setOptions.mock.lastCall?.[0].reducedMotion).toBe(true)
    await setSystemReducedMotion(true)
    settings.settings.reduceMotion = false
    await nextTick()
    expect(chart.setOptions.mock.lastCall?.[0].reducedMotion).toBe(true)
    await setSystemReducedMotion(false)
    expect(chart.setOptions.mock.lastCall?.[0].reducedMotion).toBe(false)
    await setSystemReducedMotion(true)
    expect(chart.setOptions.mock.lastCall?.[0].reducedMotion).toBe(true)
  })

  it('disconnects the media subscription and destroys the engine on unmount', async () => {
    const removeListener = vi.spyOn(media, 'removeEventListener')
    const wrapper = createChart()
    await nextTick()
    wrapper.unmount()
    unmount = undefined
    expect(chart.destroy).toHaveBeenCalledTimes(1)
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function), expect.anything())
    chart.setOptions.mockClear()
    settings.settings.reduceMotion = true
    await setSystemReducedMotion(true)
    expect(chart.setOptions).not.toHaveBeenCalled()
  })

  it('forwards the series key on mount, array replacement and key-only changes', async () => {
    const wrapper = createChart({ seriesKey: 'run:es:5m' })
    expect(chart.setCandles).toHaveBeenLastCalledWith(candles, 1, 'run:es:5m')

    const next = [...candles]
    await wrapper.setProps({ candles: next })
    expect(chart.setCandles).toHaveBeenLastCalledWith(next, 1, 'run:es:5m')

    chart.setCandles.mockClear()
    await wrapper.setProps({ seriesKey: 'run:es:15m' })
    expect(chart.setCandles).toHaveBeenCalledTimes(1)
    expect(chart.setCandles).toHaveBeenLastCalledWith(next, 1, 'run:es:15m')
  })
})

const execution = (overrides: Partial<ChartExecution> = {}): ChartExecution => ({
  id: 'trade-1',
  side: 'long',
  entryBar: 10,
  entryPrice: 100.25,
  exitBar: 20,
  exitPrice: 105.5,
  entryLabel: 'Entry',
  exitLabel: 'Exit',
  ...overrides,
})

describe('ChartCanvas execution wiring', () => {
  it('forwards mount, replacement and clear without deep-watching identical arrays', async () => {
    const first = [execution()]
    const wrapper = createChart({ executions: first })
    expect(chart.setExecutions).toHaveBeenCalledTimes(1)
    expect(chart.setExecutions).toHaveBeenCalledWith(first)

    chart.setExecutions.mockClear()
    await wrapper.setProps({ executions: first })
    expect(chart.setExecutions).not.toHaveBeenCalled()

    const second = [execution({ id: 'trade-2' })]
    await wrapper.setProps({ executions: second })
    expect(chart.setExecutions).toHaveBeenCalledTimes(1)
    expect(chart.setExecutions).toHaveBeenCalledWith(second)

    await wrapper.setProps({ executions: [] })
    expect(chart.setExecutions).toHaveBeenCalledTimes(2)
    expect(chart.setExecutions).toHaveBeenLastCalledWith([])
  })

  it('supplies an empty execution array by default', () => {
    createChart()
    expect(chart.setExecutions).toHaveBeenCalledWith([])
  })

  it('exposes focusRange to the page', () => {
    const wrapper = createChart()
    ;(wrapper.vm as unknown as { focusRange: (from: number, to: number) => void }).focusRange(12, 48)
    expect(chart.focusRange).toHaveBeenCalledWith(12, 48)
  })
})
