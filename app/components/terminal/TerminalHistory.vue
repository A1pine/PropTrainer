<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { InstrumentSpec } from '~/domain/instruments/types'
import type { SimDayLedger, SimEvent, SimTrade } from '~/domain/sim/types'
import { downloadCsv, utcTimestamp } from '~/lib/sim/export'

const props = withDefaults(
  defineProps<{
    trades: SimTrade[]
    events: SimEvent[]
    days: SimDayLedger[]
    currentDay: string
    instruments?: readonly InstrumentSpec[]
    precision?: number
    precisions?: Record<string, number>
  }>(),
  { precision: 2 },
)

const emit = defineEmits<{ focus: [symbol: string, entryTime: number, exitTime: number] }>()
const { t, locale } = useI18n()
const tab = ref<'trades' | 'events' | 'days'>('trades')
const exportFailed = ref(false)
const tabs = computed(() =>
  (['trades', 'events', 'days'] as const).map((value) => ({ value, label: t(`terminal.history.${value}`) })),
)
const trades = computed(() =>
  [...props.trades].reverse().sort((a, b) => b.exitTime - a.exitTime || b.exitBar - a.exitBar),
)
const events = computed(() => [...props.events].sort((a, b) => b.time - a.time || b.id - a.id))
const days = computed(() => [...props.days].sort((a, b) => b.key.localeCompare(a.key)))
const stats = computed(() => {
  const net = props.trades.reduce((sum, trade) => sum + trade.pnl, 0)
  const fees = props.trades.reduce((sum, trade) => sum + trade.fees, 0)
  const wins = props.trades.filter((trade) => trade.pnl > 0).length
  return {
    net,
    fees,
    netLabel: formatMoney(net, { decimals: 2, signed: true }),
    feesLabel: formatMoney(fees, { decimals: 2 }),
    winRate: props.trades.length
      ? new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }).format(
          wins / props.trades.length,
        )
      : '—',
  }
})

function moneyLabel(value: number, options: { decimals: number; signed?: boolean }): string {
  return formatMoney(value, options)
}

function priceLabel(value: number, precision: number): string {
  return formatPrice(value, precision)
}

function precisionFor(symbol: string): number {
  return (
    props.precisions?.[symbol] ??
    props.instruments?.find((instrument) => instrument.symbol === symbol)?.pricePrecision ??
    props.precision
  )
}

function tone(value: number): string {
  return value > 0 ? 'text-bull-strong' : value < 0 ? 'text-bear-strong' : 'text-ink-2'
}

function exportTrades() {
  exportFailed.value = !downloadCsv(
    'terminal-trades.csv',
    [
      t('terminal.ledger.id'),
      t('terminal.positions.symbol'),
      t('terminal.positions.side'),
      t('terminal.positions.qty'),
      t('terminal.history.entryTime'),
      t('terminal.history.exitTime'),
      t('terminal.history.entryPrice'),
      t('terminal.history.exitPrice'),
      t('terminal.history.gross'),
      t('terminal.history.fees'),
      t('terminal.history.net'),
      t('terminal.ledger.reason'),
      t('terminal.history.tag'),
    ],
    trades.value.map((trade) => [
      trade.id,
      trade.symbol,
      t(`terminal.ledger.sides.${trade.side}`),
      trade.qty,
      utcTimestamp(trade.entryTime),
      utcTimestamp(trade.exitTime),
      trade.entryPrice,
      trade.exitPrice,
      trade.grossPnl,
      trade.fees,
      trade.pnl,
      t(`terminal.ledger.reasons.${trade.exitReason}`),
      trade.tag,
    ]),
  )
}

function exportEvents() {
  exportFailed.value = !downloadCsv(
    'terminal-events.csv',
    [
      t('terminal.ledger.id'),
      t('terminal.fills.time'),
      t('terminal.ledger.eventType'),
      t('terminal.positions.symbol'),
      t('terminal.ledger.orderId'),
      t('terminal.ledger.reason'),
    ],
    events.value.map((event) => [
      event.id,
      utcTimestamp(event.time),
      t(`terminal.ledger.events.${event.type}`),
      event.symbol,
      event.orderId,
      event.message,
    ]),
  )
}
</script>

<template>
  <section
    class="min-w-0 overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-surface-2"
    data-testid="terminal-history"
    :aria-label="t('terminal.history.title')"
  >
    <header
      class="flex flex-wrap items-center justify-between gap-2 border-b-[length:var(--hairline)] border-line px-3 py-2"
    >
      <h2 class="label-micro min-w-0 truncate">{{ t('terminal.history.title') }}</h2>
      <Button
        v-if="tab === 'trades' && trades.length"
        variant="ghost"
        size="xs"
        data-testid="history-export-trades"
        @click="exportTrades"
        >{{ t('terminal.ledger.exportCsv') }}</Button
      >
      <Button
        v-if="tab === 'events' && events.length"
        variant="ghost"
        size="xs"
        data-testid="history-export-events"
        @click="exportEvents"
        >{{ t('terminal.ledger.exportCsv') }}</Button
      >
      <SegmentedControl
        v-model="tab"
        :options="tabs"
        size="sm"
        :aria-label="t('terminal.history.tabs')"
        data-testid="history-tabs"
      />
    </header>
    <p v-if="exportFailed" class="px-3 py-2 text-[11px] text-danger" role="alert">
      {{ t('terminal.ledger.exportFailed') }}
    </p>
    <dl class="grid min-w-0 grid-cols-3 gap-2 border-b-[length:var(--hairline)] border-line px-3 py-2 text-[10px]">
      <div class="min-w-0">
        <dt class="text-ink-3">{{ t('terminal.history.net') }}</dt>
        <dd class="break-all font-mono tabular-nums" :class="tone(stats.net)" data-testid="history-net">
          {{ stats.netLabel }}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-ink-3">{{ t('terminal.history.winRate') }}</dt>
        <dd class="break-all font-mono tabular-nums text-ink-2" data-testid="history-win-rate">{{ stats.winRate }}</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-ink-3">{{ t('terminal.history.closedFees') }}</dt>
        <dd class="break-all font-mono tabular-nums text-ink-2" data-testid="history-fees">
          {{ stats.feesLabel }}
        </dd>
      </div>
    </dl>

    <div v-if="tab === 'trades'" role="tabpanel" aria-labelledby="seg-trades">
      <p v-if="!trades.length" class="px-3 py-5 text-center text-[11px] text-ink-3" data-testid="history-empty-trades">
        {{ t('terminal.history.emptyTrades') }}
      </p>
      <ul v-else class="divide-y-[length:var(--hairline)] divide-line/70">
        <li v-for="trade in trades" :key="trade.id" class="min-w-0" data-testid="history-trade">
          <Button
            variant="ghost"
            block
            class="h-auto min-w-0 flex-col items-stretch gap-2 whitespace-normal rounded-none px-3 py-2 text-left focus-visible:ring-inset focus-visible:ring-offset-0"
            data-testid="history-trade-focus"
            :aria-label="
              t('terminal.history.focus', {
                symbol: trade.symbol,
                entry: utcTimestamp(trade.entryTime),
                exit: utcTimestamp(trade.exitTime),
              })
            "
            @click="emit('focus', trade.symbol, trade.entryTime, trade.exitTime)"
          >
            <span class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="break-all font-mono text-[11.5px] text-ink">{{ trade.symbol }}</span>
              <Badge :variant="trade.side === 'long' ? 'bull' : 'bear'" size="sm">{{
                t(`terminal.ledger.sides.${trade.side}`)
              }}</Badge>
              <span
                class="ml-auto break-all font-mono text-[11px] tabular-nums"
                :class="tone(trade.pnl)"
                data-testid="history-trade-pnl"
                >{{ moneyLabel(trade.pnl, { decimals: 2, signed: true }) }}</span
              >
            </span>
            <span class="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-[10px] leading-relaxed">
              <span class="min-w-0"
                ><span class="block text-ink-3">{{ t('terminal.history.entryTime') }}</span
                ><time
                  class="block break-all font-mono tabular-nums"
                  :datetime="utcTimestamp(trade.entryTime) || undefined"
                  >{{ utcTimestamp(trade.entryTime) || '—' }}</time
                ></span
              >
              <span class="min-w-0"
                ><span class="block text-ink-3">{{ t('terminal.history.exitTime') }}</span
                ><time
                  class="block break-all font-mono tabular-nums"
                  :datetime="utcTimestamp(trade.exitTime) || undefined"
                  >{{ utcTimestamp(trade.exitTime) || '—' }}</time
                ></span
              >
              <span class="min-w-0"
                ><span class="block text-ink-3">{{ t('terminal.history.entryPrice') }}</span
                ><span class="block break-all font-mono tabular-nums" data-testid="history-entry-price">{{
                  priceLabel(trade.entryPrice, precisionFor(trade.symbol))
                }}</span></span
              >
              <span class="min-w-0"
                ><span class="block text-ink-3">{{ t('terminal.history.exitPrice') }}</span
                ><span class="block break-all font-mono tabular-nums" data-testid="history-exit-price">{{
                  priceLabel(trade.exitPrice, precisionFor(trade.symbol))
                }}</span></span
              >
              <span class="min-w-0"
                ><span class="block text-ink-3">{{ t('terminal.positions.qty') }}</span
                ><span class="block break-all font-mono tabular-nums">{{ trade.qty }}</span></span
              >
              <span class="min-w-0"
                ><span class="block text-ink-3">{{ t('terminal.history.fees') }}</span
                ><span class="block break-all font-mono tabular-nums">{{
                  moneyLabel(trade.fees, { decimals: 2 })
                }}</span></span
              >
            </span>
            <span class="break-words text-[10px] text-ink-3"
              >{{ t('terminal.ledger.reason') }}: {{ t(`terminal.ledger.reasons.${trade.exitReason}`) }}</span
            >
            <span v-if="trade.tag" class="break-all text-[10px] text-ink-3"
              >{{ t('terminal.history.tag') }}: {{ trade.tag }}</span
            >
          </Button>
        </li>
      </ul>
    </div>

    <div v-else-if="tab === 'events'" role="tabpanel" aria-labelledby="seg-events">
      <p v-if="!events.length" class="px-3 py-5 text-center text-[11px] text-ink-3" data-testid="history-empty-events">
        {{ t('terminal.history.emptyEvents') }}
      </p>
      <ol v-else class="divide-y-[length:var(--hairline)] divide-line/70">
        <li v-for="event in events" :key="event.id" class="min-w-0 px-3 py-2 text-[10.5px]" data-testid="history-event">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <Badge :variant="event.type === 'rejected' || event.type === 'breach' ? 'danger' : 'neutral'" size="sm">{{
              t(`terminal.ledger.events.${event.type}`)
            }}</Badge>
            <span class="min-w-0 break-all font-mono text-ink">{{ event.symbol ?? '—' }}</span>
            <time
              class="min-w-0 break-all font-mono tabular-nums text-ink-3"
              :datetime="utcTimestamp(event.time) || undefined"
              >{{ utcTimestamp(event.time) || '—' }}</time
            >
          </div>
          <p v-if="event.orderId" class="mt-1 break-all font-mono text-ink-3">
            {{ t('terminal.ledger.orderId') }}: {{ event.orderId }}
          </p>
          <p class="mt-1 whitespace-pre-wrap break-words text-ink-2" data-testid="history-event-reason">
            {{ t('terminal.ledger.reason') }}: {{ event.message || '—' }}
          </p>
        </li>
      </ol>
    </div>

    <div v-else role="tabpanel" aria-labelledby="seg-days">
      <p v-if="!days.length" class="px-3 py-5 text-center text-[11px] text-ink-3" data-testid="history-empty-days">
        {{ t('terminal.history.emptyDays') }}
      </p>
      <ul v-else class="divide-y-[length:var(--hairline)] divide-line/70">
        <li
          v-for="day in days"
          :key="day.key"
          class="min-w-0 px-3 py-2"
          data-testid="history-day"
          :aria-current="day.key === currentDay ? 'date' : undefined"
        >
          <div class="flex min-w-0 flex-wrap items-center gap-2 text-[11px]">
            <span class="min-w-0 break-all font-mono tabular-nums text-ink">{{ day.key }}</span>
            <Badge v-if="day.key === currentDay" variant="clay" size="sm">{{ t('terminal.history.currentDay') }}</Badge>
            <Badge :variant="day.finalized ? 'neutral' : 'warn'" size="sm">{{
              t(day.finalized ? 'terminal.history.finalized' : 'terminal.history.provisional')
            }}</Badge>
          </div>
          <dl class="mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
            <div class="min-w-0">
              <dt class="text-ink-3">{{ t('terminal.history.dayNet') }}</dt>
              <dd class="break-all font-mono tabular-nums" :class="tone(day.realizedPnl)" data-testid="history-day-pnl">
                {{ moneyLabel(day.realizedPnl, { decimals: 2, signed: true }) }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-ink-3">{{ t('terminal.history.startEquity') }}</dt>
              <dd class="break-all font-mono tabular-nums text-ink-2">
                {{ moneyLabel(day.startEquity, { decimals: 2 }) }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-ink-3">{{ t('terminal.history.tradeCount') }}</dt>
              <dd class="break-all font-mono tabular-nums text-ink-2">{{ day.trades }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-ink-3">{{ t('terminal.history.fillCount') }}</dt>
              <dd class="break-all font-mono tabular-nums text-ink-2">{{ day.fills }}</dd>
            </div>
          </dl>
        </li>
      </ul>
    </div>
  </section>
</template>
