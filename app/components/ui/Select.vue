<script setup lang="ts">
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'
import { Check, ChevronDown } from '@lucide/vue'
import { cn } from '~/utils/cn'

interface Option {
  value: string
  label: string
  hint?: string
}

withDefaults(
  defineProps<{
    options: Option[]
    placeholder?: string
    disabled?: boolean
    ariaLabel?: string
    size?: 'sm' | 'md'
  }>(),
  { placeholder: 'Select…', disabled: false, ariaLabel: undefined, size: 'md' },
)

const model = defineModel<string>()
</script>

<template>
  <SelectRoot v-model="model" :disabled="disabled">
    <SelectTrigger
      :aria-label="ariaLabel"
      :class="
        cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-3 text-left transition-colors duration-150 hover:border-line-strong focus-visible:border-clay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/20 disabled:opacity-45',
          size === 'md' ? 'h-9.5 text-[13px]' : 'h-8 text-[12px]',
          $attrs.class as string,
        )
      "
    >
      <SelectValue :placeholder="placeholder" class="truncate" />
      <ChevronDown class="size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        class="z-50 max-h-[min(320px,var(--reka-select-content-available-height))] min-w-[var(--reka-select-trigger-width)] overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-overlay shadow-overlay data-[state=open]:animate-scale-in"
      >
        <SelectViewport class="p-1">
          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            class="relative flex cursor-pointer select-none items-center gap-2 rounded-sm py-1.5 pl-8 pr-2 text-[12.5px] text-ink-2 outline-none transition-colors data-[highlighted]:bg-ink/5 data-[highlighted]:text-ink"
          >
            <SelectItemIndicator class="absolute left-2 grid place-items-center text-clay">
              <Check class="size-3.5" aria-hidden="true" />
            </SelectItemIndicator>
            <SelectItemText class="flex-1">{{ option.label }}</SelectItemText>
            <span v-if="option.hint" class="font-mono text-[10.5px] text-ink-3">{{ option.hint }}</span>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
