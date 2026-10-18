<script setup lang="ts">
import { ArrowRight, Check, Copy, Flag, RefreshCw, X } from '@lucide/vue'
import type { DrillGrade, GradeNote } from '~/domain/drill/grade'
import type { DrillPlan, PlanOutcome } from '~/domain/drill/plan'
import type { Scenario } from '~/domain/market/types'

const props = defineProps<{
  grade: DrillGrade
  outcome: PlanOutcome
  scenario: Scenario
  plan: DrillPlan
  seed: string
}>()

const emit = defineEmits<{ next: [] }>()

const { t, locale } = useI18n()
const copied = ref(false)

const gradeTone = computed(() => {
  const letter = props.grade.letter
  if (letter === 'A' || letter === 'B') return 'border-bull/40 bg-bull-soft text-bull-strong'
  if (letter === 'C') return 'border-clay/40 bg-clay-soft text-clay-ink'
  if (letter === 'D') return 'border-warn/40 bg-warn-soft text-warn'
  return 'border-danger/40 bg-danger-soft text-danger'
})

const dateLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }).format(
    new Date(props.scenario.sessionDate),
  ),
)

const outcomeTone = computed(() => {
  const r = props.outcome.rMultiple ?? 0
  return r > 0 ? 'text-bull-strong' : r < 0 ? 'text-bear-strong' : 'text-ink'
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

async function copySeed() {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/drill?seed=${encodeURIComponent(props.seed)}`)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="label-micro">{{ t('drill.resultKicker') }}</p>
        <h3 class="mt-1 text-[17px] font-semibold tracking-tight">{{ t('drill.resultTitle') }}</h3>
      </div>
      <div class="grid size-14 shrink-0 place-items-center rounded-full border" :class="gradeTone">
        <span class="serif text-[22px] font-medium leading-none">{{ grade.letter }}</span>
      </div>
    </div>

    <div class="rounded-md border border-line bg-sunken p-3">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
        <span class="font-mono font-medium">{{ scenario.instrument.symbol }}</span>
        <span class="text-ink-3">{{ scenario.instrument.name }}</span>
        <span class="text-ink-3">·</span>
        <span class="num text-ink-2">{{ dateLabel }}</span>
      </div>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        <Badge variant="clay">{{ t(`read.states.${scenario.regime}`) }}</Badge>
        <Badge variant="neutral">{{ scenario.timeframeMinutes }}m</Badge>
        <Badge variant="neutral">{{ t('drill.waited', { bars: plan.waitedBars }) }}</Badge>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-2">
      <div class="rounded-md border border-line p-2">
        <p class="label-micro">{{ t('review.process') }}</p>
        <p class="num mt-0.5 text-[16px]">{{ grade.total }}<span class="text-[10px] text-ink-3">/100</span></p>
      </div>
      <div class="rounded-md border border-line p-2">
        <p class="label-micro">{{ t('review.outcome') }}</p>
        <p class="num mt-0.5 text-[16px]" :class="outcomeTone">
          {{ outcome.filled ? formatR(outcome.rMultiple) : t('review.noFill') }}
        </p>
      </div>
      <div class="rounded-md border border-line p-2">
        <p class="label-micro">{{ t('drill.plan') }}</p>
        <p class="num mt-0.5 text-[16px]">
          {{
            plan.direction === 'none'
              ? t('read.noTrade')
              : plan.direction === 'long'
                ? t('ticket.long')
                : t('ticket.short')
          }}
        </p>
      </div>
    </div>

    <div class="rounded-md border border-line bg-sunken p-3 font-mono text-[10.5px] text-ink-2">
      <div class="flex justify-between py-0.5">
        <span class="text-ink-3">{{ t('drill.entry') }}</span>
        <span>{{ plan.entry == null ? '—' : formatPrice(plan.entry, scenario.instrument.pricePrecision) }}</span>
      </div>
      <div class="flex justify-between py-0.5">
        <span class="text-ink-3">{{ t('drill.stop') }}</span>
        <span class="text-bear-strong">{{
          plan.stop == null ? '—' : formatPrice(plan.stop, scenario.instrument.pricePrecision)
        }}</span>
      </div>
      <div class="flex justify-between py-0.5">
        <span class="text-ink-3">{{ t('drill.target') }}</span>
        <span class="text-bull-strong">{{
          plan.target == null ? '—' : formatPrice(plan.target, scenario.instrument.pricePrecision)
        }}</span>
      </div>
      <div class="mt-1.5 flex justify-between border-t-[length:var(--hairline)] border-line pt-1.5">
        <span class="text-ink-3">{{ t('drill.barsToEntry') }}</span>
        <span>{{ outcome.barsToEntry }}</span>
      </div>
      <div v-if="outcome.filled" class="flex justify-between py-0.5">
        <span class="text-ink-3">{{ t('drill.held') }}</span>
        <span>{{ outcome.barsHeld }}</span>
      </div>
    </div>

    <div class="space-y-2">
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

    <div class="space-y-1.5">
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

    <div class="flex gap-2 border-t-[length:var(--hairline)] border-line pt-3">
      <Button variant="secondary" size="md" @click="copySeed">
        <Copy v-if="!copied" class="size-3.5" aria-hidden="true" />
        <Check v-else class="size-3.5" aria-hidden="true" />
        {{ copied ? t('drill.copied') : t('drill.share') }}
      </Button>
      <Button variant="primary" size="md" block @click="emit('next')">
        <RefreshCw class="size-3.5" aria-hidden="true" />
        {{ t('drill.next') }}
      </Button>
    </div>
    <NuxtLink to="/stats" class="block text-center text-[10.5px] text-ink-3 hover:text-ink-2">
      {{ t('summary.viewStats') }}
      <ArrowRight class="ml-0.5 inline size-3 align-[-2px]" aria-hidden="true" />
    </NuxtLink>
  </div>
</template>
