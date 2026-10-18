<script setup lang="ts">
import { cn } from '~/utils/cn'

withDefaults(
  defineProps<{
    label?: string
    hint?: string
    error?: string
    htmlFor?: string
    required?: boolean
    inline?: boolean
  }>(),
  { inline: false },
)
</script>

<template>
  <div :class="cn('flex flex-col gap-1.5', inline && 'flex-row items-center justify-between gap-4')">
    <div class="flex items-baseline justify-between gap-2">
      <label v-if="label" :for="htmlFor" class="text-[11.5px] font-medium text-ink-2">
        {{ label }}
        <span v-if="required" class="text-clay" aria-hidden="true">*</span>
      </label>
      <slot name="aside" />
    </div>
    <slot />
    <p v-if="error" class="text-[11px] leading-snug text-danger">{{ error }}</p>
    <p v-else-if="hint" class="text-[11px] leading-snug text-ink-3">{{ hint }}</p>
  </div>
</template>
