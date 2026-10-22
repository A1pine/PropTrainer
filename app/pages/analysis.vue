<script setup lang="ts">
import { ArrowRight, Eye, Gauge, Layers, Pause, Play, RefreshCw, SkipForward, TriangleAlert } from '@lucide/vue'
import { wasmArtifactVersion } from '~/wasm/artifact'

const { t, locale } = useI18n()
const store = useAnalysisStore()
const config = useRuntimeConfig()
const wasmHref = `${(config.app.baseURL || '/').replace(/\/$/, '')}/wasm/prop_core.wasm?v=${wasmArtifactVersion}`

// Only this route needs the core at first paint, so the preload lives here
// instead of the global head: the browser starts the download while parsing
// HTML, in parallel with hydration, and the loader then hits the same URL.
useHead({
  title: 'Analysis lab',
  link: [{ rel: 'preload', href: wasmHref, as: 'fetch', crossorigin: 'anonymous', type: 'application/wasm' }],
})

const chart = ref<{ fit: () => void; zoom: (factor: number) => void } | null>(null)

const report = computed(() => store.report)
const bias = computed(() => report.value?.bias ?? null)
const instrument = computed(() => store.instrument)
const precision = computed(() => instrument.value?.pricePrecision ?? 2)

const tabs = computed(() => [
  { value: 'overview', label: t('analysis.tabs.overview') },
  { value: 'pa', label: t('analysis.tabs.pa') },
  { value: 'ict', label: t('analysis.tabs.ict') },
  { value: 'flow', label: t('analysis.tabs.flow') },
  { value: 'indicators', label: t('analysis.tabs.indicators') },
])

const overlayChips = computed(() => [
  { key: 'ema' as const, label: t('analysis.controls.ema') },
  { key: 'vwap' as const, label: t('analysis.controls.vwap') },
  { key: 'bb' as const, label: t('analysis.controls.bb') },
  { key: 'fvg' as const, label: t('analysis.controls.fvg') },
  { key: 'ob' as const, label: t('analysis.controls.ob') },
  { key: 'liquidity' as const, label: t('analysis.controls.liquidity') },
  { key: 'profile' as const, label: t('analysis.controls.profile') },
])

const speedOptions = [
  { value: '1', label: '0.5×' },
  { value: '2', label: '1×' },
  { value: '4', label: '2×' },
]
const speedModel = computed({
  get: () => String(store.speed),
  set: (value: string) => store.setSpeed(Number(value)),
})

const biasVariant = computed(() =>
  bias.value?.direction === 'bullish' ? 'bull' : bias.value?.direction === 'bearish' ? 'bear' : 'neutral',
)
const biasLabel = computed(() => (bias.value ? t(`analysis.bias.${bias.value.direction}`) : '—'))
const scorePosition = computed(() => ((bias.value?.score ?? 0) + 100) / 2)

const deltaValues = computed(() => {
  const series = report.value?.flow.delta ?? []
  return series.map((value) => value ?? 0).filter((_, index) => index % 2 === 0)
})

const bbWidth = computed(() => {
  const latest = report.value?.indicators.latest
  if (!latest?.bbUpper || !latest?.bbLower || !latest.price) return null
  return ((latest.bbUpper - latest.bbLower) / latest.price) * 100
})

const indicatorRows = computed(() => {
  const latest = report.value?.indicators.latest
  if (!latest) return []
  return [
    {
      label: t('analysis.indicators.ema20'),
      value: formatPrice(latest.ema20, precision.value),
      tone: latest.ema20 && latest.ema20 < latest.price ? 'bull' : 'bear',
    },
    {
      label: t('analysis.indicators.ema50'),
      value: formatPrice(latest.ema50, precision.value),
      tone: latest.ema50 && latest.ema50 < latest.price ? 'bull' : 'bear',
    },
    {
      label: t('analysis.indicators.ema200'),
      value: formatPrice(latest.ema200, precision.value),
      tone: latest.ema200 && latest.ema200 < latest.price ? 'bull' : 'bear',
    },
    {
      label: t('analysis.indicators.vwap'),
      value: formatPrice(latest.vwap, precision.value),
      tone: latest.vwap && latest.vwap < latest.price ? 'bull' : 'bear',
    },
    {
      label: t('analysis.indicators.rsi'),
      value: latest.rsi == null ? '—' : latest.rsi.toFixed(1),
      tone: (latest.rsi ?? 50) > 55 ? 'bull' : (latest.rsi ?? 50) < 45 ? 'bear' : 'flat',
    },
    {
      label: t('analysis.indicators.macd'),
      value: latest.macdHist == null ? '—' : latest.macdHist.toFixed(2),
      tone: (latest.macdHist ?? 0) > 0 ? 'bull' : (latest.macdHist ?? 0) < 0 ? 'bear' : 'flat',
    },
    { label: t('analysis.indicators.atr'), value: formatPrice(latest.atr, precision.value), tone: 'flat' },
    {
      label: t('analysis.indicators.adx'),
      value: latest.adx == null ? '—' : latest.adx.toFixed(1),
      tone: (latest.adx ?? 0) > 25 ? 'clay' : 'flat',
    },
    {
      label: t('analysis.indicators.bbWidth'),
      value: bbWidth.value == null ? '—' : `${bbWidth.value.toFixed(2)}%`,
      tone: 'flat',
    },
    {
      label: t('analysis.indicators.volumeSma'),
      value: latest.volumeSma == null ? '—' : formatNumber(latest.volumeSma, 0),
      tone: 'flat',
    },
  ]
})

const sessionDate = computed(() => {
  if (!store.sampleDate) return ''
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(store.sampleDate)
})

const zoneLabel = computed(() => (report.value ? t(`analysis.ict.zones.${report.value.ict.zone}`) : '—'))
const sessionLabel = computed(() => (report.value ? t(`analysis.ict.sessions.${report.value.ict.session}`) : '—'))

function reloadCore() {
  if (import.meta.client) window.location.reload()
}

function toneClass(tone: string) {
  if (tone === 'bull') return 'text-bull-strong'
  if (tone === 'bear') return 'text-bear-strong'
  if (tone === 'clay') return 'text-clay-ink'
  return 'text-ink-3'
}

const patternKinds = new Set(['bullishEngulfing', 'bearishEngulfing', 'bullishPin', 'bearishPin', 'doji', 'insideBar'])

function eventLabel(kind: string) {
  return patternKinds.has(kind) ? t(`analysis.patterns.${kind}`) : t(`analysis.events.${kind}`)
}

function directionVariant(direction: string) {
  return direction === 'bullish' ? 'bull' : direction === 'bearish' ? 'bear' : 'neutral'
}

function toggle(key: keyof typeof store.toggles) {
  store.toggles[key] = !store.toggles[key]
}

async function newSample() {
  if (!(await store.newSample())) return
  await nextTick()
  chart.value?.fit()
}

let disposed = false
onMounted(async () => {
  await Promise.all([store.scenario ? Promise.resolve() : store.start(), store.ensureCore()])
  if (disposed) return
  await nextTick()
  chart.value?.fit()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  disposed = true
  store.stopPlayback()
  window.removeEventListener('keydown', onKeydown)
})

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  if (event.code === 'Space') {
    event.preventDefault()
    store.togglePlayback()
  } else if (event.key.toLowerCase() === 'n') {
    event.preventDefault()
    store.step()
  }
}
</script>

<template>
  <div class="mx-auto max-w-[1480px] px-3 py-5 md:px-6 md:py-6">
    <header class="flex flex-wrap items-end gap-3">
      <div class="min-w-0">
        <p class="label-micro flex items-center gap-2">
          <Layers class="size-3.5 text-clay" aria-hidden="true" />
          {{ t('analysis.kicker') }}
        </p>
        <h1 class="serif mt-2 text-[clamp(1.9rem,3.4vw,2.7rem)] font-medium tracking-tight">
          {{ t('analysis.title') }}
        </h1>
        <p class="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-2">{{ t('analysis.subtitle') }}</p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <Badge variant="outline" class="font-mono"
          >{{ store.maskedSymbol }} · {{ store.scenario?.timeframeMinutes ?? 5 }}m</Badge
        >
        <Badge v-if="store.scenarioSource === 'local'" variant="bull" dot>{{
          t('settings.dataSource.localShort')
        }}</Badge>
        <Badge v-if="store.revealed" variant="bull" dot>{{ sessionDate }}</Badge>
        <Badge v-if="store.revealed && store.scenario?.dataset" variant="outline" class="font-mono">
          {{ store.scenario.dataset.sourceSymbol }}
        </Badge>
        <Badge v-else variant="neutral" dot>{{ t('analysis.sampleHidden') }}</Badge>
        <Button v-if="!store.revealed" variant="secondary" size="sm" @click="store.reveal()">
          <Eye class="size-3.5" aria-hidden="true" />
          {{ t('analysis.reveal') }}
        </Button>
        <Button variant="primary" size="sm" @click="newSample">
          <RefreshCw class="size-3.5" aria-hidden="true" />
          {{ t('analysis.newSample') }}
        </Button>
      </div>
    </header>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <div
        class="flex flex-wrap items-center gap-1 rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 p-1"
      >
        <button
          v-for="chip in overlayChips"
          :key="chip.key"
          type="button"
          class="rounded-sm px-2 py-1 text-[10.5px] transition-colors"
          :class="
            store.toggles[chip.key]
              ? 'bg-clay-soft font-medium text-clay-ink'
              : 'text-ink-3 hover:bg-ink/[0.04] hover:text-ink-2'
          "
          :aria-pressed="store.toggles[chip.key]"
          @click="toggle(chip.key)"
        >
          {{ chip.label }}
        </button>
      </div>

      <div class="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          class="grid size-8 place-items-center rounded-md border border-line bg-surface-2 text-ink-2 transition-colors hover:border-line-strong"
          :aria-label="store.playing ? t('analysis.pause') : t('analysis.play')"
          @click="store.togglePlayback()"
        >
          <Pause v-if="store.playing" class="size-3.5" fill="currentColor" aria-hidden="true" />
          <Play v-else class="size-3.5" fill="currentColor" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 text-[11px] text-ink-2 transition-colors hover:border-line-strong"
          @click="store.step()"
        >
          <SkipForward class="size-3" aria-hidden="true" />
          {{ t('analysis.nextBar') }}
          <Kbd :keys="['N']" />
        </button>
        <SegmentedControl
          v-model="speedModel"
          :options="speedOptions"
          size="sm"
          class="w-[150px]"
          :aria-label="t('analysis.speed')"
        />
        <span class="num ml-1 text-[10.5px] text-ink-3">{{ store.visibleCount }} / {{ store.maxVisible }}</span>
      </div>
    </div>

    <div class="mt-3 grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
      <section
        class="flex flex-col overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-surface-2"
      >
        <ChartCanvas
          ref="chart"
          :candles="store.candles"
          :visible-count="store.visibleCount"
          :analysis="store.overlay"
          :blind="false"
          :timeframe-minutes="store.scenario?.timeframeMinutes ?? 5"
          :price-precision="precision"
          :tick-size="instrument?.tickSize ?? 0.25"
          :symbol-mask="store.maskedSymbol"
          class="h-[440px] sm:h-[520px] xl:h-[600px]"
        />
        <div
          class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t-[length:var(--hairline)] border-line px-3 py-2 text-[9.5px] text-ink-3"
        >
          <span class="flex items-center gap-1"
            ><span class="h-[2px] w-4 bg-[var(--clay)]" aria-hidden="true" />EMA 20</span
          >
          <span class="flex items-center gap-1"
            ><span class="h-[2px] w-4 bg-[var(--bull)]" aria-hidden="true" />EMA 50</span
          >
          <span class="flex items-center gap-1"
            ><span class="h-[2px] w-4 bg-[var(--bear)]" aria-hidden="true" />EMA 200</span
          >
          <span class="flex items-center gap-1"
            ><span class="h-[2px] w-4 border-t border-dashed border-[var(--ink-3)]" aria-hidden="true" />VWAP</span
          >
          <span class="ml-auto">{{ t('analysis.chartNote') }}</span>
        </div>
      </section>

      <aside class="space-y-3">
        <div class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 p-4">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="label-micro flex items-center gap-1.5">
                <Gauge class="size-3.5 text-ink-3" aria-hidden="true" />{{ t('analysis.bias.title') }}
              </p>
              <div class="mt-2 flex items-baseline gap-2">
                <span class="serif text-[34px] font-medium leading-none">{{
                  bias?.score == null ? '—' : (bias.score > 0 ? '+' : '') + bias.score
                }}</span>
                <Badge :variant="biasVariant" dot>{{ biasLabel }}</Badge>
              </div>
            </div>
            <div class="text-right">
              <p class="label-micro">{{ t('analysis.bias.confidence') }}</p>
              <p class="num mt-1 text-[12px]">{{ bias?.confidence == null ? '—' : `${bias.confidence}%` }}</p>
            </div>
          </div>

          <div class="relative mt-4 h-1.5 rounded-pill bg-gradient-to-r from-bear/60 via-line to-bull/60">
            <span
              class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-2 bg-ink shadow-xs"
              :style="{ left: `${scorePosition}%` }"
            />
          </div>
          <div class="mt-1 flex justify-between text-[8.5px] uppercase tracking-wide text-ink-3">
            <span>{{ t('analysis.bias.bearish') }}</span>
            <span>{{ t('analysis.bias.neutral') }}</span>
            <span>{{ t('analysis.bias.bullish') }}</span>
          </div>

          <ul class="mt-4 space-y-1.5 border-t-[length:var(--hairline)] border-line pt-3">
            <li
              v-for="reason in bias?.reasons.slice(0, 5)"
              :key="reason.code"
              class="flex items-start gap-2 text-[10.5px] leading-snug"
            >
              <span
                class="num mt-0.5 w-7 shrink-0 text-right"
                :class="reason.points >= 0 ? 'text-bull-strong' : 'text-bear-strong'"
                >{{ reason.points > 0 ? '+' : '' }}{{ reason.points }}</span
              >
              <span class="text-ink-2">{{ t(`analysis.reasons.${reason.code}`, { value: reason.value }) }}</span>
            </li>
          </ul>
        </div>

        <div class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2">
          <div class="p-2">
            <SegmentedControl v-model="store.tab" :options="tabs" size="sm" :aria-label="t('analysis.tabs.label')" />
          </div>

          <div v-if="!report && !store.coreError" class="px-4 py-10 text-center">
            <Skeleton width="w-2/3" height="h-3" class="mx-auto" />
            <Skeleton width="w-1/2" height="h-3" class="mx-auto mt-2" />
            <p class="mt-3 text-[11px] text-ink-3">{{ t('analysis.loading') }}</p>
          </div>
          <div v-else-if="!report" class="px-4 py-10 text-center">
            <TriangleAlert class="mx-auto size-5 text-warn" aria-hidden="true" />
            <p class="mt-2 text-[11.5px] text-ink-2">{{ t('analysis.unavailable.title') }}</p>
            <p class="mt-1 text-[10px] text-ink-3">{{ t('analysis.unavailable.body') }}</p>
            <Button variant="secondary" size="sm" class="mt-3" @click="reloadCore">
              {{ t('analysis.unavailable.reload') }}
            </Button>
          </div>

          <div v-else class="max-h-[520px] overflow-y-auto px-4 pb-4">
            <template v-if="store.tab === 'overview'">
              <div class="space-y-2 py-3">
                <div class="flex items-center justify-between rounded-md border border-line px-3 py-2">
                  <div>
                    <p class="text-[11px] font-medium">{{ t('analysis.overview.trend') }}</p>
                    <p class="text-[10px] text-ink-3">
                      {{ t(`analysis.structure.${report.trend.structure}`) }} · {{ t('analysis.indicators.adx') }}
                      {{ report.trend.adx?.toFixed(1) ?? '—' }}
                    </p>
                  </div>
                  <Badge :variant="directionVariant(report.trend.direction)">{{
                    t(`analysis.bias.${report.trend.direction}`)
                  }}</Badge>
                </div>
                <div class="flex items-center justify-between rounded-md border border-line px-3 py-2">
                  <div>
                    <p class="text-[11px] font-medium">{{ t('analysis.overview.ict') }}</p>
                    <p class="text-[10px] text-ink-3">
                      {{ zoneLabel }} · {{ sessionLabel
                      }}<span v-if="report.ict.killzone"> · {{ t('analysis.ict.killzone') }}</span>
                    </p>
                  </div>
                  <Badge
                    :variant="
                      report.ict.zone === 'discount' ? 'bull' : report.ict.zone === 'premium' ? 'bear' : 'neutral'
                    "
                    >{{ t(`analysis.ict.zones.${report.ict.zone}`) }}</Badge
                  >
                </div>
                <div class="flex items-center justify-between rounded-md border border-line px-3 py-2">
                  <div>
                    <p class="text-[11px] font-medium">{{ t('analysis.overview.flow') }}</p>
                    <p class="text-[10px] text-ink-3">
                      {{ t('analysis.flow.pressure') }} {{ (report.flow.pressure * 100).toFixed(0) }}% ·
                      {{ t('analysis.flow.divergence') }}
                      {{
                        report.flow.divergence === 'none'
                          ? t('analysis.flow.none')
                          : t(`analysis.bias.${report.flow.divergence}`)
                      }}
                    </p>
                  </div>
                  <Badge
                    :variant="report.flow.pressure > 0.1 ? 'bull' : report.flow.pressure < -0.1 ? 'bear' : 'neutral'"
                    >{{ t('analysis.flow.proxy') }}</Badge
                  >
                </div>
              </div>

              <div class="border-t-[length:var(--hairline)] border-line pt-3">
                <p class="label-micro">{{ t('analysis.overview.levels') }}</p>
                <ul class="mt-2 space-y-1 font-mono text-[10.5px]">
                  <li class="flex justify-between">
                    <span class="text-ink-3">POC</span><span>{{ formatPrice(report.flow.poc, precision) }}</span>
                  </li>
                  <li class="flex justify-between">
                    <span class="text-ink-3">VAH</span><span>{{ formatPrice(report.flow.vah, precision) }}</span>
                  </li>
                  <li class="flex justify-between">
                    <span class="text-ink-3">VAL</span><span>{{ formatPrice(report.flow.val, precision) }}</span>
                  </li>
                  <li
                    v-for="level in report.ict.liquidity.slice(0, 3)"
                    :key="`${level.kind}-${level.index}`"
                    class="flex justify-between"
                  >
                    <span class="text-ink-3">{{ level.kind.toUpperCase() }} · {{ level.touches }}</span
                    ><span>{{ formatPrice(level.price, precision) }}</span>
                  </li>
                </ul>
              </div>

              <div class="mt-4 border-t-[length:var(--hairline)] border-line pt-3">
                <p class="label-micro">{{ t('analysis.overview.events') }}</p>
                <ul class="mt-2 space-y-1.5">
                  <li
                    v-for="event in report.events.slice(0, 6)"
                    :key="`${event.kind}-${event.index}`"
                    class="flex items-center gap-2 text-[10.5px]"
                  >
                    <span class="w-10 shrink-0 font-mono text-ink-3">#{{ event.index }}</span>
                    <span class="text-ink-2">{{ eventLabel(event.kind) }}</span>
                    <Badge :variant="directionVariant(event.direction)" size="sm" class="ml-auto">{{
                      formatPrice(event.price, precision)
                    }}</Badge>
                  </li>
                </ul>
              </div>
            </template>

            <template v-else-if="store.tab === 'pa'">
              <div class="grid grid-cols-2 gap-2 py-3">
                <div class="rounded-md border border-line p-2">
                  <p class="label-micro">{{ t('analysis.pa.structure') }}</p>
                  <p class="mt-1 text-[11px]">{{ t(`analysis.structure.${report.trend.structure}`) }}</p>
                </div>
                <div class="rounded-md border border-line p-2">
                  <p class="label-micro">{{ t('analysis.pa.ema') }}</p>
                  <p class="mt-1 text-[11px]">{{ t(`analysis.alignment.${report.trend.emaAlignment}`) }}</p>
                </div>
                <div class="rounded-md border border-line p-2">
                  <p class="label-micro">{{ t('analysis.pa.premium') }}</p>
                  <p class="num mt-1 text-[11px]">{{ report.trend.premiumDiscount }}%</p>
                </div>
                <div class="rounded-md border border-line p-2">
                  <p class="label-micro">{{ t('analysis.pa.range') }}</p>
                  <p class="num mt-1 text-[10px]">
                    {{ formatPrice(report.trend.rangeLow, precision) }} –
                    {{ formatPrice(report.trend.rangeHigh, precision) }}
                  </p>
                </div>
              </div>

              <div class="border-t-[length:var(--hairline)] border-line pt-3">
                <p class="label-micro">{{ t('analysis.pa.swings') }}</p>
                <ul class="mt-2 space-y-1 font-mono text-[10.5px]">
                  <li
                    v-for="swing in report.trend.swings.slice(0, 5)"
                    :key="`${swing.index}-${swing.kind}`"
                    class="flex items-center justify-between"
                  >
                    <span class="text-ink-3">#{{ swing.index }} · {{ swing.label }}</span>
                    <span>{{ formatPrice(swing.price, precision) }}</span>
                  </li>
                </ul>
              </div>

              <div class="mt-4 border-t-[length:var(--hairline)] border-line pt-3">
                <p class="label-micro">{{ t('analysis.pa.patterns') }}</p>
                <ul class="mt-2 space-y-1.5">
                  <li
                    v-for="pattern in report.pa.patterns.slice(0, 5)"
                    :key="`${pattern.index}-${pattern.kind}`"
                    class="flex items-center justify-between text-[10.5px]"
                  >
                    <span class="text-ink-2">{{ t(`analysis.patterns.${pattern.kind}`) }}</span>
                    <Badge :variant="directionVariant(pattern.direction)" size="sm">#{{ pattern.index }}</Badge>
                  </li>
                  <li v-if="!report.pa.patterns.length" class="text-[10.5px] text-ink-3">
                    {{ t('analysis.pa.noPatterns') }}
                  </li>
                </ul>
              </div>

              <div class="mt-4 border-t-[length:var(--hairline)] border-line pt-3">
                <p class="label-micro">{{ t('analysis.pa.levels') }}</p>
                <ul class="mt-2 space-y-1 font-mono text-[10.5px]">
                  <li
                    v-for="level in report.pa.levels.slice(0, 5)"
                    :key="`${level.lastIndex}-${level.price}`"
                    class="flex justify-between"
                  >
                    <span class="text-ink-3">{{ t(`analysis.levels.${level.kind}`) }} · {{ level.touches }}</span>
                    <span>{{ formatPrice(level.price, precision) }}</span>
                  </li>
                </ul>
              </div>
            </template>

            <template v-else-if="store.tab === 'ict'">
              <div class="flex flex-wrap gap-1.5 py-3">
                <Badge variant="clay">{{ zoneLabel }}</Badge>
                <Badge variant="neutral">{{ sessionLabel }}</Badge>
                <Badge :variant="report.ict.killzone ? 'bull' : 'neutral'">{{
                  report.ict.killzone ? t('analysis.ict.killzone') : t('analysis.ict.outsideKillzone')
                }}</Badge>
              </div>

              <div class="border-t-[length:var(--hairline)] border-line pt-3">
                <p class="label-micro">{{ t('analysis.ict.fvg') }}</p>
                <ul class="mt-2 space-y-1.5">
                  <li
                    v-for="gap in report.ict.fvgs.slice(0, 5)"
                    :key="`${gap.from}-${gap.direction}`"
                    class="rounded-md border border-line px-2 py-1.5 text-[10px]"
                  >
                    <div class="flex items-center justify-between">
                      <Badge :variant="gap.direction === 'bullish' ? 'bull' : 'bear'" size="sm">{{
                        t(`analysis.bias.${gap.direction}`)
                      }}</Badge>
                      <span class="font-mono text-ink-3"
                        >{{ formatPrice(gap.bottom, precision) }} – {{ formatPrice(gap.top, precision) }}</span
                      >
                    </div>
                    <p class="mt-1 text-ink-3">{{ t('analysis.ict.filled', { pct: Math.round(gap.filled * 100) }) }}</p>
                  </li>
                </ul>
              </div>

              <div class="mt-4 border-t-[length:var(--hairline)] border-line pt-3">
                <p class="label-micro">{{ t('analysis.ict.orderBlocks') }}</p>
                <ul class="mt-2 space-y-1 font-mono text-[10.5px]">
                  <li
                    v-for="block in report.ict.orderBlocks.slice(0, 5)"
                    :key="block.index"
                    class="flex justify-between"
                  >
                    <span :class="block.direction === 'bullish' ? 'text-bull-strong' : 'text-bear-strong'"
                      >#{{ block.index }} {{ t(`analysis.bias.${block.direction}`) }}</span
                    >
                    <span>{{ formatPrice(block.bottom, precision) }} – {{ formatPrice(block.top, precision) }}</span>
                  </li>
                </ul>
              </div>

              <div class="mt-4 border-t-[length:var(--hairline)] border-line pt-3">
                <p class="label-micro">{{ t('analysis.ict.liquidity') }}</p>
                <ul class="mt-2 space-y-1 font-mono text-[10.5px]">
                  <li
                    v-for="level in report.ict.liquidity"
                    :key="`${level.kind}-${level.index}`"
                    class="flex justify-between"
                  >
                    <span class="text-clay-ink">{{ level.kind.toUpperCase() }} · {{ level.touches }}</span>
                    <span>{{ formatPrice(level.price, precision) }}</span>
                  </li>
                </ul>
              </div>

              <div class="mt-4 border-t-[length:var(--hairline)] border-line pt-3">
                <p class="label-micro">{{ t('analysis.ict.sweeps') }}</p>
                <ul class="mt-2 space-y-1 text-[10.5px]">
                  <li v-for="sweep in report.ict.sweeps" :key="sweep.index" class="flex justify-between">
                    <span :class="sweep.direction === 'bullish' ? 'text-bull-strong' : 'text-bear-strong'"
                      >{{ t(`analysis.bias.${sweep.direction}`) }} · #{{ sweep.index }}</span
                    >
                    <span class="font-mono">{{ formatPrice(sweep.price, precision) }}</span>
                  </li>
                  <li v-if="!report.ict.sweeps.length" class="text-ink-3">{{ t('analysis.ict.noSweeps') }}</li>
                </ul>
              </div>
            </template>

            <template v-else-if="store.tab === 'flow'">
              <div class="space-y-3 py-3">
                <div>
                  <div class="flex justify-between text-[10.5px]">
                    <span class="text-ink-2">{{ t('analysis.flow.pressure') }}</span
                    ><span class="num">{{ (report.flow.pressure * 100).toFixed(0) }}%</span>
                  </div>
                  <div class="relative mt-1 h-1.5 rounded-pill bg-line">
                    <span class="absolute inset-y-0 left-1/2 w-px bg-ink/20" /><span
                      class="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-clay"
                      :style="{ left: `${((report.flow.pressure + 1) / 2) * 100}%` }"
                    />
                  </div>
                </div>
                <div>
                  <div class="flex justify-between text-[10.5px]">
                    <span class="text-ink-2">{{ t('analysis.flow.imbalance') }}</span
                    ><span class="num">{{ (report.flow.imbalance * 100).toFixed(0) }}%</span>
                  </div>
                  <div class="relative mt-1 h-1.5 rounded-pill bg-line">
                    <span class="absolute inset-y-0 left-1/2 w-px bg-ink/20" /><span
                      class="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-3"
                      :style="{ left: `${((report.flow.imbalance + 1) / 2) * 100}%` }"
                    />
                  </div>
                </div>
              </div>

              <div class="border-t-[length:var(--hairline)] border-line pt-3">
                <div class="flex items-center justify-between">
                  <p class="label-micro">{{ t('analysis.flow.cumDelta') }}</p>
                  <Badge :variant="directionVariant(report.flow.divergence)" size="sm">{{
                    report.flow.divergence === 'none'
                      ? t('analysis.flow.none')
                      : t(`analysis.bias.${report.flow.divergence}`)
                  }}</Badge>
                </div>
                <Sparkline
                  :data="deltaValues.length > 1 ? deltaValues : [0, 0]"
                  :width="340"
                  :height="72"
                  tone="auto"
                  class="mt-2 w-full"
                />
              </div>

              <div class="mt-3 grid grid-cols-3 gap-2 border-t-[length:var(--hairline)] border-line pt-3">
                <div>
                  <p class="label-micro">POC</p>
                  <p class="num text-[11px]">{{ formatPrice(report.flow.poc, precision) }}</p>
                </div>
                <div>
                  <p class="label-micro">VAH</p>
                  <p class="num text-[11px]">{{ formatPrice(report.flow.vah, precision) }}</p>
                </div>
                <div>
                  <p class="label-micro">VAL</p>
                  <p class="num text-[11px]">{{ formatPrice(report.flow.val, precision) }}</p>
                </div>
              </div>

              <div class="mt-4 border-t-[length:var(--hairline)] border-line pt-3">
                <p class="label-micro">{{ t('analysis.flow.absorption') }}</p>
                <ul class="mt-2 space-y-1 text-[10.5px]">
                  <li v-for="item in report.flow.absorptions" :key="item.index" class="flex justify-between">
                    <span :class="item.direction === 'bullish' ? 'text-bull-strong' : 'text-bear-strong'"
                      >{{ t(`analysis.bias.${item.direction}`) }} · #{{ item.index }}</span
                    >
                    <span class="font-mono">{{ formatPrice(item.price, precision) }}</span>
                  </li>
                  <li v-if="!report.flow.absorptions.length" class="text-ink-3">
                    {{ t('analysis.flow.noAbsorption') }}
                  </li>
                </ul>
              </div>
              <p class="mt-3 text-[9.5px] leading-relaxed text-ink-3">{{ t('analysis.flow.note') }}</p>
            </template>

            <template v-else>
              <table class="mt-3 w-full text-left">
                <thead>
                  <tr class="text-[9px] uppercase tracking-wide text-ink-3">
                    <th class="pb-1.5 font-medium">{{ t('analysis.indicators.name') }}</th>
                    <th class="pb-1.5 text-right font-medium">{{ t('analysis.indicators.value') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in indicatorRows"
                    :key="row.label"
                    class="border-t-[length:var(--hairline)] border-line/70 text-[10.5px]"
                  >
                    <td class="py-1.5 text-ink-2">{{ row.label }}</td>
                    <td class="py-1.5 text-right font-mono" :class="toneClass(row.tone)">{{ row.value }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
        </div>

        <div
          class="flex items-start gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-[9.5px] leading-relaxed text-ink-3"
        >
          <TriangleAlert class="mt-0.5 size-3 shrink-0 text-warn" aria-hidden="true" />
          <span>{{ t('analysis.disclaimer') }}</span>
        </div>
      </aside>
    </div>
  </div>
</template>
