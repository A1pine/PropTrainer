<script setup lang="ts">
const props = defineProps<{ kind: 'drawdown' | 'daily' | 'target' }>()

const width = 160
const height = 56

const paths = computed(() => {
  if (props.kind === 'drawdown') {
    return {
      line: 'M4 14 L36 12 L62 20 L88 18 L112 30 L138 26 L156 40',
      floor: 'M4 42 L156 42',
      fill: 'M4 14 L36 12 L62 20 L88 18 L112 30 L138 26 L156 40 L156 42 L4 42 Z',
    }
  }
  if (props.kind === 'daily') {
    return {
      line: 'M4 30 L30 24 L52 34 L78 26 L100 38 L126 30 L156 44',
      floor: 'M4 46 L156 46',
      fill: 'M4 30 L30 24 L52 34 L78 26 L100 38 L126 30 L156 44 L156 46 L4 46 Z',
    }
  }
  return {
    line: 'M4 46 L28 42 L48 38 L70 30 L92 26 L118 16 L140 12 L156 8',
    floor: 'M4 18 L156 18',
    fill: 'M4 46 L28 42 L48 38 L70 30 L92 26 L118 16 L140 12 L156 8 L156 56 L4 56 Z',
  }
})
</script>

<template>
  <svg :viewBox="`0 0 ${width} ${height}`" class="h-14 w-full" aria-hidden="true">
    <defs>
      <linearGradient :id="`rule-${kind}`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--clay)" stop-opacity="0.16" />
        <stop offset="100%" stop-color="var(--clay)" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path :d="paths.fill" :fill="`url(#rule-${kind})`" />
    <path :d="paths.line" fill="none" stroke="var(--ink-2)" stroke-width="1.2" stroke-linejoin="round" />
    <path
      :d="paths.floor"
      fill="none"
      :stroke="kind === 'target' ? 'var(--bull)' : 'var(--bear)'"
      stroke-width="1"
      stroke-dasharray="3 3"
      stroke-opacity="0.7"
    />
    <circle cx="156" cy="40" r="2.2" fill="var(--clay)" />
  </svg>
</template>
