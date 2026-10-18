<script setup lang="ts">
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    percent: number
    size?: number
    strokeWidth?: number
    tone?: 'clay' | 'bull' | 'bear' | 'ink'
    trackClass?: string
  }>(),
  { size: 56, strokeWidth: 4, tone: 'clay' },
)

const radius = computed(() => (props.size - props.strokeWidth) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const clamped = computed(() => Math.max(0, Math.min(100, Number.isFinite(props.percent) ? props.percent : 0)))
const offset = computed(() => circumference.value * (1 - clamped.value / 100))
const stroke = computed(() => {
  switch (props.tone) {
    case 'bull':
      return 'var(--bull)'
    case 'bear':
      return 'var(--bear)'
    case 'ink':
      return 'var(--ink)'
    default:
      return 'var(--clay)'
  }
})
</script>

<template>
  <div class="relative inline-grid place-items-center" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size" class="-rotate-90" aria-hidden="true">
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        stroke="var(--line)"
        :stroke-width="strokeWidth"
        :class="trackClass"
      />
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        :stroke="stroke"
        :stroke-width="strokeWidth"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="offset"
        class="transition-[stroke-dashoffset] duration-500 ease-[var(--ease-swift)]"
      />
    </svg>
    <div :class="cn('absolute inset-0 grid place-items-center text-center leading-none')">
      <slot>
        <span class="num text-[11px] font-medium">{{ Math.round(clamped) }}%</span>
      </slot>
    </div>
  </div>
</template>
