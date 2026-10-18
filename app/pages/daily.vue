<script setup lang="ts">
import { ArrowRight, CalendarCheck, Clock3, Lock, Sparkles, Trophy } from '@lucide/vue'
import { createScenarioFactory } from '~/domain/market/scenario'
import { dailyScenarioNow, dailySeed } from '~/domain/market/daily'
import { buildReferenceResults } from '~/domain/drill/reference'
import { instruments } from '~/domain/instruments/catalog'
import { createRules } from '~/domain/trading/types'

useHead({ title: 'Daily challenge' })

const { t, locale } = useI18n()
const settings = useSettingsStore()
const history = useHistoryStore()

const now = new Date()
const todayKey = dailySeed(now)
const todayLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(now)

const mySession = computed(() => history.sessions.find((session) => session.id === `drill-${todayKey}`))
const myRound = computed(() => mySession.value?.rounds[0] ?? null)

const scenario = createScenarioFactory({
  universe: instruments.list(),
  now: dailyScenarioNow(todayKey),
}).createFromSeed(todayKey)

const rules = computed(() =>
  createRules({
    preset: settings.settings.accountPreset,
    accountSize: settings.settings.accountSize,
    maxContracts: settings.settings.maxContracts,
  }),
)

const benchmarks = computed(() =>
  buildReferenceResults(scenario, {
    riskBudget: (settings.settings.accountSize * settings.settings.riskPerTrade) / 100,
    maxContracts: rules.value.maxContracts,
  }).sort((a, b) => b.grade.total - a.grade.total),
)

const dayHistory = computed(() => {
  const days: { key: string; graded: boolean; score: number | null; grade: string | null }[] = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now)
    date.setUTCDate(date.getUTCDate() - offset)
    const key = dailySeed(date)
    const session = history.sessions.find((item) => item.id === `drill-${key}`)
    const round = session?.rounds[0]
    days.push({ key, graded: Boolean(session), score: round?.processScore ?? null, grade: round?.grade ?? null })
  }
  return days
})

const locked = computed(() => !myRound.value)

const dateLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }).format(
    new Date(scenario.sessionDate),
  ),
)

onMounted(() => {
  settings.hydrate()
  history.hydrate()
})
</script>

<template>
  <div class="mx-auto max-w-[1280px] px-4 py-8 md:px-8 md:py-10">
    <header class="flex flex-wrap items-end gap-3">
      <div>
        <p class="label-micro flex items-center gap-2">
          <CalendarCheck class="size-3.5 text-clay" aria-hidden="true" />
          {{ t('daily.kicker') }}
        </p>
        <h1 class="serif mt-2 text-[clamp(1.9rem,3.6vw,2.8rem)] font-medium tracking-tight">{{ t('daily.title') }}</h1>
        <p class="mt-2 max-w-[60ch] text-[12.5px] leading-relaxed text-ink-2">{{ t('daily.subtitle') }}</p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <Badge variant="outline">{{ todayLabel }}</Badge>
        <Badge :variant="locked ? 'clay' : 'bull'" dot>{{ locked ? t('daily.locked') : t('daily.revealed') }}</Badge>
      </div>
    </header>

    <div class="mt-6 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <section class="relative overflow-hidden rounded-xl border-[length:var(--hairline)] border-line bg-surface-2">
        <div class="pointer-events-none absolute inset-0 dot-grid opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" aria-hidden="true" />

        <div v-if="locked" class="relative p-6 sm:p-8">
          <div class="flex items-center gap-2">
            <span class="grid size-9 place-items-center rounded-lg border border-line bg-surface-2 text-ink-3">
              <Lock class="size-4" aria-hidden="true" />
            </span>
            <div>
              <p class="text-[12px] font-medium">{{ t('daily.sealed') }}</p>
              <p class="font-mono text-[10.5px] text-ink-3">M??? · 5m · DAY ??</p>
            </div>
          </div>

          <h2 class="serif mt-8 max-w-[24ch] text-[30px] leading-[1.05] tracking-tight">{{ t('daily.lockTitle') }}</h2>
          <p class="mt-3 max-w-[48ch] text-[12px] leading-relaxed text-ink-3">{{ t('daily.lockBody') }}</p>

          <div class="mt-6 flex flex-wrap items-center gap-2">
            <NuxtLink :to="`/drill?seed=${todayKey}&mode=daily`">
              <Button variant="primary" size="lg">
                {{ t('daily.play') }}
                <ArrowRight class="size-4" aria-hidden="true" />
              </Button>
            </NuxtLink>
            <span class="flex items-center gap-1.5 text-[10.5px] text-ink-3">
              <Clock3 class="size-3" aria-hidden="true" />
              {{ t('daily.lockNote') }}
            </span>
          </div>

          <div class="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
            <div class="bg-surface-2 px-3 py-3">
              <p class="label-micro">{{ t('daily.stats.sample') }}</p>
              <p class="num mt-1 text-[12px]">{{ scenario.candles.length - scenario.replayStart }} bars</p>
            </div>
            <div class="bg-surface-2 px-3 py-3">
              <p class="label-micro">{{ t('daily.stats.players') }}</p>
              <p class="num mt-1 text-[12px]">{{ t('daily.stats.benchmarks', { count: benchmarks.length }) }}</p>
            </div>
            <div class="bg-surface-2 px-3 py-3">
              <p class="label-micro">{{ t('daily.stats.reset') }}</p>
              <p class="num mt-1 text-[12px]">00:00 UTC</p>
            </div>
          </div>
        </div>

        <div v-else class="relative p-5 sm:p-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="label-micro">{{ t('daily.yourResult') }}</p>
              <div class="mt-1 flex items-center gap-2">
                <span class="font-mono text-[13px] font-semibold">{{ myRound?.symbol }}</span>
                <span class="text-[11px] text-ink-3">{{ dateLabel }}</span>
                <Badge variant="clay">{{ t(`read.states.${myRound?.regime}`) }}</Badge>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <div class="text-right">
                <p class="label-micro">{{ t('review.process') }}</p>
                <p class="num text-[20px] font-medium">{{ myRound?.processScore ?? '—' }}<span class="text-[10px] text-ink-3">/100</span></p>
              </div>
              <div class="grid size-14 place-items-center rounded-full border border-clay/40 bg-clay-soft text-clay-ink">
                <span class="serif text-[22px]">{{ myRound?.grade ?? '—' }}</span>
              </div>
            </div>
          </div>

          <div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div class="rounded-md border border-line bg-sunken p-2.5">
              <p class="label-micro">{{ t('review.outcome') }}</p>
              <p class="num mt-1 text-[14px]" :class="(myRound?.rMultiple ?? 0) > 0 ? 'text-bull-strong' : (myRound?.rMultiple ?? 0) < 0 ? 'text-bear-strong' : 'text-ink'">{{ formatR(myRound?.rMultiple) }}</p>
            </div>
            <div class="rounded-md border border-line bg-sunken p-2.5">
              <p class="label-micro">{{ t('daily.stats.state') }}</p>
              <p class="mt-1 text-[12px]">{{ t(`read.states.${myRound?.regime}`) }}</p>
            </div>
            <div class="rounded-md border border-line bg-sunken p-2.5">
              <p class="label-micro">{{ t('daily.stats.bars') }}</p>
              <p class="num mt-1 text-[14px]">{{ scenario.candles.length - scenario.replayStart }}</p>
            </div>
            <div class="rounded-md border border-line bg-sunken p-2.5">
              <p class="label-micro">{{ t('daily.stats.submitted') }}</p>
              <p class="num mt-1 text-[12px]">{{ formatDate(mySession?.endedAt ?? myRound?.endedAt ?? now.toISOString(), locale) }}</p>
            </div>
          </div>

          <div class="mt-5">
            <div class="mb-2 flex items-center justify-between">
              <p class="label-micro flex items-center gap-1.5"><Trophy class="size-3.5 text-ink-3" aria-hidden="true" /> {{ t('daily.board') }}</p>
              <span class="text-[9.5px] text-ink-3">{{ t('daily.boardNote') }}</span>
            </div>
            <div class="overflow-hidden rounded-md border border-line">
              <div class="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b border-line bg-sunken px-3 py-1.5 text-[9.5px] uppercase tracking-wide text-ink-3">
                <span>{{ t('daily.benchmarks.plan') }}</span>
                <span class="text-right">{{ t('daily.benchmarks.direction') }}</span>
                <span class="text-right">R</span>
                <span class="w-9 text-right">{{ t('daily.benchmarks.grade') }}</span>
              </div>
              <div v-for="(row, index) in benchmarks" :key="row.id" class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-line/60 px-3 py-2 text-[11px] last:border-0">
                <span class="flex items-center gap-2">
                  <span class="num text-[9.5px] text-ink-3">{{ index + 1 }}</span>
                  {{ t(row.labelKey) }}
                </span>
                <span class="text-right font-mono text-[10.5px] text-ink-2">{{ row.plan.direction === 'none' ? t('read.noTrade') : row.plan.direction === 'long' ? t('ticket.long') : t('ticket.short') }}</span>
                <span class="text-right font-mono text-[10.5px]" :class="(row.outcome.rMultiple ?? 0) > 0 ? 'text-bull-strong' : (row.outcome.rMultiple ?? 0) < 0 ? 'text-bear-strong' : 'text-ink-3'">{{ row.outcome.filled ? formatR(row.outcome.rMultiple) : '—' }}</span>
                <span class="w-9 text-right"><Badge :variant="row.grade.letter === 'A' || row.grade.letter === 'B' ? 'bull' : row.grade.letter === 'C' ? 'clay' : 'warn'" size="sm">{{ row.grade.letter }}</Badge></span>
              </div>
            </div>
            <p class="mt-2 text-[9.5px] leading-relaxed text-ink-3">{{ t('daily.boardDisclaimer') }}</p>
          </div>

          <div class="mt-5 flex items-center gap-2 border-t border-line pt-4">
            <NuxtLink to="/stats"><Button variant="secondary" size="sm">{{ t('daily.viewStats') }}</Button></NuxtLink>
            <NuxtLink to="/drill"><Button variant="ghost" size="sm">{{ t('drill.next') }}<ArrowRight class="size-3.5" aria-hidden="true" /></Button></NuxtLink>
          </div>
        </div>
      </section>

      <aside class="space-y-4">
        <div class="panel p-5">
          <p class="label-micro">{{ t('daily.how.title') }}</p>
          <ol class="mt-3 space-y-3">
            <li class="flex gap-3">
              <span class="num text-[10px] text-clay">01</span>
              <p class="text-[11.5px] leading-relaxed text-ink-2">{{ t('daily.how.one') }}</p>
            </li>
            <li class="flex gap-3">
              <span class="num text-[10px] text-clay">02</span>
              <p class="text-[11.5px] leading-relaxed text-ink-2">{{ t('daily.how.two') }}</p>
            </li>
            <li class="flex gap-3">
              <span class="num text-[10px] text-clay">03</span>
              <p class="text-[11.5px] leading-relaxed text-ink-2">{{ t('daily.how.three') }}</p>
            </li>
          </ol>
          <div class="mt-4 flex items-start gap-2 rounded-md border border-line bg-sunken p-3">
            <Sparkles class="mt-0.5 size-3.5 shrink-0 text-clay" aria-hidden="true" />
            <p class="text-[10.5px] leading-relaxed text-ink-3">{{ t('daily.how.note') }}</p>
          </div>
        </div>

        <div class="panel p-5">
          <div class="flex items-center justify-between">
            <p class="label-micro">{{ t('daily.history.title') }}</p>
            <span class="num text-[10px] text-ink-3">{{ dayHistory.filter((day) => day.graded).length }} / 7</span>
          </div>
          <div class="mt-3 flex items-end justify-between gap-1.5">
            <div v-for="day in dayHistory" :key="day.key" class="flex flex-1 flex-col items-center gap-1">
              <div
                class="grid h-10 w-full place-items-center rounded-sm border text-[10px]"
                :class="day.graded ? 'border-clay/30 bg-clay-soft text-clay-ink' : 'border-line bg-sunken text-ink-3'"
                :title="day.key"
              >
                {{ day.graded ? day.grade : '·' }}
              </div>
              <span class="font-mono text-[8.5px] text-ink-3">{{ day.key.slice(-2) }}</span>
            </div>
          </div>
          <p class="mt-3 text-[10px] leading-relaxed text-ink-3">{{ t('daily.history.note') }}</p>
        </div>
      </aside>
    </div>
  </div>
</template>
