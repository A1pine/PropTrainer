<script setup lang="ts">
import { X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { SimOrder, SimOrderStatus, SimSide } from '~/domain/sim/types'
import { utcTimestamp } from '~/lib/sim/export'

const props = defineProps<{
  orders: SimOrder[]
  precision: number
  precisions?: Record<string, number>
  symbolFilter?: string | null
}>()

type OrderPatch = { qty?: number; limitPrice?: number | null; stopPrice?: number | null }
type Scope = 'all' | 'working' | 'filled' | 'cancelled'

const emit = defineEmits<{
  cancel: [id: string]
  cancelAll: []
  cancelSide: [side: SimSide]
  modify: [id: string, patch: OrderPatch]
}>()

const { t } = useI18n()
const scope = ref<Scope>('all')
const editingId = ref<string | null>(null)
const draft = reactive({ qty: '', limitPrice: '', stopPrice: '' })
const error = ref('')
const scopeOptions = computed(() =>
  (['all', 'working', 'filled', 'cancelled'] as const).map((value) => ({
    value,
    label: t(`terminal.orders.scopes.${value}`),
  })),
)
const symbolOrders = computed(() =>
  props.orders.filter((order) => !props.symbolFilter || order.symbol === props.symbolFilter),
)
const working = computed(() => symbolOrders.value.filter(isWorking))
const visibleOrders = computed(() =>
  symbolOrders.value.filter(
    (order) => scope.value === 'all' || (scope.value === 'working' ? isWorking(order) : order.status === scope.value),
  ),
)
const editingOrder = computed(() => props.orders.find((order) => order.id === editingId.value))

const statusTone: Record<SimOrderStatus, 'neutral' | 'clay' | 'warn' | 'bull' | 'danger'> = {
  working: 'clay',
  suspended: 'warn',
  filled: 'bull',
  cancelled: 'neutral',
  rejected: 'danger',
  expired: 'neutral',
}

function isWorking(order: SimOrder): boolean {
  return order.status === 'working' || order.status === 'suspended'
}

function precisionFor(order: SimOrder): number {
  return props.precisions?.[order.symbol] ?? props.precision
}

function hasLimit(order: SimOrder): boolean {
  return order.type === 'limit' || order.type.endsWith('-limit') || order.limitPrice != null
}

function hasStop(order: SimOrder): boolean {
  return order.type === 'stop' || order.type === 'stop-limit' || order.stopPrice != null
}

function priceLabel(order: SimOrder): string {
  const precision = precisionFor(order)
  if (order.limitPrice != null && order.stopPrice != null) {
    return `${t('terminal.ticket.stop')} ${formatPrice(order.stopPrice, precision)} · ${t('terminal.ticket.limit')} ${formatPrice(order.limitPrice, precision)}`
  }
  if (order.limitPrice != null) return formatPrice(order.limitPrice, precision)
  if (order.stopPrice != null) return formatPrice(order.stopPrice, precision)
  if (order.trailTicks != null) return t('terminal.orders.trailTicks', { ticks: order.trailTicks })
  return '—'
}

function syncDraft(order: SimOrder) {
  draft.qty = String(order.qty)
  draft.limitPrice = order.limitPrice == null ? '' : String(order.limitPrice)
  draft.stopPrice = order.stopPrice == null ? '' : String(order.stopPrice)
  error.value = ''
}

function edit(order: SimOrder) {
  editingId.value = order.id
  syncDraft(order)
}

watch(
  () => {
    const order = editingOrder.value
    return (
      order &&
      JSON.stringify([
        order.id,
        order.status,
        order.type,
        order.qty,
        order.filledQty,
        order.limitPrice,
        order.stopPrice,
      ])
    )
  },
  () => {
    const order = editingOrder.value
    if (!order || !isWorking(order)) editingId.value = null
    else syncDraft(order)
  },
)

function save(order: SimOrder) {
  if (!isWorking(order)) return
  error.value = ''
  const qty = Number(draft.qty.trim())
  if (!draft.qty.trim() || !Number.isSafeInteger(qty) || qty < Math.max(1, order.filledQty)) {
    error.value = t('terminal.orders.invalidQty', { min: Math.max(1, order.filledQty) })
    return
  }
  const patch: OrderPatch = {}
  if (qty !== order.qty) patch.qty = qty
  const offsetLimit = order.type === 'trailing-stop-limit' && order.limitOffsetTicks != null
  for (const field of ['limitPrice', 'stopPrice'] as const) {
    if (!(field === 'limitPrice' ? hasLimit(order) : hasStop(order))) continue
    const raw = draft[field].trim()
    const value = raw === '' ? null : Number(raw)
    const optional = field === 'limitPrice' && offsetLimit
    if ((value == null && !optional) || (value != null && !Number.isFinite(value))) {
      error.value = t('terminal.orders.invalidPrice')
      return
    }
    if (value !== order[field]) patch[field] = value
  }
  if (Object.keys(patch).length) emit('modify', order.id, patch)
}
</script>

<template>
  <section
    class="min-w-0 overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-surface-2"
    data-testid="orders-table"
    :aria-label="t('terminal.orders.title')"
  >
    <header
      class="flex flex-wrap items-center justify-between gap-2 border-b-[length:var(--hairline)] border-line px-3 py-2"
    >
      <h2 class="label-micro min-w-0 truncate">{{ t('terminal.orders.title') }}</h2>
      <span class="font-mono text-[10px] tabular-nums text-ink-3" data-testid="orders-count">{{
        visibleOrders.length
      }}</span>
      <SegmentedControl
        v-model="scope"
        :options="scopeOptions"
        size="sm"
        :aria-label="t('terminal.orders.scope')"
        data-testid="orders-scope"
      />
      <div v-if="working.length" class="flex flex-wrap gap-1">
        <Button variant="ghost" size="xs" data-testid="orders-cancel-all" @click="emit('cancelAll')">{{
          t('terminal.orders.cancelAll')
        }}</Button>
        <Button
          v-if="working.some((order) => order.side === 'long')"
          variant="ghost"
          size="xs"
          data-testid="orders-cancel-buy"
          @click="emit('cancelSide', 'long')"
          >{{ t('terminal.orders.cancelBuy') }}</Button
        >
        <Button
          v-if="working.some((order) => order.side === 'short')"
          variant="ghost"
          size="xs"
          data-testid="orders-cancel-sell"
          @click="emit('cancelSide', 'short')"
          >{{ t('terminal.orders.cancelSell') }}</Button
        >
      </div>
    </header>

    <p v-if="!visibleOrders.length" class="px-3 py-5 text-center text-[11px] text-ink-3" data-testid="orders-empty">
      {{ t('terminal.orders.empty') }}
    </p>
    <ul v-else class="divide-y-[length:var(--hairline)] divide-line/70">
      <li v-for="order in visibleOrders" :key="order.id" class="min-w-0 px-3 py-2" data-testid="order-row">
        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span class="min-w-0 break-all font-mono text-[11.5px] font-medium tabular-nums text-ink">{{
            order.symbol
          }}</span>
          <span
            class="text-[10.5px] font-medium"
            :class="order.side === 'long' ? 'text-bull-strong' : 'text-bear-strong'"
            >{{ t(order.side === 'long' ? 'terminal.ticket.buy' : 'terminal.ticket.sell') }}</span
          >
          <span class="min-w-0 break-words text-[10.5px] text-ink-2">{{
            t(`terminal.ticket.types.${order.type}`)
          }}</span>
          <span
            class="num break-all text-[11px] text-ink"
            :title="t('terminal.orders.filledTotal')"
            data-testid="order-qty"
            >{{ order.filledQty }}/{{ order.qty }}</span
          >
          <span class="num min-w-0 break-words text-[11px] text-ink-2" data-testid="order-price">{{
            priceLabel(order)
          }}</span>
          <span class="font-mono text-[10px] uppercase tracking-wide text-ink-3">{{
            t(`terminal.ticket.${order.tif}`)
          }}</span>
          <Badge :variant="statusTone[order.status]" size="sm" :dot="order.status === 'working'">{{
            t(`terminal.orders.${order.status}`)
          }}</Badge>
          <Button
            v-if="isWorking(order)"
            variant="ghost"
            size="xs"
            data-testid="order-edit"
            :aria-label="`${t('terminal.orders.edit')} ${order.symbol}`"
            @click="edit(order)"
            >{{ t('terminal.orders.edit') }}</Button
          >
          <Button
            v-if="isWorking(order)"
            variant="ghost"
            size="icon-xs"
            class="ml-auto"
            data-testid="order-cancel"
            :aria-label="`${t('terminal.orders.cancel')} ${order.symbol} ${priceLabel(order)}`"
            @click="emit('cancel', order.id)"
            ><X class="size-3" aria-hidden="true"
          /></Button>
        </div>
        <p v-if="order.reason" class="mt-1 break-words text-[10.5px] text-ink-2" data-testid="order-reason">
          {{ t('terminal.ledger.reason') }}: {{ order.reason }}
        </p>

        <form
          v-if="editingId === order.id && isWorking(order)"
          class="mt-2 grid min-w-0 grid-cols-2 gap-2 rounded-md bg-surface-1 p-2"
          data-testid="order-editor"
          @submit.prevent="save(order)"
          @keydown.esc.stop="editingId = null"
        >
          <div class="min-w-0">
            <span class="label-micro">{{ t('terminal.orders.qty') }}</span>
            <Input
              v-model="draft.qty"
              size="sm"
              inputmode="numeric"
              class="w-full font-mono tabular-nums"
              :aria-label="t('terminal.orders.qty')"
              data-testid="order-edit-qty"
            />
          </div>
          <div v-if="hasLimit(order)" class="min-w-0">
            <span class="label-micro">{{ t('terminal.ticket.limit') }}</span>
            <Input
              v-model="draft.limitPrice"
              size="sm"
              inputmode="decimal"
              class="w-full font-mono tabular-nums"
              :aria-label="t('terminal.ticket.limit')"
              data-testid="order-edit-limit"
            />
          </div>
          <div v-if="hasStop(order)" class="min-w-0">
            <span class="label-micro">{{ t('terminal.ticket.stop') }}</span>
            <Input
              v-model="draft.stopPrice"
              size="sm"
              inputmode="decimal"
              class="w-full font-mono tabular-nums"
              :aria-label="t('terminal.ticket.stop')"
              data-testid="order-edit-stop"
            />
          </div>
          <p v-if="error" class="col-span-2 break-words text-[11px] text-danger" role="alert">{{ error }}</p>
          <div class="col-span-2 flex flex-wrap gap-1">
            <Button type="submit" size="xs" data-testid="order-save">{{ t('terminal.orders.save') }}</Button>
            <Button variant="ghost" size="xs" @click="editingId = null">{{ t('terminal.orders.discard') }}</Button>
          </div>
        </form>

        <details class="mt-2 text-[10px] text-ink-3" data-testid="order-details">
          <summary class="w-fit cursor-pointer rounded-sm focus-visible:outline-clay">
            {{ t('terminal.orders.details') }}
          </summary>
          <dl class="mt-1 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1">
            <div class="min-w-0">
              <dt>{{ t('terminal.ledger.orderId') }}</dt>
              <dd class="break-all font-mono text-ink-2">{{ order.id }}</dd>
            </div>
            <div class="min-w-0">
              <dt>{{ t('terminal.fills.role') }}</dt>
              <dd class="break-words text-ink-2">{{ t(`terminal.ledger.roles.${order.role}`) }}</dd>
            </div>
            <div
              v-for="item in [
                { key: 'submitted', time: order.createdTime },
                { key: 'release', time: order.releaseAt },
                { key: 'expiry', time: order.expiresAt },
              ]"
              :key="item.key"
              class="min-w-0"
            >
              <dt>{{ t(`terminal.orders.${item.key}`) }}</dt>
              <dd class="break-all font-mono tabular-nums text-ink-2">
                <time :datetime="utcTimestamp(item.time) || undefined">{{ utcTimestamp(item.time) || '—' }}</time>
              </dd>
            </div>
            <div class="min-w-0">
              <dt>{{ t('terminal.orders.parent') }}</dt>
              <dd class="break-all font-mono text-ink-2">{{ order.parentId ?? '—' }}</dd>
            </div>
            <div class="min-w-0">
              <dt>{{ t('terminal.orders.oco') }}</dt>
              <dd class="break-all font-mono text-ink-2">{{ order.ocoId ?? '—' }}</dd>
            </div>
            <div v-if="order.reduceOnly" class="col-span-2">{{ t('terminal.orders.reduceOnly') }}</div>
          </dl>
        </details>
      </li>
    </ul>
  </section>
</template>
