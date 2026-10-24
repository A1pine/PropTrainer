<script setup lang="ts">
import { X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { SimOrder, SimSide } from '~/domain/sim/types'

const props = withDefaults(
  defineProps<{
    price: number | null
    precision: number
    tickSize: number
    rows?: number
    workingOrders?: SimOrder[]
  }>(),
  { rows: 21, workingOrders: () => [] },
)

const emit = defineEmits<{
  pick: [price: number]
  rest: [price: number]
  cancel: [id: string]
  place: [side: SimSide, price: number, type: 'limit' | 'stop']
}>()

const { t } = useI18n()
const sides = ['long', 'short'] as const
const levels = computed(() => {
  if (props.price == null || !Number.isFinite(props.price) || !Number.isFinite(props.tickSize) || props.tickSize <= 0)
    return []
  const count = Number.isFinite(props.rows) ? Math.max(1, Math.floor(props.rows)) : 21
  const middle = Math.floor(count / 2)
  const centerTick = Math.round(props.price / props.tickSize)
  const activeOrders = props.workingOrders.filter((order) => order.status === 'working' || order.status === 'suspended')

  return Array.from({ length: count }, (_, index) => {
    const offset = middle - index
    const price = Number(((centerTick + offset) * props.tickSize).toPrecision(15))
    const label = formatPrice(price, props.precision)
    const orders = activeOrders.filter((order) =>
      [order.limitPrice, order.stopPrice].some(
        (level) => level != null && Math.abs(level - price) < props.tickSize * 1e-6,
      ),
    )
    const groups = sides.map((side) => {
      const own = orders.filter((order) => order.side === side)
      return { side, orders: own, qty: own.reduce((total, order) => total + order.qty - order.filledQty, 0) }
    })
    return { price, label, offset, groups }
  })
})

function pick(price: number, event: MouseEvent) {
  if (event.shiftKey) emit('rest', price)
  else emit('pick', price)
}

function placeLabel(side: SimSide, price: string): string {
  return `${t('terminal.dom.placeLimit', { side: t(side === 'long' ? 'terminal.ticket.buy' : 'terminal.ticket.sell'), price })}. ${t('terminal.dom.stopShortcut')}`
}
</script>

<template>
  <section
    class="min-w-0 overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-surface-2"
    data-testid="dom-ladder"
    :aria-label="t('terminal.dom.title')"
  >
    <header class="border-b-[length:var(--hairline)] border-line px-3 py-2">
      <h2 class="label-micro">{{ t('terminal.dom.title') }}</h2>
      <p class="mt-1 text-[10px] leading-relaxed text-ink-3" data-testid="dom-no-depth">
        {{ t('terminal.dom.noDepth') }}
      </p>
    </header>

    <p v-if="!levels.length" class="px-3 py-5 text-center font-mono text-ink-3" data-testid="dom-empty">—</p>
    <template v-else>
      <div class="grid grid-cols-3 px-1 py-1 text-center text-[10px] text-ink-3" aria-hidden="true">
        <span>{{ t('terminal.ticket.buy') }}</span
        ><span>{{ t('terminal.dom.priceDepth') }}</span
        ><span>{{ t('terminal.ticket.sell') }}</span>
      </div>
      <ol class="divide-y-[length:var(--hairline)] divide-line/50">
        <li
          v-for="level in levels"
          :key="level.price"
          class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] items-start"
          :class="
            level.offset === 0
              ? 'bg-clay-soft font-semibold text-clay-ink'
              : level.offset > 0
                ? 'bg-bear-soft text-bear-strong'
                : 'bg-bull-soft text-bull-strong'
          "
          data-testid="dom-row"
          :data-mark="level.offset === 0 ? 'true' : undefined"
        >
          <div
            v-for="group in level.groups"
            :key="group.side"
            class="row-start-1 flex min-w-0 flex-col gap-0.5 p-0.5"
            :class="group.side === 'long' ? 'col-start-1' : 'col-start-3'"
          >
            <Button
              variant="ghost"
              size="xs"
              class="h-auto min-h-8 min-w-0 flex-wrap gap-1 whitespace-normal rounded-sm px-1 py-1 text-[10px] focus-visible:ring-inset focus-visible:ring-offset-0"
              :class="
                group.side === 'long'
                  ? 'bg-bull-soft text-bull-strong hover:text-bull-strong'
                  : 'bg-bear-soft text-bear-strong hover:text-bear-strong'
              "
              :data-testid="group.side === 'long' ? 'dom-buy' : 'dom-sell'"
              :aria-label="placeLabel(group.side, level.label)"
              @click="emit('place', group.side, level.price, $event.shiftKey ? 'stop' : 'limit')"
              @contextmenu.prevent.stop="emit('place', group.side, level.price, 'stop')"
              @keydown.shift.enter.prevent.stop="emit('place', group.side, level.price, 'stop')"
            >
              <span>{{ t(group.side === 'long' ? 'terminal.ticket.buy' : 'terminal.ticket.sell') }}</span>
              <span v-if="group.qty" class="break-all font-mono tabular-nums" data-testid="dom-own-qty">{{
                t('terminal.dom.ownQty', { qty: group.qty })
              }}</span>
            </Button>
            <Badge
              v-for="order in group.orders"
              :key="order.id"
              :variant="order.side === 'long' ? 'bull' : 'bear'"
              class="h-auto min-w-0 max-w-full justify-between gap-0.5 overflow-hidden rounded-sm px-1"
              data-testid="dom-order"
            >
              <span class="min-w-0 truncate font-mono tabular-nums"
                >{{ t(order.side === 'long' ? 'terminal.ticket.buy' : 'terminal.ticket.sell') }}
                {{ order.qty - order.filledQty }}</span
              >
              <Button
                variant="ghost"
                size="icon-xs"
                class="shrink-0 text-inherit"
                data-testid="dom-cancel"
                :aria-label="t('terminal.dom.cancel', { price: level.label })"
                @click.stop="emit('cancel', order.id)"
                ><X class="size-3" aria-hidden="true"
              /></Button>
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="xs"
            class="col-start-2 row-start-1 flex h-auto min-h-9 min-w-0 flex-col gap-0.5 rounded-none px-1 py-1 text-[11px] text-inherit hover:bg-ink/5 focus-visible:ring-inset focus-visible:ring-offset-0"
            data-testid="dom-price"
            :aria-current="level.offset === 0 ? 'true' : undefined"
            :aria-label="`${t('terminal.dom.pick', { price: level.label })}. ${t('terminal.dom.send', { price: level.label })}`"
            @click="pick(level.price, $event)"
          >
            <span class="min-w-0 whitespace-normal break-all font-mono tabular-nums">{{ level.label }}</span>
            <span class="font-mono text-[10px] tabular-nums text-ink-3" data-testid="dom-depth">—</span>
          </Button>
        </li>
      </ol>
    </template>
    <p class="border-t-[length:var(--hairline)] border-line px-3 py-2 text-[10px] leading-relaxed text-ink-3">
      {{ t('terminal.dom.tradeHint') }}
    </p>
  </section>
</template>
