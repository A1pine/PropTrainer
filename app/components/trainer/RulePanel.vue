<script setup lang="ts">
import { AlertTriangle, Shield, Target, TrendingUp } from '@lucide/vue'
import type { PropRules, RuleStatus } from '~/domain/trading/types'

defineProps<{
  rules: PropRules
  statuses: RuleStatus[]
  compact?: boolean
}>()

const { t } = useI18n()

const icons = {
  profit: Target,
  drawdown: Shield,
  daily: AlertTriangle,
  contracts: TrendingUp,
  trades: TrendingUp,
} as const

function tone(state: RuleStatus['state']) {
  if (state === 'breached') return 'bg-danger'
  if (state === 'near') return 'bg-warn'
  if (state === 'done') return 'bg-bull'
  return 'bg-clay'
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="status in statuses" :key="status.id" class="space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 text-[11px] text-ink-2">
          <component
            :is="icons[status.id]"
            class="size-3.5"
            :class="status.state === 'breached' ? 'text-danger' : status.state === 'near' ? 'text-warn' : 'text-ink-3'"
            aria-hidden="true"
          />
          {{ t(`rules.${status.id}`) }}
        </div>
        <span
          class="num text-[10.5px]"
          :class="status.state === 'breached' ? 'text-danger' : status.state === 'near' ? 'text-warn' : 'text-ink-3'"
        >
          <template v-if="status.id === 'contracts'">{{ status.value }}/{{ status.limit }}</template>
          <template v-else-if="status.id === 'profit'"
            >{{ formatMoney(status.value, { decimals: 0 }) }} /
            {{ formatMoney(status.limit, { decimals: 0 }) }}</template
          >
          <template v-else
            >{{ formatMoney(status.value, { decimals: 0 }) }} /
            {{ formatMoney(status.limit, { decimals: 0 }) }}</template
          >
        </span>
      </div>
      <div class="h-1 overflow-hidden rounded-pill bg-ink/[0.07]">
        <div
          class="h-full rounded-pill transition-[width] duration-500 ease-[var(--ease-swift)]"
          :class="tone(status.state)"
          :style="{
            width: `${Math.max(2, status.id === 'drawdown' ? status.percent : status.id === 'profit' ? status.percent : status.percent)}%`,
          }"
        />
      </div>
      <p
        v-if="!compact && (status.state === 'near' || status.state === 'breached')"
        class="text-[10px] leading-snug"
        :class="status.state === 'breached' ? 'text-danger' : 'text-warn'"
      >
        {{
          status.state === 'breached'
            ? t('rules.breached')
            : t('rules.near', { amount: formatMoney(status.remaining, { decimals: 0 }) })
        }}
      </p>
    </div>
  </div>
</template>
