<script setup lang="ts">
import { RotateCcw } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { formatMoney, formatPrice } from '~/utils/format'
import type { ConsistencyStatus, PropTemplate, RiskState, SimRuleStatus } from '~/domain/sim/types'
import { PROP_TEMPLATES } from '~/domain/sim/presets'

const props = defineProps<{
  templateId: string
  template: PropTemplate
  risk: RiskState | null
  statuses: SimRuleStatus[]
  consistency: ConsistencyStatus | null
  precision: number
}>()

const emit = defineEmits<{
  'update:templateId': [id: string]
  reset: []
  configure: [template: PropTemplate]
}>()
const { t } = useI18n()
const inputClass =
  'h-8 w-full min-w-0 rounded-md border border-line bg-surface-2 px-2 font-mono text-[12px] tabular-nums outline-none focus:border-clay focus:ring-2 focus:ring-clay/20'

function onTemplate(value: string | undefined) {
  if (value) emit('update:templateId', value)
}

const templates = computed(() => {
  const options = PROP_TEMPLATES.map((item) => ({
    value: item.id,
    label: item.label,
    hint: formatMoney(item.accountSize, { decimals: 0 }),
  }))
  if (!options.some((item) => item.value === props.templateId)) {
    options.push({
      value: props.templateId,
      label: props.template.label,
      hint: formatMoney(props.template.accountSize, { decimals: 0 }),
    })
  }
  return options
})
const modes = ['static', 'trailing-intraday', 'trailing-eod'] as const
const bases = ['balance', 'equity'] as const
const actions = ['warn', 'flatten', 'flatten-lock'] as const
const gates = ['pass', 'payout'] as const
const modeOptions = computed(() => modes.map((value) => ({ value, label: t(`terminal.rules.modes.${value}`) })))
const basisOptions = computed(() => bases.map((value) => ({ value, label: t(`terminal.rules.bases.${value}`) })))
const actionOptions = computed(() => actions.map((value) => ({ value, label: t(`terminal.rules.actions.${value}`) })))
const gateOptions = computed(() => gates.map((value) => ({ value, label: t(`terminal.rules.gates.${value}`) })))
const statusById = computed(() => new Map(props.statuses.map((status) => [status.id, status])))

function stateLabel(state: SimRuleStatus['state'] | undefined): string {
  return t(
    `terminal.rules.${({ breached: 'breach', near: 'near', done: 'done', gated: 'gated', ok: 'ok' } as const)[state ?? 'ok']}`,
  )
}

const stateTone: Record<string, string> = {
  breached: 'text-danger',
  near: 'text-warn',
  done: 'text-bull-strong',
  gated: 'text-warn',
  ok: 'text-ink-2',
}
const days = computed(() => {
  const done = props.risk?.days.filter((day) => day.finalized && day.fills > 0).length ?? 0
  const required = props.template.minTradingDays
  return {
    done,
    required,
    label: required > 0 ? t('terminal.rules.daysValue', { done, required }) : t('terminal.rules.noLimit'),
  }
})
const consistencyRatio = computed(() => {
  const status = props.consistency
  return status && status.totalNetProfit > 0 && status.ratio != null && Number.isFinite(status.ratio)
    ? status.ratio
    : null
})
const rows = computed(() => {
  const template = props.template
  const drawdown = statusById.value.get('drawdown')
  const daily = statusById.value.get('daily')
  const contracts = statusById.value.get('contracts')
  const trades = statusById.value.get('trades')
  return [
    {
      id: 'drawdown',
      label: t('terminal.rules.drawdown'),
      value: formatMoney(template.drawdown.amount, { decimals: 0 }),
      detail: drawdown ? formatMoney(drawdown.remaining, { decimals: 0 }) : '—',
      state: drawdown?.state,
    },
    {
      id: 'daily',
      label: t('terminal.rules.daily'),
      value:
        template.dailyLoss.amount > 0
          ? formatMoney(template.dailyLoss.amount, { decimals: 0 })
          : t('terminal.rules.noLimit'),
      detail: daily ? formatMoney(daily.remaining, { decimals: 0 }) : '—',
      state: daily?.state,
    },
    {
      id: 'target',
      label: t('terminal.rules.target'),
      value:
        template.profitTarget > 0 ? formatMoney(template.profitTarget, { decimals: 0 }) : t('terminal.rules.noLimit'),
      detail: formatMoney(props.risk ? props.risk.lastBalance - props.risk.startBalance : null, {
        decimals: 0,
        signed: true,
      }),
      state: statusById.value.get('profit')?.state,
    },
    {
      id: 'contracts',
      label: t('terminal.rules.contracts'),
      value: `${template.maxContracts}`,
      detail: contracts ? `${contracts.value}` : '—',
      state: contracts?.state,
    },
    {
      id: 'trades',
      label: t('terminal.rules.maxTrades'),
      value: template.maxTradesPerDay > 0 ? `${template.maxTradesPerDay}` : t('terminal.rules.noLimit'),
      detail: trades ? `${trades.value}` : '—',
      state: trades?.state,
    },
    {
      id: 'days',
      label: t('terminal.rules.days'),
      value: days.value.label,
      detail: '',
      state: days.value.required > 0 && days.value.done >= days.value.required ? 'done' : 'ok',
    },
    {
      id: 'consistency',
      label: t('terminal.rules.consistency'),
      value: template.consistency
        ? `${Math.round(template.consistency.maxBestDayRatio * 100)}%`
        : t('terminal.rules.noLimit'),
      detail: consistencyRatio.value != null ? `${Math.round(consistencyRatio.value * 100)}%` : '—',
      state:
        template.consistency && props.consistency && (!props.consistency.eligible || consistencyRatio.value == null)
          ? 'gated'
          : 'ok',
    },
  ] satisfies { id: string; label: string; value: string; detail: string; state?: SimRuleStatus['state'] }[]
})

interface RuleDraft {
  label: string
  accountSize: string
  profitTarget: string
  drawdownMode: PropTemplate['drawdown']['mode']
  drawdownAmount: string
  drawdownBasis: PropTemplate['drawdown']['basis']
  includeUnrealized: boolean
  floorCap: string
  dailyAmount: string
  dailyAction: PropTemplate['dailyLoss']['action']
  maxContracts: string
  maxTradesPerDay: string
  minTradingDays: string
  consistencyOn: boolean
  consistencyRatio: string
  consistencyGate: 'pass' | 'payout'
}

function makeDraft(template: PropTemplate): RuleDraft {
  return {
    label: template.label,
    accountSize: String(template.accountSize),
    profitTarget: String(template.profitTarget),
    drawdownMode: template.drawdown.mode,
    drawdownAmount: String(template.drawdown.amount),
    drawdownBasis: template.drawdown.basis,
    includeUnrealized: template.drawdown.includeUnrealized,
    floorCap: template.drawdown.floorCap == null ? '' : String(template.drawdown.floorCap),
    dailyAmount: String(template.dailyLoss.amount),
    dailyAction: template.dailyLoss.action,
    maxContracts: String(template.maxContracts),
    maxTradesPerDay: String(template.maxTradesPerDay),
    minTradingDays: String(template.minTradingDays),
    consistencyOn: template.consistency != null,
    consistencyRatio: String(template.consistency?.maxBestDayRatio ?? 0.5),
    consistencyGate: template.consistency?.gate ?? 'pass',
  }
}

const draft = ref<RuleDraft>(makeDraft(props.template))
const error = ref<string | null>(null)
const editorOpen = ref(false)
const moneyFields = [
  { key: 'accountSize', label: 'terminal.rules.accountSize' },
  { key: 'profitTarget', label: 'terminal.rules.target' },
  { key: 'drawdownAmount', label: 'terminal.rules.drawdown' },
  { key: 'dailyAmount', label: 'terminal.rules.daily' },
] as const
const countFields = [
  { key: 'maxContracts', label: 'terminal.rules.contracts' },
  { key: 'maxTradesPerDay', label: 'terminal.rules.maxTrades' },
  { key: 'minTradingDays', label: 'terminal.rules.minDays' },
] as const

function resetDraft(): void {
  draft.value = makeDraft(props.template)
  error.value = null
}

watch(() => props.template, resetDraft)

function numeric(text: string): number {
  const value = text.trim()
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : Number.NaN
}

function validate(): string | null {
  const value = draft.value
  if (!value.label.trim() || value.label.trim().length > 100) return t('terminal.rules.errors.name')
  if (
    !Number.isFinite(numeric(value.accountSize)) ||
    numeric(value.accountSize) <= 0 ||
    !Number.isFinite(numeric(value.drawdownAmount)) ||
    numeric(value.drawdownAmount) <= 0
  )
    return t('terminal.rules.errors.positive')
  if (![value.profitTarget, value.dailyAmount].every((raw) => Number.isFinite(numeric(raw)) && numeric(raw) >= 0))
    return t('terminal.rules.errors.nonNegative')
  if (
    !modes.includes(value.drawdownMode) ||
    !bases.includes(value.drawdownBasis) ||
    !actions.includes(value.dailyAction) ||
    !gates.includes(value.consistencyGate) ||
    typeof value.includeUnrealized !== 'boolean' ||
    typeof value.consistencyOn !== 'boolean'
  )
    return t('terminal.rules.errors.option')
  if (value.floorCap.trim()) {
    const cap = numeric(value.floorCap)
    if (!Number.isFinite(cap) || cap < numeric(value.accountSize) - numeric(value.drawdownAmount))
      return t('terminal.rules.errors.cap')
  }
  if (!Number.isSafeInteger(numeric(value.maxContracts)) || numeric(value.maxContracts) < 1)
    return t('terminal.rules.errors.contracts')
  if (
    ![value.maxTradesPerDay, value.minTradingDays].every(
      (raw) => Number.isSafeInteger(numeric(raw)) && numeric(raw) >= 0,
    )
  )
    return t('terminal.rules.errors.counts')
  if (
    value.consistencyOn &&
    (!Number.isFinite(numeric(value.consistencyRatio)) ||
      numeric(value.consistencyRatio) <= 0 ||
      numeric(value.consistencyRatio) > 1)
  )
    return t('terminal.rules.errors.ratio')
  return null
}

function configure(): void {
  error.value = validate()
  if (error.value) return
  const value = draft.value
  const template: PropTemplate = {
    id: `custom-${props.template.id.replace(/^custom-/, '')}`,
    label: value.label.trim(),
    accountSize: numeric(value.accountSize),
    profitTarget: numeric(value.profitTarget),
    drawdown: {
      mode: value.drawdownMode,
      amount: numeric(value.drawdownAmount),
      basis: value.drawdownBasis,
      floorCap: value.floorCap.trim() ? numeric(value.floorCap) : null,
      includeUnrealized: value.includeUnrealized,
    },
    dailyLoss: { amount: numeric(value.dailyAmount), action: value.dailyAction },
    maxContracts: numeric(value.maxContracts),
    maxTradesPerDay: numeric(value.maxTradesPerDay),
    minTradingDays: numeric(value.minTradingDays),
    consistency: value.consistencyOn
      ? { maxBestDayRatio: numeric(value.consistencyRatio), gate: value.consistencyGate }
      : null,
    source: t('terminal.rules.customSource'),
  }
  emit('configure', template)
}

function utcTime(seconds: number): string {
  const date = new Date(seconds * 1000)
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC` : '—'
}
</script>

<template>
  <div class="flex flex-col gap-2.5" @keydown.stop>
    <div class="flex items-end gap-2">
      <label class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="label-micro">{{ t('terminal.rules.template') }}</span>
        <Select
          :model-value="templateId"
          :options="templates"
          size="sm"
          :aria-label="t('terminal.rules.template')"
          data-testid="rules-template"
          @update:model-value="onTemplate"
        />
      </label>
      <Button type="button" variant="outline" size="sm" data-testid="rules-reset" @click="emit('reset')">
        <RotateCcw class="size-3.5" aria-hidden="true" />{{ t('terminal.rules.reset') }}
      </Button>
    </div>
    <p class="text-[10px] leading-snug text-ink-3" data-testid="rules-generic">
      {{ t('terminal.rules.genericDisclaimer') }}
    </p>
    <dl class="divide-y divide-line">
      <div
        v-for="row in rows"
        :key="row.id"
        class="flex items-baseline justify-between gap-3 py-1.5"
        :data-testid="`rule-${row.id}`"
      >
        <dt class="text-[11.5px] text-ink-2">{{ row.label }}</dt>
        <dd class="flex items-baseline gap-2" :aria-label="stateLabel(row.state)">
          <span v-if="row.detail" class="font-mono text-[10.5px] tabular-nums text-ink-3">{{ row.detail }}</span>
          <span class="num text-[12px] tabular-nums" :class="stateTone[row.state ?? 'ok']">{{ row.value }}</span>
        </dd>
      </div>
    </dl>
    <div class="text-[10px] leading-snug text-ink-3">
      <p>
        {{ t(`terminal.rules.modes.${template.drawdown.mode}`) }} ·
        {{ t(`terminal.rules.bases.${template.drawdown.basis}`) }}
      </p>
      <p>
        {{ t('terminal.rules.includeUnrealized') }}:
        {{ t(template.drawdown.includeUnrealized ? 'terminal.rules.on' : 'terminal.rules.off') }}
      </p>
      <p>
        {{ t('terminal.rules.floorCap') }}:
        {{
          template.drawdown.floorCap == null
            ? t('terminal.rules.noLimit')
            : formatMoney(template.drawdown.floorCap, { decimals: 0 })
        }}
      </p>
      <p>{{ t('terminal.rules.dailyAction') }}: {{ t(`terminal.rules.actions.${template.dailyLoss.action}`) }}</p>
    </div>
    <div
      v-if="template.consistency"
      class="rounded-md bg-surface-2 p-2 text-[10px] leading-snug text-ink-3"
      data-testid="rules-consistency-note"
    >
      <p>{{ t('terminal.rules.consistencyHint', { gate: t(`terminal.rules.gates.${template.consistency.gate}`) }) }}</p>
      <p v-if="consistencyRatio == null" data-testid="rules-ratio-undefined">
        {{ t('terminal.rules.ratioUndefined') }}
      </p>
      <p v-if="consistency">
        {{
          t('terminal.rules.bestDayTotal', {
            best: formatMoney(consistency.bestDay, { decimals: 2, signed: true }),
            total: formatMoney(consistency.totalNetProfit, { decimals: 2, signed: true }),
          })
        }}
      </p>
    </div>
    <div v-if="risk" class="rounded-md border-[length:var(--hairline)] border-line bg-surface-1/60 p-2">
      <div class="flex items-center justify-between">
        <span class="label-micro">{{ t('terminal.account.floor') }}</span>
        <span class="num text-[12px] tabular-nums">{{ formatPrice(risk.floor, precision) }}</span>
      </div>
      <div class="mt-1 flex items-center justify-between">
        <span class="label-micro">{{ t('terminal.account.balance') }}</span>
        <span class="num text-[12px] tabular-nums">{{ formatMoney(risk.lastBalance, { decimals: 0 }) }}</span>
      </div>
      <div
        v-if="risk.breach"
        class="mt-2 text-[11px] leading-snug text-danger"
        data-testid="rules-breach"
        role="status"
      >
        <p>{{ t('terminal.rules.breach') }} · {{ risk.breach.message }}</p>
        <p>
          {{
            t('terminal.rules.breachEvidence', {
              rule: t(`terminal.rules.ruleNames.${risk.breach.rule}`),
              bar: risk.breach.bar,
              time: utcTime(risk.breach.time),
              equity: formatMoney(risk.breach.equity, { decimals: 2 }),
              floor: formatMoney(risk.breach.floor, { decimals: 2 }),
            })
          }}
        </p>
      </div>
    </div>
    <details v-if="risk" class="rounded-md border-[length:var(--hairline)] border-line p-2">
      <summary class="cursor-pointer text-[11.5px] font-medium text-ink-2">{{ t('terminal.rules.ledger') }}</summary>
      <p class="mt-1 text-[10px] leading-snug text-ink-3">{{ t('terminal.rules.ledgerHint') }}</p>
      <p v-if="risk.days.length === 0" class="mt-2 text-[11px] text-ink-3">{{ t('terminal.rules.ledgerEmpty') }}</p>
      <div
        v-for="day in risk.days"
        :key="day.key"
        class="mt-2 border-t border-line pt-2 text-[10px]"
        data-testid="rules-ledger-day"
        :data-finalized="day.finalized"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-mono tabular-nums">{{ day.key }}</span>
          <span :class="day.finalized ? 'text-ink-2' : 'text-warn'">{{
            t(day.finalized ? 'terminal.rules.finalized' : 'terminal.rules.provisional')
          }}</span>
        </div>
        <div class="mt-1 flex justify-between gap-2 text-ink-3">
          <span>{{ t('terminal.rules.sessionCounts', { trades: day.trades, fills: day.fills }) }}</span>
          <span class="font-mono tabular-nums">{{ formatMoney(day.realizedPnl, { decimals: 2, signed: true }) }}</span>
        </div>
      </div>
    </details>
    <Button
      type="button"
      variant="outline"
      size="sm"
      :aria-expanded="editorOpen"
      data-testid="rules-edit"
      @click="editorOpen = !editorOpen"
      >{{ t('terminal.rules.editDraft') }}</Button
    >
    <form
      v-if="editorOpen"
      class="flex flex-col gap-2 rounded-md border-[length:var(--hairline)] border-line bg-surface-1/60 p-2"
      novalidate
      data-testid="rules-editor"
      @submit.prevent="configure"
    >
      <p class="text-[10px] leading-snug text-ink-3">{{ t('terminal.rules.draftHint') }}</p>
      <label class="flex flex-col gap-1">
        <span class="label-micro">{{ t('terminal.rules.templateName') }}</span>
        <input
          v-model="draft.label"
          :class="inputClass"
          maxlength="100"
          :aria-label="t('terminal.rules.templateName')"
          data-testid="draft-label"
        />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label v-for="field in moneyFields" :key="field.key" class="flex flex-col gap-1">
          <span class="label-micro">{{ t(field.label) }}</span>
          <input
            v-model="draft[field.key]"
            :class="inputClass"
            inputmode="decimal"
            :aria-label="t(field.label)"
            :data-testid="`draft-${field.key}`"
          />
        </label>
      </div>
      <label class="flex flex-col gap-1">
        <span class="label-micro">{{ t('terminal.rules.drawdownMode') }}</span>
        <Select
          v-model="draft.drawdownMode"
          :options="modeOptions"
          size="sm"
          :aria-label="t('terminal.rules.drawdownMode')"
          data-testid="draft-drawdownMode"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="label-micro">{{ t('terminal.rules.drawdownBasis') }}</span>
        <Select
          v-model="draft.drawdownBasis"
          :options="basisOptions"
          size="sm"
          :aria-label="t('terminal.rules.drawdownBasis')"
          data-testid="draft-drawdownBasis"
        />
      </label>
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-ink-2">{{ t('terminal.rules.includeUnrealized') }}</span>
        <Switch
          v-model="draft.includeUnrealized"
          :aria-label="t('terminal.rules.includeUnrealized')"
          data-testid="draft-includeUnrealized"
        />
      </div>
      <label class="flex flex-col gap-1">
        <span class="label-micro">{{ t('terminal.rules.floorCap') }}</span>
        <input
          v-model="draft.floorCap"
          :class="inputClass"
          inputmode="decimal"
          :aria-label="t('terminal.rules.floorCap')"
          data-testid="draft-floorCap"
        />
      </label>
      <p class="text-[10px] leading-snug text-ink-3">{{ t('terminal.rules.capHint') }}</p>
      <label class="flex flex-col gap-1">
        <span class="label-micro">{{ t('terminal.rules.dailyAction') }}</span>
        <Select
          v-model="draft.dailyAction"
          :options="actionOptions"
          size="sm"
          :aria-label="t('terminal.rules.dailyAction')"
          data-testid="draft-dailyAction"
        />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label v-for="field in countFields" :key="field.key" class="flex flex-col gap-1">
          <span class="label-micro">{{ t(field.label) }}</span>
          <input
            v-model="draft[field.key]"
            :class="inputClass"
            inputmode="numeric"
            :aria-label="t(field.label)"
            :data-testid="`draft-${field.key}`"
          />
        </label>
      </div>
      <p class="text-[10px] leading-snug text-ink-3">{{ t('terminal.rules.zeroHint') }}</p>
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-ink-2">{{ t('terminal.rules.consistency') }}</span>
        <Switch
          v-model="draft.consistencyOn"
          :aria-label="t('terminal.rules.consistency')"
          data-testid="draft-consistencyOn"
        />
      </div>
      <div v-if="draft.consistencyOn" class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1">
          <span class="label-micro">{{ t('terminal.rules.maxRatio') }}</span>
          <input
            v-model="draft.consistencyRatio"
            :class="inputClass"
            inputmode="decimal"
            :aria-label="t('terminal.rules.maxRatio')"
            data-testid="draft-consistencyRatio"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="label-micro">{{ t('terminal.rules.consistencyGate') }}</span>
          <Select
            v-model="draft.consistencyGate"
            :options="gateOptions"
            size="sm"
            :aria-label="t('terminal.rules.consistencyGate')"
            data-testid="draft-consistencyGate"
          />
        </label>
      </div>
      <p v-if="error" class="text-[11px] leading-snug text-danger" role="alert" data-testid="rules-error">
        {{ error }}
      </p>
      <Button type="submit" size="sm" data-testid="rules-apply">{{ t('terminal.rules.applyNewAttempt') }}</Button>
      <Button type="button" variant="ghost" size="xs" data-testid="rules-discard" @click="resetDraft">{{
        t('terminal.rules.discardDraft')
      }}</Button>
    </form>
  </div>
</template>
