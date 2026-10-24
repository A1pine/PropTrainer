<script setup lang="ts">
import { ChevronDown, Plus, Trash2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { formatPrice } from '~/utils/format'
import type { SimAtm, SimOrderInput, SimOrderType, SimSide, SimTimeInForce } from '~/domain/sim/types'
import { readAtmPresets, validAtm, validAtmPreset, writeAtmPresets, type AtmPreset } from '~/lib/sim/atm-presets'

const props = withDefaults(
  defineProps<{
    mark: number | null
    precision: number
    tickSize: number
    maxQty: number
    symbol?: string
    replayTime?: number | null
    disabled?: boolean
    priceHint?: number | null
    priceHintSide?: SimSide
    priceHintType?: 'limit' | 'stop'
    sideHint?: SimSide
  }>(),
  { symbol: 'MNQ', replayTime: null, disabled: false, priceHint: null },
)

const emit = defineEmits<{ submit: [input: SimOrderInput] }>()
const { t } = useI18n()
const orderTypes = ['market', 'limit', 'stop', 'stop-limit', 'trailing-stop', 'trailing-stop-limit'] as const
const timeInForces = ['day', 'gtc', 'gtd'] as const
const inputClass =
  'h-8 w-full min-w-0 rounded-md border border-line bg-surface-2 px-2 font-mono text-[12px] tabular-nums outline-none focus:border-clay focus:ring-2 focus:ring-clay/20'

type TargetDraft = { price: string; qty: string }
const side = ref<SimSide>('long')
const qty = ref('1')
const type = ref<SimOrderType>('market')
const limitPrice = ref('')
const stopPrice = ref('')
const trailTicks = ref('8')
const limitOffsetTicks = ref('1')
const tif = ref<SimTimeInForce>('day')
const expiresText = ref('')
const releaseText = ref('')
const reduceOnly = ref(false)
const bracketOn = ref(false)
const stopLoss = ref('')
const targets = ref<TargetDraft[]>([])
const atmOpen = ref(false)
const breakEvenOn = ref(false)
const breakEvenTrigger = ref('10')
const breakEvenOffset = ref('1')
const trailingOn = ref(false)
const trailTrigger = ref('10')
const trailDistance = ref('8')
const trailStep = ref('2')
const error = ref<string | null>(null)
const presetError = ref<string | null>(null)
const presets = ref<AtmPreset[]>([])
const presetName = ref('')
const selectedPreset = ref('')

const typeOptions = computed(() => orderTypes.map((value) => ({ value, label: t(`terminal.ticket.types.${value}`) })))
const tifOptions = computed(() => timeInForces.map((value) => ({ value, label: t(`terminal.ticket.${value}`) })))
const presetOptions = computed(() =>
  presets.value.filter((item) => item.symbol === props.symbol).map((item) => ({ value: item.name, label: item.name })),
)
const needsLimit = computed(() => type.value === 'limit' || type.value === 'stop-limit')
const needsStop = computed(() => type.value === 'stop' || type.value === 'stop-limit')
const needsTrail = computed(() => type.value === 'trailing-stop' || type.value === 'trailing-stop-limit')
const sideSign = computed(() => (side.value === 'long' ? 1 : -1))
const atmAvailable = computed(() => !reduceOnly.value && bracketOn.value && aligned(number(stopLoss.value)))
const runner = computed(() => {
  const total = targets.value.reduce((sum, target) => sum + number(target.qty), 0)
  const remainder = number(qty.value) - total
  return Number.isSafeInteger(remainder) && remainder >= 0 ? remainder : '—'
})

function number(text: string): number {
  const value = text.trim()
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : Number.NaN
}

function integer(value: number, min = 1): boolean {
  return Number.isSafeInteger(value) && value >= min
}

function aligned(value: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(props.tickSize) || props.tickSize <= 0) return false
  const ticks = value / props.tickSize
  return Number.isSafeInteger(Math.round(ticks)) && Math.abs(ticks - Math.round(ticks)) <= 1e-6
}

function priceText(value: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(props.tickSize) || props.tickSize <= 0) return ''
  return String(Number((Math.round(value / props.tickSize) * props.tickSize).toFixed(10)))
}

function entryReference(): number {
  if (needsLimit.value) return number(limitPrice.value)
  if (needsStop.value) return number(stopPrice.value)
  if (needsTrail.value) {
    const offset = type.value === 'trailing-stop-limit' ? number(limitOffsetTicks.value) : 0
    return (props.mark ?? Number.NaN) + sideSign.value * (number(trailTicks.value) + offset) * props.tickSize
  }
  return props.mark ?? Number.NaN
}

function initializeProtection(): void {
  const entry = entryReference()
  stopLoss.value = priceText(entry - sideSign.value * props.tickSize * 8)
  targets.value = targets.value.map((target, index) => ({
    qty: target.qty,
    price: priceText(entry + sideSign.value * props.tickSize * 16 * (index + 1)),
  }))
}

function initializePrices(): void {
  const mark = props.mark ?? Number.NaN
  limitPrice.value = priceText(mark - sideSign.value * props.tickSize * 4)
  stopPrice.value = priceText(mark + sideSign.value * props.tickSize * 4)
  initializeProtection()
  error.value = null
}

function dateText(seconds: number): string {
  const date = new Date(seconds * 1000)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19) : ''
}

function parseUtc(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map((value) => Number(value ?? 0))
  if (year! < 100) return null
  const ms = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!)
  const date = new Date(ms)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  )
    return null
  return Number.isSafeInteger(ms / 1000) ? ms / 1000 : null
}

function defaultExpiry(): void {
  expiresText.value =
    props.replayTime != null && Number.isSafeInteger(props.replayTime)
      ? dateText((Math.floor(props.replayTime / 3600) + 1) * 3600)
      : ''
}

function reset(): void {
  side.value = 'long'
  qty.value = '1'
  type.value = 'market'
  tif.value = 'day'
  releaseText.value = ''
  reduceOnly.value = false
  bracketOn.value = false
  targets.value = []
  atmOpen.value = false
  breakEvenOn.value = false
  trailingOn.value = false
  trailTicks.value = '8'
  limitOffsetTicks.value = '1'
  breakEvenTrigger.value = '10'
  breakEvenOffset.value = '1'
  trailTrigger.value = '10'
  trailDistance.value = '8'
  trailStep.value = '2'
  selectedPreset.value = ''
  presetName.value = ''
  presetError.value = null
  initializePrices()
  defaultExpiry()
}

defineExpose({ reset })

watch(() => [props.symbol, props.tickSize, side.value] as const, initializePrices, { immediate: true, flush: 'sync' })
watch(
  () => props.sideHint,
  (next) => {
    if (next === 'long' || next === 'short') side.value = next
  },
  { immediate: true },
)
watch(
  () => props.symbol,
  () => {
    selectedPreset.value = ''
    presetName.value = ''
    presetError.value = null
    releaseText.value = ''
    defaultExpiry()
  },
)
watch(
  () => props.mark,
  (mark, previous) => {
    if (mark != null && Number.isFinite(mark) && (previous == null || !Number.isFinite(previous))) initializePrices()
  },
)
watch(
  () => props.replayTime,
  (next, previous) => {
    if (next == null || (previous != null && next < previous)) reset()
    else if (!expiresText.value) defaultExpiry()
  },
  { immediate: true },
)
watch(tif, (value) => {
  if (value === 'gtd' && !expiresText.value) defaultExpiry()
})
watch(
  bracketOn,
  (on) => {
    if (on) {
      initializeProtection()
      if (!targets.value.length) addTarget()
    } else {
      breakEvenOn.value = false
      trailingOn.value = false
    }
  },
  { flush: 'sync' },
)
watch(
  reduceOnly,
  (on) => {
    if (on) {
      bracketOn.value = false
      breakEvenOn.value = false
      trailingOn.value = false
    }
  },
  { flush: 'sync' },
)
watch(
  () => [props.priceHint, props.priceHintSide, props.priceHintType] as const,
  ([price, hintSide, hintType]) => {
    if (price == null || !Number.isFinite(price)) return
    if (hintSide === 'long' || hintSide === 'short') side.value = hintSide
    const field = hintType ?? (needsStop.value ? 'stop' : 'limit')
    if (field === 'stop') {
      if (type.value !== 'stop-limit') type.value = 'stop'
      stopPrice.value = String(price)
    } else {
      if (type.value !== 'stop-limit') type.value = 'limit'
      limitPrice.value = String(price)
    }
    error.value = null
  },
  { immediate: true },
)

function addTarget(): void {
  if (targets.value.length >= 5) return
  const remaining = number(qty.value) - targets.value.reduce((sum, target) => sum + number(target.qty), 0)
  targets.value.push({
    price: priceText(entryReference() + sideSign.value * props.tickSize * 16 * (targets.value.length + 1)),
    qty: String(integer(remaining) ? remaining : 1),
  })
}

function atm(): SimAtm | null {
  if (!breakEvenOn.value && !trailingOn.value) return null
  return {
    breakEven: breakEvenOn.value
      ? { triggerTicks: number(breakEvenTrigger.value), offsetTicks: number(breakEvenOffset.value) }
      : null,
    trailing: trailingOn.value
      ? {
          triggerTicks: number(trailTrigger.value),
          distanceTicks: number(trailDistance.value),
          stepTicks: number(trailStep.value),
        }
      : null,
  }
}

function validate(schedule = true): string | null {
  if (!orderTypes.includes(type.value) || !timeInForces.includes(tif.value) || !['long', 'short'].includes(side.value))
    return t('terminal.ticket.errors.order')
  const quantity = number(qty.value)
  if (!integer(quantity)) return t('terminal.ticket.errors.qty')
  if (!Number.isFinite(props.maxQty) || quantity > props.maxQty)
    return t('terminal.ticket.errors.max', { max: props.maxQty })
  if (props.mark == null || !Number.isFinite(props.mark)) return t('terminal.ticket.errors.noMark')
  if (!Number.isFinite(props.tickSize) || props.tickSize <= 0) return t('terminal.ticket.errors.tick')
  if (needsLimit.value && !Number.isFinite(number(limitPrice.value))) return t('terminal.ticket.errors.limit')
  if (needsStop.value && !Number.isFinite(number(stopPrice.value))) return t('terminal.ticket.errors.stop')
  if (
    (needsLimit.value && !aligned(number(limitPrice.value))) ||
    (needsStop.value && !aligned(number(stopPrice.value)))
  )
    return t('terminal.ticket.errors.tick')
  if (needsTrail.value && !integer(number(trailTicks.value))) return t('terminal.ticket.errors.trail')
  if (type.value === 'trailing-stop-limit' && !integer(number(limitOffsetTicks.value), 0))
    return t('terminal.ticket.errors.offset')
  if (schedule) {
    if (props.replayTime == null || !Number.isSafeInteger(props.replayTime))
      return t('terminal.ticket.errors.replayTime')
    const expiry = parseUtc(expiresText.value)
    const release = parseUtc(releaseText.value)
    if (tif.value === 'gtd' && (expiry == null || expiry <= props.replayTime)) return t('terminal.ticket.errors.expiry')
    if (releaseText.value && (release == null || release <= props.replayTime))
      return t('terminal.ticket.errors.release')
    if (tif.value === 'gtd' && release != null && expiry != null && release >= expiry)
      return t('terminal.ticket.errors.releaseExpiry')
  }
  const management = atm()
  if (management && (!atmAvailable.value || !validAtm(management))) return t('terminal.ticket.errors.atm')
  if (reduceOnly.value && bracketOn.value) return t('terminal.ticket.errors.reduceBracket')
  if (bracketOn.value) {
    const entry = entryReference()
    if (!Number.isFinite(entry)) return t('terminal.ticket.errors.noMark')
    if (!stopLoss.value.trim() && targets.value.length === 0) return t('terminal.ticket.errors.emptyBracket')
    if (stopLoss.value.trim()) {
      const stop = number(stopLoss.value)
      if (!aligned(stop)) return t('terminal.ticket.errors.tick')
      if ((entry - stop) * sideSign.value <= 0) return t('terminal.ticket.errors.bracketSide')
    }
    if (targets.value.length > 5) return t('terminal.ticket.errors.targetCount')
    let total = 0
    for (const target of targets.value) {
      if (!integer(number(target.qty))) return t('terminal.ticket.errors.targetQty')
      if (!aligned(number(target.price))) return t('terminal.ticket.errors.targetPrice')
      if ((number(target.price) - entry) * sideSign.value <= 0) return t('terminal.ticket.errors.bracketSide')
      total += number(target.qty)
    }
    if (!Number.isSafeInteger(total) || total > quantity) return t('terminal.ticket.errors.bracketQty')
  }
  return null
}

function submit(): void {
  if (props.disabled) return
  error.value = validate()
  if (error.value) return
  const input: SimOrderInput = {
    side: side.value,
    type: type.value,
    qty: number(qty.value),
    tif: tif.value,
    limitPrice: needsLimit.value ? number(limitPrice.value) : null,
    stopPrice: needsStop.value ? number(stopPrice.value) : null,
    trailTicks: needsTrail.value ? number(trailTicks.value) : null,
    limitOffsetTicks: type.value === 'trailing-stop-limit' ? number(limitOffsetTicks.value) : null,
    expiresAt: tif.value === 'gtd' ? parseUtc(expiresText.value) : null,
    releaseAt: releaseText.value ? parseUtc(releaseText.value) : null,
    reduceOnly: reduceOnly.value,
    bracket: bracketOn.value
      ? {
          stopLoss: stopLoss.value.trim() ? number(stopLoss.value) : null,
          targets: targets.value.map((target) => ({ price: number(target.price), qty: number(target.qty) })),
          atm: atm(),
        }
      : null,
  }
  emit('submit', input)
}

function savePreset(): void {
  presetError.value = validate(false)
  if (presetError.value) return
  if (!bracketOn.value || reduceOnly.value) {
    presetError.value = t('terminal.ticket.errors.presetBracket')
    return
  }
  const entry = entryReference()
  const preset: AtmPreset = {
    name: presetName.value.trim(),
    symbol: props.symbol,
    qty: number(qty.value),
    stopTicks: stopLoss.value.trim() ? ((entry - number(stopLoss.value)) * sideSign.value) / props.tickSize : null,
    targets: targets.value.map((target) => ({
      ticks: ((number(target.price) - entry) * sideSign.value) / props.tickSize,
      qty: number(target.qty),
    })),
    atm: atm(),
  }
  // Remove binary floating-point noise, never round a genuinely fractional tick distance.
  const cleanTicks = (value: number) => (Math.abs(value - Math.round(value)) <= 1e-6 ? Math.round(value) : value)
  if (preset.stopTicks != null) preset.stopTicks = cleanTicks(preset.stopTicks)
  preset.targets.forEach((target) => {
    target.ticks = cleanTicks(target.ticks)
  })
  if (!validAtmPreset(preset)) {
    presetError.value = t('terminal.ticket.errors.preset')
    return
  }
  const next = [
    ...readAtmPresets().filter((item) => item.symbol !== preset.symbol || item.name !== preset.name),
    preset,
  ]
  if (!writeAtmPresets(next)) {
    presetError.value = t('terminal.ticket.errors.storage')
    return
  }
  presets.value = next
  selectedPreset.value = preset.name
  presetName.value = preset.name
}

function loadPreset(): void {
  const preset = presets.value.find((item) => item.symbol === props.symbol && item.name === selectedPreset.value)
  const entry = entryReference()
  if (
    !preset ||
    !validAtmPreset(preset) ||
    !Number.isFinite(entry) ||
    !Number.isFinite(props.tickSize) ||
    props.tickSize <= 0
  ) {
    presetError.value = t('terminal.ticket.errors.preset')
    return
  }
  reduceOnly.value = false
  bracketOn.value = true
  qty.value = String(preset.qty)
  stopLoss.value = preset.stopTicks == null ? '' : priceText(entry - sideSign.value * preset.stopTicks * props.tickSize)
  targets.value = preset.targets.map((target) => ({
    price: priceText(entry + sideSign.value * target.ticks * props.tickSize),
    qty: String(target.qty),
  }))
  breakEvenOn.value = preset.atm?.breakEven != null
  trailingOn.value = preset.atm?.trailing != null
  if (preset.atm?.breakEven) {
    breakEvenTrigger.value = String(preset.atm.breakEven.triggerTicks)
    breakEvenOffset.value = String(preset.atm.breakEven.offsetTicks)
  }
  if (preset.atm?.trailing) {
    trailTrigger.value = String(preset.atm.trailing.triggerTicks)
    trailDistance.value = String(preset.atm.trailing.distanceTicks)
    trailStep.value = String(preset.atm.trailing.stepTicks)
  }
  atmOpen.value = breakEvenOn.value || trailingOn.value
  presetName.value = preset.name
  presetError.value = null
  error.value = null
}

function deletePreset(): void {
  const next = readAtmPresets().filter((item) => item.symbol !== props.symbol || item.name !== selectedPreset.value)
  if (!writeAtmPresets(next)) {
    presetError.value = t('terminal.ticket.errors.storage')
    return
  }
  presets.value = next
  selectedPreset.value = ''
  presetName.value = ''
  presetError.value = null
}

onMounted(() => {
  presets.value = readAtmPresets()
})
</script>

<template>
  <form class="flex flex-col gap-2.5" data-testid="order-ticket" novalidate @submit.prevent="submit" @keydown.stop>
    <div class="grid grid-cols-2 gap-1.5">
      <button
        v-for="direction in ['long', 'short'] as const"
        :key="direction"
        type="button"
        class="flex h-9 items-center justify-center rounded-md text-[12.5px] font-semibold transition-all active:scale-[0.98]"
        :class="
          side === direction
            ? direction === 'long'
              ? 'bg-bull text-on-bull shadow-xs'
              : 'bg-bear text-on-bear shadow-xs'
            : 'border-[length:var(--hairline)] border-line bg-surface-2 text-ink-2 hover:text-ink'
        "
        :aria-pressed="side === direction"
        :data-testid="`ticket-${direction}`"
        @click="side = direction"
      >
        {{ t(direction === 'long' ? 'terminal.ticket.buy' : 'terminal.ticket.sell') }}
      </button>
    </div>
    <div class="grid grid-cols-[1fr_auto] items-end gap-2">
      <label class="flex flex-col gap-1">
        <span class="label-micro">{{ t('terminal.ticket.qty') }}</span>
        <input
          v-model="qty"
          :class="inputClass"
          inputmode="numeric"
          :aria-label="t('terminal.ticket.qty')"
          data-testid="ticket-qty"
        />
      </label>
      <div class="flex flex-col items-end gap-1 pb-1">
        <span class="label-micro">{{ symbol }} · {{ t('terminal.ticket.mark') }}</span>
        <span class="num text-[13px] font-medium tabular-nums">{{ formatPrice(mark, precision) }}</span>
      </div>
    </div>
    <label class="flex flex-col gap-1">
      <span class="label-micro">{{ t('terminal.ticket.type') }}</span>
      <Select
        v-model="type"
        :options="typeOptions"
        :aria-label="t('terminal.ticket.type')"
        size="sm"
        data-testid="ticket-type"
      />
    </label>
    <label v-if="needsLimit" class="flex flex-col gap-1">
      <span class="label-micro">{{ t('terminal.ticket.limit') }}</span>
      <input
        v-model="limitPrice"
        :class="inputClass"
        inputmode="decimal"
        :aria-label="t('terminal.ticket.limit')"
        data-testid="ticket-limit"
      />
    </label>
    <label v-if="needsStop" class="flex flex-col gap-1">
      <span class="label-micro">{{ t('terminal.ticket.stop') }}</span>
      <input
        v-model="stopPrice"
        :class="inputClass"
        inputmode="decimal"
        :aria-label="t('terminal.ticket.stop')"
        data-testid="ticket-stop"
      />
    </label>
    <label v-if="needsTrail" class="flex flex-col gap-1">
      <span class="label-micro">{{ t('terminal.ticket.trail') }}</span>
      <input
        v-model="trailTicks"
        :class="inputClass"
        inputmode="numeric"
        :aria-label="t('terminal.ticket.trail')"
        data-testid="ticket-trail"
      />
    </label>
    <label v-if="type === 'trailing-stop-limit'" class="flex flex-col gap-1">
      <span class="label-micro">{{ t('terminal.ticket.limitOffset') }}</span>
      <input
        v-model="limitOffsetTicks"
        :class="inputClass"
        inputmode="numeric"
        :aria-label="t('terminal.ticket.limitOffset')"
        data-testid="ticket-limit-offset"
      />
    </label>
    <label class="flex flex-col gap-1">
      <span class="label-micro">{{ t('terminal.ticket.tif') }}</span>
      <Select
        v-model="tif"
        :options="tifOptions"
        :aria-label="t('terminal.ticket.tif')"
        size="sm"
        data-testid="ticket-tif"
      />
    </label>
    <label v-if="tif === 'gtd'" class="flex flex-col gap-1">
      <span class="label-micro">{{ t('terminal.ticket.expiresAt') }}</span>
      <input
        v-model="expiresText"
        type="datetime-local"
        step="1"
        :class="inputClass"
        :aria-label="t('terminal.ticket.expiresAt')"
        data-testid="ticket-expiry"
      />
    </label>
    <label class="flex flex-col gap-1">
      <span class="label-micro">{{ t('terminal.ticket.releaseAt') }}</span>
      <input
        v-model="releaseText"
        type="datetime-local"
        step="1"
        :class="inputClass"
        :aria-label="t('terminal.ticket.releaseAt')"
        data-testid="ticket-release"
      />
    </label>
    <p class="text-[10px] leading-snug text-ink-3">{{ t('terminal.ticket.scheduleHint') }}</p>
    <div class="flex items-center justify-between gap-2">
      <span class="text-[11px] text-ink-2">{{ t('terminal.ticket.reduceOnly') }}</span>
      <Switch v-model="reduceOnly" :aria-label="t('terminal.ticket.reduceOnly')" data-testid="ticket-reduce" />
    </div>
    <p v-if="reduceOnly" class="text-[10px] leading-snug text-ink-3">{{ t('terminal.ticket.reduceHint') }}</p>
    <div class="rounded-md border-[length:var(--hairline)] border-line bg-surface-1/60 p-2">
      <button
        type="button"
        class="flex w-full items-center justify-between text-left disabled:opacity-45"
        :disabled="reduceOnly"
        :aria-expanded="bracketOn"
        data-testid="ticket-bracket"
        @click="bracketOn = !bracketOn"
      >
        <span class="text-[11.5px] font-medium text-ink-2">{{ t('terminal.ticket.bracket') }}</span>
        <ChevronDown
          class="size-3.5 text-ink-3 transition-transform"
          :class="bracketOn ? 'rotate-180' : ''"
          aria-hidden="true"
        />
      </button>
      <div v-if="bracketOn" class="mt-2 flex flex-col gap-2">
        <label class="flex flex-col gap-1">
          <span class="label-micro">{{ t('terminal.ticket.stopLoss') }}</span>
          <input
            v-model="stopLoss"
            :class="inputClass"
            inputmode="decimal"
            :aria-label="t('terminal.ticket.stopLoss')"
            data-testid="ticket-stop-loss"
          />
        </label>
        <div v-for="(target, index) in targets" :key="index" class="flex items-end gap-1.5" data-testid="ticket-target">
          <label class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="label-micro">{{ t('terminal.ticket.target') }} {{ index + 1 }}</span>
            <input
              v-model="target.price"
              :class="inputClass"
              inputmode="decimal"
              :aria-label="`${t('terminal.ticket.target')} ${index + 1}`"
              data-testid="target-price"
            />
          </label>
          <label class="w-16">
            <span class="sr-only">{{ t('terminal.ticket.qty') }} {{ index + 1 }}</span>
            <input
              v-model="target.qty"
              :class="inputClass"
              inputmode="numeric"
              :aria-label="`${t('terminal.ticket.qty')} ${index + 1}`"
              data-testid="target-qty"
            />
          </label>
          <button
            type="button"
            class="mb-0.5 grid size-7 place-items-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger"
            :aria-label="t('terminal.ticket.removeTarget')"
            data-testid="remove-target"
            @click="targets.splice(index, 1)"
          >
            <Trash2 class="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          block
          :disabled="targets.length >= 5"
          data-testid="add-target"
          @click="addTarget"
        >
          <Plus class="size-3.5" aria-hidden="true" />{{ t('terminal.ticket.addTarget') }}
        </Button>
        <p class="text-[10px] text-ink-3" data-testid="ticket-runner">
          {{ t('terminal.ticket.runner', { qty: runner }) }}
        </p>
      </div>
    </div>
    <div class="rounded-md border-[length:var(--hairline)] border-line bg-surface-1/60 p-2">
      <button
        type="button"
        class="flex w-full items-center justify-between text-left"
        :aria-expanded="atmOpen"
        data-testid="ticket-atm"
        @click="atmOpen = !atmOpen"
      >
        <span class="text-[11.5px] font-medium text-ink-2">{{ t('terminal.ticket.atm') }}</span>
        <ChevronDown
          class="size-3.5 text-ink-3 transition-transform"
          :class="atmOpen ? 'rotate-180' : ''"
          aria-hidden="true"
        />
      </button>
      <div v-if="atmOpen" class="mt-2 flex flex-col gap-2.5">
        <p class="text-[10px] leading-snug text-ink-3">{{ t('terminal.ticket.atmRequiresStop') }}</p>
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-ink-2">{{ t('terminal.ticket.breakEven') }}</span>
          <Switch
            v-model="breakEvenOn"
            :disabled="!atmAvailable && !breakEvenOn"
            :aria-label="t('terminal.ticket.breakEven')"
            data-testid="ticket-break-even"
          />
        </div>
        <div v-if="breakEvenOn" class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1">
            <span class="label-micro">{{ t('terminal.ticket.trigger') }}</span>
            <input
              v-model="breakEvenTrigger"
              :class="inputClass"
              inputmode="numeric"
              :aria-label="`${t('terminal.ticket.breakEven')} ${t('terminal.ticket.trigger')}`"
              data-testid="be-trigger"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="label-micro">{{ t('terminal.ticket.offset') }}</span>
            <input
              v-model="breakEvenOffset"
              :class="inputClass"
              inputmode="numeric"
              :aria-label="`${t('terminal.ticket.breakEven')} ${t('terminal.ticket.offset')}`"
              data-testid="be-offset"
            />
          </label>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-ink-2">{{ t('terminal.ticket.trailing') }}</span>
          <Switch
            v-model="trailingOn"
            :disabled="!atmAvailable && !trailingOn"
            :aria-label="t('terminal.ticket.trailing')"
            data-testid="ticket-trailing"
          />
        </div>
        <div v-if="trailingOn" class="grid grid-cols-3 gap-2">
          <label class="flex flex-col gap-1">
            <span class="label-micro">{{ t('terminal.ticket.trigger') }}</span>
            <input
              v-model="trailTrigger"
              :class="inputClass"
              inputmode="numeric"
              :aria-label="`${t('terminal.ticket.trailing')} ${t('terminal.ticket.trigger')}`"
              data-testid="atm-trigger"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="label-micro">{{ t('terminal.ticket.distance') }}</span>
            <input
              v-model="trailDistance"
              :class="inputClass"
              inputmode="numeric"
              :aria-label="t('terminal.ticket.distance')"
              data-testid="atm-distance"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="label-micro">{{ t('terminal.ticket.step') }}</span>
            <input
              v-model="trailStep"
              :class="inputClass"
              inputmode="numeric"
              :aria-label="t('terminal.ticket.step')"
              data-testid="atm-step"
            />
          </label>
        </div>
      </div>
    </div>
    <details class="rounded-md border-[length:var(--hairline)] border-line bg-surface-1/60 p-2">
      <summary class="cursor-pointer text-[11.5px] font-medium text-ink-2">{{ t('terminal.ticket.presets') }}</summary>
      <div class="mt-2 flex flex-col gap-2">
        <p class="text-[10px] leading-snug text-ink-3">{{ t('terminal.ticket.presetHint', { symbol }) }}</p>
        <Select
          v-model="selectedPreset"
          :options="presetOptions"
          :placeholder="t('terminal.ticket.selectPreset')"
          :aria-label="t('terminal.ticket.presets')"
          size="sm"
          data-testid="preset-select"
        />
        <div class="flex gap-2">
          <Button type="button" size="xs" :disabled="!selectedPreset" data-testid="preset-load" @click="loadPreset">{{
            t('terminal.ticket.loadPreset')
          }}</Button>
          <Button
            type="button"
            size="xs"
            variant="danger-ghost"
            :disabled="!selectedPreset"
            data-testid="preset-delete"
            @click="deletePreset"
            >{{ t('terminal.ticket.deletePreset') }}</Button
          >
        </div>
        <label class="flex flex-col gap-1">
          <span class="label-micro">{{ t('terminal.ticket.presetName') }}</span>
          <input
            v-model="presetName"
            :class="inputClass"
            maxlength="64"
            :aria-label="t('terminal.ticket.presetName')"
            data-testid="preset-name"
          />
        </label>
        <Button type="button" size="xs" data-testid="preset-save" @click="savePreset">{{
          t('terminal.ticket.savePreset')
        }}</Button>
        <p v-if="presetError" class="text-[11px] leading-snug text-danger" role="alert" data-testid="preset-error">
          {{ presetError }}
        </p>
      </div>
    </details>
    <p v-if="error" class="text-[11px] leading-snug text-danger" role="alert" data-testid="ticket-error">{{ error }}</p>
    <Button
      type="submit"
      :variant="side === 'long' ? 'bull' : 'bear'"
      size="md"
      block
      :disabled="disabled"
      data-testid="ticket-submit"
    >
      {{ side === 'long' ? t('terminal.ticket.submitBuy') : t('terminal.ticket.submitSell') }} {{ qty }}
    </Button>
    <Button type="button" variant="ghost" size="xs" data-testid="ticket-reset" @click="reset">{{
      t('terminal.ticket.resetTicket')
    }}</Button>
    <p class="text-[10px] leading-snug text-ink-3">{{ t('terminal.ticket.hint') }}</p>
  </form>
</template>
