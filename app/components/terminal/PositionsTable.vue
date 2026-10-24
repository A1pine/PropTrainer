<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SimMark, SimPosition } from '~/domain/sim/types'
import { utcTimestamp } from '~/lib/sim/export'

const props = defineProps<{
  positions: SimPosition[]
  marks: Record<string, SimMark>
  precision: number
  pointValues: Record<string, number>
  precisions?: Record<string, number>
  replayTime?: number
}>()

const emit = defineEmits<{
  flatten: [symbol: string]
  reverse: [symbol: string]
  focus: [symbol: string]
  reduce: [symbol: string, qty: number]
}>()

const { t } = useI18n()
const reduceDrafts = reactive<Record<string, string | number | null>>({})
const reduceErrors = reactive<Record<string, boolean>>({})

function reduce(position: SimPosition) {
  const raw = String(reduceDrafts[position.id] ?? '1').trim()
  const qty = Number(raw)
  const valid = raw !== '' && Number.isSafeInteger(qty) && qty >= 1 && qty <= position.qty
  reduceErrors[position.id] = !valid
  if (valid) emit('reduce', position.symbol, qty)
}

const rows = computed(() =>
  props.positions.map((position) => {
    const quote = props.marks[position.symbol]
    const mark = quote?.price
    const precision = props.precisions?.[position.symbol] ?? props.precision
    const pointValue = props.pointValues[position.symbol]
    const pnl =
      mark != null && Number.isFinite(mark) && pointValue != null && Number.isFinite(pointValue) && pointValue > 0
        ? (mark - position.avgPrice) * position.qty * pointValue * (position.side === 'long' ? 1 : -1)
        : null

    return {
      position,
      avgLabel: formatPrice(position.avgPrice, precision),
      markLabel: formatPrice(mark, precision),
      markTime: utcTimestamp(quote?.time),
      stale: props.replayTime != null && (!quote || !Number.isFinite(quote.time) || quote.time < props.replayTime),
      pnlLabel: formatMoney(pnl, { decimals: 2, signed: true }),
      pnlTone: pnl == null || pnl === 0 ? 'text-ink-2' : pnl > 0 ? 'text-bull-strong' : 'text-bear-strong',
    }
  }),
)
</script>

<template>
  <section
    class="min-w-0 overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-surface-2"
    data-testid="positions-table"
    :aria-label="t('terminal.positions.title')"
  >
    <header class="flex items-center justify-between gap-2 border-b-[length:var(--hairline)] border-line px-3 py-2">
      <h2 class="label-micro min-w-0 truncate">{{ t('terminal.positions.title') }}</h2>
      <span class="shrink-0 font-mono text-[10px] tabular-nums text-ink-3">{{ positions.length }}</span>
    </header>

    <p v-if="!rows.length" class="px-3 py-5 text-center text-[11px] text-ink-3" data-testid="positions-empty">
      {{ t('terminal.positions.empty') }}
    </p>

    <ul v-else class="divide-y-[length:var(--hairline)] divide-line/70">
      <li v-for="row in rows" :key="row.position.id" class="min-w-0 px-3 py-2" data-testid="position-row">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <span class="min-w-0 break-all font-mono text-[11.5px] font-medium text-ink">{{ row.position.symbol }}</span>
          <Badge :variant="row.position.side === 'long' ? 'bull' : 'bear'" size="sm">
            {{ t(`terminal.ledger.sides.${row.position.side}`) }}
          </Badge>
        </div>

        <dl class="mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-[10.5px]">
          <div class="min-w-0">
            <dt class="text-ink-3">{{ t('terminal.positions.qty') }}</dt>
            <dd class="break-all font-mono tabular-nums text-ink" data-testid="position-qty">{{ row.position.qty }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-ink-3">{{ t('terminal.positions.avg') }}</dt>
            <dd class="break-all font-mono tabular-nums text-ink-2" data-testid="position-avg">{{ row.avgLabel }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-ink-3">{{ t('terminal.positions.mark') }}</dt>
            <dd class="break-all font-mono tabular-nums text-ink-2" data-testid="position-mark">{{ row.markLabel }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-ink-3">{{ t('terminal.positions.pnl') }}</dt>
            <dd class="break-all font-mono tabular-nums" :class="row.pnlTone" data-testid="position-pnl">
              {{ row.pnlLabel }}
            </dd>
          </div>
        </dl>

        <div
          v-if="replayTime != null"
          class="mt-2 flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-ink-3"
          data-testid="position-mark-time"
        >
          <span>{{ t('terminal.positions.markTime') }}</span>
          <time class="min-w-0 break-all font-mono tabular-nums" :datetime="row.markTime || undefined">{{
            row.markTime || '—'
          }}</time>
          <Badge v-if="row.stale" variant="warn" size="sm" data-testid="position-stale">{{
            t('terminal.positions.stale')
          }}</Badge>
        </div>

        <form
          class="mt-2 flex min-w-0 flex-wrap items-end gap-1"
          data-testid="position-reduce-form"
          @submit.prevent="reduce(row.position)"
        >
          <div class="min-w-0 flex-1 basis-24">
            <span class="label-micro">{{ t('terminal.positions.reduceQty') }}</span>
            <Input
              :model-value="reduceDrafts[row.position.id] ?? '1'"
              size="sm"
              inputmode="numeric"
              class="w-full font-mono tabular-nums"
              :aria-label="`${t('terminal.positions.reduceQty')} ${row.position.symbol}`"
              :invalid="reduceErrors[row.position.id]"
              data-testid="position-reduce-qty"
              @update:model-value="reduceDrafts[row.position.id] = $event ?? null"
            />
          </div>
          <Button type="submit" variant="secondary" size="xs" data-testid="position-reduce">{{
            t('terminal.positions.reduce')
          }}</Button>
          <p v-if="reduceErrors[row.position.id]" class="w-full text-[11px] text-danger" role="alert">
            {{ t('terminal.positions.invalidReduce', { max: row.position.qty }) }}
          </p>
        </form>

        <div class="mt-2 flex flex-wrap gap-1" role="group" :aria-label="t('terminal.positions.actions')">
          <Button
            variant="ghost"
            size="xs"
            data-testid="position-flatten"
            :aria-label="`${t('terminal.positions.flatten')} ${row.position.symbol}`"
            @click="emit('flatten', row.position.symbol)"
          >
            {{ t('terminal.positions.flatten') }}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            data-testid="position-reverse"
            :aria-label="`${t('terminal.positions.reverse')} ${row.position.symbol}`"
            @click="emit('reverse', row.position.symbol)"
          >
            {{ t('terminal.positions.reverse') }}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            data-testid="position-focus"
            :aria-label="`${t('terminal.positions.focus')} ${row.position.symbol}`"
            @click="emit('focus', row.position.symbol)"
          >
            {{ t('terminal.positions.focus') }}
          </Button>
        </div>
      </li>
    </ul>
  </section>
</template>
