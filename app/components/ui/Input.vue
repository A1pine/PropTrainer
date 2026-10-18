<script setup lang="ts">
import { cn } from '~/utils/cn'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    size?: 'sm' | 'md'
    invalid?: boolean
    prefix?: string
    suffix?: string
  }>(),
  { size: 'md', invalid: false },
)

const model = defineModel<string | number | null>()
</script>

<template>
  <label
    :class="
      cn(
        'group flex items-center gap-2 rounded-md border bg-surface-2 transition-[border-color,box-shadow] duration-150',
        size === 'md' ? 'h-9.5 px-3' : 'h-8 px-2.5',
        invalid ? 'border-danger' : 'border-line hover:border-line-strong',
        'focus-within:border-clay focus-within:ring-2 focus-within:ring-clay/20',
        $attrs.class as string,
      )
    "
  >
    <span v-if="prefix" class="shrink-0 font-mono text-[12px] text-ink-3">{{ prefix }}</span>
    <input
      v-model="model"
      v-bind="$attrs"
      :class="
        cn(
          'min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3/70',
          size === 'md' ? 'text-[13px]' : 'text-[12px]',
        )
      "
    />
    <span v-if="suffix" class="shrink-0 font-mono text-[11px] text-ink-3">{{ suffix }}</span>
    <slot name="trailing" />
  </label>
</template>
