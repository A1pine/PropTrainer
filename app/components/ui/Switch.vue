<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'

withDefaults(defineProps<{ disabled?: boolean; ariaLabel?: string }>(), {
  disabled: false,
  ariaLabel: undefined,
})
const model = defineModel<boolean>({ default: false })
</script>

<template>
  <SwitchRoot
    v-model="model"
    :disabled="disabled"
    :aria-label="ariaLabel"
    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill border border-line bg-ink/10 p-0.5 transition-colors duration-200 data-[state=checked]:border-clay data-[state=checked]:bg-clay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:opacity-40"
  >
    <SwitchThumb
      class="block size-4 rounded-full bg-surface-2 shadow-xs transition-transform duration-200 ease-snap data-[state=checked]:translate-x-4 data-[state=checked]:bg-white"
    />
  </SwitchRoot>
</template>
