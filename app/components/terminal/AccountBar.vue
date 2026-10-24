<script setup lang="ts">
import { ShieldAlert, ShieldCheck, ShieldQuestion } from '@lucide/vue'
import type { SimAccountStatus } from '~/domain/sim/types'

const props = defineProps<{
  status: SimAccountStatus
  equity: number
  balance: number
  dayPnl: number
  cushion: number | null
  floor: number
  drawdownAmount: number
  dailyRemaining: number | null
  openContracts: number
  consistencyRatio: number | null
  consistencyLimit: number | null
  precision: number
}>()

const { t } = useI18n()

const statusTone = computed(() => {
  switch (props.status) {
    case 'breached':
      return 'danger'
    case 'daily-lock':
      return 'warn'
    case 'target':
      return 'bull'
    default:
      return 'neutral'
  }
})

const statusIcon = computed(() => {
  switch (props.status) {
    case 'breached':
      return ShieldAlert
    case 'daily-lock':
      return ShieldQuestion
    case 'target':
      return ShieldCheck
    default:
      return ShieldCheck
  }
})

const cushionPercent = computed(() => {
  if (props.cushion == null || props.drawdownAmount <= 0) return 0
  return Math.max(0, Math.min(100, (props.cushion / props.drawdownAmount) * 100))
})

const cushionTone = computed(() => {
  if (props.cushion == null) return 'bg-ink/15'
  if (props.cushion <= 0) return 'bg-danger'
  if (cushionPercent.value < 25) return 'bg-warn'
  return 'bg-bull'
})

const cells = computed(() => [
  { label: t('terminal.account.equity'), value: formatMoney(props.equity, { decimals: 0 }), tone: 'ink' },
  {
    label: t('terminal.account.dayPnl'),
    value: formatMoney(props.dayPnl, { decimals: 0, signed: true }),
    tone: props.dayPnl > 0 ? 'bull' : props.dayPnl < 0 ? 'bear' : 'ink',
  },
  {
    label: t('terminal.account.cushion'),
    value: formatMoney(props.cushion, { decimals: 0 }),
    tone: props.cushion != null && props.cushion < props.drawdownAmount * 0.25 ? 'warn' : 'ink',
  },
  {
    label: t('terminal.account.dll'),
    value:
      props.dailyRemaining == null ? t('terminal.rules.noLimit') : formatMoney(props.dailyRemaining, { decimals: 0 }),
    tone: props.dailyRemaining != null && props.dailyRemaining < 250 ? 'warn' : 'ink',
  },
  { label: t('terminal.account.open'), value: `${props.openContracts}`, tone: 'ink' },
  {
    label: t('terminal.account.consistency'),
    value:
      props.consistencyRatio == null || props.consistencyLimit == null
        ? '—'
        : `${(props.consistencyRatio * 100).toFixed(0)} / ${(props.consistencyLimit * 100).toFixed(0)}%`,
    tone:
      props.consistencyRatio != null &&
      props.consistencyLimit != null &&
      props.consistencyRatio > props.consistencyLimit
        ? 'warn'
        : 'ink',
  },
])

const toneClass: Record<string, string> = {
  ink: 'text-ink',
  bull: 'text-bull-strong',
  bear: 'text-bear-strong',
  warn: 'text-warn',
}
</script>

<template>
  <section
    class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 px-3 py-2.5"
    :aria-label="t('terminal.account.status')"
  >
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div class="flex items-center gap-2">
        <Badge :variant="statusTone" size="sm" dot>
          <component :is="statusIcon" class="size-3" aria-hidden="true" />
          {{ t(`terminal.status.${status}`) }}
        </Badge>
      </div>
      <div
        v-for="cell in cells"
        :key="cell.label"
        class="flex min-w-[74px] flex-col gap-0.5 border-l-[length:var(--hairline)] border-line pl-3 first-of-type:border-l-0 first-of-type:pl-0"
      >
        <span class="label-micro">{{ cell.label }}</span>
        <span class="num text-[13px] font-medium leading-none tabular-nums" :class="toneClass[cell.tone]">
          {{ cell.value }}
        </span>
      </div>
      <div class="ml-auto flex min-w-[150px] flex-1 flex-col gap-1 sm:max-w-[220px]">
        <div class="flex items-center justify-between font-mono text-[9.5px] text-ink-3">
          <span>{{ t('terminal.account.floor') }} {{ formatPrice(floor, precision) }}</span>
          <span>{{ Math.round(cushionPercent) }}%</span>
        </div>
        <div
          class="h-1.5 overflow-hidden rounded-pill bg-ink/10"
          role="progressbar"
          :aria-valuenow="Math.round(cushionPercent)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="t('terminal.account.cushion')"
        >
          <div
            class="h-full rounded-pill transition-[width] duration-300"
            :class="cushionTone"
            :style="{ width: `${cushionPercent}%` }"
          />
        </div>
      </div>
    </div>
  </section>
</template>
