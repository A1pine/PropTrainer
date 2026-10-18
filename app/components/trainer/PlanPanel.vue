<script setup lang="ts">
import { AlertTriangle, ArrowLeft, Check, X } from '@lucide/vue'
import type { DrillPlan, PlanValidation, TradeDirection } from '~/domain/drill/plan'
import type { RiskSizingResult } from '~/domain/trading/sizing'

const props = defineProps<{
  plan: DrillPlan
  validation: PlanValidation | null
  sizing: RiskSizingResult | null
  precision: number
  tickSize: number
  instrumentSymbol: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:level': [kind: 'entry' | 'stop' | 'target', price: number | null]
  back: []
  submit: []
}>()

const { t } = useI18n()

const isLong = computed(() => props.plan.direction === 'long')
const checks = computed(() => props.validation?.checks.filter((check) => check.id !== 'direction.none') ?? [])
const visibleChecks = computed(() => checks.value.slice(0, 6))
const noTrade = computed(() => props.plan.direction === 'none')

function update(kind: 'entry' | 'stop' | 'target', value: number | null) {
  emit('update:level', kind, value)
}

const directionIcon = computed(() => (isLong.value ? '▲' : '▼'))
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <p class="label-micro">{{ t('plan.step') }}</p>
      <Badge :variant="noTrade ? 'neutral' : isLong ? 'bull' : 'bear'">
        {{ noTrade ? t('read.noTrade') : `${directionIcon} ${isLong ? t('ticket.long') : t('ticket.short')}` }}
      </Badge>
    </div>

    <template v-if="noTrade">
      <div>
        <h3 class="text-[16px] font-semibold tracking-tight">{{ t('plan.standAsideTitle') }}</h3>
        <p class="mt-1 text-[11.5px] leading-relaxed text-ink-3">{{ t('plan.standAsideBody') }}</p>
      </div>
      <div class="rounded-md border border-line bg-sunken p-3 text-[11.5px] leading-relaxed text-ink-2">
        {{ t('plan.standAsideNote') }}
      </div>
      <div class="flex gap-2">
        <Button variant="ghost" size="md" @click="emit('back')">
          <ArrowLeft class="size-3.5" aria-hidden="true" />
          {{ t('plan.back') }}
        </Button>
        <Button variant="primary" size="md" block @click="emit('submit')">{{ t('plan.confirmNoTrade') }}</Button>
      </div>
    </template>

    <template v-else>
      <div>
        <h3 class="text-[16px] font-semibold tracking-tight">{{ t('plan.title') }}</h3>
        <p class="mt-1 text-[11.5px] leading-relaxed text-ink-3">{{ t('plan.hint') }}</p>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <Field :label="t('plan.entry')" :hint="t('plan.entryHint')">
          <NumberField
            :model-value="plan.entry"
            :precision="precision"
            :step="tickSize"
            :aria-label="t('plan.entry')"
            @update:model-value="update('entry', $event)"
          />
        </Field>
        <Field :label="t('plan.stop')" :hint="t('plan.stopHint')">
          <NumberField
            :model-value="plan.stop"
            :precision="precision"
            :step="tickSize"
            :aria-label="t('plan.stop')"
            @update:model-value="update('stop', $event)"
          />
        </Field>
        <Field :label="t('plan.target')" :hint="t('plan.targetHint')" class="col-span-2">
          <NumberField
            :model-value="plan.target"
            :precision="precision"
            :step="tickSize"
            :aria-label="t('plan.target')"
            @update:model-value="update('target', $event)"
          />
        </Field>
      </div>

      <div class="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-line bg-sunken p-3 sm:grid-cols-3">
        <div>
          <p class="label-micro">{{ t('plan.rr') }}</p>
          <p class="num mt-0.5 text-[13px]">{{ validation?.rr == null ? '—' : `${validation.rr.toFixed(2)} : 1` }}</p>
        </div>
        <div>
          <p class="label-micro">{{ t('plan.contracts') }}</p>
          <p class="num mt-0.5 text-[13px]">{{ sizing?.contracts ?? 0 }}</p>
        </div>
        <div>
          <p class="label-micro">{{ t('plan.risk') }}</p>
          <p class="num mt-0.5 text-[13px] text-bear-strong">{{ formatMoney(sizing?.riskAmount ?? 0) }}</p>
        </div>
        <div>
          <p class="label-micro">{{ t('plan.reward') }}</p>
          <p class="num mt-0.5 text-[13px] text-bull-strong">{{ formatMoney(sizing?.rewardAmount ?? null) }}</p>
        </div>
        <div>
          <p class="label-micro">{{ t('plan.fees') }}</p>
          <p class="num mt-0.5 text-[13px]">{{ formatMoney(sizing?.fees ?? 0) }}</p>
        </div>
        <div>
          <p class="label-micro">{{ t('plan.margin') }}</p>
          <p class="num mt-0.5 text-[13px]">{{ formatMoney(sizing?.margin ?? 0, { decimals: 0 }) }}</p>
        </div>
      </div>

      <div>
        <p class="label-micro mb-2">{{ t('plan.checks') }}</p>
        <ul class="space-y-1.5">
          <li v-for="check in visibleChecks" :key="check.id" class="flex items-start gap-2 text-[11px] leading-snug">
            <Check v-if="check.status === 'pass'" class="mt-0.5 size-3.5 shrink-0 text-bull" aria-hidden="true" />
            <AlertTriangle v-else-if="check.status === 'warn'" class="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden="true" />
            <X v-else class="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden="true" />
            <span :class="check.status === 'fail' ? 'text-danger' : check.status === 'warn' ? 'text-warn' : 'text-ink-2'">
              {{ t(`plan.check.${check.id.replaceAll('.', '_')}`, check.params ?? {}) }}
            </span>
          </li>
        </ul>
      </div>

      <div class="flex gap-2 border-t-[length:var(--hairline)] border-line pt-3">
        <Button variant="ghost" size="md" @click="emit('back')">
          <ArrowLeft class="size-3.5" aria-hidden="true" />
          {{ t('plan.back') }}
        </Button>
        <Button
          variant="primary"
          size="md"
          block
          :disabled="disabled || !sizing || sizing.contracts < 1"
          @click="emit('submit')"
        >
          {{ t('plan.submit', { symbol: instrumentSymbol }) }}
        </Button>
      </div>
    </template>
  </div>
</template>
