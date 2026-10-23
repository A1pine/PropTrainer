<script setup lang="ts">
import { ArrowRight, Check, Flag, RotateCcw, X } from '@lucide/vue'
import type { DrillGrade, GradeNote } from '~/domain/drill/grade'
import type { Scenario } from '~/domain/market/types'
import type { AccountSnapshot } from '~/domain/trading/types'
import type { TradeExecution } from '~/domain/trading/executions'
import { describeScenario } from '~/domain/market/scenario'

const props = defineProps<{
  grade: DrillGrade | null
  scenario: Scenario
  account: AccountSnapshot
  executions: readonly TradeExecution[]
  roundIndex: number
  totalRounds: number
  isLast: boolean
}>()

const emit = defineEmits<{ next: []; end: []; replay: []; focus: [execution: TradeExecution] }>()

const { t, locale } = useI18n()

const revealed = computed(() => describeScenario(props.scenario))
const letterTone = computed(() => {
  const letter = props.grade?.letter
  if (!letter) return 'border-line text-ink-2'
  if (letter === 'A' || letter === 'B') return 'border-bull/40 bg-bull-soft text-bull-strong'
  if (letter === 'C') return 'border-clay/40 bg-clay-soft text-clay-ink'
  if (letter === 'D') return 'border-warn/40 bg-warn-soft text-warn'
  return 'border-danger/40 bg-danger-soft text-danger'
})

const outcomeTone = computed(() => {
  const r = props.grade?.outcome.rMultiple ?? 0
  return r > 0 ? 'text-bull-strong' : r < 0 ? 'text-bear-strong' : 'text-ink'
})

const windowLabel = computed(() => {
  const meta = props.scenario.dataset
  if (!meta) return ''
  const start = new Date(meta.windowStart * 1000).toISOString()
  const end = new Date(meta.windowEnd * 1000).toISOString()
  return `${formatDate(start, locale.value)} → ${formatDate(end, locale.value)}`
})

const dateLabel = computed(() => {
  const date = new Date(props.scenario.sessionDate)
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(date)
})

function noteIcon(note: GradeNote) {
  if (note.tone === 'positive') return Check
  if (note.tone === 'critical') return X
  return Flag
}

function noteTone(note: GradeNote) {
  if (note.tone === 'positive') return 'text-bull'
  if (note.tone === 'critical') return 'text-danger'
  if (note.tone === 'warning') return 'text-warn'
  return 'text-ink-3'
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="label-micro">{{ t('review.roundComplete', { index: roundIndex, total: totalRounds }) }}</p>
        <h3 class="mt-1 text-[17px] font-semibold tracking-tight">{{ t('review.title') }}</h3>
      </div>
      <div v-if="grade" class="grid size-14 shrink-0 place-items-center rounded-full border" :class="letterTone">
        <span class="serif text-[22px] font-medium leading-none">{{ grade.letter }}</span>
      </div>
    </div>

    <div class="rounded-md border border-line bg-sunken p-3">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
        <span class="font-mono font-medium">{{ revealed.symbol }}</span>
        <span class="text-ink-3">{{ revealed.name }}</span>
        <span class="text-ink-3">·</span>
        <span class="num text-ink-2">{{ dateLabel }}</span>
      </div>
      <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="clay">{{ t(`read.states.${scenario.regime}`) }}</Badge>
        <Badge variant="neutral">{{ revealed.timeframe }}</Badge>
        <Badge variant="neutral">{{
          t('review.barsHidden', { bars: scenario.candles.length - scenario.replayStart })
        }}</Badge>
        <Badge v-if="scenario.dataset" variant="bull" :title="scenario.dataset.license">
          {{ scenario.dataset.sourceSymbol }}
        </Badge>
      </div>
      <p v-if="windowLabel" class="mt-1.5 font-mono text-[10px] text-ink-3">{{ windowLabel }}</p>
    </div>

    <div v-if="grade" class="grid grid-cols-3 gap-2">
      <div class="rounded-md border border-line p-2">
        <p class="label-micro">{{ t('review.process') }}</p>
        <p class="num mt-0.5 text-[16px]">{{ grade.total }}<span class="text-[10px] text-ink-3">/100</span></p>
      </div>
      <div class="rounded-md border border-line p-2">
        <p class="label-micro">{{ t('review.outcome') }}</p>
        <p class="num mt-0.5 text-[16px]" :class="outcomeTone">
          {{ grade.outcome.exitReason === 'no-entry' ? t('review.noFill') : formatR(grade.outcome.rMultiple) }}
        </p>
      </div>
      <div class="rounded-md border border-line p-2">
        <p class="label-micro">{{ t('review.pnl') }}</p>
        <p class="num mt-0.5 text-[16px]" :class="account.netPnl >= 0 ? 'text-bull-strong' : 'text-bear-strong'">
          {{ formatMoney(account.netPnl, { signed: true }) }}
        </p>
      </div>
    </div>

    <ExecutionSummary
      :executions="executions"
      :precision="scenario.instrument.pricePrecision"
      @focus="emit('focus', $event)"
    />

    <div v-if="grade" class="space-y-2">
      <div v-for="part in grade.parts" :key="part.id" class="space-y-1">
        <div class="flex items-center justify-between text-[10.5px] text-ink-2">
          <span>{{ t(`review.parts.${part.id}`) }}</span>
          <span class="num text-ink-3">{{ part.points }}/{{ part.max }}</span>
        </div>
        <div class="h-1 overflow-hidden rounded-pill bg-ink/[0.07]">
          <div class="h-full rounded-pill bg-clay/80" :style="{ width: `${(part.points / part.max) * 100}%` }" />
        </div>
      </div>
    </div>

    <div v-if="grade?.notes.length" class="space-y-1.5">
      <p class="label-micro">{{ t('review.coach') }}</p>
      <ul class="space-y-1">
        <li
          v-for="(note, index) in grade.notes"
          :key="`${note.code}-${index}`"
          class="flex items-start gap-1.5 text-[11px] leading-snug"
        >
          <component :is="noteIcon(note)" class="mt-0.5 size-3 shrink-0" :class="noteTone(note)" aria-hidden="true" />
          <span class="text-ink-2">{{ t(note.code, note.params ?? {}) }}</span>
        </li>
      </ul>
    </div>

    <div v-else class="rounded-md border border-line bg-sunken p-3 text-[11.5px] leading-relaxed text-ink-2">
      {{ t('review.noPlan') }}
    </div>

    <div
      class="grid grid-cols-2 gap-x-3 gap-y-1 border-t-[length:var(--hairline)] border-line pt-3 font-mono text-[11px]"
    >
      <span class="text-ink-3">{{ t('review.fees') }}</span
      ><span class="text-right">{{ formatMoney(account.fees) }}</span>
      <span class="text-ink-3">{{ t('review.trades') }}</span
      ><span class="text-right">{{ account.trades.length }}</span> <span class="text-ink-3">{{ t('review.exit') }}</span
      ><span class="text-right">{{
        account.trades[0]?.exitReason ? t(`review.exits.${account.trades[0].exitReason}`) : '—'
      }}</span>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button variant="secondary" size="md" @click="emit('replay')">
        <RotateCcw class="size-3.5" aria-hidden="true" />
        {{ t('review.replay') }}
      </Button>
      <Button v-if="!isLast" variant="primary" size="md" block @click="emit('next')">
        {{ t('review.nextRound') }}
        <ArrowRight class="size-3.5" aria-hidden="true" />
      </Button>
      <Button v-else variant="primary" size="md" block @click="emit('end')">{{ t('review.finishSession') }}</Button>
    </div>
  </div>
</template>
