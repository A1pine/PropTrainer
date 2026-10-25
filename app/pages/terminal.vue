<script setup lang="ts">
import { X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { ChartAnalysis, ChartOrderLine, ChartStyle } from '~/lib/chart/types'
import type { PropTemplate, SimTimeframe } from '~/domain/sim/types'
import { timeframeMinutes } from '~/domain/sim/timeframe'
import { templateById } from '~/domain/sim/presets'
import { instruments } from '~/domain/instruments/catalog'
import { candleIndexAt, isFormingCandle } from '~/lib/sim/chart'
import {
  fallbackHotkeys,
  matchHotkey,
  readHotkeys,
  writeHotkeys,
  type HotkeyAction,
  type HotkeySettings,
} from '~/lib/sim/hotkeys'
import { LAYOUT_SIZES, readLayout, resizePanes, writeLayout, type TerminalPane } from '~/lib/sim/layout'

const REPLAY_LABEL = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const EMPTY_ANALYSIS: ChartAnalysis = { series: [], zones: [], levels: [], markers: [], profile: [] }

const { t } = useI18n()
const terminal = useTerminalStore()
const toasts = useToastStore()

const ticketOpen = ref(false)
const priceHint = ref<number | null>(null)
const priceHintSide = ref<'long' | 'short' | null>(null)
const priceHintType = ref<'limit' | 'stop' | null>(null)
const ticketSide = ref<'long' | 'short' | null>(null)
const dock = ref<'positions' | 'orders' | 'fills' | 'history' | 'rules'>('positions')
const chartStyle = computed<ChartStyle>({
  get: () => panes.value[activePane.value]?.style ?? 'candles',
  set: (value) => {
    const pane = panes.value[activePane.value]
    if (!pane) return
    pane.style = value
    persistPanes()
  },
})
const ladderOpen = ref(true)
// Server and first client render must agree, so the persisted table is adopted
// after hydration instead of during setup.
const hotkeys = ref<HotkeySettings>(fallbackHotkeys())
const hotkeysOpen = ref(false)

interface PaneChart {
  fit: () => void
  focusRange: (from: number, to: number) => void
}

// Up to three panes share the replay clock. Only the active pane receives
// order drags and price picks so a stray click never places an order on a
// background chart.
const panes = ref<TerminalPane[]>([{ symbol: 'MNQ', timeframe: '15m', style: 'candles' }])
const activePane = ref(0)
const wide = ref(false)
const charts = new Map<number, PaneChart>()
let media: MediaQueryList | null = null

function setChart(index: number, handle: unknown) {
  if (handle) charts.set(index, handle as PaneChart)
  else charts.delete(index)
}

const renderedPanes = computed(() => {
  // A narrow layout mounts only the active pane, so aggregating the hidden
  // layouts would be pure waste. Wide layouts still prepare all three.
  const indices = wide.value ? panes.value.map((_, index) => index) : [activePane.value]
  return indices.flatMap((index) => {
    const pane = panes.value[index]
    return pane ? [{ pane, index, candles: terminal.candlesFor(pane.symbol, pane.timeframe) }] : []
  })
})

const visiblePanes = computed(() => renderedPanes.value)

const paneColumns = computed(() =>
  visiblePanes.value.length >= 3 ? 'lg:grid-cols-3' : visiblePanes.value.length === 2 ? 'lg:grid-cols-2' : '',
)

function chooseSymbol(symbol: string) {
  const pane = panes.value[activePane.value]
  if (pane && pane.symbol !== symbol) {
    pane.symbol = symbol
    persistPanes()
  }
  if (symbol !== terminal.symbol) void terminal.load(symbol)
}

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
      volume: quote?.volume ?? null,
      precision: spec.pricePrecision,
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

function ordersFor(targetSymbol: string): ChartOrderLine[] {
  const lines: ChartOrderLine[] = []
  for (const order of terminal.workingOrders) {
    if (order.symbol !== targetSymbol) continue
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
}

const position = computed(() => terminal.snapshot?.positions.find((item) => item.symbol === terminal.symbol) ?? null)

const mark = computed(() => terminal.mark?.price ?? null)

const replayLabel = computed(() => {
  const time = terminal.replayTime
  if (time == null) return '—'
  return REPLAY_LABEL.format(new Date(time * 1000))
})

const ruleSummary = computed(() => terminal.risk?.status ?? 'active')

// Use the store's gate: it also requires a fresh mark, an open session and a
// replay that has not ended, so the chart never invites a click that the engine
// would reject.
const canTrade = computed(() => terminal.canTrade)

// Out-of-window price thresholds remain visible in the position card.
const riskAnalysis = computed<ChartAnalysis>(() => {
  const levels: ChartAnalysis['levels'] = []
  // The drawdown floor is an account-equity number, not an instrument price, so
  // it stays in the account bar; only position-derived prices belong on a chart.
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
  if (!levels.length) return EMPTY_ANALYSIS
  return { series: [], zones: [], levels, markers: [], profile: [] }
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
  // On wide layouts the ticket is already visible, so the shortcut moves focus
  // to the matching side instead of pretending to open a panel. On mobile the
  // sheet is the visible copy, so pick whichever instance is actually rendered.
  void nextTick(() => {
    const testId = side === 'long' ? 'ticket-long' : 'ticket-short'
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`))
    const target = nodes.find((node) => node.offsetParent !== null) ?? nodes[0]
    target?.focus()
  })
}

function closeTicket() {
  ticketOpen.value = false
  priceHint.value = null
  priceHintSide.value = null
  priceHintType.value = null
  ticketSide.value = null
}

function focusSymbol(symbol: string) {
  chooseSymbol(symbol)
}

function persistPanes() {
  writeLayout(panes.value)
}

function paneCandles(pane: TerminalPane) {
  return terminal.candlesFor(pane.symbol, pane.timeframe)
}

function paneIsForming(pane: TerminalPane, candles: readonly { time: number }[]) {
  const last = candles[candles.length - 1]
  return last != null && terminal.knownTime != null && isFormingCandle(last.time, pane.timeframe, terminal.knownTime)
}

function paneTimeframeMinutes(pane: TerminalPane) {
  return pane.timeframe === '1D' ? 1440 : (timeframeMinutes(pane.timeframe) ?? 5)
}

function panePrecision(pane: TerminalPane) {
  return instruments.require(pane.symbol).pricePrecision
}

function paneTickSize(pane: TerminalPane) {
  return instruments.require(pane.symbol).tickSize
}

function paneLabel(pane: TerminalPane) {
  return `${pane.symbol} ${pane.timeframe}`
}

// One place decides which pane owns the ticket, ladder and position card. Every
// layout mutation funnels through here so the trading context can never point at
// a symbol or timeframe that is no longer on screen.
function syncActivePane() {
  const pane = panes.value[activePane.value] ?? panes.value[0]
  if (!pane) return
  if (pane.symbol !== terminal.symbol) void terminal.load(pane.symbol)
  if (pane.timeframe !== terminal.timeframe) terminal.setTimeframe(pane.timeframe)
}

function activatePane(index: number) {
  const pane = panes.value[index]
  if (!pane || index === activePane.value) return
  activePane.value = index
  syncActivePane()
}

function setPaneSymbol(index: number, symbol: string) {
  const pane = panes.value[index]
  if (!pane || !terminal.symbols.includes(symbol)) return
  pane.symbol = symbol
  persistPanes()
  if (index === activePane.value) syncActivePane()
}

function setPaneTimeframe(index: number, value: SimTimeframe) {
  const pane = panes.value[index]
  if (!pane) return
  pane.timeframe = value
  persistPanes()
  if (index === activePane.value) syncActivePane()
}

function setPaneStyle(index: number, value: ChartStyle) {
  const pane = panes.value[index]
  if (!pane) return
  pane.style = value
  persistPanes()
}

function fitAll() {
  for (const handle of charts.values()) handle.fit()
}

function setPaneCount(size: number) {
  panes.value = resizePanes(panes.value, size, terminal.symbols, {
    symbol: terminal.symbol,
    timeframe: terminal.timeframe,
    style: chartStyle.value,
  })
  if (activePane.value >= panes.value.length) activePane.value = panes.value.length - 1
  persistPanes()
  syncActivePane()
  void nextTick(() => {
    for (const handle of charts.values()) handle.fit()
  })
}

function removePane(index: number) {
  if (panes.value.length <= 1) return
  panes.value.splice(index, 1)
  // Keep the same chart selected where possible; otherwise fall back to the
  // pane that slid into its place.
  if (activePane.value >= panes.value.length) activePane.value = panes.value.length - 1
  else if (index < activePane.value) activePane.value -= 1
  persistPanes()
  syncActivePane()
  void nextTick(() => {
    for (const handle of charts.values()) handle.fit()
  })
}

function reducePosition(symbol: string, qty: number) {
  const current = terminal.snapshot?.positions.find((item) => item.symbol === symbol)
  if (!current) return
  const side = current.side === 'long' ? 'short' : 'long'
  const result = terminal.submit({ side, type: 'market', qty, reduceOnly: true }, symbol)
  if (!result.ok) toasts.error(t('terminal.errors.rejected'), result.error)
  else toasts.push({ title: t('terminal.toast.reduced'), variant: 'info' })
}

function cancelSide(side: 'long' | 'short') {
  const targets = terminal.workingOrders.filter((order) => order.side === side)
  for (const order of targets) terminal.cancel(order.id)
  if (targets.length) toasts.push({ title: t('terminal.toast.cancelled'), variant: 'info' })
}

function cancelAllOrders() {
  const result = terminal.cancelAll()
  if (!result.ok) toasts.error(t('terminal.errors.rejected'), result.error)
  else toasts.push({ title: t('terminal.toast.cancelled'), variant: 'info' })
}

function modifyOrder(id: string, patch: { limitPrice?: number | null; stopPrice?: number | null; qty?: number }) {
  const result = terminal.modify(id, patch)
  if (!result.ok) toasts.error(t('terminal.errors.rejected'), result.error)
  else toasts.push({ title: t('terminal.toast.modified'), variant: 'info' })
}

function focusTrade(symbol: string, entryTime: number, exitTime: number) {
  // Jump to a pane that already shows the trade, or retarget the active pane so
  // the chart and the trading context stay on the same instrument.
  const paneIndex = panes.value.findIndex((pane) => pane.symbol === symbol)
  const index = paneIndex >= 0 ? paneIndex : activePane.value
  const pane = panes.value[index]
  if (!pane) return
  if (paneIndex < 0) {
    pane.symbol = symbol
    persistPanes()
  }
  activePane.value = index
  syncActivePane()
  void nextTick(() => {
    const candles = paneCandles(pane)
    const from = candleIndexAt(candles, entryTime)
    const to = candleIndexAt(candles, exitTime)
    if (from < 0) return
    charts.get(index)?.focusRange(from, Math.max(from, to))
  })
}

function applyHotkeys(next: HotkeySettings) {
  hotkeys.value = next
  writeHotkeys(next)
}

function runHotkey(action: HotkeyAction) {
  if (action === 'play-pause') terminal.toggle()
  else if (action === 'step') terminal.stepBars(1)
  else if (action === 'buy') openTicket('long')
  else if (action === 'sell') openTicket('short')
  else if (action === 'flatten') flatten()
  else if (action === 'close') closeTicket()
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
  // A shortcut must never fire while the hotkey editor owns the keyboard.
  if (hotkeysOpen.value) return
  // A shortcut must never fire while a popover, menu or dialog owns the keys.
  if (target?.closest('[role="dialog"],[role="listbox"],[role="menu"]')) return
  const action = matchHotkey(event, hotkeys.value, {
    hasPosition: Boolean(position.value),
    ticketOpen: ticketOpen.value,
  })
  if (!action) return
  event.preventDefault()
  runHotkey(action)
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
  // Stop lines are chart-only aliases (`<orderId>:stop`); resolve the engine
  // order before checking that it can actually be cancelled.
  const orderId = id.endsWith(':stop') ? id.slice(0, -':stop'.length) : id
  const order = terminal.workingOrders.find((item) => item.id === orderId)
  if (!order) {
    toasts.error(t('terminal.toast.cancelUnavailable'))
    return
  }
  cancelOrder(orderId)
  toasts.push({ title: t('terminal.toast.cancelled'), variant: 'info' })
}

// The dock buttons pass a symbol; the right-side card and the hotkey call with
// no argument. Guard against the DOM event that a bare `@click` supplies.
function flatten(target?: string) {
  const symbol = typeof target === 'string' ? target : undefined
  const result = terminal.flatten(symbol)
  if (!result.ok) toasts.error(t('terminal.errors.rejected'), result.error)
  else toasts.push({ title: t('terminal.toast.flattened'), variant: 'warn' })
}

function reverse(target?: string) {
  const symbol = typeof target === 'string' ? target : undefined
  const result = terminal.reverse(symbol)
  if (result.ok) toasts.push({ title: t('terminal.toast.reversed'), variant: 'info' })
  else toasts.error(t('terminal.errors.rejected'), result.error)
}

function exitAll() {
  if (!window.confirm(t('terminal.positions.exitAllConfirm'))) return
  const result = terminal.exitAll()
  if (!result.ok) toasts.error(t('terminal.errors.rejected'), result.error)
  else toasts.push({ title: t('terminal.toast.flattened'), variant: 'warn' })
}

async function freshAttempt(template?: PropTemplate) {
  if (terminal.loading || !window.confirm(t('terminal.rules.resetConfirm'))) return
  closeTicket()
  await terminal.newAttempt({ template, reuseTapes: true })
  if (terminal.error) toasts.error(t('terminal.errors.rejected'), terminal.error)
  else {
    const available = panes.value.filter((pane) => terminal.symbols.includes(pane.symbol))
    panes.value = available.length
      ? available
      : [{ symbol: terminal.symbol, timeframe: terminal.timeframe, style: 'candles' }]
    activePane.value = Math.min(activePane.value, panes.value.length - 1)
    syncActivePane()
    persistPanes()
    toasts.push({ title: t('terminal.toast.reset'), variant: 'info' })
  }
}

function resetAccount() {
  void freshAttempt()
}

function configureTemplate(template: PropTemplate) {
  void freshAttempt(template)
}

function selectTemplate(id: string) {
  const next = templateById(id)
  if (next && next.id !== terminal.templateId) void freshAttempt(next)
}

function setTimeframe(value: SimTimeframe) {
  terminal.setTimeframe(value)
  const pane = panes.value[activePane.value]
  if (pane && pane.timeframe !== value) {
    pane.timeframe = value
    persistPanes()
  }
}

function syncWide(event?: MediaQueryList | MediaQueryListEvent) {
  const matches = event ? event.matches : (media?.matches ?? false)
  wide.value = matches
}

// Restore the layout only after the replay run exists: the saved panes must be
// validated against the instruments that run actually pinned, otherwise a stale
// layout can point the ticket at a symbol the account does not trade.
async function retryRestore() {
  await terminal.retryRestore()
  if (terminal.ready) await boot()
}

async function boot() {
  await terminal.initialize()
  const saved = readLayout((symbol) => terminal.symbols.includes(symbol))
  if (saved?.length) {
    panes.value = saved
    const preferred = saved.findIndex((pane) => pane.symbol === terminal.symbol)
    activePane.value = preferred >= 0 ? preferred : 0
    syncActivePane()
  } else {
    panes.value = [{ symbol: terminal.symbol, timeframe: terminal.timeframe, style: 'candles' }]
  }
  await nextTick()
  fitAll()
}

onMounted(() => {
  hotkeys.value = readHotkeys()
  media = window.matchMedia('(min-width: 1024px)')
  syncWide()
  media.addEventListener('change', syncWide)
  window.addEventListener('keydown', onKeydown)
  void boot()
})

// Playback is a page-level activity: leaving the terminal must stop the timer
// instead of stepping bars in the background.
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  media?.removeEventListener('change', syncWide)
  media = null
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
          {{ t(`terminal.badge.${terminal.source}`) }}
        </Badge>
      </div>
      <div class="flex items-center gap-2">
        <p class="max-w-[52ch] text-[11px] leading-snug text-ink-3">{{ t('terminal.subtitle') }}</p>
        <Select
          :model-value="terminal.symbol"
          :options="symbolOptions"
          size="sm"
          class="w-[104px] lg:hidden"
          :aria-label="t('terminal.watchlist.title')"
          @update:model-value="(value) => value && chooseSymbol(value)"
        />
      </div>
    </header>

    <div class="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-ink-3">
      <span role="status" :data-storage="terminal.storageStatus">{{
        t(`terminal.storage.${terminal.storageStatus}`)
      }}</span>
      <Button
        variant="danger-ghost"
        size="xs"
        data-testid="exit-all"
        :disabled="!terminal.ready || (!terminal.snapshot?.positions.length && !terminal.workingOrders.length)"
        @click="exitAll"
        >{{ t('terminal.positions.exitAll') }}</Button
      >
    </div>
    <div
      v-if="terminal.restoreBlocked || terminal.storageStatus === 'unavailable'"
      role="alert"
      data-testid="storage-warning"
      class="rounded-lg border border-line bg-surface-2 p-3 text-[11px] text-ink-2"
    >
      <p>{{ t(terminal.restoreBlocked ? 'terminal.storage.blocked' : 'terminal.storage.warning') }}</p>
      <p v-if="terminal.storageError" class="mt-1 break-words font-mono text-[10px]">{{ terminal.storageError }}</p>
      <div class="mt-2 flex gap-2">
        <Button
          variant="outline"
          size="xs"
          :disabled="terminal.loading"
          @click="terminal.restoreBlocked ? retryRestore() : terminal.retrySave()"
        >
          {{ t('terminal.storage.retry') }}
        </Button>
        <Button
          v-if="terminal.restoreBlocked"
          variant="outline"
          size="xs"
          :disabled="terminal.loading"
          @click="resetAccount"
        >
          {{ t('terminal.storage.newAttempt') }}
        </Button>
      </div>
    </div>
    <p v-if="terminal.error" role="alert" class="break-words text-[11px] text-bear-strong">{{ terminal.error }}</p>
    <p v-if="terminal.dataNotice" role="status" class="text-[11px] text-ink-3">
      {{ t(`terminal.data.${terminal.dataNotice}`) }}
    </p>
    <p v-if="terminal.ready && (terminal.ended || terminal.stale)" role="status" class="text-[11px] text-ink-3">
      {{ t(terminal.ended ? 'terminal.replay.ended' : 'terminal.replay.stale') }}
    </p>

    <AccountBar
      v-if="terminal.account"
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
      :realized="terminal.account?.realizedPnl"
      :unrealized="terminal.account?.unrealizedPnl"
      :margin="terminal.account?.marginUsed"
      :buying-power="terminal.account?.buyingPower"
    />

    <div class="grid min-h-0 gap-2.5 lg:grid-cols-[212px_minmax(0,1fr)] xl:grid-cols-[212px_minmax(0,1fr)_296px]">
      <aside class="hidden min-h-0 flex-col gap-2.5 lg:flex">
        <Watchlist :rows="watchRows" @select="chooseSymbol" />
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
              <HotkeySettings :settings="hotkeys" @update:settings="applyHotkeys" @open-change="hotkeysOpen = $event" />
              <div
                class="hidden items-center gap-0.5 rounded-sm bg-ink/[0.05] p-0.5 lg:flex"
                role="group"
                :aria-label="t('terminal.layout.label')"
              >
                <button
                  v-for="size in LAYOUT_SIZES"
                  :key="size"
                  type="button"
                  class="h-5 min-w-5 rounded-sm px-1 font-mono text-[10px] tabular-nums transition-colors"
                  :class="panes.length === size ? 'bg-surface-2 text-ink shadow-xs' : 'text-ink-3 hover:text-ink-2'"
                  :aria-pressed="panes.length === size"
                  :aria-label="t('terminal.layout.count', { count: size })"
                  @click="setPaneCount(size)"
                >
                  {{ size }}
                </button>
              </div>
              <Button variant="ghost" size="xs" @click="fitAll()">{{ t('chart.fit') }}</Button>
              <Button variant="ghost" size="xs" @click="ladderOpen = !ladderOpen">
                {{ t('terminal.dom.title') }}
              </Button>
            </div>
          </div>
          <div
            class="grid grid-cols-1 gap-[length:var(--hairline)] bg-line"
            :class="paneColumns"
            :data-panes="visiblePanes.length"
          >
            <div
              v-for="entry in visiblePanes"
              :key="`${entry.index}:${entry.pane.symbol}`"
              class="relative min-w-0 bg-surface-2"
              :class="entry.index === activePane ? 'ring-1 ring-inset ring-clay/50' : ''"
              :data-pane="entry.index"
              :data-symbol="entry.pane.symbol"
              :data-active="entry.index === activePane"
              @pointerdown="activatePane(entry.index)"
            >
              <button
                v-if="panes.length > 1"
                type="button"
                class="absolute right-1.5 top-10 z-10 grid size-5 place-items-center rounded-sm border-[length:var(--hairline)] border-line bg-surface-2/90 text-ink-3 backdrop-blur transition-colors hover:text-ink"
                :aria-label="t('terminal.layout.remove')"
                :title="paneLabel(entry.pane)"
                @click.stop="removePane(entry.index)"
              >
                <X class="size-3" aria-hidden="true" />
              </button>
              <TerminalChartPane
                :ref="(handle) => setChart(entry.index, handle)"
                :candles="entry.candles"
                :series-key="`${terminal.run?.id ?? 'run'}:${entry.pane.symbol}:${entry.pane.timeframe}`"
                :visible-count="entry.candles.length"
                :orders="ordersFor(entry.pane.symbol)"
                :chart-style="entry.pane.style"
                :order-draggable="canTrade && entry.index === activePane"
                :price-pick-enabled="canTrade && entry.index === activePane"
                :blind="false"
                :timeframe-minutes="paneTimeframeMinutes(entry.pane)"
                :timeframe-label="entry.pane.timeframe"
                time-zone="America/Chicago"
                show-dates
                :price-precision="panePrecision(entry.pane)"
                :tick-size="paneTickSize(entry.pane)"
                :analysis="entry.index === activePane ? riskAnalysis : null"
                :symbol-mask="entry.pane.symbol"
                :label="paneLabel(entry.pane)"
                class="h-[clamp(320px,44vh,520px)]"
                @order-drag="onOrderDrag"
                @order-cancel="cancelFromChart"
                @price-pick="onPricePick"
              >
                <template #badge>
                  <span
                    v-if="paneIsForming(entry.pane, entry.candles)"
                    class="rounded-sm bg-surface-2/90 px-1 py-0.5 text-[9px] text-ink-3"
                    data-testid="forming-bar"
                    :title="t('terminal.chart.formingHint')"
                    >{{ t('terminal.chart.forming') }}</span
                  >
                </template>
              </TerminalChartPane>
            </div>
          </div>
          <div class="border-t border-line px-2.5 py-1.5">
            <ReplayBar
              :playing="terminal.playing"
              :speed="terminal.speed"
              :progress="terminal.progress"
              :index="terminal.cursor"
              :total="terminal.totalBars"
              :time-label="replayLabel"
              :source="terminal.source"
              :ended="terminal.ended"
              @toggle="terminal.toggle"
              @step="terminal.stepBars(1)"
              @reset="resetAccount"
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
              :precisions="precisions"
              :replay-time="terminal.replayTime ?? undefined"
              @flatten="flatten"
              @reverse="reverse"
              @reduce="reducePosition"
              @focus="focusSymbol"
            />
            <OrdersTable
              v-else-if="dock === 'orders'"
              :orders="terminal.orders"
              :precision="precision"
              :precisions="precisions"
              @cancel="cancelOrder"
              @cancel-all="cancelAllOrders"
              @cancel-side="cancelSide"
              @modify="modifyOrder"
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
              @update:template-id="selectTemplate"
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
            <span class="font-mono text-[10px] text-ink-3" data-testid="ticket-symbol"
              >{{ terminal.symbol }} · {{ terminal.timeframe }}</span
            >
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
