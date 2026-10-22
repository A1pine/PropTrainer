// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChartCanvas from '@/components/chart/ChartCanvas.vue'
import type { Candle } from '@/domain/market/types'

const { chart, construct } = vi.hoisted(() => ({
  chart: {
    setCandles: vi.fn(),
    setVisibleCount: vi.fn(),
    setOverlays: vi.fn(),
    setDrawings: vi.fn(),
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
      timeframeMinutes: 5,
      reducedMotion: false,
    })
    await wrapper.setProps({ overlayDraggable: true })
    expect(chart.setOptions).toHaveBeenLastCalledWith({
      overlayDraggable: true,
      timeframeMinutes: 5,
      reducedMotion: false,
    })
    await wrapper.setProps({ timeframeMinutes: 15 })
    expect(chart.setOptions).toHaveBeenLastCalledWith({
      overlayDraggable: true,
      timeframeMinutes: 15,
      reducedMotion: false,
    })
    await wrapper.setProps({ overlayDraggable: false, pricePrecision: 1, tickSize: 0.1 })
    expect(chart.setOptions).toHaveBeenLastCalledWith({
      overlayDraggable: false,
      timeframeMinutes: 15,
      reducedMotion: false,
    })
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
})
