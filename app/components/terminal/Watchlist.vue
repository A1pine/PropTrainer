<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatNumber, formatPrice } from '~/utils/format'

export interface WatchlistRow {
  symbol: string
  name: string
  price: number | null
  changePercent: number | null
  position: 'long' | 'short' | null
  active: boolean
  /** Last revealed base-timeframe bar volume. Never a session or live aggregate. */
  volume?: number | null
  /** Price decimals for this symbol; defaults to 2 when omitted. */
  precision?: number
}

defineProps<{ rows: WatchlistRow[] }>()
const emit = defineEmits<{ select: [symbol: string] }>()
const { t, locale } = useI18n()

function priceLabel(row: WatchlistRow): string {
  if (row.price == null || !Number.isFinite(row.price)) return '—'
  return formatPrice(row.price, row.precision ?? 2, locale.value)
}

function volumeLabel(row: WatchlistRow): string {
  if (row.volume == null || !Number.isFinite(row.volume)) return '—'
  return formatNumber(row.volume, 0, locale.value)
}

function changeLabel(row: WatchlistRow): string {
  if (row.changePercent == null) return '—'
  const prefix = row.changePercent >= 0 ? '+' : ''
  return `${prefix}${formatNumber(row.changePercent, 2, locale.value)}%`
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-surface-2">
    <div class="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2">
      <h2 class="label-micro shrink-0">{{ t('terminal.watchlist.title') }}</h2>
      <span class="min-w-0 truncate text-[9.5px] text-ink-3" :title="t('terminal.watchlist.hint')">{{
        t('terminal.watchlist.hint')
      }}</span>
    </div>
    <div class="max-h-[320px] overflow-y-auto p-1">
      <button
        v-for="row in rows"
        :key="row.symbol"
        type="button"
        class="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors"
        :class="row.active ? 'bg-clay-soft text-clay-ink' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink'"
        :data-symbol="row.symbol"
        data-testid="watchlist-row"
        :aria-current="row.active ? 'true' : undefined"
        @click="emit('select', row.symbol)"
      >
        <span class="flex w-full items-center gap-1.5">
          <span class="w-11 shrink-0 font-mono text-[11px] font-medium tabular-nums">{{ row.symbol }}</span>
          <span class="min-w-0 flex-1 truncate text-[10.5px]" data-testid="watchlist-name" :title="row.name">{{
            row.name
          }}</span>
          <span
            v-if="row.position"
            class="shrink-0 rounded-xs px-1 py-0.5 text-[9px] font-medium uppercase"
            :class="row.position === 'long' ? 'bg-bull-soft text-bull-strong' : 'bg-bear-soft text-bear-strong'"
            data-testid="watchlist-position"
          >
            {{ row.position }}
          </span>
        </span>
        <span class="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span class="shrink-0 font-mono text-[11px] tabular-nums" data-testid="watchlist-price">{{
            priceLabel(row)
          }}</span>
          <span
            v-if="row.changePercent != null"
            class="min-w-11 shrink-0 whitespace-nowrap text-right font-mono text-[10px] tabular-nums"
            :class="row.changePercent >= 0 ? 'text-bull-strong' : 'text-bear-strong'"
            data-testid="watchlist-change"
          >
            {{ changeLabel(row) }}
          </span>
          <span v-else class="min-w-11 shrink-0 text-right text-[10px] text-ink-3" data-testid="watchlist-change"
            >—</span
          >
          <span
            class="ml-auto flex shrink-0 items-baseline gap-1 text-[9px] uppercase tracking-wide text-ink-3"
            data-testid="watchlist-volume"
            :title="t('terminal.watchlist.volumeTitle')"
          >
            <span>{{ t('terminal.watchlist.volume') }}</span>
            <span class="font-mono text-[10px] normal-case tabular-nums">{{ volumeLabel(row) }}</span>
          </span>
        </span>
      </button>
    </div>
  </div>
</template>
