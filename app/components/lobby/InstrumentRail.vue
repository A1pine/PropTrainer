<script setup lang="ts">
import { Check } from '@lucide/vue'
import { instruments } from '~/domain/instruments/catalog'

const props = defineProps<{ selected: string[] }>()
const emit = defineEmits<{ toggle: [symbol: string] }>()

const list = instruments.list()

function active(symbol: string) {
  return props.selected.includes(symbol)
}

function disabled(symbol: string) {
  return active(symbol) && props.selected.length <= 1
}
</script>

<template>
  <div class="scroll-fade -mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="group" aria-label="Instrument universe">
    <button
      v-for="instrument in list"
      :key="instrument.symbol"
      type="button"
      class="group relative flex min-w-[138px] shrink-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-all duration-200 active:scale-[0.985]"
      :class="
        active(instrument.symbol)
          ? 'border-line-strong bg-surface-2 shadow-xs'
          : 'border-line bg-transparent opacity-60 hover:opacity-100'
      "
      :aria-pressed="active(instrument.symbol)"
      :disabled="disabled(instrument.symbol)"
      @click="emit('toggle', instrument.symbol)"
    >
      <span class="flex w-full items-center justify-between">
        <span class="font-mono text-[12px] font-semibold tracking-wide">{{ instrument.symbol }}</span>
        <span
          v-if="active(instrument.symbol)"
          class="grid size-4 place-items-center rounded-full bg-clay text-white"
          aria-hidden="true"
        >
          <Check class="size-2.5" :stroke-width="3" />
        </span>
        <span v-else class="size-1.5 rounded-full border border-line-strong" aria-hidden="true" />
      </span>
      <span class="truncate text-[10.5px] text-ink-3">{{ instrument.name.replace(' E-mini', '') }}</span>
      <span class="font-mono text-[9.5px] text-ink-3">${{ instrument.pointValue }}/pt · {{ instrument.tickSize }} tick</span>
    </button>
  </div>
</template>
