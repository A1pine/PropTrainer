<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SimTimeframe } from '~/domain/sim/types'
import { TERMINAL_TIMEFRAMES, timeframeLabel } from '~/domain/sim/timeframe'

const props = defineProps<{ modelValue: SimTimeframe; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: SimTimeframe] }>()
const { t } = useI18n()

const options = computed(() => TERMINAL_TIMEFRAMES.map((value) => ({ value, label: timeframeLabel(value) })))

function select(value: SimTimeframe) {
  if (props.disabled) return
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="flex items-center gap-0.5" role="group" :aria-label="t('terminal.timeframe.label')">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="h-6 rounded-sm px-1.5 font-mono text-[10.5px] tabular-nums transition-colors disabled:opacity-40"
      :class="
        option.value === modelValue ? 'bg-ink/[0.09] text-ink' : 'text-ink-3 hover:bg-ink/[0.05] hover:text-ink-2'
      "
      :aria-pressed="option.value === modelValue"
      :disabled="disabled"
      @click="select(option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
