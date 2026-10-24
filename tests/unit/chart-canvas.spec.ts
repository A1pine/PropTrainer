// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChartCanvas from '@/components/chart/ChartCanvas.vue'
import type { Candle } from '@/domain/market/types'
import type { ChartCallbacks, ChartOrderLine } from '@/lib/chart/types'

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
const order = (overrides: Partial<ChartOrderLine> = {}): ChartOrderLine => ({
  id: 'order-1',
  side: 'long',
  kind: 'limit',
  price: 100.25,
  label: 'BUY',
  qty: 2,
  ...overrides,
})

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

describe('ChartCanvas order wiring', () => {
  it('passes orders and orderDraggable into the engine and forwards order callbacks', () => {
    const orders = [order()]
    const wrapper = createChart({ orders: orders, orderDraggable: true, pricePickEnabled: true })

    expect(construct.mock.lastCall?.[3]).toMatchObject({ orderDraggable: true })
    expect(chart.setOrderLines).toHaveBeenCalledWith(orders)

    const callbacks = construct.mock.lastCall?.[1] as ChartCallbacks
    callbacks.onOrderDrag?.('order-1', 101.25)
    callbacks.onPricePick?.(99.5)

    expect(wrapper.emitted('order-drag')).toEqual([['order-1', 101.25]])
    expect(wrapper.emitted('price-pick')).toEqual([[99.5]])
  })

  it('defaults to no orders and a non-draggable terminal', () => {
    createChart()

    expect(construct.mock.lastCall?.[3]).toMatchObject({ orderDraggable: false })
    expect(chart.setOrderLines).toHaveBeenCalledWith([])
  })

  it('defaults price-pick off and arms the engine only when the caller enables it', async () => {
    const wrapper = createChart()
    const callbacks = construct.mock.lastCall?.[1] as { onPricePick?: (price: number) => void }

    expect(construct.mock.lastCall?.[3]).toMatchObject({ pricePickEnabled: false })

    callbacks.onPricePick?.(99.5)
    expect(wrapper.emitted('price-pick')).toBeUndefined()

    await wrapper.setProps({ pricePickEnabled: true })
    expect(chart.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ pricePickEnabled: true }))
    callbacks.onPricePick?.(99.5)
    expect(wrapper.emitted('price-pick')).toEqual([[99.5]])

    await wrapper.setProps({ pricePickEnabled: false })
    expect(chart.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ pricePickEnabled: false }))
    callbacks.onPricePick?.(98.5)
    expect(wrapper.emitted('price-pick')).toEqual([[99.5]])
  })

  it('passes chart style and session clock options through mount and updates', async () => {
    const wrapper = createChart({ chartStyle: 'heikin-ashi', timeZone: 'America/Chicago', showDates: true })

    expect(construct.mock.lastCall?.[3]).toMatchObject({
      chartStyle: 'heikin-ashi',
      timeZone: 'America/Chicago',
      showDates: true,
    })
    await wrapper.setProps({ chartStyle: 'line' })
    expect(chart.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ chartStyle: 'line', timeZone: 'America/Chicago', showDates: true }),
    )
    await wrapper.setProps({ timeZone: 'Europe/London', showDates: false })
    expect(chart.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ chartStyle: 'line', timeZone: 'Europe/London', showDates: false }),
    )
  })

  it('forwards replacement and clear without deep-watching identical arrays', async () => {
    const first = [order()]
    const wrapper = createChart({ orders: first })
    expect(chart.setOrderLines).toHaveBeenCalledTimes(1)
    expect(chart.setOrderLines).toHaveBeenCalledWith(first)

    chart.setOrderLines.mockClear()
    await wrapper.setProps({ orders: first })
    expect(chart.setOrderLines).not.toHaveBeenCalled()

    const second = [order({ id: 'order-2', price: 102 })]
    await wrapper.setProps({ orders: second })
    expect(chart.setOrderLines).toHaveBeenCalledTimes(1)
    expect(chart.setOrderLines).toHaveBeenCalledWith(second)

    await wrapper.setProps({ orders: [] })
    expect(chart.setOrderLines).toHaveBeenCalledTimes(2)
    expect(chart.setOrderLines).toHaveBeenLastCalledWith([])
  })

  it('does not deep-watch order fields on replay updates', async () => {
    const orders = reactive([order()])
    const wrapper = createChart({ orders: orders })
    chart.setOrderLines.mockClear()

    orders[0]!.price = 102
    await nextTick()
    expect(chart.setOrderLines).not.toHaveBeenCalled()
    await wrapper.setProps({ orders: [...orders] })
    expect(chart.setOrderLines).toHaveBeenCalledExactlyOnceWith(orders)
  })

  it('forwards callback listeners and detaches the engine on unmount', () => {
    const onOrderDrag = vi.fn()
    const onOrderCancel = vi.fn()
    const onPricePick = vi.fn()
    const wrapper = createChart({ onOrderDrag, onOrderCancel, onPricePick, pricePickEnabled: true })
    const callbacks = construct.mock.lastCall?.[1] as ChartCallbacks

    callbacks.onOrderDrag?.('order-1', 101.25)
    callbacks.onOrderCancel?.('order-1')
    callbacks.onPricePick?.(99.5)
    expect(onOrderDrag).toHaveBeenCalledExactlyOnceWith('order-1', 101.25)
    expect(onOrderCancel).toHaveBeenCalledExactlyOnceWith('order-1')
    expect(onPricePick).toHaveBeenCalledExactlyOnceWith(99.5)

    wrapper.unmount()
    unmount = undefined
    expect(chart.destroy).toHaveBeenCalledTimes(1)
  })

  it('includes orderDraggable in the options watcher', async () => {
    const wrapper = createChart()

    await wrapper.setProps({ orderDraggable: true })
    expect(chart.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overlayDraggable: false,
        orderDraggable: true,
        chartStyle: 'candles',
        timeZone: 'UTC',
        showDates: false,
        timeframeMinutes: 5,
        showOverlayLabels: true,
        reducedMotion: false,
      }),
    )

    await wrapper.setProps({ orderDraggable: false })
    expect(chart.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overlayDraggable: false,
        orderDraggable: false,
        chartStyle: 'candles',
        timeZone: 'UTC',
        showDates: false,
        timeframeMinutes: 5,
        showOverlayLabels: true,
        reducedMotion: false,
      }),
    )
  })
})
