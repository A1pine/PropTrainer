<script setup lang="ts">
import { useI18n } from 'vue-i18n'

export interface WatchlistRow {
  symbol: string
  name: string
  price: number | null
  changePercent: number | null
  position: 'long' | 'short' | null
  active: boolean
}

defineProps<{ rows: WatchlistRow[] }>()
const emit = defineEmits<{ select: [symbol: string] }>()
const { t } = useI18n()
</script>

<template>
  <div class="overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-surface-2">
    <div class="flex items-baseline justify-between border-b border-line px-3 py-2">
      <h2 class="label-micro">{{ t('terminal.watchlist.title') }}</h2>
      <span class="text-[9.5px] text-ink-3">{{ t('terminal.watchlist.hint') }}</span>
    </div>
    <div class="max-h-[320px] overflow-y-auto p-1">
      <button
        v-for="row in rows"
        :key="row.symbol"
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
        :class="row.active ? 'bg-clay-soft text-clay-ink' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink'"
        @click="emit('select', row.symbol)"
      >
        <span class="w-11 font-mono text-[11px] font-medium tabular-nums">{{ row.symbol }}</span>
        <span class="min-w-0 flex-1 truncate text-[10.5px]">{{ row.name }}</span>
        <span class="font-mono text-[11px] tabular-nums">{{ row.price == null ? '—' : row.price.toFixed(2) }}</span>
        <span
          v-if="row.changePercent != null"
          class="w-12 text-right font-mono text-[10px] tabular-nums"
          :class="row.changePercent >= 0 ? 'text-bull-strong' : 'text-bear-strong'"
        >
          {{ row.changePercent >= 0 ? '+' : '' }}{{ row.changePercent.toFixed(2) }}%
        </span>
        <span v-else class="w-12 text-right text-[10px] text-ink-3">—</span>
        <span
          v-if="row.position"
          class="rounded-xs px-1 py-0.5 text-[9px] font-medium uppercase"
          :class="row.position === 'long' ? 'bg-bull-soft text-bull-strong' : 'bg-bear-soft text-bear-strong'"
        >
          {{ row.position }}
        </span>
      </button>
    </div>
  </div>
</template>
