<script setup lang="ts">
import { ArrowDownRight, ArrowUpRight, Ban, MoveHorizontal, TrendingDown, TrendingUp, Waves } from '@lucide/vue'
import type { Regime } from '~/domain/market/types'
import type { TradeDirection } from '~/domain/drill/plan'

const props = defineProps<{
  state: Regime
  direction: TradeDirection
  thesis: string
  waitedBars: number
  maxThesis?: number
  disabled?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:state': [state: Regime]
  'update:direction': [direction: TradeDirection]
  'update:thesis': [thesis: string]
  commit: []
  wait: []
}>()

const { t } = useI18n()

const states = computed(() => [
  { value: 'uptrend' as Regime, label: t('read.states.uptrend'), icon: TrendingUp },
  { value: 'downtrend' as Regime, label: t('read.states.downtrend'), icon: TrendingDown },
  { value: 'range' as Regime, label: t('read.states.range'), icon: MoveHorizontal },
  { value: 'expansion' as Regime, label: t('read.states.expansion'), icon: Waves },
])

const directionOptions = computed(() => [
  { value: 'long' as const, label: t('ticket.long'), icon: ArrowUpRight },
  { value: 'short' as const, label: t('ticket.short'), icon: ArrowDownRight },
  { value: 'none' as const, label: t('read.noTrade'), icon: Ban },
])

const longLocked = computed(() => props.state === 'downtrend')
const shortLocked = computed(() => props.state === 'uptrend')
const directionModel = computed({
  get: () => props.direction,
  set: (value: string) => {
    const direction = value as TradeDirection
    if ((direction === 'long' && longLocked.value) || (direction === 'short' && shortLocked.value)) return
    emit('update:direction', direction)
  },
})
const thesisLength = computed(() => props.thesis.trim().length)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <p class="label-micro">{{ t('read.step') }}</p>
      <span v-if="waitedBars > 0" class="font-mono text-[10px] text-ink-3">{{
        t('read.waited', { bars: waitedBars })
      }}</span>
    </div>
    <div>
      <h3 class="text-[16px] font-semibold tracking-tight">{{ t('read.prompt') }}</h3>
      <p class="mt-1 text-[11.5px] leading-relaxed text-ink-3">{{ t('read.hint') }}</p>
    </div>

    <div class="grid grid-cols-2 gap-1.5" role="radiogroup" :aria-label="t('read.prompt')">
      <button
        v-for="option in states"
        :key="option.value"
        type="button"
        role="radio"
        :aria-checked="state === option.value"
        class="flex items-center gap-2 rounded-md border border-line px-2.5 py-2.5 text-left text-[12px] transition-all duration-150 active:scale-[0.98]"
        :class="
          state === option.value
            ? 'border-clay bg-clay-soft text-clay-ink shadow-xs'
            : 'text-ink-2 hover:border-line-strong hover:bg-ink/[0.03]'
        "
        :disabled="disabled"
        @click="emit('update:state', option.value)"
      >
        <component :is="option.icon" class="size-4 shrink-0" :stroke-width="1.7" aria-hidden="true" />
        {{ option.label }}
      </button>
    </div>

    <div>
      <p class="mb-1.5 text-[11.5px] font-medium text-ink-2">{{ t('read.direction') }}</p>
      <SegmentedControl v-model="directionModel" :options="directionOptions" :aria-label="t('read.direction')" />
      <p v-if="longLocked || shortLocked" class="mt-1.5 text-[10.5px] leading-snug text-warn">
        {{ t('read.counterTrendLock', { state: t(`read.states.${state}`) }) }}
      </p>
    </div>

    <div>
      <div class="mb-1.5 flex items-center justify-between">
        <label for="thesis" class="text-[11.5px] font-medium text-ink-2">{{ t('read.thesis') }}</label>
        <span class="font-mono text-[10px] text-ink-3">{{ thesisLength }}/{{ maxThesis ?? 160 }}</span>
      </div>
      <textarea
        id="thesis"
        :value="thesis"
        rows="3"
        :maxlength="maxThesis ?? 160"
        :placeholder="t('read.thesisPlaceholder')"
        :disabled="disabled"
        class="w-full resize-none rounded-md border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed outline-none transition-[border-color,box-shadow] placeholder:text-ink-3/70 focus:border-clay focus:ring-2 focus:ring-clay/20 disabled:opacity-50"
        @input="emit('update:thesis', ($event.target as HTMLTextAreaElement).value)"
      />
      <p class="mt-1 text-[10.5px] leading-snug text-ink-3">{{ t('read.thesisHint') }}</p>
    </div>

    <div class="flex items-center gap-2 border-t-[length:var(--hairline)] border-line pt-3">
      <Button variant="primary" size="md" block :disabled="disabled" @click="emit('commit')">
        {{ t('read.commit') }}
        <Kbd :keys="['↵']" class="ml-1 !border-black/15 !bg-black/10 !text-current" />
      </Button>
      <Button variant="ghost" size="md" :disabled="disabled" @click="emit('wait')">
        {{ t('read.wait') }}
      </Button>
    </div>
  </div>
</template>
