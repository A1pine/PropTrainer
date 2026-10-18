<script setup lang="ts">
import { cn } from '~/utils/cn'

withDefaults(defineProps<{ width?: string; height?: string; rounded?: string }>(), {
  width: 'w-full',
  height: 'h-4',
  rounded: 'rounded-sm',
})
</script>

<template>
  <span
    :class="
      cn(
        'relative block overflow-hidden bg-ink/6',
        width,
        height,
        rounded,
        'after:absolute after:inset-y-0 after:w-1/3 after:animate-sweep after:bg-gradient-to-r after:from-transparent after:via-white/45 after:to-transparent',
        'dark:after:via-white/10',
      )
    "
    aria-hidden="true"
  />
</template>
