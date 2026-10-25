<script setup lang="ts">
import { Eraser, Minus, MousePointer2, TrendingUp } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import ChartCanvas from '~/components/chart/ChartCanvas.vue'
import ExamAnalysisControls from '~/components/analysis/ExamAnalysisControls.vue'
import type { Candle } from '~/domain/market/types'
import type { ChartAnalysis, ChartDrawing, ChartOrderLine, ChartStyle, ChartTool } from '~/lib/chart/types'

const props = withDefaults(
  defineProps<{
    candles: Candle[]
    visibleCount: number
    /** Stable pane series identity; appends must not reset pan/zoom. */
    seriesKey?: string
    orders?: readonly ChartOrderLine[]
    chartStyle?: ChartStyle
    orderDraggable?: boolean
    pricePickEnabled?: boolean
    timeframeMinutes?: number
    timeframeLabel?: string
    timeZone?: string
    showDates?: boolean
    pricePrecision?: number
    tickSize?: number
    analysis?: ChartAnalysis | null
    symbolMask?: string
    label?: string
    blind?: boolean
  }>(),
  {
    orders: () => [],
    chartStyle: 'candles',
    orderDraggable: false,
    pricePickEnabled: false,
    timeframeMinutes: 5,
    timeframeLabel: undefined,
    timeZone: 'UTC',
    showDates: false,
    pricePrecision: 2,
    tickSize: 0.25,
    analysis: null,
    symbolMask: 'M???',
    label: 'Price chart',
    blind: false,
  },
)

const emit = defineEmits<{
  'order-drag': [id: string, price: number]
  'order-cancel': [id: string]
  'price-pick': [price: number]
}>()

const { t, te } = useI18n()
const activeTool = ref<ChartTool>('cursor')
const drawings = ref<ChartDrawing[]>([])
const chart = ref<{
  fit: () => void
  zoom: (factor: number) => void
  scrollToLatest: () => void
  focusOn: (index: number, span?: number) => void
  focusRange: (from: number, to: number) => void
} | null>(null)

const tools: { value: ChartTool; icon: typeof MousePointer2; key: string; fallback: string }[] = [
  { value: 'cursor', icon: MousePointer2, key: 'chart.tool.cursor', fallback: 'Cursor / pan' },
  { value: 'trend', icon: TrendingUp, key: 'chart.tool.trend', fallback: 'Trend line' },
  { value: 'horizontal', icon: Minus, key: 'chart.tool.horizontal', fallback: 'Horizontal line' },
]

function uiLabel(key: string, fallback: string) {
  return te(key) ? t(key) : fallback
}

const revealCount = computed(() => {
  if (!Number.isFinite(props.visibleCount)) return 0
  return Math.max(0, Math.min(props.candles.length, Math.floor(props.visibleCount)))
})
const visibleCandles = computed(() => props.candles.slice(0, revealCount.value))

const {
  enabled: analysisEnabled,
  frameworks: analysisFrameworks,
  layers: analysisLayers,
  report: analysisReport,
  overlay: analysisOverlay,
  status: analysisStatus,
  retry: retryAnalysis,
} = useExamAnalysis({
  candles: () => visibleCandles.value,
  visibleCount: () => revealCount.value,
  precision: () => props.pricePrecision,
})

const mergedAnalysis = computed<ChartAnalysis | null>(() => {
  const risk = props.analysis ?? null
  const overlay = analysisOverlay.value
  if (!overlay) return risk
  if (!risk) return overlay
  return {
    series: [...risk.series, ...overlay.series],
    zones: [...risk.zones, ...overlay.zones],
    levels: [...risk.levels, ...overlay.levels],
    markers: [...risk.markers, ...overlay.markers],
    profile: [...risk.profile, ...overlay.profile],
  }
})

const drawingActive = computed(() => activeTool.value !== 'cursor')
const effectiveOrderDraggable = computed(() => props.orderDraggable && !drawingActive.value)
const effectivePricePickEnabled = computed(() => props.pricePickEnabled && !drawingActive.value)

function setTool(tool: ChartTool) {
  activeTool.value = tool
}

function clearDrawings() {
  drawings.value = []
}

function updateDrawings(next: ChartDrawing[]) {
  drawings.value = next
}

function forwardOrderDrag(id: string, price: number) {
  if (effectiveOrderDraggable.value) emit('order-drag', id, price)
}

function forwardOrderCancel(id: string) {
  if (!drawingActive.value) emit('order-cancel', id)
}

function forwardPricePick(price: number) {
  if (effectivePricePickEnabled.value) emit('price-pick', price)
}

watch(
  () => [props.seriesKey, props.symbolMask, props.timeframeLabel, props.timeframeMinutes] as const,
  (next, previous) => {
    if (previous && next.some((value, index) => value !== previous[index])) drawings.value = []
  },
)

defineExpose({
  fit: () => chart.value?.fit(),
  zoom: (factor: number) => chart.value?.zoom(factor),
  scrollToLatest: () => chart.value?.scrollToLatest(),
  focusOn: (index: number, span?: number) => chart.value?.focusOn(index, span),
  focusRange: (from: number, to: number) => chart.value?.focusRange(from, to),
})
</script>

<template>
  <div class="flex min-h-0 w-full flex-col" data-testid="terminal-chart-pane">
    <div class="flex items-center gap-0.5 border-b-[length:var(--hairline)] border-line px-1 py-0.5">
      <button
        v-for="tool in tools"
        :key="tool.value"
        type="button"
        class="grid size-7 shrink-0 place-items-center rounded-sm transition-colors"
        :class="
          activeTool === tool.value ? 'bg-clay-soft text-clay-ink' : 'text-ink-3 hover:bg-ink/[0.05] hover:text-ink-2'
        "
        :aria-label="uiLabel(tool.key, tool.fallback)"
        :aria-pressed="activeTool === tool.value"
        :title="uiLabel(tool.key, tool.fallback)"
        :data-testid="`chart-tool-${tool.value}`"
        @click="setTool(tool.value)"
      >
        <component :is="tool.icon" class="size-3.5" aria-hidden="true" />
      </button>

      <span class="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />

      <button
        type="button"
        class="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-ink/[0.05] hover:text-ink-2 disabled:opacity-35"
        :disabled="drawings.length === 0"
        :aria-label="uiLabel('chart.clear', 'Clear drawings')"
        :title="uiLabel('chart.clear', 'Clear drawings')"
        data-testid="chart-clear-drawings"
        @click="clearDrawings"
      >
        <Eraser class="size-3.5" aria-hidden="true" />
      </button>

      <span
        v-if="drawingActive"
        class="min-w-0 truncate pl-1 text-[9.5px] text-clay-ink"
        data-testid="drawing-mode-note"
      >
        {{ uiLabel('chart.tool.active', 'Drawing mode: clicks add shapes, not orders') }}
      </span>
      <span
        v-else-if="drawings.length"
        class="min-w-0 truncate pl-1 text-[9.5px] text-ink-3"
        data-testid="drawings-scope-note"
      >
        {{ uiLabel('chart.tool.scope', 'Drawings clear when the symbol or timeframe changes') }}
      </span>

      <div class="ml-auto min-w-0 shrink-0 pl-1">
        <ExamAnalysisControls
          v-model:enabled="analysisEnabled"
          v-model:frameworks="analysisFrameworks"
          v-model:layers="analysisLayers"
          :report="analysisReport"
          :status="analysisStatus"
          :count="revealCount"
          compact
          @retry="retryAnalysis"
        />
      </div>
    </div>

    <ChartCanvas
      ref="chart"
      class="min-h-[260px] flex-1"
      :candles="candles"
      :visible-count="visibleCount"
      :series-key="seriesKey"
      :orders="orders"
      :chart-style="chartStyle"
      :order-draggable="effectiveOrderDraggable"
      :price-pick-enabled="effectivePricePickEnabled"
      :timeframe-minutes="timeframeMinutes"
      :timeframe-label="timeframeLabel"
      :time-zone="timeZone"
      :show-dates="showDates"
      :price-precision="pricePrecision"
      :tick-size="tickSize"
      :analysis="mergedAnalysis"
      :symbol-mask="symbolMask"
      :label="label"
      :blind="blind"
      :tool="activeTool"
      :drawings="drawings"
      @update:drawings="updateDrawings"
      @order-drag="forwardOrderDrag"
      @order-cancel="forwardOrderCancel"
      @price-pick="forwardPricePick"
    >
      <template #badge><slot name="badge" /></template>
    </ChartCanvas>
  </div>
</template>
