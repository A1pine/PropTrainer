<script setup lang="ts">
const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    points: { index: number; cumulative: number; drawdown: number }[]
    height?: number
  }>(),
  { height: 220 },
)

const width = 720
const padding = { top: 16, right: 12, bottom: 24, left: 12 }
const hover = ref<number | null>(null)

const geometry = computed(() => {
  const raw = props.points
  if (!raw.length) return null
  const data = raw.length === 1 ? [{ index: 0, cumulative: 0, drawdown: 0 }, ...raw] : raw
  const values = [0, ...data.map((point) => point.cumulative)]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const innerW = width - padding.left - padding.right
  const innerH = props.height - padding.top - padding.bottom
  const x = (index: number) => padding.left + (index / (data.length - 1)) * innerW
  const y = (value: number) => padding.top + (1 - (value - min) / span) * innerH
  let line = `M ${x(0).toFixed(1)} ${y(data[0]!.cumulative).toFixed(1)}`
  for (let index = 1; index < data.length; index += 1) {
    const previous = data[index - 1]!
    const point = data[index]!
    const mid = (x(index - 1) + x(index)) / 2
    line += ` C ${mid.toFixed(1)} ${y(previous.cumulative).toFixed(1)}, ${mid.toFixed(1)} ${y(point.cumulative).toFixed(1)}, ${x(index).toFixed(1)} ${y(point.cumulative).toFixed(1)}`
  }
  const area = `${line} L ${x(data.length - 1).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`
  return { data, x, y, line, area, zero: y(0), min, max, innerW, innerH }
})

const hovered = computed(() => {
  if (!geometry.value || hover.value == null) return null
  const point = geometry.value.data[hover.value]
  if (!point) return null
  return { point, x: geometry.value.x(hover.value), y: geometry.value.y(point.cumulative) }
})

function onMove(event: PointerEvent) {
  if (!geometry.value) return
  const bounds = (event.currentTarget as SVGElement).getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
  hover.value = Math.round(ratio * (geometry.value.data.length - 1))
}

const tone = computed(() => {
  const last = props.points.at(-1)?.cumulative ?? 0
  return last >= 0 ? 'var(--bull)' : 'var(--bear)'
})
</script>

<template>
  <div class="relative">
    <svg
      v-if="geometry"
      :viewBox="`0 0 ${width} ${height}`"
      class="w-full touch-none"
      role="img"
      aria-label="Equity curve"
      @pointermove="onMove"
      @pointerleave="hover = null"
    >
      <defs>
        <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="tone" stop-opacity="0.18" />
          <stop offset="100%" :stop-color="tone" stop-opacity="0" />
        </linearGradient>
      </defs>

      <g stroke="var(--line)" stroke-width="1">
        <line v-for="row in 4" :key="row" :x1="padding.left" :x2="width - padding.right" :y1="padding.top + ((height - padding.top - padding.bottom) * row) / 4" :y2="padding.top + ((height - padding.top - padding.bottom) * row) / 4" />
      </g>
      <line :x1="padding.left" :x2="width - padding.right" :y1="geometry.zero" :y2="geometry.zero" stroke="var(--line-strong)" stroke-dasharray="3 4" />

      <path :d="geometry.area" fill="url(#equity-fill)" />
      <path :d="geometry.line" fill="none" :stroke="tone" stroke-width="2" stroke-linecap="round" />

      <g v-if="hovered">
        <line :x1="hovered.x" :x2="hovered.x" :y1="padding.top" :y2="height - padding.bottom" stroke="var(--line-strong)" stroke-dasharray="3 3" />
        <circle :cx="hovered.x" :cy="hovered.y" r="3.5" :fill="tone" stroke="var(--surface-2)" stroke-width="2" />
      </g>
      <circle :cx="geometry.x(geometry.data.length - 1)" :cy="geometry.y(geometry.data.at(-1)?.cumulative ?? 0)" r="2.5" :fill="tone" />
    </svg>
    <div v-else class="grid h-[220px] place-items-center text-[11px] text-ink-3">{{ t('statsPage.equity.empty') }}</div>

    <div
      v-if="hovered"
      class="pointer-events-none absolute top-2 rounded-md border-[length:var(--hairline)] border-line bg-overlay/95 px-2 py-1 font-mono text-[10px] shadow-sm backdrop-blur"
      :style="{ left: `${Math.min(90, ((hovered.x / width) * 100))}%` }"
    >
      <span class="text-ink-3">#{{ hovered.point.index }}</span>
      <span class="ml-2" :class="hovered.point.cumulative >= 0 ? 'text-bull-strong' : 'text-bear-strong'">
        {{ formatMoney(hovered.point.cumulative, { signed: true }) }}
      </span>
    </div>
  </div>
</template>
