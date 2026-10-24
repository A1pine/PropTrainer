<script setup lang="ts">
import { ArrowDownRight, ArrowUpRight, Info, Minus, Plus } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { ChartAnalysis, ChartOrderLine, ChartStyle } from '~/lib/chart/types'
import type { PropTemplate, SimTimeframe } from '~/domain/sim/types'
import { timeframeMinutes } from '~/domain/sim/timeframe'
import { instruments } from '~/domain/instruments/catalog'

const { t } = useI18n()
const terminal = useTerminalStore()
const toasts = useToastStore()

const chart = ref<{
  fit: () => void
  zoom: (factor: number) => void
  scrollToLatest: () => void
  focusOn: (index: number, span?: number) => void
  focusRange: (from: number, to: number) => void
} | null>(null)

const ticketOpen = ref(false)
const priceHint = ref<number | null>(null)
const priceHintSide = ref<'long' | 'short' | null>(null)
const priceHintType = ref<'limit' | 'stop' | null>(null)
const ticketSide = ref<'long' | 'short' | null>(null)
const dock = ref<'positions' | 'orders' | 'fills' | 'history' | 'rules'>('positions')
const chartStyle = ref<ChartStyle>('candles')
const ladderOpen = ref(true)
const selectedSymbol = computed({
  get: () => terminal.symbol,
  set: (value: string) => {
    void terminal.load(value)
  },
})

const precision = computed(() => terminal.instrument.pricePrecision)
const tickSize = computed(() => terminal.instrument.tickSize)

const watchRows = computed(() =>
  terminal.symbols.map((symbol) => {
    const spec = instruments.require(symbol)
    const active = symbol === terminal.symbol
    const quote = terminal.quotes[symbol] ?? null
    const position = terminal.snapshot?.positions.find((item) => item.symbol === symbol)
    return {
      symbol,
      name: spec.name,
      price: quote?.price ?? null,
      changePercent: quote?.changePercent ?? null,
      position: position ? position.side : null,
      active,
    }
  }),
)

const symbolOptions = computed(() => terminal.symbols.map((symbol) => ({ value: symbol, label: symbol })))
const styleOptions = computed(() =>
  (['candles', 'ohlc', 'line', 'heikin-ashi'] as const).map((value) => ({
    value,
    label: t(`terminal.chart.styles.${value}`),
  })),
)
const precisions = computed<Record<string, number>>(() =>
  Object.fromEntries(instruments.list().map((spec) => [spec.symbol, spec.pricePrecision])),
)

const pointValues = computed<Record<string, number>>(() =>
  Object.fromEntries(instruments.list().map((spec) => [spec.symbol, spec.pointValue])),
)

const ordersForChart = computed<ChartOrderLine[]>(() => {
  const lines: ChartOrderLine[] = []
  for (const order of terminal.workingOrders) {
    if (order.symbol !== terminal.symbol) continue
    if (order.type === 'market') continue
    const protective = order.role !== 'entry'
    if (order.limitPrice != null) {
      lines.push({
        id: order.id,
        side: order.side,
        kind: 'limit',
        price: order.limitPrice,
        label: `${order.side === 'long' ? t('terminal.ticket.buy') : t('terminal.ticket.sell')} ${order.filledQty ? `${order.filledQty}/${order.qty}` : order.qty}`,
        qty: order.qty,
        protective,
      })
    }
    if (order.stopPrice != null) {
      lines.push({
        id: `${order.id}:stop`,
        side: order.side,
        kind: 'stop',
        price: order.stopPrice,
        label: `Stop ${order.qty}`,
        qty: order.qty,
        protective,
      })
    }
  }
  return lines
})

const position = computed(() => terminal.snapshot?.positions.find((item) => item.symbol === terminal.symbol) ?? null)

const mark = computed(() => terminal.mark?.price ?? null)

const replayLabel = computed(() => {
  const time = terminal.replayTime
  if (time == null) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(time * 1000))
})

const ruleSummary = computed(() => terminal.risk?.status ?? 'active')

const canTrade = computed(() => terminal.ready && terminal.risk?.status === 'active')

// Only lines that are actually inside the visible price window are drawn by the
// chart engine; an out-of-window breach line is still shown in the account bar.
const riskAnalysis = computed<ChartAnalysis>(() => {
  const levels: ChartAnalysis['levels'] = []
  if (terminal.risk) {
    levels.push({
      id: 'floor',
      price: terminal.risk.floor,
      tone: 'warn',
      label: t('terminal.account.floor'),
    })
  }
  if (terminal.breachPrice != null) {
    levels.push({
      id: 'breach',
      price: terminal.breachPrice,
      tone: 'bear',
      label: t('terminal.account.breach'),
    })
  }
  const daily = terminal.dailyLineFor(terminal.symbol)
  if (daily != null) {
    levels.push({
      id: 'daily',
      price: daily,
      tone: 'clay',
      label: t('terminal.account.dll'),
    })
  }
  return { series: [], zones: [], levels, markers: [], profile: [] }
})

// The chart uses exchange-local labels; the replay clock is already Chicago-based.
const chartTimeframeMinutes = computed(() => {
  if (terminal.timeframe === '1D') return 1440
  return timeframeMinutes(terminal.timeframe) ?? 5
})

function onOrderDrag(id: string, price: number) {
  const order = terminal.workingOrders.find((item) => item.id === id || `${item.id}:stop` === id)
  if (!order) return
  const rounded = Math.round(price / tickSize.value) * tickSize.value
  const patch = id.endsWith(':stop') ? { stopPrice: rounded } : { limitPrice: rounded }
  const result = terminal.modify(order.id, patch)
  if (!result.ok) toasts.error(t('terminal.errors.rejected'), result.error)
}

function hintPrice(price: number, side?: 'long' | 'short', type: 'limit' | 'stop' = 'limit') {
  priceHint.value = price
  priceHintType.value = type
  priceHintSide.value = side ?? (mark.value != null && price > mark.value ? 'short' : 'long')
  ticketSide.value = null
  ticketOpen.value = true
}

function onPricePick(price: number) {
  hintPrice(price)
}

function restAtPrice(price: number) {
  hintPrice(price)
}

function placeAtPrice(side: 'long' | 'short', price: number, type: 'limit' | 'stop') {
  hintPrice(price, side, type)
}

function openTicket(side: 'long' | 'short') {
  priceHint.value = null
  priceHintSide.value = null
  priceHintType.value = null
  ticketSide.value = side
  ticketOpen.value = true
}

function closeTicket() {
  ticketOpen.value = false
  priceHint.value = null
  priceHintSide.value = null
  priceHintType.value = null
  ticketSide.value = null
}

function focusSymbol(symbol: string) {
  selectedSymbol.value = symbol
}

function focusTrade(symbol: string, entryTime: number, exitTime: number) {
  if (symbol !== terminal.symbol) selectedSymbol.value = symbol
  void nextTick(() => {
    const candles = terminal.chartCandles
    const from = candles.findIndex((candle) => candle.time >= entryTime)
    const to = candles.findIndex((candle) => candle.time >= exitTime)
    if (from < 0) return
    chart.value?.focusRange(from, to < 0 ? from + 40 : to)
  })
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
  // A shortcut must never fire while a popover, menu or dialog owns the keys.
  if (target?.closest('[role="dialog"],[role="listbox"],[role="menu"]')) return
  if (event.key === ' ') {
    event.preventDefault()
    terminal.toggle()
  } else if (event.key === 'n' || event.key === 'N') {
    event.preventDefault()
    terminal.stepBars(1)
  } else if (event.key === 'b' || event.key === 'B') {
    event.preventDefault()
    openTicket('long')
  } else if (event.key === 's' || event.key === 'S') {
    event.preventDefault()
    openTicket('short')
  } else if ((event.key === 'f' || event.key === 'F') && position.value) {
    event.preventDefault()
    flatten()
  } else if (event.key === 'Escape' && ticketOpen.value) {
    closeTicket()
  }
}

function submitOrder(input: Parameters<typeof terminal.submit>[0]) {
  const result = terminal.submit(input)
  if (!result.ok) {
    toasts.error(t('terminal.errors.rejected'), result.error)
    return
  }
  toasts.success(t('terminal.toast.submitted'))
  closeTicket()
}

function cancelOrder(id: string) {
  // Stop legs are chart-only aliases (`<orderId>:stop`); the engine knows the
  // order itself, so strip the suffix before cancelling.
  const orderId = id.endsWith(':stop') ? id.slice(0, -':stop'.length) : id
  const result = terminal.cancel(orderId)
  if (!result.ok) toasts.error(t('terminal.errors.rejected'), result.error)
}

function cancelFromChart(id: string) {
  const order = terminal.workingOrders.find((item) => item.id === id)
  if (!order) {
    toasts.error(t('terminal.toast.cancelUnavailable'))
    return
  }
  cancelOrder(id)
  toasts.push({ title: t('terminal.toast.cancelled'), variant: 'info' })
}

function flatten() {
  terminal.flatten()
  toasts.push({ title: t('terminal.toast.flattened'), variant: 'warn' })
}

function reverse() {
  const result = terminal.reverse()
  if (result.ok) toasts.push({ title: t('terminal.toast.reversed'), variant: 'info' })
  else toasts.error(t('terminal.errors.rejected'), result.error)
}

function resetAccount() {
  if (!window.confirm(t('terminal.rules.resetConfirm'))) return
  void terminal.reset()
  toasts.push({ title: t('terminal.toast.reset'), variant: 'info' })
}

// Custom rule edits only apply to a fresh attempt: the ledger and floor cannot
// change underneath live positions.
function configureTemplate(template: PropTemplate) {
  if (!window.confirm(t('terminal.rules.resetConfirm'))) return
  void terminal.newAttempt({ template, reuseTapes: true })
  toasts.push({ title: t('terminal.toast.reset'), variant: 'info' })
}

function setTimeframe(value: SimTimeframe) {
  terminal.setTimeframe(value)
}

onMounted(() => {
  if (!terminal.ready) void terminal.load()
  window.addEventListener('keydown', onKeydown)
})

// Playback is a page-level activity: leaving the terminal must stop the timer
// instead of stepping bars in the background.
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  terminal.pause()
  void terminal.flush()
})

useHead({ title: 'Trade terminal' })
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1680px] flex-col gap-2.5 px-3 py-3 sm:px-4">
    <header class="flex flex-wrap items-end justify-between gap-2">
      <div class="flex items-baseline gap-2">
        <h1 class="text-[17px] font-semibold tracking-tight text-ink">{{ t('terminal.title') }}</h1>
        <Badge variant="outline" size="sm">{{ t('terminal.badge.replay') }}</Badge>
        <Badge :variant="terminal.source === 'local' ? 'clay' : 'neutral'" size="sm">
          {{ terminal.source === 'local' ? t('terminal.badge.local') : t('terminal.badge.synthetic') }}
        </Badge>
      </div>
      <div class="flex items-center gap-2">
        <p class="max-w-[52ch] text-[11px] leading-snug text-ink-3">{{ t('terminal.subtitle') }}</p>
        <Select
          v-model="selectedSymbol"
          :options="symbolOptions"
          size="sm"
          class="w-[104px] lg:hidden"
          :aria-label="t('terminal.watchlist.title')"
        />
      </div>
    </header>

    <AccountBar
      :status="ruleSummary"
      :equity="terminal.account?.equity ?? 0"
      :balance="terminal.account?.balance ?? 0"
      :day-pnl="terminal.account?.dayPnl ?? 0"
      :cushion="terminal.cushion"
      :floor="terminal.risk?.floor ?? 0"
      :drawdown-amount="terminal.template.drawdown.amount"
      :daily-remaining="terminal.ruleStatuses.find((item) => item.id === 'daily')?.remaining ?? null"
      :open-contracts="terminal.account?.openContracts ?? 0"
      :consistency-ratio="terminal.consistency?.ratio ?? null"
      :consistency-limit="terminal.template.consistency?.maxBestDayRatio ?? null"
      :precision="precision"
    />

    <div class="grid min-h-0 gap-2.5 lg:grid-cols-[212px_minmax(0,1fr)] xl:grid-cols-[212px_minmax(0,1fr)_296px]">
      <aside class="hidden min-h-0 flex-col gap-2.5 lg:flex">
        <Watchlist :rows="watchRows" @select="(symbol) => (selectedSymbol = symbol)" />
        <div class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 p-2.5">
          <p class="label-micro">{{ t('terminal.limits.title') }}</p>
          <ul class="mt-1.5 space-y-1 text-[10.5px] leading-snug text-ink-3">
            <li>{{ t('terminal.limits.data') }}</li>
            <li>{{ t('terminal.limits.depth') }}</li>
            <li>{{ t('terminal.limits.timeframe') }}</li>
          </ul>
        </div>
      </aside>

      <section class="flex min-h-0 min-w-0 flex-col gap-2">
        <div class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2">
          <div class="flex flex-wrap items-center gap-2 border-b border-line px-2.5 py-1.5">
            <div class="flex items-center gap-1.5">
              <span class="font-mono text-[12px] font-semibold tracking-wide text-ink">{{ terminal.symbol }}</span>
              <span class="text-[10px] text-ink-3">{{ terminal.instrument.name }}</span>
            </div>
            <span class="h-4 w-[length:var(--hairline)] bg-line" aria-hidden="true" />
            <TimeframePicker :model-value="terminal.timeframe" @update:model-value="setTimeframe" />
            <span class="h-4 w-[length:var(--hairline)] bg-line" aria-hidden="true" />
            <span class="font-mono text-[10.5px] text-ink-3">{{ replayLabel }}</span>
            <div class="ml-auto flex items-center gap-1.5">
              <Select
                v-model="chartStyle"
                :options="styleOptions"
                :aria-label="t('terminal.chart.style')"
                size="sm"
                class="w-[104px]"
              />
              <Button variant="ghost" size="xs" @click="chart?.fit()">{{ t('chart.fit') }}</Button>
              <Button variant="ghost" size="xs" @click="ladderOpen = !ladderOpen">
                {{ t('terminal.dom.title') }}
              </Button>
            </div>
          </div>
          <ChartCanvas
            ref="chart"
            :candles="terminal.chartCandles"
            :visible-count="terminal.chartCandles.length"
            :orders="ordersForChart"
            :chart-style="chartStyle"
            :order-draggable="canTrade"
            :price-pick-enabled="canTrade"
            :blind="false"
            :tool="'cursor'"
            :timeframe-minutes="chartTimeframeMinutes"
            time-zone="America/Chicago"
            show-dates
            :price-precision="precision"
            :tick-size="tickSize"
            :analysis="riskAnalysis"
            :symbol-mask="terminal.symbol"
            :label="`${terminal.symbol} ${terminal.timeframe}`"
            class="h-[clamp(300px,44vh,520px)]"
            @order-drag="onOrderDrag"
            @order-cancel="cancelFromChart"
            @price-pick="onPricePick"
          />
          <div class="border-t border-line px-2.5 py-1.5">
            <ReplayBar
              :playing="terminal.playing"
              :speed="terminal.speed"
              :progress="terminal.progress"
              :index="terminal.cursor"
              :total="terminal.totalBars"
              :time-label="replayLabel"
              :source="terminal.source"
              @toggle="terminal.toggle"
              @step="terminal.stepBars(1)"
              @reset="terminal.reset"
              @speed="terminal.setSpeed"
            />
          </div>
        </div>

        <div v-if="ladderOpen" class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 p-2.5">
          <DomLadder
            :price="mark"
            :precision="precision"
            :tick-size="tickSize"
            :working-orders="terminal.workingOrders.filter((order) => order.symbol === terminal.symbol)"
            @pick="onPricePick"
            @rest="restAtPrice"
            @place="placeAtPrice"
            @cancel="cancelOrder"
          />
        </div>

        <div class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2">
          <div class="flex items-center gap-1 border-b border-line px-2 py-1.5">
            <button
              v-for="tab in ['positions', 'orders', 'fills', 'history', 'rules'] as const"
              :key="tab"
              type="button"
              class="h-6 rounded-sm px-2 text-[11px] transition-colors"
              :class="dock === tab ? 'bg-ink/[0.08] text-ink' : 'text-ink-3 hover:text-ink-2'"
              :aria-pressed="dock === tab"
              @click="dock = tab"
            >
              {{ t(`terminal.dock.${tab}`) }}
            </button>
          </div>
          <div class="max-h-[280px] overflow-auto p-2">
            <PositionsTable
              v-if="dock === 'positions'"
              :positions="terminal.snapshot?.positions ?? []"
              :marks="terminal.snapshot?.marks ?? {}"
              :point-values="pointValues"
              :precision="precision"
              @flatten="flatten"
              @reverse="reverse"
              @focus="focusSymbol"
            />
            <OrdersTable
              v-else-if="dock === 'orders'"
              :orders="terminal.orders"
              :precision="precision"
              @cancel="cancelOrder"
              @cancel-all="terminal.cancelAll"
            />
            <FillsTable v-else-if="dock === 'fills'" :fills="terminal.fills" :precision="precision" />
            <TerminalHistory
              v-else-if="dock === 'history'"
              :trades="terminal.trades"
              :events="terminal.snapshot?.events ?? []"
              :days="terminal.risk?.days ?? []"
              :current-day="terminal.risk?.currentDay ?? ''"
              :instruments="instruments.list()"
              :precision="precision"
              :precisions="precisions"
              @focus="focusTrade"
            />
            <RulesPanel
              v-else
              :template-id="terminal.templateId"
              :template="terminal.template"
              :risk="terminal.risk"
              :statuses="terminal.ruleStatuses"
              :consistency="terminal.consistency"
              :precision="precision"
              @update:template-id="terminal.setTemplate"
              @reset="resetAccount"
              @configure="configureTemplate"
            />
          </div>
        </div>
      </section>

      <aside class="hidden min-h-0 flex-col gap-2 xl:flex">
        <div class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 p-2.5">
          <div class="mb-2 flex items-center justify-between">
            <h2 class="label-micro">{{ t('terminal.ticket.title') }}</h2>
            <span class="font-mono text-[10px] text-ink-3">{{ terminal.symbol }} · {{ terminal.timeframe }}</span>
          </div>
          <OrderTicket
            :mark="mark"
            :precision="precision"
            :tick-size="tickSize"
            :max-qty="terminal.template.maxContracts"
            :symbol="terminal.symbol"
            :replay-time="terminal.replayTime"
            :disabled="!canTrade"
            :price-hint="priceHint"
            :price-hint-side="priceHintSide ?? undefined"
            :price-hint-type="priceHintType ?? undefined"
            :side-hint="ticketSide ?? undefined"
            @submit="submitOrder"
          />
        </div>
        <div v-if="position" class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 p-2.5">
          <div class="flex items-center justify-between">
            <span class="label-micro">{{ t('terminal.positions.title') }}</span>
            <Badge :variant="position.side === 'long' ? 'bull' : 'bear'" size="sm">{{ position.side }}</Badge>
          </div>
          <div class="mt-1.5 grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums">
            <div>
              <p class="text-[9px] text-ink-3">{{ t('terminal.positions.qty') }}</p>
              <p>{{ position.qty }}</p>
            </div>
            <div>
              <p class="text-[9px] text-ink-3">{{ t('terminal.positions.avg') }}</p>
              <p>{{ formatPrice(position.avgPrice, precision) }}</p>
            </div>
            <div>
              <p class="text-[9px] text-ink-3">{{ t('terminal.account.breach') }}</p>
              <p :class="terminal.breachPrice == null ? '' : 'text-warn'">
                {{ terminal.breachPrice == null ? '—' : formatPrice(terminal.breachPrice, precision) }}
              </p>
            </div>
          </div>
          <div class="mt-2 grid grid-cols-2 gap-1.5">
            <Button variant="outline" size="xs" @click="flatten">{{ t('terminal.positions.flatten') }}</Button>
            <Button variant="outline" size="xs" @click="reverse">{{ t('terminal.positions.reverse') }}</Button>
          </div>
        </div>
      </aside>
    </div>

    <div v-if="!ticketOpen" class="sticky bottom-2 z-20 grid grid-cols-2 gap-2 xl:hidden">
      <Button variant="bull" size="md" class="shadow-lg" aria-keyshortcuts="B" @click="openTicket('long')">
        {{ t('terminal.ticket.buy') }} · {{ terminal.symbol }}
      </Button>
      <Button variant="bear" size="md" class="shadow-lg" aria-keyshortcuts="S" @click="openTicket('short')">
        {{ t('terminal.ticket.sell') }} · {{ terminal.symbol }}
      </Button>
    </div>

    <div
      v-if="ticketOpen"
      class="fixed inset-0 z-30 bg-black/35 backdrop-blur-[1px] xl:hidden"
      aria-hidden="true"
      @click="closeTicket"
    />
    <div
      v-if="ticketOpen"
      class="fixed inset-x-0 bottom-[calc(var(--mobile-tabbar)+env(safe-area-inset-bottom))] z-50 max-h-[74vh] overflow-y-auto rounded-t-xl border-t-[length:var(--hairline)] border-line bg-surface-1 shadow-2xl xl:hidden"
      role="dialog"
      aria-modal="true"
      :aria-label="t('terminal.ticket.title')"
      @keydown.escape.stop="closeTicket"
    >
      <div class="p-2.5">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="label-micro">{{ t('terminal.ticket.title') }}</h2>
          <button type="button" class="text-[11px] text-ink-3" @click="closeTicket">
            {{ t('common.close') }}
          </button>
        </div>
        <OrderTicket
          :mark="mark"
          :precision="precision"
          :tick-size="tickSize"
          :max-qty="terminal.template.maxContracts"
          :symbol="terminal.symbol"
          :replay-time="terminal.replayTime"
          :disabled="!canTrade"
          :price-hint="priceHint"
          :price-hint-side="priceHintSide ?? undefined"
          :price-hint-type="priceHintType ?? undefined"
          :side-hint="ticketSide ?? undefined"
          @submit="submitOrder"
        />
      </div>
    </div>
  </div>
</template>
