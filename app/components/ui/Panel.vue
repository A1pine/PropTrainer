<script setup lang="ts">
import { cn } from '~/utils/cn'

withDefaults(
  defineProps<{
    as?: string
    padded?: boolean
    hoverable?: boolean
    tone?: 'default' | 'sunken' | 'plain'
  }>(),
  { as: 'section', padded: true, hoverable: false, tone: 'default' },
)
</script>

<template>
  <component
    :is="as"
    :class="
      cn(
        'relative rounded-lg border-[length:var(--hairline)]',
        tone === 'default' && 'border-line bg-surface-2',
        tone === 'sunken' && 'border-line-soft bg-sunken',
        tone === 'plain' && 'border-transparent bg-transparent',
        padded && 'p-4 sm:p-5',
        hoverable && 'panel-hover',
        $attrs.class as string,
      )
    "
  >
    <header v-if="$slots.header || $slots.action" class="mb-4 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <slot name="header" />
      </div>
      <div v-if="$slots.action" class="flex shrink-0 items-center gap-1.5">
        <slot name="action" />
      </div>
    </header>
    <slot />
    <footer v-if="$slots.footer" class="mt-4 border-t-[length:var(--hairline)] border-line pt-3">
      <slot name="footer" />
    </footer>
  </component>
</template>
