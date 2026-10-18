<script setup lang="ts">
import { createRules } from '~/domain/trading/types'
import { instruments } from '~/domain/instruments/catalog'
import {
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  Crosshair,
  Play,
  ScanLine,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
} from '@lucide/vue'

useHead({ title: 'Blind replay trainer' })

const { t, locale } = useI18n()
const settings = useSettingsStore()
const history = useHistoryStore()
const rules = computed(() =>
  createRules({
    preset: settings.settings.accountPreset,
    accountSize: settings.settings.accountSize,
    maxContracts: settings.settings.maxContracts,
  }),
)

const todayKey = computed(() => {
  const now = new Date()
  return `daily-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
})
const todayLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(),
  ),
)
const dailyDone = computed(() => history.sessions.some((session) => session.id === `drill-${todayKey.value}`))

const recent = computed(() => history.sessions.slice(0, 3))
const stats = computed(() => history.stats)
const sparkline = computed(() => stats.value.equityCurve.map((point) => point.cumulative))

const steps = computed(() => [
  { icon: ScanLine, title: t('lobby.how.read.title'), body: t('lobby.how.read.body') },
  { icon: Crosshair, title: t('lobby.how.plan.title'), body: t('lobby.how.plan.body') },
  { icon: Play, title: t('lobby.how.run.title'), body: t('lobby.how.run.body') },
  { icon: ClipboardCheck, title: t('lobby.how.review.title'), body: t('lobby.how.review.body') },
])

const ruleCards = computed(() => [
  {
    kind: 'drawdown' as const,
    title: t('lobby.rules.drawdown.title'),
    body: t('lobby.rules.drawdown.body', { pct: percentOf(rules.value.maxDrawdown) }),
    icon: TrendingDown,
  },
  {
    kind: 'daily' as const,
    title: t('lobby.rules.daily.title'),
    body: t('lobby.rules.daily.body', { pct: percentOf(rules.value.dailyLossLimit) }),
    icon: ShieldAlert,
  },
  {
    kind: 'target' as const,
    title: t('lobby.rules.target.title'),
    body: t('lobby.rules.target.body', { pct: percentOf(rules.value.profitTarget) }),
    icon: Target,
  },
])

const microStats = computed(() => [
  t('lobby.stats.instruments', { count: instruments.list().length }),
  t('lobby.stats.rounds'),
  t('lobby.stats.timeframe'),
  t('lobby.stats.zero'),
])

function percentOf(value: number) {
  return Math.round((value / settings.settings.accountSize) * 1000) / 10
}

function toggleInstrument(symbol: string) {
  const current = settings.settings.instruments
  const next = current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol]
  if (next.length < 1) return
  settings.update({ instruments: next })
}

onMounted(() => {
  settings.hydrate()
  history.hydrate()
})
</script>

<template>
  <div>
    <section class="relative overflow-hidden">
      <div class="pointer-events-none absolute inset-x-0 top-0 h-[520px] mesh-glow opacity-80" aria-hidden="true" />
      <div
        class="pointer-events-none absolute inset-0 dot-grid opacity-[0.35] [mask-image:linear-gradient(to_bottom,black,transparent_65%)]"
        aria-hidden="true"
      />

      <div
        class="relative mx-auto grid max-w-[1480px] gap-10 px-4 pb-14 pt-12 md:px-8 lg:grid-cols-12 lg:gap-8 lg:pb-20 lg:pt-16"
      >
        <div class="stagger lg:col-span-6 lg:pr-6">
          <p class="label-micro flex items-center gap-2">
            <span class="size-1.5 rounded-full bg-clay" aria-hidden="true" />
            {{ t('lobby.eyebrow') }}
          </p>

          <h1 class="serif mt-5 text-[clamp(2.7rem,5.2vw,4.5rem)] font-medium leading-[0.98] tracking-[-0.035em]">
            {{ t('lobby.headline.line1') }}<br />
            <span class="text-ink-3">{{ t('lobby.headline.line2') }}</span>
          </h1>

          <p class="mt-5 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
            {{ t('lobby.subcopy') }}
          </p>

          <div class="mt-7 flex flex-wrap items-center gap-2.5">
            <NuxtLink to="/trainer">
              <Button variant="primary" size="lg">
                {{ t('lobby.cta.start') }}
                <ArrowRight class="size-4" aria-hidden="true" />
              </Button>
            </NuxtLink>
            <NuxtLink to="/guide">
              <Button variant="secondary" size="lg">{{ t('lobby.cta.guide') }}</Button>
            </NuxtLink>
          </div>

          <div class="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10.5px] text-ink-3">
            <template v-for="(stat, index) in microStats" :key="stat">
              <span class="flex items-center gap-1.5">
                <span class="size-1 rounded-full bg-clay/60" aria-hidden="true" />
                {{ stat }}
              </span>
              <span
                v-if="index < microStats.length - 1"
                class="hidden h-2.5 w-[length:var(--hairline)] bg-line sm:block"
                aria-hidden="true"
              />
            </template>
          </div>
        </div>

        <div class="relative lg:col-span-6">
          <div
            class="absolute -inset-x-6 -inset-y-6 animate-[breathe_7s_ease-in-out_infinite] rounded-[32px] bg-clay/[0.07] blur-2xl"
            aria-hidden="true"
          />
          <HeroChart class="relative" />
          <div
            class="absolute -bottom-4 -left-3 hidden items-center gap-2 rounded-lg border-[length:var(--hairline)] border-line bg-surface-2/95 px-3 py-2 shadow-md backdrop-blur sm:flex"
          >
            <span class="grid size-6 place-items-center rounded-full bg-clay-soft text-clay-ink">
              <TrendingUp class="size-3" aria-hidden="true" />
            </span>
            <div>
              <p class="text-[9.5px] uppercase tracking-[0.12em] text-ink-3">{{ t('lobby.preview.round') }}</p>
              <p class="num text-[11px] text-ink">03 / 20</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="mx-auto max-w-[1480px] space-y-14 px-4 pb-16 md:px-8">
      <section>
        <div class="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p class="label-micro">{{ t('lobby.universe.kicker') }}</p>
            <h2 class="mt-1 text-[18px] font-semibold tracking-tight">{{ t('lobby.universe.title') }}</h2>
          </div>
          <p class="max-w-[46ch] text-[11px] leading-relaxed text-ink-3">{{ t('lobby.universe.hint') }}</p>
        </div>
        <InstrumentRail :selected="settings.settings.instruments" @toggle="toggleInstrument" />
      </section>

      <section>
        <div class="mb-5 max-w-[52ch]">
          <p class="label-micro">{{ t('lobby.how.kicker') }}</p>
          <h2 class="serif mt-2 text-[26px] font-medium tracking-tight">{{ t('lobby.how.title') }}</h2>
        </div>
        <div
          class="grid gap-px overflow-hidden rounded-xl border-[length:var(--hairline)] border-line bg-line sm:grid-cols-2 lg:grid-cols-4"
        >
          <article
            v-for="(step, index) in steps"
            :key="step.title"
            class="group bg-surface-2 p-5 transition-colors hover:bg-surface-1"
          >
            <div class="flex items-center justify-between">
              <span class="num text-[10px] text-ink-3">0{{ index + 1 }}</span>
              <component
                :is="step.icon"
                class="size-4 text-clay transition-transform duration-300 group-hover:-translate-y-0.5"
                :stroke-width="1.6"
                aria-hidden="true"
              />
            </div>
            <h3 class="mt-6 text-[13.5px] font-semibold">{{ step.title }}</h3>
            <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">{{ step.body }}</p>
          </article>
        </div>
      </section>

      <section>
        <div class="mb-5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p class="label-micro">{{ t('lobby.rules.kicker') }}</p>
            <h2 class="serif mt-2 text-[26px] font-medium tracking-tight">{{ t('lobby.rules.title') }}</h2>
          </div>
          <p class="max-w-[42ch] text-[11px] leading-relaxed text-ink-3">{{ t('lobby.rules.subtitle') }}</p>
        </div>
        <div class="grid gap-3 md:grid-cols-3">
          <article v-for="card in ruleCards" :key="card.kind" class="panel panel-hover group p-4">
            <div class="flex items-center justify-between">
              <component :is="card.icon" class="size-4 text-ink-3" :stroke-width="1.6" aria-hidden="true" />
              <Badge variant="neutral" size="sm">{{
                t('lobby.rules.onAccount', { size: formatMoney(settings.settings.accountSize, { decimals: 0 }) })
              }}</Badge>
            </div>
            <RuleDiagram :kind="card.kind" class="mt-4" />
            <h3 class="mt-3 text-[13px] font-semibold">{{ card.title }}</h3>
            <p class="mt-1 text-[11.5px] leading-relaxed text-ink-3">{{ card.body }}</p>
          </article>
        </div>
      </section>

      <section
        class="relative overflow-hidden rounded-xl border-[length:var(--hairline)] border-clay/25 bg-clay-soft/70 p-5 sm:p-6"
      >
        <div
          class="pointer-events-none absolute -right-10 -top-14 size-48 rounded-full bg-clay/10 blur-2xl"
          aria-hidden="true"
        />
        <div class="relative flex flex-wrap items-center gap-4">
          <div class="grid size-11 shrink-0 place-items-center rounded-lg bg-surface-2 text-clay shadow-xs">
            <CalendarDays class="size-5" :stroke-width="1.7" aria-hidden="true" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 text-[10px] uppercase tracking-[0.13em] text-clay-ink">
              {{ t('lobby.daily.kicker') }} · <span class="num">{{ todayLabel }}</span>
            </p>
            <h3 class="mt-1 text-[15px] font-semibold tracking-tight">{{ t('lobby.daily.title') }}</h3>
            <p class="mt-1 max-w-[62ch] text-[11.5px] leading-relaxed text-ink-2">{{ t('lobby.daily.body') }}</p>
          </div>
          <NuxtLink :to="dailyDone ? '/daily' : `/drill?seed=${todayKey}&mode=daily`">
            <Button :variant="dailyDone ? 'secondary' : 'primary'" size="md">
              {{ dailyDone ? t('lobby.daily.view') : t('lobby.daily.play') }}
              <ArrowRight class="size-3.5" aria-hidden="true" />
            </Button>
          </NuxtLink>
        </div>
      </section>

      <section class="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div class="panel p-5">
          <div class="flex items-start justify-between">
            <div>
              <p class="label-micro">{{ t('lobby.recent.kicker') }}</p>
              <h2 class="mt-1 text-[16px] font-semibold tracking-tight">{{ t('lobby.recent.title') }}</h2>
            </div>
            <NuxtLink to="/stats" class="text-[10.5px] text-ink-3 transition-colors hover:text-ink"
              >{{ t('lobby.recent.all') }} →</NuxtLink
            >
          </div>

          <div v-if="recent.length" class="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <div class="space-y-2">
              <div
                v-for="session in recent"
                :key="session.id"
                class="flex items-center justify-between rounded-md border border-line px-3 py-2"
              >
                <div class="min-w-0">
                  <p class="text-[11.5px] font-medium">{{ t(`modes.${session.mode}`) }}</p>
                  <p class="text-[10px] text-ink-3">
                    {{ formatDate(session.startedAt, locale) }} · {{ session.rounds.length }}
                    {{ t('lobby.recent.rounds') }}
                  </p>
                </div>
                <span
                  class="num text-[12px]"
                  :class="
                    session.netPnl > 0 ? 'text-bull-strong' : session.netPnl < 0 ? 'text-bear-strong' : 'text-ink-3'
                  "
                >
                  {{
                    session.netPnl
                      ? formatMoney(session.netPnl, { signed: true })
                      : `${session.rounds[0]?.processScore ?? '—'}/100`
                  }}
                </span>
              </div>
            </div>
            <div class="flex flex-col items-end justify-between gap-2">
              <Sparkline :data="sparkline.length > 1 ? sparkline : [0, 0]" :width="148" :height="52" tone="auto" />
              <div class="text-right">
                <p class="label-micro">{{ t('lobby.recent.net') }}</p>
                <p class="num text-[15px]" :class="stats.netPnl >= 0 ? 'text-bull-strong' : 'text-bear-strong'">
                  {{ formatMoney(stats.netPnl, { signed: true }) }}
                </p>
              </div>
            </div>
          </div>

          <div v-else class="mt-5 flex flex-wrap items-center gap-3">
            <p class="max-w-[42ch] text-[11.5px] leading-relaxed text-ink-3">{{ t('lobby.recent.empty') }}</p>
            <NuxtLink to="/trainer">
              <Button variant="secondary" size="sm">{{ t('lobby.recent.start') }}</Button>
            </NuxtLink>
          </div>
        </div>

        <div class="panel flex flex-col justify-between gap-4 p-5">
          <div>
            <p class="label-micro">{{ t('lobby.discipline.kicker') }}</p>
            <h2 class="serif mt-2 text-[22px] font-medium leading-tight tracking-tight">
              {{ t('lobby.discipline.title') }}
            </h2>
            <p class="mt-2 text-[11.5px] leading-relaxed text-ink-3">{{ t('lobby.discipline.body') }}</p>
          </div>
          <div class="flex items-end justify-between border-t-[length:var(--hairline)] border-line pt-3">
            <div>
              <p class="label-micro">{{ t('lobby.discipline.plan') }}</p>
              <p class="num text-[16px]">{{ stats.followedPlanRate == null ? '—' : `${stats.followedPlanRate}%` }}</p>
            </div>
            <div class="text-right">
              <p class="label-micro">{{ t('lobby.discipline.avgR') }}</p>
              <p class="num text-[16px]">{{ formatR(stats.avgR) }}</p>
            </div>
          </div>
        </div>
      </section>
    </div>

    <footer class="border-t-[length:var(--hairline)] border-line bg-surface-0">
      <div class="mx-auto flex max-w-[1480px] flex-wrap items-center gap-3 px-4 py-6 text-[10.5px] text-ink-3 md:px-8">
        <p class="max-w-[60ch]">{{ t('lobby.footer.disclaimer') }}</p>
        <div class="ml-auto flex items-center gap-4">
          <span class="font-mono">v{{ $config.public.appVersion }}</span>
          <LocaleSwitcher variant="select" />
        </div>
      </div>
    </footer>
  </div>
</template>
