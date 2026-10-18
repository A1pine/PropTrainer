<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(
  defineProps<{
    content: string
    side?: 'top' | 'right' | 'bottom' | 'left'
    align?: 'start' | 'center' | 'end'
    delay?: number
  }>(),
  { side: 'top', align: 'center', delay: 260 },
)
</script>

<template>
  <TooltipProvider :delay-duration="delay" :skip-delay-duration="80">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="side"
          :align="align"
          :side-offset="6"
          class="z-60 max-w-[240px] rounded-md border-[length:var(--hairline)] border-line bg-overlay px-2.5 py-1.5 text-[11.5px] leading-snug text-ink-2 shadow-overlay data-[state=delayed-open]:animate-scale-in"
        >
          {{ content }}
          <TooltipArrow class="fill-[var(--surface-overlay)]" :width="8" :height="5" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
