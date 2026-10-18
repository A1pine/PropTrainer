<script setup lang="ts">
import { ArrowDownRight, ArrowUpRight } from '@lucide/vue'
import type { InstrumentSpec } from '~/domain/instruments/types'
import type { Position } from '~/domain/trading/types'

const props = defineProps<{
  position: Position
  instrument: InstrumentSpec
  markPrice: number
  unrealized: number
  roundR: number | null
  disabled?: boolean
}>()

const emit = defineEmits<{ close: []; breakeven: [] }>()

const { t } = useI18n()

const isLong = computed(() => props.position.side === 'long')
const pnlTone = computed(() => (props.unrealized > 0 ? 'text-bull-strong' : props.unrealized < 0 ? 'text-bear-strong' : 'text-ink'))
</script>

<template>
  <div class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 p-3">
    <div class="flex items-center justify-between">
      <span class="flex items-center gap-1.5 text-[11px] font-medium" :class="isLong ? 'text-bull-strong' : 'text-bear-strong'">
        <ArrowUpRight v-if="isLong" class="size-3.5" aria-hidden="true" />
        <ArrowDownRight v-else class="size-3.5" aria-hidden="true" />
        {{ isLong ? t('ticket.long') : t('ticket.short') }} · {{ position.qty }} {{ instrument.symbol }}
      </span>
      <Badge :variant="isLong ? 'bull' : 'bear'" size="sm">{{ t('position.open') }}</Badge>
    </div>

    <div class="mt-3 grid grid-cols-3 gap-2 font-mono text-[11px]">
      <div>
        <p class="text-[9.5px] uppercase tracking-wide text-ink-3">{{ t('position.entry') }}</p>
        <p class="mt-0.5 tabular-nums">{{ formatPrice(position.entryPrice, instrument.pricePrecision) }}</p>
      </div>
      <div>
        <p class="text-[9.5px] uppercase tracking-wide text-ink-3">{{ t('position.mark') }}</p>
        <p class="mt-0.5 tabular-nums">{{ formatPrice(markPrice, instrument.pricePrecision) }}</p>
      </div>
      <div class="text-right">
        <p class="text-[9.5px] uppercase tracking-wide text-ink-3">{{ t('position.openPnl') }}</p>
        <p class="mt-0.5 tabular-nums" :class="pnlTone">{{ formatMoney(unrealized, { signed: true }) }}</p>
      </div>
      <div>
        <p class="text-[9.5px] uppercase tracking-wide text-ink-3">{{ t('position.stop') }}</p>
        <p class="mt-0.5 tabular-nums text-bear">{{ position.stopLoss == null ? '—' : formatPrice(position.stopLoss, instrument.pricePrecision) }}</p>
      </div>
      <div>
        <p class="text-[9.5px] uppercase tracking-wide text-ink-3">{{ t('position.target') }}</p>
        <p class="mt-0.5 tabular-nums text-bull">{{ position.takeProfit == null ? '—' : formatPrice(position.takeProfit, instrument.pricePrecision) }}</p>
      </div>
      <div class="text-right">
        <p class="text-[9.5px] uppercase tracking-wide text-ink-3">{{ t('position.r') }}</p>
        <p class="mt-0.5 tabular-nums" :class="pnlTone">{{ formatR(roundR) }}</p>
      </div>
    </div>

    <div class="mt-3 flex gap-2">
      <Button variant="secondary" size="sm" block :disabled="disabled" @click="emit('breakeven')">
        {{ t('position.breakeven') }}
      </Button>
      <Button variant="outline" size="sm" block :disabled="disabled" class="!border-bear/40 !text-bear-strong hover:!bg-bear-soft" @click="emit('close')">
        {{ t('position.close') }}
      </Button>
    </div>
  </div>
</template>
