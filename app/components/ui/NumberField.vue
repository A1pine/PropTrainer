<script setup lang="ts">
import { Minus, Plus } from '@lucide/vue'
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    modelValue: number | null
    min?: number
    max?: number
    step?: number
    precision?: number
    disabled?: boolean
    placeholder?: string
    suffix?: string
    ariaLabel?: string
    invalid?: boolean
    align?: 'left' | 'right'
  }>(),
  {
    min: undefined,
    max: undefined,
    step: 1,
    precision: 0,
    disabled: false,
    placeholder: '0',
    suffix: '',
    ariaLabel: undefined,
    invalid: false,
    align: 'right',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
  commit: [value: number | null]
}>()

defineOptions({ inheritAttrs: false })

const focused = ref(false)
const decimals = computed(() => Math.max(0, props.precision))
const draft = ref(format(props.modelValue))

function format(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return ''
  return value.toFixed(decimals.value)
}

function clamp(value: number): number {
  let next = value
  if (props.min != null) next = Math.max(props.min, next)
  if (props.max != null) next = Math.min(props.max, next)
  const factor = 10 ** decimals.value
  return Math.round(next * factor) / factor
}

function commit(raw: string | number | null) {
  const text = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw)
  if (text === '') {
    emit('update:modelValue', null)
    emit('commit', null)
    return
  }
  const parsed = Number(text.replace(/,/g, ''))
  if (!Number.isFinite(parsed)) {
    draft.value = format(props.modelValue)
    return
  }
  const next = clamp(parsed)
  draft.value = format(next)
  emit('update:modelValue', next)
  emit('commit', next)
}

function onInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
}

function onBlur() {
  focused.value = false
  commit(draft.value)
}

function onFocus(event: FocusEvent) {
  focused.value = true
  const input = event.target as HTMLInputElement
  input.select()
}

function onEnter(event: KeyboardEvent) {
  ;(event.target as HTMLInputElement).blur()
}

function nudge(direction: 1 | -1) {
  if (props.disabled) return
  const base = props.modelValue ?? props.min ?? 0
  commit(base + direction * props.step)
}

watch(
  () => props.modelValue,
  (value) => {
    if (!focused.value) draft.value = format(value)
  },
)

defineExpose({ focus: () => inputRef.value?.focus() })
const inputRef = ref<HTMLInputElement | null>(null)
</script>

<template>
  <div
    :class="
      cn(
        'flex h-9.5 items-center rounded-md border bg-surface-2 transition-[border-color,box-shadow] duration-150',
        invalid ? 'border-danger' : 'border-line hover:border-line-strong',
        'focus-within:border-clay focus-within:ring-2 focus-within:ring-clay/20',
        disabled && 'pointer-events-none opacity-45',
        $attrs.class as string,
      )
    "
  >
    <button
      type="button"
      class="grid h-full w-8 shrink-0 place-items-center text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
      :aria-label="`Decrease ${ariaLabel ?? 'value'}`"
      :disabled="disabled || (min != null && (modelValue ?? 0) <= min)"
      tabindex="-1"
      @click="nudge(-1)"
    >
      <Minus class="size-3.5" aria-hidden="true" />
    </button>
    <div class="relative flex min-w-0 flex-1 items-center">
      <input
        ref="inputRef"
        :value="draft"
        :inputmode="precision > 0 ? 'decimal' : 'numeric'"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="ariaLabel"
        :aria-invalid="invalid || undefined"
        class="w-full bg-transparent py-0 font-mono text-[13px] tabular-nums outline-none placeholder:text-ink-3/60"
        :class="align === 'right' ? 'text-right' : 'text-left'"
        @focus="onFocus"
        @input="onInput"
        @blur="onBlur"
        @keydown.enter.prevent="onEnter"
        @keydown.up.prevent="nudge(1)"
        @keydown.down.prevent="nudge(-1)"
      />
      <span v-if="suffix" class="pointer-events-none ml-1 shrink-0 font-mono text-[11px] text-ink-3">
        {{ suffix }}
      </span>
    </div>
    <button
      type="button"
      class="grid h-full w-8 shrink-0 place-items-center text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
      :aria-label="`Increase ${ariaLabel ?? 'value'}`"
      :disabled="disabled || (max != null && (modelValue ?? 0) >= max)"
      tabindex="-1"
      @click="nudge(1)"
    >
      <Plus class="size-3.5" aria-hidden="true" />
    </button>
  </div>
</template>
