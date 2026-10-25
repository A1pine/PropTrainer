// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, toRaw } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TerminalChartPane from '@/components/terminal/TerminalChartPane.vue'
import type { useExamAnalysis as createExamAnalysis, ExamAnalysisStatus } from '@/composables/useExamAnalysis'
import type { AnalysisReport } from '@/domain/analysis/types'
import type { Candle } from '@/domain/market/types'
import { defaultAnalysisFrameworks, defaultAnalysisLayers } from '@/lib/chart/analysis'
import type { ChartAnalysis, ChartDrawing } from '@/lib/chart/types'

const fit = vi.fn()
const zoom = vi.fn()
const scrollToLatest = vi.fn()
const focusOn = vi.fn()
const focusRange = vi.fn()

const ChartCanvasStub = defineComponent({
  name: 'ChartCanvas',
  inheritAttrs: false,
  props: [
    'candles',
    'visibleCount',
    'seriesKey',
    'orders',
    'chartStyle',
    'orderDraggable',
    'pricePickEnabled',
    'timeframeMinutes',
    'timeframeLabel',
    'timeZone',
    'showDates',
    'pricePrecision',
    'tickSize',
    'analysis',
    'symbolMask',
    'label',
    'blind',
    'tool',
    'drawings',
  ],
  emits: ['update:drawings', 'order-drag', 'order-cancel', 'price-pick'],
  setup(_, { expose, slots }) {
    expose({ fit, zoom, scrollToLatest, focusOn, focusRange })
    return () => h('div', { 'data-testid': 'stub-chart-canvas' }, slots.badge?.())
  },
})

const ExamAnalysisControlsStub = defineComponent({
  name: 'ExamAnalysisControls',
  props: ['enabled', 'frameworks', 'layers', 'report', 'status', 'count', 'compact'],
  emits: ['update:enabled', 'update:frameworks', 'update:layers', 'retry'],
  setup(props, { emit }) {
    return () =>
      h(
        'button',
        {
          type: 'button',
          'data-testid': 'stub-analysis-toggle',
          'data-enabled': String(props.enabled),
          onClick: () => emit('update:enabled', !props.enabled),
        },
        props.enabled ? 'on' : 'off',
      )
  },
})

const candles: Candle[] = [
  { time: 0, open: 100, high: 102, low: 99, close: 101, volume: 10 },
  { time: 60, open: 101, high: 103, low: 100, close: 102, volume: 11 },
  { time: 120, open: 102, high: 104, low: 101, close: 103, volume: 12 },
  { time: 180, open: 103, high: 105, low: 102, close: 104, volume: 13 },
]

const riskAnalysis: ChartAnalysis = {
  series: [],
  zones: [],
  levels: [{ id: 'risk-breach', price: 99, tone: 'warn', label: 'Breach' }],
  markers: [],
  profile: [],
}

const taAnalysis: ChartAnalysis = {
  series: [{ id: 'ta-ema', tone: 'clay', points: [100, 101, 102, null] }],
  zones: [{ id: 'ta-zone', from: 0, to: 1, top: 103, bottom: 100, tone: 'bull', label: 'OB' }],
  levels: [{ id: 'ta-level', price: 101, tone: 'ink', label: 'VWAP' }],
  markers: [{ id: 'ta-marker', index: 1, price: 102, tone: 'bull', label: 'BOS' }],
  profile: [{ price: 101, volume: 10, inValueArea: true, isPoc: true }],
}

const drawing: ChartDrawing = {
  id: 'drawing-1',
  type: 'trend',
  points: [
    { index: 0, price: 100 },
    { index: 1, price: 102 },
  ],
}

type AnalysisState = ReturnType<typeof createExamAnalysis>
let analysisState: AnalysisState
const useExamAnalysis = vi.fn(() => analysisState)

function createAnalysisState() {
  return {
    enabled: ref(false),
    frameworks: ref({ ...defaultAnalysisFrameworks }),
    layers: ref({ ...defaultAnalysisLayers }),
    report: ref<AnalysisReport | null>(null),
    overlay: ref<ChartAnalysis | null>(null),
    status: ref<ExamAnalysisStatus>('off'),
    count: ref(0),
    retry: vi.fn(),
  }
}

const baseProps = {
  candles,
  visibleCount: candles.length,
  orders: [],
  chartStyle: 'candles' as const,
  orderDraggable: true,
  pricePickEnabled: true,
  timeframeMinutes: 5,
  timeframeLabel: '5m',
  timeZone: 'America/Chicago',
  showDates: true,
  pricePrecision: 2,
  tickSize: 0.25,
  analysis: riskAnalysis,
  symbolMask: 'ES',
  label: 'ES 5m',
}

let wrappers: VueWrapper[] = []

beforeEach(() => {
  vi.clearAllMocks()
  analysisState = createAnalysisState()
  useExamAnalysis.mockReset()
  useExamAnalysis.mockImplementation(() => analysisState)
  vi.stubGlobal('useExamAnalysis', useExamAnalysis)
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, te: () => false }))
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function render(overrides: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  const wrapper = mount(TerminalChartPane, {
    props: { ...baseProps, ...overrides },
    slots,
    global: {
      stubs: {
        ChartCanvas: ChartCanvasStub,
        ExamAnalysisControls: ExamAnalysisControlsStub,
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

function chartOf(wrapper: VueWrapper) {
  return wrapper.findComponent({ name: 'ChartCanvas' })
}

function controlsOf(wrapper: VueWrapper) {
  return wrapper.findComponent({ name: 'ExamAnalysisControls' })
}

describe('TerminalChartPane', () => {
  it('keeps risk analysis when TA is off and merges TA arrays when it is on', async () => {
    const wrapper = render()

    let analysis = chartOf(wrapper).props('analysis') as ChartAnalysis
    expect(toRaw(analysis)).toBe(riskAnalysis)
    expect(analysis.levels.map((item) => item.id)).toEqual(['risk-breach'])

    analysisState.overlay.value = taAnalysis
    await nextTick()
    analysis = chartOf(wrapper).props('analysis') as ChartAnalysis
    expect(analysis.series.map((item) => item.id)).toEqual(['ta-ema'])
    expect(analysis.zones.map((item) => item.id)).toEqual(['ta-zone'])
    expect(analysis.levels.map((item) => item.id)).toEqual(['risk-breach', 'ta-level'])
    expect(analysis.markers.map((item) => item.id)).toEqual(['ta-marker'])
    expect(analysis.profile).toHaveLength(1)

    analysisState.overlay.value = null
    await nextTick()
    analysis = chartOf(wrapper).props('analysis') as ChartAnalysis
    expect(toRaw(analysis)).toBe(riskAnalysis)
    expect(analysis.levels.map((item) => item.id)).toEqual(['risk-breach'])
  })

  it('disables order dragging and price picking while a drawing tool is active', async () => {
    const wrapper = render()
    expect(chartOf(wrapper).props()).toMatchObject({
      tool: 'cursor',
      orderDraggable: true,
      pricePickEnabled: true,
    })

    await wrapper.get('[data-testid="chart-tool-trend"]').trigger('click')
    expect(chartOf(wrapper).props()).toMatchObject({
      tool: 'trend',
      orderDraggable: false,
      pricePickEnabled: false,
    })

    await wrapper.get('[data-testid="chart-tool-horizontal"]').trigger('click')
    expect(chartOf(wrapper).props()).toMatchObject({
      tool: 'horizontal',
      orderDraggable: false,
      pricePickEnabled: false,
    })

    await wrapper.get('[data-testid="chart-tool-cursor"]').trigger('click')
    expect(chartOf(wrapper).props()).toMatchObject({
      tool: 'cursor',
      orderDraggable: true,
      pricePickEnabled: true,
    })
  })

  it('forwards order and price events from the chart, but not while drawing', async () => {
    const wrapper = render()
    const chart = chartOf(wrapper)

    chart.vm.$emit('order-drag', 'order-1', 101.25)
    chart.vm.$emit('order-cancel', 'order-2')
    chart.vm.$emit('price-pick', 99.5)

    expect(wrapper.emitted('order-drag')).toEqual([['order-1', 101.25]])
    expect(wrapper.emitted('order-cancel')).toEqual([['order-2']])
    expect(wrapper.emitted('price-pick')).toEqual([[99.5]])

    await wrapper.get('[data-testid="chart-tool-trend"]').trigger('click')
    chart.vm.$emit('order-drag', 'order-3', 102)
    chart.vm.$emit('order-cancel', 'order-3')
    chart.vm.$emit('price-pick', 100.5)

    expect(wrapper.emitted('order-drag')).toHaveLength(1)
    expect(wrapper.emitted('order-cancel')).toHaveLength(1)
    expect(wrapper.emitted('price-pick')).toHaveLength(1)
  })

  it('forwards the badge slot to the chart', () => {
    const wrapper = render({}, { badge: '<span data-testid="forming-badge">1D</span>' })
    expect(chartOf(wrapper).get('[data-testid="forming-badge"]').text()).toBe('1D')
  })

  it('keeps drawings across replay appends and clears them on symbol or timeframe changes', async () => {
    const wrapper = render()
    await wrapper.get('[data-testid="chart-tool-trend"]').trigger('click')

    chartOf(wrapper).vm.$emit('update:drawings', [drawing])
    await nextTick()
    expect(chartOf(wrapper).props('drawings')).toHaveLength(1)

    await wrapper.setProps({
      candles: [...candles, { time: 240, open: 104, high: 106, low: 103, close: 105, volume: 14 }],
      visibleCount: candles.length + 1,
    })
    expect(chartOf(wrapper).props('drawings')).toHaveLength(1)

    await wrapper.setProps({ symbolMask: 'NQ', label: 'NQ 5m' })
    expect(chartOf(wrapper).props('drawings')).toHaveLength(0)

    chartOf(wrapper).vm.$emit('update:drawings', [drawing])
    await nextTick()
    expect(chartOf(wrapper).props('drawings')).toHaveLength(1)

    await wrapper.setProps({ timeframeMinutes: 15, timeframeLabel: '15m', label: 'NQ 15m' })
    expect(chartOf(wrapper).props('drawings')).toHaveLength(0)
  })

  it('forwards the pane series key and republishes it when only the key changes', async () => {
    const wrapper = render({ seriesKey: 'run:es:5m' })
    expect(chartOf(wrapper).props('seriesKey')).toBe('run:es:5m')

    const next = [...candles, { time: 240, open: 104, high: 106, low: 103, close: 105, volume: 14 }]
    await wrapper.setProps({ candles: next, visibleCount: next.length })
    expect(chartOf(wrapper).props('seriesKey')).toBe('run:es:5m')

    await wrapper.setProps({ seriesKey: 'run:es:15m' })
    expect(chartOf(wrapper).props('seriesKey')).toBe('run:es:15m')
  })

  it('clears drawings from the toolbar and disables the button when empty', async () => {
    const wrapper = render()
    const clear = wrapper.get('[data-testid="chart-clear-drawings"]')
    expect(clear.attributes('disabled')).toBeDefined()

    chartOf(wrapper).vm.$emit('update:drawings', [drawing])
    await nextTick()
    expect(chartOf(wrapper).props('drawings')).toHaveLength(1)
    expect(clear.attributes('disabled')).toBeUndefined()

    await clear.trigger('click')
    expect(chartOf(wrapper).props('drawings')).toHaveLength(0)
    expect(clear.attributes('disabled')).toBeDefined()
  })

  it('proxies fit and focusRange to the chart', () => {
    const wrapper = render()
    const pane = wrapper.vm as unknown as {
      fit: () => void
      focusRange: (from: number, to: number) => void
    }

    pane.fit()
    pane.focusRange(1, 3)

    expect(fit).toHaveBeenCalledTimes(1)
    expect(focusRange).toHaveBeenCalledWith(1, 3)
  })

  it('feeds only the revealed prefix and source candles to TA', () => {
    render({ visibleCount: 2, chartStyle: 'heikin-ashi' })

    const input = useExamAnalysis.mock.calls[0]?.[0] as {
      candles: () => readonly Candle[]
      visibleCount: () => number
      precision: () => number
    }

    expect(input.candles().map((candle) => candle.time)).toEqual([0, 60])
    expect(toRaw(input.candles()[0] as Candle)).toBe(candles[0])
    expect(input.visibleCount()).toBe(2)
    expect(input.precision()).toBe(2)
  })

  it('keeps two panes independent and out of each other’s revealed range', () => {
    const firstState = createAnalysisState()
    firstState.enabled.value = true
    firstState.status.value = 'ready'
    firstState.overlay.value = taAnalysis
    const secondState = createAnalysisState()
    useExamAnalysis.mockImplementationOnce(() => firstState).mockImplementationOnce(() => secondState)

    const firstRisk: ChartAnalysis = {
      ...riskAnalysis,
      levels: [{ id: 'risk-first', price: 98, tone: 'warn', label: 'First' }],
    }
    const secondRisk: ChartAnalysis = {
      ...riskAnalysis,
      levels: [{ id: 'risk-second', price: 108, tone: 'warn', label: 'Second' }],
    }
    const first = render({
      candles: candles.slice(0, 2),
      visibleCount: 2,
      analysis: firstRisk,
      symbolMask: 'ES',
      label: 'ES 5m',
    })
    const second = render({
      candles: candles.slice(2),
      visibleCount: 1,
      analysis: secondRisk,
      symbolMask: 'NQ',
      label: 'NQ 5m',
    })

    expect(
      chartOf(first)
        .props('analysis')
        .levels.map((item: { id: string }) => item.id),
    ).toEqual(['risk-first', 'ta-level'])
    expect(toRaw(chartOf(second).props('analysis'))).toBe(secondRisk)

    const firstInput = useExamAnalysis.mock.calls[0]?.[0] as { candles: () => readonly Candle[] }
    const secondInput = useExamAnalysis.mock.calls[1]?.[0] as { candles: () => readonly Candle[] }
    expect(firstInput.candles().map((candle) => candle.time)).toEqual([0, 60])
    expect(secondInput.candles().map((candle) => candle.time)).toEqual([120])

    first.get('[data-testid="chart-tool-trend"]').trigger('click')
    return nextTick().then(() => {
      expect(chartOf(first).props('tool')).toBe('trend')
      expect(chartOf(first).props('orderDraggable')).toBe(false)
      expect(chartOf(second).props('tool')).toBe('cursor')
      expect(chartOf(second).props('orderDraggable')).toBe(true)
    })
  })

  it('keeps the optional study toggle off by default and wires it to the composable', async () => {
    const wrapper = render()
    const controls = controlsOf(wrapper)
    expect(controls.props('enabled')).toBe(false)
    expect(controls.props('status')).toBe('off')

    await controls.vm.$emit('update:enabled', true)
    await nextTick()

    expect(analysisState.enabled.value).toBe(true)
    expect(controlsOf(wrapper).props('enabled')).toBe(true)
    expect(toRaw(chartOf(wrapper).props('analysis'))).toBe(riskAnalysis)
  })
})
