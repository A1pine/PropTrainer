<script setup lang="ts">
import { ArrowDown, ArrowUp, Crosshair, Diamond } from '@lucide/vue'
import type { TradeExecution } from '~/domain/trading/executions'

defineProps<{
  executions: readonly TradeExecution[]
  precision: number
}>()
const emit = defineEmits<{ focus: [execution: TradeExecution] }>()
const { t, locale } = useI18n()

const timeFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'UTC',
    }),
)

function barTime(timestamp: number) {
  return timeFormatter.value.format(new Date(timestamp * 1000))
}
</script>

<template>
  <section class="space-y-2" data-testid="execution-summary" :aria-label="t('review.executions.title')">
    <h4 class="label-micro">{{ t('review.executions.title') }}</h4>
    <p v-if="!executions.length" class="rounded-md border border-dashed border-line p-3 text-[11px] text-ink-2">
      {{ t('review.executions.empty') }}
    </p>
    <template v-else>
      <div
        v-for="(execution, index) in executions"
        :key="execution.id"
        class="rounded-md border border-line bg-sunken p-2.5"
        data-testid="execution-row"
      >
        <div class="mb-2 flex items-center justify-between gap-2 text-[11px]">
          <span class="font-medium">
            {{ t('review.executions.trade', { index: index + 1 }) }} ·
            {{ t(execution.side === 'long' ? 'ticket.long' : 'ticket.short') }}
          </span>
          <button
            type="button"
            class="flex items-center gap-1 rounded-sm px-1.5 py-1 text-clay-ink transition-colors hover:bg-clay-soft"
            :aria-label="t('review.executions.focusTrade', { index: index + 1 })"
            @click="emit('focus', execution)"
          >
            <Crosshair class="size-3.5" aria-hidden="true" />
            {{ t('review.executions.focus') }}
          </button>
        </div>
        <dl class="grid grid-cols-2 gap-3">
          <div class="min-w-0" data-testid="execution-entry" :data-bar="execution.entryBar">
            <dt class="flex items-center gap-1 text-[10.5px] text-ink-2">
              <component
                :is="execution.side === 'long' ? ArrowUp : ArrowDown"
                class="size-3.5"
                :class="execution.side === 'long' ? 'text-bull-strong' : 'text-bear-strong'"
                aria-hidden="true"
              />
              {{ t('review.executions.entry') }}
            </dt>
            <dd class="num mt-0.5 text-[13px]" data-testid="execution-entry-price">
              {{ formatPrice(execution.entryPrice, precision) }}
            </dd>
            <dd class="mt-1 text-[10px] leading-relaxed text-ink-3">
              <time :datetime="new Date(execution.entryTime * 1000).toISOString()">{{
                barTime(execution.entryTime)
              }}</time>
              <span class="block num">{{ t('review.executions.bar', { index: execution.entryBar + 1 }) }}</span>
            </dd>
          </div>
          <div class="min-w-0" data-testid="execution-exit" :data-bar="execution.exitBar">
            <dt class="flex items-center gap-1 text-[10.5px] text-ink-2">
              <Diamond class="size-3" aria-hidden="true" />
              {{ t('review.executions.exit') }}
            </dt>
            <dd class="num mt-0.5 text-[13px]" data-testid="execution-exit-price">
              {{ formatPrice(execution.exitPrice, precision) }}
            </dd>
            <dd class="mt-1 text-[10px] leading-relaxed text-ink-3">
              <time :datetime="new Date(execution.exitTime * 1000).toISOString()">{{
                barTime(execution.exitTime)
              }}</time>
              <span class="block num">{{ t('review.executions.bar', { index: execution.exitBar + 1 }) }}</span>
            </dd>
          </div>
        </dl>
        <p class="mt-2 border-t-[length:var(--hairline)] border-line pt-1.5 text-[10.5px] text-ink-2">
          {{ t('review.exit') }} · {{ t(`review.exits.${execution.exitReason}`) }}
        </p>
      </div>
      <p class="text-[10px] leading-relaxed text-ink-3">{{ t('review.executions.timeHint') }}</p>
      <p class="text-[10px] leading-relaxed text-ink-3">{{ t('review.executions.chartHint') }}</p>
    </template>
  </section>
</template>
