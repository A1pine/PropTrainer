<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core'

const props = withDefaults(
  defineProps<{
    value: number
    decimals?: number
    prefix?: string
    suffix?: string
    duration?: number
    flash?: boolean
    signed?: boolean
  }>(),
  { decimals: 0, prefix: '', suffix: '', duration: 520, flash: false, signed: false },
)

const prefersReduced = usePreferredReducedMotion()
const settings = useSettingsStore()
const reduced = computed(() => settings.settings.reduceMotion || prefersReduced.value === 'reduce')
const display = ref(props.value)
const flashClass = ref('')
let frame = 0
let flashTimer: ReturnType<typeof setTimeout> | undefined

const formatter = computed(
  () =>
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: props.decimals,
      maximumFractionDigits: props.decimals,
    }),
)

const text = computed(() => {
  const sign = props.signed && display.value > 0 ? '+' : ''
  return `${sign}${props.prefix}${formatter.value.format(display.value)}${props.suffix}`
})

function stop() {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
}

function animateTo(target: number) {
  stop()
  const from = display.value
  if (!Number.isFinite(target) || reduced.value || target === from || props.duration <= 0) {
    display.value = target
    return
  }
  const startedAt = performance.now()
  const delta = target - from
  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / props.duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    display.value = from + delta * eased
    if (progress < 1) frame = requestAnimationFrame(tick)
    else display.value = target
  }
  frame = requestAnimationFrame(tick)
}

watch(
  () => props.value,
  (value, previous) => {
    animateTo(value)
    if (props.flash && value !== previous) {
      flashClass.value = value > previous ? 'tick-flash-up' : 'tick-flash-down'
      if (flashTimer) clearTimeout(flashTimer)
      flashTimer = setTimeout(() => (flashClass.value = ''), 600)
    }
  },
)

watch(reduced, (value) => {
  if (value) {
    stop()
    display.value = props.value
  }
})

onBeforeUnmount(() => {
  stop()
  if (flashTimer) clearTimeout(flashTimer)
})
</script>

<template>
  <span :class="['num tabular-nums transition-colors', flashClass]">{{ text }}</span>
</template>
