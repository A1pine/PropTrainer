<script setup lang="ts">
import type { ExitReason } from '~/domain/trading/types'
import type { LogRow } from '~/domain/stats/types'

defineProps<{
  rows: LogRow[]
  precision: number
  compact?: boolean
}>()

const { t } = useI18n()

const reasonKey: Record<ExitReason, string> = {
  stop: 'log.stop',
  target: 'log.target',
  manual: 'log.manual',
  flatten: 'log.flatten',
  breach: 'log.breach',
  end: 'log.end',
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-surface-2">
    <div class="flex items-center justify-between border-b-[length:var(--hairline)] border-line px-3 py-2">
      <p class="label-micro">{{ t('log.title') }}</p>
      <span class="font-mono text-[10px] text-ink-3">{{ rows.length }}</span>
    </div>
    <div v-if="!rows.length" class="px-3 py-5 text-center text-[11px] text-ink-3">{{ t('log.empty') }}</div>
    <table v-else class="w-full text-left">
      <thead>
        <tr class="text-[9.5px] uppercase tracking-wide text-ink-3">
          <th class="px-3 py-1.5 font-medium">#</th>
          <th class="px-2 py-1.5 font-medium">{{ t('log.side') }}</th>
          <th class="px-2 py-1.5 font-medium text-right">{{ t('log.entry') }}</th>
          <th class="px-2 py-1.5 font-medium text-right">{{ t('log.exit') }}</th>
          <th class="px-2 py-1.5 font-medium text-right">R</th>
          <th class="px-3 py-1.5 font-medium text-right">{{ t('log.pnl') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" class="border-t-[length:var(--hairline)] border-line/70 font-mono text-[10.5px]">
          <td class="px-3 py-1.5 text-ink-3">{{ row.bar }}</td>
          <td class="px-2 py-1.5" :class="row.side === 'long' ? 'text-bull-strong' : 'text-bear-strong'">{{ row.side === 'long' ? 'L' : 'S' }} {{ row.qty }}</td>
          <td class="px-2 py-1.5 text-right text-ink-2">{{ formatPrice(row.entryPrice, precision) }}</td>
          <td class="px-2 py-1.5 text-right text-ink-2">{{ formatPrice(row.exitPrice, precision) }}</td>
          <td class="px-2 py-1.5 text-right" :class="(row.rMultiple ?? 0) >= 0 ? 'text-bull-strong' : 'text-bear-strong'">{{ formatR(row.rMultiple) }}</td>
          <td class="px-3 py-1.5 text-right" :class="row.pnl >= 0 ? 'text-bull-strong' : 'text-bear-strong'">{{ formatMoney(row.pnl, { signed: true }) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
