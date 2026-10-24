<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SimFill } from '~/domain/sim/types'
import { downloadCsv, utcTimestamp } from '~/lib/sim/export'

const props = defineProps<{
  fills: SimFill[]
  precision: number
  precisions?: Record<string, number>
}>()

const { t } = useI18n()
const exportFailed = ref(false)

function exportFills() {
  exportFailed.value = !downloadCsv(
    'terminal-fills.csv',
    [
      t('terminal.ledger.id'),
      t('terminal.ledger.orderId'),
      t('terminal.positions.symbol'),
      t('terminal.fills.time'),
      t('terminal.fills.side'),
      t('terminal.fills.qty'),
      t('terminal.fills.price'),
      t('terminal.fills.role'),
      t('terminal.fills.fee'),
      t('terminal.ledger.cashDelta'),
      t('terminal.ledger.reason'),
    ],
    rows.value.map(({ fill }) => [
      fill.id,
      fill.orderId,
      fill.symbol,
      utcTimestamp(fill.time),
      t(`terminal.ledger.sides.${fill.side}`),
      fill.qty,
      fill.price,
      t(`terminal.ledger.roles.${fill.role}`),
      fill.fee,
      fill.cashDelta,
      fill.reason == null ? '' : t(`terminal.ledger.reasons.${fill.reason}`),
    ]),
  )
}

const rows = computed(() =>
  [...props.fills]
    .reverse()
    .sort((a, b) => b.time - a.time || b.bar - a.bar)
    .map((fill) => {
      const iso = utcTimestamp(fill.time)
      return {
        fill,
        iso,
        clock: iso ? iso.slice(11, -1) : '—',
        price: formatPrice(fill.price, props.precisions?.[fill.symbol] ?? props.precision),
        fee: formatMoney(fill.fee, { decimals: 2, signed: false }),
      }
    }),
)
</script>

<template>
  <section
    class="min-w-0 overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-surface-2"
    data-testid="fills-table"
    :aria-label="t('terminal.fills.title')"
  >
    <header class="flex items-center justify-between gap-2 border-b-[length:var(--hairline)] border-line px-3 py-2">
      <h2 class="label-micro min-w-0 truncate">{{ t('terminal.fills.title') }}</h2>
      <span class="shrink-0 font-mono text-[10px] tabular-nums text-ink-3">{{ fills.length }}</span>
      <Button v-if="fills.length" variant="ghost" size="xs" data-testid="fills-export" @click="exportFills">{{
        t('terminal.ledger.exportCsv')
      }}</Button>
    </header>
    <p v-if="exportFailed" class="px-3 py-2 text-[11px] text-danger" role="alert">
      {{ t('terminal.ledger.exportFailed') }}
    </p>

    <p v-if="!rows.length" class="px-3 py-5 text-center text-[11px] text-ink-3" data-testid="fills-empty">
      {{ t('terminal.fills.empty') }}
    </p>

    <ul v-else class="divide-y-[length:var(--hairline)] divide-line/70">
      <li v-for="row in rows" :key="row.fill.id" class="min-w-0 px-3 py-2" data-testid="fill-row">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <span class="min-w-0 break-all font-mono text-[11.5px] font-medium text-ink">{{ row.fill.symbol }}</span>
          <Badge :variant="row.fill.side === 'long' ? 'bull' : 'bear'" size="sm">
            {{ t(row.fill.side === 'long' ? 'terminal.ticket.buy' : 'terminal.ticket.sell') }}
          </Badge>
          <time
            class="ml-auto font-mono text-[10px] tabular-nums text-ink-3"
            :datetime="row.iso || undefined"
            :title="row.iso || undefined"
          >
            {{ row.clock }} UTC
          </time>
        </div>

        <dl class="mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-[10.5px] sm:grid-cols-4">
          <div class="min-w-0">
            <dt class="text-ink-3">{{ t('terminal.fills.qty') }}</dt>
            <dd class="break-all font-mono tabular-nums text-ink" data-testid="fill-qty">{{ row.fill.qty }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-ink-3">{{ t('terminal.fills.price') }}</dt>
            <dd class="break-all font-mono tabular-nums text-ink-2" data-testid="fill-price">{{ row.price }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-ink-3">{{ t('terminal.fills.role') }}</dt>
            <dd class="break-words capitalize text-ink-2" data-testid="fill-role">
              {{ t(`terminal.ledger.roles.${row.fill.role}`) }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-ink-3">{{ t('terminal.fills.fee') }}</dt>
            <dd class="break-all font-mono tabular-nums text-ink-2" data-testid="fill-fee">{{ row.fee }}</dd>
          </div>
        </dl>
      </li>
    </ul>
  </section>
</template>
