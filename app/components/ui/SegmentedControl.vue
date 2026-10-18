<script setup lang="ts" generic="T extends string">
import type { Component } from 'vue'
import { cn } from '~/utils/cn'

interface Option {
  value: T
  label: string
  icon?: Component
}

const props = withDefaults(
  defineProps<{
    options: Option[]
    size?: 'sm' | 'md'
    ariaLabel?: string
    disabled?: boolean
  }>(),
  { size: 'md', ariaLabel: undefined, disabled: false },
)

const model = defineModel<T>({ required: true })

const activeIndex = computed(() =>
  Math.max(
    0,
    props.options.findIndex((option) => option.value === model.value),
  ),
)

function select(value: T) {
  if (props.disabled) return
  model.value = value
}

function onKeydown(event: KeyboardEvent, index: number) {
  const last = props.options.length - 1
  let next = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index === last ? 0 : index + 1
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index === 0 ? last : index - 1
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = last
  else return
  event.preventDefault()
  const option = props.options[next]
  if (option) {
    select(option.value)
    const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')
    buttons?.[next]?.focus()
  }
}
</script>

<template>
  <div
    role="tablist"
    :aria-label="ariaLabel"
    :class="
      cn(
        'relative grid w-full rounded-pill bg-ink/[0.06] p-0.5 dark:bg-white/[0.07]',
        disabled && 'pointer-events-none opacity-50',
        $attrs.class as string,
      )
    "
    :style="{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }"
  >
    <span
      class="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-pill bg-surface-2 shadow-xs transition-transform duration-300 ease-snap"
      :style="{
        width: `calc((100% - 4px) / ${options.length})`,
        transform: `translateX(${activeIndex * 100}%)`,
      }"
      aria-hidden="true"
    />
    <button
      v-for="(option, index) in options"
      :id="`seg-${option.value}`"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="option.value === model"
      :tabindex="option.value === model ? 0 : -1"
      :class="
        cn(
          'relative z-10 inline-flex items-center justify-center gap-1.5 rounded-pill font-medium transition-colors duration-200',
          size === 'md' ? 'h-7 px-2 text-[12px]' : 'h-6 px-1.5 text-[11px]',
          option.value === model ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
        )
      "
      @click="select(option.value)"
      @keydown="onKeydown($event, index)"
    >
      <component :is="option.icon" v-if="option.icon" class="size-3.5" aria-hidden="true" />
      {{ option.label }}
    </button>
  </div>
</template>
