<script setup lang="ts">
import { ArrowDownRight, ArrowUpRight, ClipboardList } from '@lucide/vue'
import type { InstrumentSpec } from '~/domain/instruments/types'
import type { AccountSnapshot, PlaceOrderInput } from '~/domain/trading/types'
import { computePositionSize } from '~/domain/trading/sizing'

const props = withDefaults(
  defineProps<{
    instrument: InstrumentSpec
    account: AccountSnapshot | null
    defaultSide?: 'long' | 'short'
    defaultQty?: number
    defaultStop?: number | null
    defaultTarget?: number | null
    riskBudget: number
    maxContracts: number
    disabled?: boolean
    pending: boolean
  }>(),
  {
    defaultSide: 'long',
    defaultQty: 1,
    defaultStop: null,
    defaultTarget: null,
    disabled: false,
  },
)

const emit = defineEmits<{
  submit: [input: PlaceOrderInput]
  cancel: [id: string]
}>()

const { t } = useI18n()

const side = ref<'long' | 'short'>(props.defaultSide)
const type = ref<'market' | 'limit'>('market')
const qty = ref(props.defaultQty)
const limitPrice = ref<number | null>(null)
const stop = ref<number | null>(props.defaultStop)
const target = ref<number | null>(props.defaultTarget)

watch(
  () => [props.defaultSide, props.defaultQty, props.defaultStop, props.defaultTarget] as const,
  ([nextSide, nextQty, nextStop, nextTarget]) => {
    side.value = nextSide
    qty.value = nextQty
    stop.value = nextStop
    target.value = nextTarget
  },
)

const sideOptions = computed(() => [
  { value: 'long', label: t('ticket.long'), icon: ArrowUpRight },
  { value: 'short', label: t('ticket.short'), icon: ArrowDownRight },
])
const typeOptions = computed(() => [
  { value: 'market', label: t('ticket.market') },
  { value: 'limit', label: t('ticket.limit') },
])

const mark = computed(() => props.account?.markPrice ?? 0)
const working = computed(() => props.account?.orders.find((order) => order.status === 'working') ?? null)
const hasPosition = computed(() => props.account?.position != null)

const reference = computed(() => (type.value === 'limit' && limitPrice.value != null ? limitPrice.value : mark.value))

const sizing = computed(() =>
  computePositionSize({
    instrument: props.instrument,
    entry: reference.value,
    stop: stop.value,
    target: target.value,
    riskBudget: props.riskBudget,
    maxContracts: props.maxContracts,
  }),
)

const canSubmit = computed(
  () =>
    !props.disabled &&
    !hasPosition.value &&
    !working.value &&
    qty.value >= 1 &&
    qty.value <= props.maxContracts &&
    stop.value != null &&
    (type.value === 'market' || limitPrice.value != null),
)

function submit() {
  if (!canSubmit.value) return
  emit('submit', {
    side: side.value,
    type: type.value,
    qty: Math.round(qty.value),
    limitPrice: type.value === 'limit' ? limitPrice.value : null,
    stopLoss: stop.value,
    takeProfit: target.value,
  })
}
</script>

<template>
  <div class="space-y-3.5">
    <div class="flex items-center justify-between">
      <p class="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
        <ClipboardList class="size-3.5 text-ink-3" aria-hidden="true" />
        {{ t('ticket.title') }}
      </p>
      <Badge variant="clay" size="sm">{{ t('ticket.riskBased') }}</Badge>
    </div>

    <div v-if="working" class="rounded-md border border-warn/40 bg-warn-soft p-2.5">
      <div class="flex items-center justify-between text-[11px]">
        <span class="font-medium text-warn">{{ t('ticket.working') }}</span>
        <span class="num text-ink-2"
          >{{ working.side === 'long' ? t('ticket.long') : t('ticket.short') }} {{ working.qty }} @
          {{ formatPrice(working.limitPrice, instrument.pricePrecision) }}</span
        >
      </div>
      <Button variant="ghost" size="xs" class="mt-1 !text-warn" @click="emit('cancel', working.id)">{{
        t('ticket.cancel')
      }}</Button>
    </div>

    <div v-else-if="hasPosition" class="rounded-md border border-line bg-sunken p-2.5 text-[11.5px] text-ink-2">
      {{ t('ticket.positionOpen') }}
    </div>

    <SegmentedControl v-model="side" :options="sideOptions" :aria-label="t('ticket.side')" />
    <SegmentedControl v-model="type" :options="typeOptions" size="sm" :aria-label="t('ticket.orderType')" />

    <Field v-if="type === 'limit'" :label="t('ticket.limitPrice')" :hint="t('ticket.limitHint')">
      <NumberField
        :model-value="limitPrice"
        :precision="instrument.pricePrecision"
        :step="instrument.tickSize"
        :aria-label="t('ticket.limitPrice')"
        @update:model-value="limitPrice = $event"
      />
    </Field>

    <div class="grid grid-cols-2 gap-2">
      <Field :label="t('ticket.qty')" :hint="t('ticket.autoSize', { qty: sizing.contracts })">
        <NumberField
          :model-value="qty"
          :min="1"
          :max="maxContracts"
          :precision="0"
          :step="1"
          :aria-label="t('ticket.qty')"
          @update:model-value="qty = $event ?? 1"
        />
      </Field>
      <Field :label="t('ticket.maxLoss')">
        <div class="flex h-9.5 items-center justify-end rounded-md border border-line bg-sunken px-3">
          <span class="num text-[13px] text-bear-strong">{{ formatMoney(sizing.riskAmount) }}</span>
        </div>
      </Field>
      <Field :label="t('ticket.stop')">
        <NumberField
          :model-value="stop"
          :precision="instrument.pricePrecision"
          :step="instrument.tickSize"
          :aria-label="t('ticket.stop')"
          @update:model-value="stop = $event"
        />
      </Field>
      <Field :label="t('ticket.target')">
        <NumberField
          :model-value="target"
          :precision="instrument.pricePrecision"
          :step="instrument.tickSize"
          :aria-label="t('ticket.target')"
          @update:model-value="target = $event"
        />
      </Field>
    </div>

    <div class="grid grid-cols-3 gap-2 rounded-md border border-line bg-sunken p-2.5">
      <div>
        <p class="label-micro">R:R</p>
        <p class="num mt-0.5 text-[12px]">{{ sizing.rr == null ? '—' : `${sizing.rr.toFixed(2)}:1` }}</p>
      </div>
      <div>
        <p class="label-micro">{{ t('ticket.fees') }}</p>
        <p class="num mt-0.5 text-[12px]">{{ formatMoney(sizing.fees) }}</p>
      </div>
      <div>
        <p class="label-micro">{{ t('ticket.margin') }}</p>
        <p class="num mt-0.5 text-[12px]">{{ formatMoney(sizing.margin, { decimals: 0 }) }}</p>
      </div>
    </div>

    <Button :variant="side === 'long' ? 'bull' : 'bear'" size="lg" block :disabled="!canSubmit" @click="submit">
      <ArrowUpRight v-if="side === 'long'" class="size-4" aria-hidden="true" />
      <ArrowDownRight v-else class="size-4" aria-hidden="true" />
      {{ side === 'long' ? t('ticket.buy') : t('ticket.sell') }} {{ instrument.symbol }} · {{ Math.round(qty) }}
    </Button>
    <p class="text-center text-[10px] leading-snug text-ink-3">{{ t('ticket.footnote') }}</p>
  </div>
</template>
