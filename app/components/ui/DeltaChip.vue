<script setup lang="ts">
import { ArrowDownRight, ArrowUpRight, Minus } from '@lucide/vue'
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    value: number | null
    decimals?: number
    suffix?: string
    prefix?: string
    invert?: boolean
    showIcon?: boolean
    size?: 'sm' | 'md'
    neutralThreshold?: number
  }>(),
  { decimals: 2, suffix: '', prefix: '', invert: false, showIcon: true, size: 'sm', neutralThreshold: 0 },
)

const direction = computed<'up' | 'down' | 'flat'>(() => {
  if (props.value == null || Math.abs(props.value) <= props.neutralThreshold) return 'flat'
  return props.value > 0 ? 'up' : 'down'
})

const positive = computed(() => (props.invert ? direction.value === 'down' : direction.value === 'up'))
const negative = computed(() => (props.invert ? direction.value === 'up' : direction.value === 'down'))

const toneClass = computed(() =>
  positive.value ? 'text-bull-strong' : negative.value ? 'text-bear-strong' : 'text-ink-3',
)
const bgClass = computed(() =>
  positive.value ? 'bg-bull-soft' : negative.value ? 'bg-bear-soft' : 'bg-ink/5',
)

const label = computed(() => {
  if (props.value == null) return '—'
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals,
  })
  const sign = props.value > 0 ? '+' : ''
  return `${sign}${props.prefix}${formatter.format(props.value)}${props.suffix}`
})
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex items-center gap-1 rounded-pill font-medium',
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-[12px]',
        toneClass,
        bgClass,
        $attrs.class as string,
      )
    "
  >
    <template v-if="showIcon">
      <ArrowUpRight v-if="direction === 'up'" class="size-3" aria-hidden="true" />
      <ArrowDownRight v-else-if="direction === 'down'" class="size-3" aria-hidden="true" />
      <Minus v-else class="size-3" aria-hidden="true" />
    </template>
    <span class="num">{{ label }}</span>
  </span>
</template>
