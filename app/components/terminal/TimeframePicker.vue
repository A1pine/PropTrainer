<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from '@lucide/vue'
import type { SimTimeframe } from '~/domain/sim/types'
import {
  BASE_MINUTES,
  TERMINAL_TIMEFRAMES,
  isTimeframeAvailable,
  timeframeLabel,
  timeframeMinutes,
} from '~/domain/sim/timeframe'

const props = defineProps<{ modelValue: SimTimeframe; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: SimTimeframe] }>()
const { t } = useI18n()

type CustomError = 'invalid' | 'finer' | 'step' | 'tooLarge'

const inputId = useId()
const hintId = useId()
const errorId = useId()

const options = computed(() => TERMINAL_TIMEFRAMES.map((value) => ({ value, label: timeframeLabel(value) })))
const draft = ref('')
const errorKey = ref<CustomError | null>(null)

const customMinutes = computed(() => {
  if (TERMINAL_TIMEFRAMES.includes(props.modelValue)) return null
  const minutes = timeframeMinutes(props.modelValue)
  if (minutes === null || !isTimeframeAvailable(props.modelValue)) return null
  return minutes
})
const customSelected = computed(() => customMinutes.value !== null)
const customLabel = computed(() => timeframeLabel(props.modelValue))

const error = computed(() => {
  if (!errorKey.value) return ''
  return t(`terminal.timeframe.custom.errors.${errorKey.value}`)
})
const describedBy = computed(() => (errorKey.value ? `${hintId} ${errorId}` : hintId))

watch(
  () => props.modelValue,
  (value) => {
    errorKey.value = null
    if (TERMINAL_TIMEFRAMES.includes(value)) {
      draft.value = ''
      return
    }
    const minutes = timeframeMinutes(value)
    if (minutes !== null) draft.value = String(minutes)
  },
  { immediate: true },
)

function select(value: SimTimeframe) {
  if (props.disabled) return
  errorKey.value = null
  draft.value = ''
  emit('update:modelValue', value)
}

function applyCustom() {
  if (props.disabled) return
  const raw = draft.value.trim()
  const minutes = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(minutes)) {
    errorKey.value = 'invalid'
    return
  }
  if (minutes < BASE_MINUTES) {
    errorKey.value = 'finer'
    return
  }
  if (minutes % BASE_MINUTES !== 0) {
    errorKey.value = 'step'
    return
  }
  const frame = `${minutes}m` as SimTimeframe
  if (!isTimeframeAvailable(frame)) {
    // The domain caps otherwise valid base-bar multiples at 1440 minutes.
    errorKey.value = 'tooLarge'
    return
  }
  errorKey.value = null
  emit('update:modelValue', frame)
}
</script>

<template>
  <div
    class="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1"
    role="group"
    :aria-label="t('terminal.timeframe.label')"
    @keydown.stop
  >
    <div class="flex flex-wrap items-center gap-0.5">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="h-6 rounded-sm px-1.5 font-mono text-[10.5px] tabular-nums transition-colors disabled:opacity-40"
        :class="
          option.value === modelValue ? 'bg-ink/[0.09] text-ink' : 'text-ink-3 hover:bg-ink/[0.05] hover:text-ink-2'
        "
        :data-testid="`timeframe-${option.value}`"
        :data-preset="option.value"
        :aria-pressed="option.value === modelValue"
        :disabled="disabled"
        @click="select(option.value)"
      >
        {{ option.label }}
      </button>
    </div>

    <span
      v-if="customSelected"
      class="rounded-sm bg-ink/[0.09] px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-ink"
      data-testid="timeframe-custom-active"
      :aria-label="t('terminal.timeframe.custom.selected', { label: customLabel })"
    >
      {{ customLabel }}
    </span>

    <form
      class="flex items-center gap-0.5"
      novalidate
      :title="t('terminal.timeframe.custom.baseHint')"
      @submit.prevent="applyCustom"
    >
      <label class="sr-only" :for="inputId">{{ t('terminal.timeframe.custom.label') }}</label>
      <input
        :id="inputId"
        v-model="draft"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        spellcheck="false"
        placeholder="45"
        class="h-6 w-10 rounded-sm border bg-surface-2 px-1 text-center font-mono text-[10.5px] tabular-nums text-ink outline-none transition-colors placeholder:text-ink-3/60 focus-visible:border-clay focus-visible:ring-2 focus-visible:ring-clay/20 disabled:opacity-40"
        :class="errorKey ? 'border-danger' : customSelected ? 'border-clay' : 'border-line'"
        data-testid="timeframe-custom-input"
        :aria-describedby="describedBy"
        :aria-invalid="errorKey ? 'true' : undefined"
        :disabled="disabled"
        @input="errorKey = null"
      />
      <span class="text-[10px] text-ink-3" aria-hidden="true">m</span>
      <button
        type="submit"
        class="grid size-5 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-ink/[0.05] hover:text-ink disabled:opacity-40"
        data-testid="timeframe-custom-apply"
        :aria-label="t('terminal.timeframe.custom.apply')"
        :disabled="disabled"
      >
        <Check class="size-3" aria-hidden="true" />
      </button>
    </form>

    <p :id="hintId" class="sr-only">{{ t('terminal.timeframe.custom.baseHint') }}</p>
    <p
      v-if="error"
      :id="errorId"
      role="alert"
      class="basis-full text-[10px] leading-tight text-danger"
      data-testid="timeframe-custom-error"
    >
      {{ error }}
    </p>
  </div>
</template>
