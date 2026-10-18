<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    data: number[]
    width?: number
    height?: number
    tone?: 'auto' | 'bull' | 'bear' | 'clay' | 'ink'
    fill?: boolean
    strokeWidth?: number
    showDot?: boolean
  }>(),
  { width: 120, height: 36, tone: 'auto', fill: true, strokeWidth: 1.5, showDot: true },
)

const id = useId()
const resolvedTone = computed(() => {
  if (props.tone !== 'auto') return props.tone
  const first = props.data[0] ?? 0
  const last = props.data[props.data.length - 1] ?? 0
  return last >= first ? 'bull' : 'bear'
})

const color = computed(() => {
  switch (resolvedTone.value) {
    case 'bull':
      return 'var(--bull)'
    case 'bear':
      return 'var(--bear)'
    case 'clay':
      return 'var(--clay)'
    default:
      return 'var(--ink-3)'
  }
})

const geometry = computed(() => {
  const data = props.data
  if (data.length < 2) return { line: '', area: '', last: null as null | { x: number; y: number } }
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pad = props.strokeWidth
  const innerW = props.width - pad * 2
  const innerH = props.height - pad * 2
  const points = data.map((value, index) => ({
    x: pad + (index / (data.length - 1)) * innerW,
    y: pad + (1 - (value - min) / span) * innerH,
  }))

  let line = `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!
    const curr = points[i]!
    const midX = (prev.x + curr.x) / 2
    line += ` C ${midX.toFixed(2)} ${prev.y.toFixed(2)}, ${midX.toFixed(2)} ${curr.y.toFixed(2)}, ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`
  }
  const last = points[points.length - 1]!
  const area = `${line} L ${last.x.toFixed(2)} ${props.height} L ${points[0]!.x.toFixed(2)} ${props.height} Z`
  return { line, area, last }
})
</script>

<template>
  <svg :viewBox="`0 0 ${width} ${height}`" :width="width" :height="height" class="overflow-visible" aria-hidden="true">
    <defs>
      <linearGradient :id="`spark-${id}`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.22" />
        <stop offset="100%" :stop-color="color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path v-if="fill && geometry.area" :d="geometry.area" :fill="`url(#spark-${id})`" />
    <path
      v-if="geometry.line"
      :d="geometry.line"
      fill="none"
      :stroke="color"
      :stroke-width="strokeWidth"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle
      v-if="showDot && geometry.last"
      :cx="geometry.last.x"
      :cy="geometry.last.y"
      r="2.2"
      :fill="color"
      class="animate-pulse-dot"
    />
  </svg>
</template>
