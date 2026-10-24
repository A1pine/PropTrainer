<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core'
import type { Candle } from '~/domain/market/types'
import { ChartEngine } from '~/lib/chart/engine'
import { readChartTheme } from '~/lib/chart/theme'
import type {
  ChartAnalysis,
  ChartDrawing,
  ChartExecution,
  ChartOrderLine,
  ChartOverlayLevels,
  ChartStyle,
  ChartTool,
  CrosshairPayload,
} from '~/lib/chart/types'

const props = withDefaults(
  defineProps<{
    candles: Candle[]
    visibleCount: number
    overlays?: ChartOverlayLevels
    orders?: readonly ChartOrderLine[]
    drawings?: ChartDrawing[]
    executions?: readonly ChartExecution[]
    analysis?: ChartAnalysis | null
    tool?: ChartTool
    blind?: boolean
    timeframeMinutes?: number
    /** Optional badge override so session frames can read `1D` instead of `1440m`. */
    timeframeLabel?: string
    pricePrecision?: number
    tickSize?: number
    overlayDraggable?: boolean
    orderDraggable?: boolean
    pricePickEnabled?: boolean
    chartStyle?: ChartStyle
    timeZone?: string
    showDates?: boolean
    showOverlayLabels?: boolean
    symbolMask?: string
    label?: string
  }>(),
  {
    overlays: () => ({ entry: null, stop: null, target: null }),
    orders: () => [],
    drawings: () => [],
    executions: () => [],
    analysis: null,
    tool: 'cursor',
    blind: true,
    timeframeMinutes: 5,
    timeframeLabel: undefined,
    pricePrecision: 2,
    tickSize: 0.25,
    overlayDraggable: false,
    orderDraggable: false,
    pricePickEnabled: false,
    chartStyle: 'candles',
    timeZone: 'UTC',
    showDates: false,
    showOverlayLabels: true,
    symbolMask: 'M???',
    label: 'Price chart',
  },
)

const emit = defineEmits<{
  'update:drawings': [drawings: ChartDrawing[]]
  'overlay-drag': [kind: keyof ChartOverlayLevels, price: number]
  'order-drag': [id: string, price: number]
  'order-cancel': [id: string]
  'price-pick': [price: number]
}>()

const container = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const engine = shallowRef<ChartEngine | null>(null)
const hover = ref<CrosshairPayload | null>(null)
const size = ref({ width: 0, height: 0 })
const { resolved } = useAppTheme()
const settings = useSettingsStore()
const preferredMotion = usePreferredReducedMotion()
const reducedMotion = computed(() => settings.settings.reduceMotion || preferredMotion.value === 'reduce')

const tooltipStyle = computed(() => {
  if (!hover.value) return {}
  const flipX = hover.value.x > size.value.width - 190
  const flipY = hover.value.y > size.value.height - 130
  return {
    left: `${flipX ? hover.value.x - 186 : hover.value.x + 16}px`,
    top: `${flipY ? hover.value.y - 118 : hover.value.y + 16}px`,
  }
})

const tone = computed(() =>
  hover.value ? (hover.value.candle.close >= hover.value.candle.open ? 'text-bull-strong' : 'text-bear-strong') : '',
)

function init() {
  if (!canvas.value || !container.value || engine.value) return
  const chart = new ChartEngine(
    canvas.value,
    {
      onCrosshair: (payload) => {
        hover.value = payload
      },
      onOverlayDrag: (kind, price) => emit('overlay-drag', kind, price),
      onOrderDrag: (id, price) => emit('order-drag', id, price),
      onOrderCancel: (id) => emit('order-cancel', id),
      // Click-to-pick is opt-in: read-only exam charts never pass this option and
      // must stay inert even when a listener happens to be attached.
      onPricePick: (price) => {
        if (props.pricePickEnabled) emit('price-pick', price)
      },
      onDrawingCommit: (drawing) => emit('update:drawings', [...props.drawings, drawing]),
    },
    readChartTheme(container.value),
    {
      blind: props.blind,
      timeframeMinutes: props.timeframeMinutes,
      pricePrecision: props.pricePrecision,
      tickSize: props.tickSize,
      overlayDraggable: props.overlayDraggable,
      orderDraggable: props.orderDraggable,
      pricePickEnabled: props.pricePickEnabled,
      chartStyle: props.chartStyle,
      timeZone: props.timeZone,
      showDates: props.showDates,
      showOverlayLabels: props.showOverlayLabels,
      reducedMotion: reducedMotion.value,
    },
  )
  chart.setCandles(props.candles, props.visibleCount)
  chart.setOverlays(props.overlays)
  chart.setOrderLines(props.orders)
  chart.setDrawings(props.drawings)
  chart.setExecutions(props.executions)
  chart.setAnalysis(props.analysis)
  chart.setTool(props.tool)
  chart.fit()
  engine.value = chart
  const bounds = container.value.getBoundingClientRect()
  size.value = { width: bounds.width, height: bounds.height }
}

let observer: ResizeObserver | null = null

onMounted(() => {
  init()
  observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect
    if (box) size.value = { width: box.width, height: box.height }
  })
  if (container.value) observer.observe(container.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  engine.value?.destroy()
  engine.value = null
})

watch(
  () => props.candles,
  (candles) => engine.value?.setCandles(candles, props.visibleCount),
)

watch(
  () => props.visibleCount,
  (count) => engine.value?.setVisibleCount(count),
)

watch(
  () => props.overlays,
  (overlays) => engine.value?.setOverlays(overlays),
  { deep: true },
)

// Order lines are rebuilt as immutable arrays on every replay tick. A shallow
// watch lets the engine's deep-equal no-op absorb ticks that did not move an order.
watch(
  () => props.orders,
  (orders) => engine.value?.setOrderLines(orders),
)

watch(
  () => props.drawings,
  (drawings) => engine.value?.setDrawings(drawings),
  { deep: true },
)

// Filled executions arrive as immutable arrays rebuilt after a reveal. A shallow
// watch avoids walking every trade on each playback tick.
watch(
  () => props.executions,
  (executions) => engine.value?.setExecutions(executions),
)

watch(
  () => props.tool,
  (tool) => engine.value?.setTool(tool),
)

// `analysis` is rebuilt as a fresh object whenever the report changes, so a
// shallow watch is enough. Deep traversal would walk every indicator series
// (thousands of numbers) on each playback step.
watch(
  () => props.analysis,
  (analysis) => engine.value?.setAnalysis(analysis),
)

watch(
  () => props.blind,
  (blind) => engine.value?.setBlind(blind),
)

watch(
  () => [props.pricePrecision, props.tickSize] as const,
  ([precision, tick]) => engine.value?.setPrecision(precision, tick),
)

watch(
  () =>
    [
      props.overlayDraggable,
      props.orderDraggable,
      props.pricePickEnabled,
      props.chartStyle,
      props.timeZone,
      props.showDates,
      props.timeframeMinutes,
      props.showOverlayLabels,
      reducedMotion.value,
    ] as const,
  ([
    overlayDraggable,
    orderDraggable,
    pricePickEnabled,
    chartStyle,
    timeZone,
    showDates,
    timeframeMinutes,
    showOverlayLabels,
    reducedMotion,
  ]) =>
    engine.value?.setOptions({
      overlayDraggable,
      orderDraggable,
      pricePickEnabled,
      chartStyle,
      timeZone,
      showDates,
      timeframeMinutes,
      showOverlayLabels,
      reducedMotion,
    }),
)

watch(
  () => resolved.value,
  async () => {
    await nextTick()
    if (container.value) engine.value?.setTheme(readChartTheme(container.value))
  },
)

defineExpose({
  fit: () => engine.value?.fit(),
  zoom: (factor: number) => engine.value?.zoom(factor),
  scrollToLatest: () => engine.value?.scrollToLatest(),
  focusOn: (index: number, span?: number) => engine.value?.focusOn(index, span),
  focusRange: (from: number, to: number) => engine.value?.focusRange(from, to),
})
</script>

<template>
  <div ref="container" class="relative min-h-[260px] w-full overflow-hidden">
    <canvas
      ref="canvas"
      class="absolute inset-0 size-full cursor-crosshair touch-none"
      role="img"
      :aria-label="`${label}. Blind mode ${blind ? 'on' : 'off'}. Use the playback controls for keyboard access.`"
    />

    <div class="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
      <span
        class="rounded-sm border-[length:var(--hairline)] border-line bg-surface-2/80 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-ink-3 backdrop-blur"
      >
        {{ symbolMask }} · {{ timeframeLabel ?? `${timeframeMinutes}m` }}
      </span>
      <slot name="badge" />
    </div>

    <Transition
      enter-active-class="transition duration-100"
      enter-from-class="opacity-0 translate-y-1"
      leave-active-class="transition duration-75"
      leave-to-class="opacity-0"
    >
      <div
        v-if="hover"
        class="pointer-events-none absolute z-10 w-[170px] rounded-md border-[length:var(--hairline)] border-line bg-overlay/95 p-2 shadow-md backdrop-blur"
        :style="tooltipStyle"
      >
        <div class="flex items-center justify-between text-[9.5px] text-ink-3">
          <span class="font-mono uppercase tracking-wide">{{ hover.relativeLabel }}</span>
          <span>{{ hover.index + 1 }}</span>
        </div>
        <div v-if="!blind && hover.timeLabel" class="font-mono text-[9.5px] text-ink-3">
          {{ hover.timeLabel }}
        </div>
        <div class="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10.5px] tabular-nums">
          <span class="text-ink-3">O</span
          ><span class="text-right" :class="tone">{{ blind ? '•••' : hover.candle.open.toFixed(pricePrecision) }}</span>
          <span class="text-ink-3">H</span
          ><span class="text-right" :class="tone">{{ blind ? '•••' : hover.candle.high.toFixed(pricePrecision) }}</span>
          <span class="text-ink-3">L</span
          ><span class="text-right" :class="tone">{{ blind ? '•••' : hover.candle.low.toFixed(pricePrecision) }}</span>
          <span class="text-ink-3">C</span
          ><span class="text-right" :class="tone">{{
            blind ? '•••' : hover.candle.close.toFixed(pricePrecision)
          }}</span>
        </div>
        <div
          class="mt-1 flex justify-between border-t-[length:var(--hairline)] border-line pt-1 font-mono text-[10px] text-ink-3"
        >
          <span>VOL</span><span>{{ hover.candle.volume.toLocaleString('en-US') }}</span>
        </div>
      </div>
    </Transition>

    <div v-if="!candles.length" class="absolute inset-0 grid place-items-center text-[12px] text-ink-3">
      <slot name="empty">Drawing a sample…</slot>
    </div>
  </div>
</template>
