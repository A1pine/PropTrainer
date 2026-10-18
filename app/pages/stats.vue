<script setup lang="ts">
import { ArrowRight, Download, History, ShieldCheck, Target, TrendingUp } from '@lucide/vue'
import { aggregateTrades, filterTradesByDays } from '~/domain/stats/aggregate'

useHead({ title: 'Stats' })

const { t, locale } = useI18n()
const history = useHistoryStore()
const settings = useSettingsStore()

const range = ref<'7d' | '30d' | 'all'>('all')
const rangeOptions = computed(() => [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: 'all', label: t('statsPage.all') },
])

const days = computed(() => (range.value === '7d' ? 7 : range.value === '30d' ? 30 : 0))
const trades = computed(() => filterTradesByDays(history.trades, days.value))
const stats = computed(() => aggregateTrades(trades.value))

const sessions = computed(() => {
  if (!days.value) return history.sessions
  const cutoff = Date.now() - days.value * 24 * 60 * 60 * 1000
  return history.sessions.filter((session) => new Date(session.startedAt).getTime() >= cutoff)
})

const processRounds = computed(() =>
  sessions.value.flatMap((session) => session.rounds).filter((round) => round.processScore != null),
)
const avgProcess = computed(() =>
  processRounds.value.length
    ? Math.round(
        processRounds.value.reduce((total, round) => total + (round.processScore ?? 0), 0) / processRounds.value.length,
      )
    : null,
)
const breaches = computed(
  () => sessions.value.flatMap((session) => session.rounds).filter((round) => round.status === 'breached').length,
)
const totalRounds = computed(() => sessions.value.reduce((total, session) => total + session.rounds.length, 0))

const kpis = computed(() => [
  {
    label: t('statsPage.kpi.sessions'),
    value: sessions.value.length,
    format: 'int' as const,
    hint: t('statsPage.kpi.sessionsHint'),
  },
  {
    label: t('statsPage.kpi.rounds'),
    value: totalRounds.value,
    format: 'int' as const,
    hint: t('statsPage.kpi.roundsHint'),
  },
  {
    label: t('statsPage.kpi.winRate'),
    value: stats.value.winRate,
    format: 'percent' as const,
    hint: t('statsPage.kpi.winRateHint'),
  },
  {
    label: t('statsPage.kpi.avgR'),
    value: stats.value.avgR ?? 0,
    format: 'r' as const,
    hint: t('statsPage.kpi.avgRHint'),
    empty: stats.value.avgR == null,
  },
])

const distributionMax = computed(() => Math.max(1, ...stats.value.rDistribution.map((bucket) => bucket.count)))

const historyRows = computed(() =>
  [...sessions.value].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 8),
)

const isEmpty = computed(() => !history.sessions.length)

function exportJson() {
  const blob = new Blob([history.exportJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `prop-desk-history-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function roundGrade(sessionId: string) {
  const session = sessions.value.find((item) => item.id === sessionId)
  return session?.rounds.find((round) => round.processScore != null)?.grade ?? null
}

onMounted(() => {
  settings.hydrate()
  history.hydrate()
})
</script>

<template>
  <div class="mx-auto max-w-[1280px] px-4 py-8 md:px-8 md:py-10">
    <header class="flex flex-wrap items-end gap-3">
      <div>
        <p class="label-micro">{{ t('statsPage.kicker') }}</p>
        <h1 class="serif mt-2 text-[clamp(1.9rem,3.6vw,2.8rem)] font-medium tracking-tight">
          {{ t('statsPage.title') }}
        </h1>
        <p class="mt-2 max-w-[56ch] text-[12.5px] leading-relaxed text-ink-2">{{ t('statsPage.subtitle') }}</p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <SegmentedControl
          v-model="range"
          :options="rangeOptions"
          size="sm"
          :aria-label="t('statsPage.range')"
          class="w-[190px]"
        />
        <Button variant="secondary" size="sm" :disabled="isEmpty" @click="exportJson">
          <Download class="size-3.5" aria-hidden="true" />
          {{ t('statsPage.export') }}
        </Button>
      </div>
    </header>

    <div v-if="isEmpty" class="panel mt-8">
      <EmptyState :icon="History" :title="t('statsPage.empty.title')" :description="t('statsPage.empty.body')">
        <NuxtLink to="/trainer">
          <Button variant="primary" size="sm"
            >{{ t('statsPage.empty.cta') }}<ArrowRight class="size-3.5" aria-hidden="true"
          /></Button>
        </NuxtLink>
      </EmptyState>
    </div>

    <template v-else>
      <div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article v-for="kpi in kpis" :key="kpi.label" class="panel p-4">
          <p class="label-micro">{{ kpi.label }}</p>
          <p class="num mt-2 text-[26px] font-medium leading-none">
            <template v-if="kpi.empty">—</template>
            <template v-else-if="kpi.format === 'percent'"
              >{{ Number(kpi.value).toFixed(1) }}<span class="text-[12px] text-ink-3">%</span></template
            >
            <template v-else-if="kpi.format === 'r'">{{ formatR(Number(kpi.value)) }}</template>
            <template v-else>{{ kpi.value }}</template>
          </p>
          <p class="mt-2 text-[10px] text-ink-3">{{ kpi.hint }}</p>
        </article>
      </div>

      <div class="mt-3 grid gap-3 lg:grid-cols-[1.65fr_1fr]">
        <section class="panel p-4">
          <div class="mb-2 flex items-start justify-between">
            <div>
              <p class="label-micro">{{ t('statsPage.equity.title') }}</p>
              <p class="num mt-1 text-[20px]" :class="stats.netPnl >= 0 ? 'text-bull-strong' : 'text-bear-strong'">
                {{ formatMoney(stats.netPnl, { signed: true }) }}
              </p>
            </div>
            <div class="text-right">
              <p class="label-micro">{{ t('statsPage.equity.drawdown') }}</p>
              <p class="num mt-1 text-[13px] text-bear-strong">{{ formatMoney(stats.maxDrawdown) }}</p>
            </div>
          </div>
          <EquityCurve :points="stats.equityCurve" />
        </section>

        <section class="panel p-4">
          <p class="label-micro">{{ t('statsPage.process.title') }}</p>
          <div class="mt-3 flex items-center gap-4">
            <ProgressRing :percent="avgProcess ?? 0" :size="72" :stroke-width="5">
              <span class="num text-[20px] font-medium">{{ avgProcess ?? '—' }}</span>
            </ProgressRing>
            <div class="min-w-0">
              <p class="text-[11.5px] font-medium">{{ t('statsPage.process.score') }}</p>
              <p class="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">{{ t('statsPage.process.scoreBody') }}</p>
            </div>
          </div>
          <dl class="mt-4 space-y-2.5 border-t-[length:var(--hairline)] border-line pt-3">
            <div class="flex items-center justify-between">
              <dt class="flex items-center gap-1.5 text-[11px] text-ink-2">
                <ShieldCheck class="size-3.5 text-ink-3" aria-hidden="true" />{{ t('statsPage.process.plan') }}
              </dt>
              <dd class="num text-[12px]">{{ stats.followedPlanRate == null ? '—' : `${stats.followedPlanRate}%` }}</dd>
            </div>
            <div class="flex items-center justify-between">
              <dt class="flex items-center gap-1.5 text-[11px] text-ink-2">
                <Target class="size-3.5 text-ink-3" aria-hidden="true" />{{ t('statsPage.process.breaches') }}
              </dt>
              <dd class="num text-[12px]" :class="breaches ? 'text-bear-strong' : ''">{{ breaches }}</dd>
            </div>
            <div class="flex items-center justify-between">
              <dt class="flex items-center gap-1.5 text-[11px] text-ink-2">
                <TrendingUp class="size-3.5 text-ink-3" aria-hidden="true" />{{ t('statsPage.process.profitFactor') }}
              </dt>
              <dd class="num text-[12px]">{{ stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2) }}</dd>
            </div>
            <div class="flex items-center justify-between">
              <dt class="text-[11px] text-ink-2">{{ t('statsPage.process.fees') }}</dt>
              <dd class="num text-[12px] text-ink-3">{{ formatMoney(stats.fees) }}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div class="mt-3 grid gap-3 lg:grid-cols-2">
        <section class="panel p-4">
          <div class="flex items-start justify-between">
            <div>
              <p class="label-micro">{{ t('statsPage.distribution.title') }}</p>
              <p class="mt-1 text-[10.5px] text-ink-3">
                {{ t('statsPage.distribution.body', { count: stats.count }) }}
              </p>
            </div>
            <Badge variant="neutral" size="sm">{{ t('statsPage.distribution.bucket') }}</Badge>
          </div>
          <div class="mt-5 flex h-[120px] items-end gap-1">
            <div
              v-for="bucket in stats.rDistribution"
              :key="bucket.label"
              class="group relative flex h-full flex-1 items-end"
              :title="`${bucket.label}R · ${bucket.count}`"
            >
              <div
                class="w-full rounded-t-xs transition-[height] duration-500"
                :class="bucket.from >= 0 ? 'bg-clay/75' : 'bg-bear/70'"
                :style="{
                  height: `${(bucket.count / distributionMax) * 100}%`,
                  minHeight: bucket.count ? '3px' : '1px',
                }"
              />
              <span
                class="num pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 text-[8.5px] text-ink-3 opacity-0 transition-opacity group-hover:opacity-100"
                >{{ bucket.count }}</span
              >
            </div>
          </div>
          <div class="mt-1 flex gap-1">
            <span
              v-for="bucket in stats.rDistribution"
              :key="bucket.label"
              class="flex-1 text-center font-mono text-[8px] text-ink-3"
              >{{ bucket.label }}</span
            >
          </div>
        </section>

        <section class="panel p-4">
          <div class="flex items-start justify-between">
            <p class="label-micro">{{ t('statsPage.instruments.title') }}</p>
            <span class="font-mono text-[10px] text-ink-3">{{ stats.byInstrument.length }}</span>
          </div>
          <table class="mt-3 w-full text-left">
            <thead>
              <tr class="text-[9.5px] uppercase tracking-wide text-ink-3">
                <th class="pb-1.5 font-medium">{{ t('statsPage.instruments.symbol') }}</th>
                <th class="pb-1.5 text-right font-medium">{{ t('statsPage.instruments.trades') }}</th>
                <th class="pb-1.5 text-right font-medium">{{ t('statsPage.instruments.win') }}</th>
                <th class="pb-1.5 text-right font-medium">{{ t('statsPage.instruments.avgR') }}</th>
                <th class="pb-1.5 text-right font-medium">{{ t('statsPage.instruments.netPnl') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in stats.byInstrument"
                :key="row.symbol"
                class="border-t-[length:var(--hairline)] border-line/70 text-[11px]"
              >
                <td class="py-2 font-mono font-medium">{{ row.symbol }}</td>
                <td class="py-2 text-right font-mono text-ink-2">{{ row.trades }}</td>
                <td class="py-2 text-right font-mono text-ink-2">{{ row.winRate.toFixed(1) }}%</td>
                <td
                  class="py-2 text-right font-mono"
                  :class="(row.avgR ?? 0) >= 0 ? 'text-bull-strong' : 'text-bear-strong'"
                >
                  {{ formatR(row.avgR) }}
                </td>
                <td
                  class="py-2 text-right font-mono"
                  :class="row.netPnl >= 0 ? 'text-bull-strong' : 'text-bear-strong'"
                >
                  {{ formatMoney(row.netPnl, { signed: true, decimals: 0 }) }}
                </td>
              </tr>
              <tr v-if="!stats.byInstrument.length">
                <td colspan="5" class="py-6 text-center text-[11px] text-ink-3">
                  {{ t('statsPage.instruments.empty') }}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <section class="panel mt-3 p-4">
        <div class="flex items-center justify-between">
          <p class="label-micro">{{ t('statsPage.history.title') }}</p>
          <span class="font-mono text-[10px] text-ink-3">{{ sessions.length }}</span>
        </div>
        <div class="mt-3 divide-y-[length:var(--hairline)] divide-line">
          <div v-for="session in historyRows" :key="session.id" class="flex flex-wrap items-center gap-3 py-2.5">
            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-2 text-[11.5px] font-medium">
                {{ t(`modes.${session.mode}`) }}
                <Badge v-if="roundGrade(session.id)" variant="outline" size="sm">{{ roundGrade(session.id) }}</Badge>
              </p>
              <p class="text-[10px] text-ink-3">
                {{ formatDate(session.startedAt, locale) }} ·
                {{ t('statsPage.history.rounds', { count: session.rounds.length }) }}
              </p>
            </div>
            <span class="font-mono text-[10.5px] text-ink-3">{{ session.rounds[0]?.symbol ?? '—' }}</span>
            <span
              class="num w-20 text-right text-[11.5px]"
              :class="session.netPnl >= 0 ? 'text-bull-strong' : 'text-bear-strong'"
            >
              {{ session.netPnl ? formatMoney(session.netPnl, { signed: true }) : '—' }}
            </span>
          </div>
          <p v-if="!historyRows.length" class="py-6 text-center text-[11px] text-ink-3">
            {{ t('statsPage.history.empty') }}
          </p>
        </div>
      </section>
    </template>
  </div>
</template>
