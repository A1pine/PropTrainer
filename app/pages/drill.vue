<script setup lang="ts">
import { Eraser, Maximize2, Minus, MousePointer2, Plus, RefreshCw, Sparkles } from '@lucide/vue'
import type { ChartTool } from '~/lib/chart/types'
import { planExecutions, type TradeExecution } from '~/domain/trading/executions'

useHead({ title: 'Decision drill' })

const { t } = useI18n()
const route = useRoute()
const drill = useDrillStore()
const pk = usePkStore()
const player = computed<1 | 2>(() => (Number(route.query.player) === 2 ? 2 : 1))
const recordedFor = ref('')
const celebrate = ref(false)
let celebrationTimer: ReturnType<typeof setTimeout> | null = null
const DRILL_KEY = 'propdesk:last-drill-start'

function startKey() {
  const seed = typeof route.query.seed === 'string' ? route.query.seed : 'random'
  return `${seed}:${route.query.mode ?? 'drill'}:${route.query.pk ?? ''}:${route.query.player ?? ''}`
}
const settings = useSettingsStore()
const chart = ref<{
  fit: () => void
  zoom: (factor: number) => void
  focusOn: (index: number, span?: number) => void
  focusRange: (from: number, to: number) => void
} | null>(null)

const instrument = computed(() => drill.instrument)
const {
  enabled: analysisEnabled,
  frameworks: analysisFrameworks,
  layers: analysisLayers,
  report: analysisReport,
  overlay: analysisOverlay,
  status: analysisStatus,
  count: analysisCount,
  retry: retryAnalysis,
} = useExamAnalysis({
  candles: () => drill.candles,
  visibleCount: () => drill.visibleCount,
  precision: () => instrument.value?.pricePrecision ?? 2,
  active: () => drill.scenario != null,
})
const overlays = computed(() => ({
  entry: drill.plan.entry,
  stop: drill.plan.stop,
  target: drill.plan.target,
}))
const executions = computed(() =>
  drill.revealed && drill.phase === 'review' ? planExecutions(drill.outcome, drill.plan.direction, drill.candles) : [],
)
const chartExecutions = computed(() =>
  executions.value.map((execution) => ({
    ...execution,
    entryLabel: t('review.executions.entry'),
    exitLabel: t('review.executions.exit'),
  })),
)

function focusExecution(execution: TradeExecution) {
  chart.value?.focusRange(execution.entryBar, execution.exitBar)
}

const isRevealed = computed(() => drill.revealed)
const step = computed(() => (drill.phase === 'reading' ? 1 : drill.phase === 'planning' ? 2 : 3))
const symbolLabel = computed(() =>
  drill.revealed ? (instrument.value?.symbol ?? '') : (instrument.value?.mask ?? 'M???'),
)

const tools: { value: ChartTool; icon: typeof MousePointer2; label: string }[] = [
  { value: 'cursor', icon: MousePointer2, label: 'Cursor / pan' },
  { value: 'trend', icon: Sparkles, label: 'Trend line' },
  { value: 'horizontal', icon: Minus, label: 'Horizontal line' },
]

watch(
  () => drill.revealed,
  async (revealed) => {
    if (!revealed) return
    await nextTick()
    const execution = executions.value[0]
    if (execution) focusExecution(execution)
    else chart.value?.focusOn(drill.plan.submittedAtBar + 10, 80)
  },
)

async function startDrill() {
  const seed = typeof route.query.seed === 'string' ? route.query.seed : undefined
  const mode = route.query.mode === 'daily' ? 'daily' : route.query.pk ? 'pk' : 'drill'
  const key = startKey()
  if (!(await drill.start({ seed, mode }))) return
  if (import.meta.client) sessionStorage.setItem(DRILL_KEY, key)
  await nextTick()
  chart.value?.fit()
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.code === 'Space' && drill.phase === 'reading') {
    event.preventDefault()
    drill.wait()
  }
  if (drill.phase === 'reading') {
    const states = { '1': 'uptrend', '2': 'downtrend', '3': 'range', '4': 'expansion' } as const
    if (states[event.key as keyof typeof states]) drill.updatePlan({ state: states[event.key as keyof typeof states] })
    if (event.key.toLowerCase() === 'l') drill.setDirection('long')
    if (event.key.toLowerCase() === 's') drill.setDirection('short')
  }
}

watch(
  () => drill.phase,
  (phase) => {
    if (phase !== 'review' || !route.query.pk || !drill.grade || !drill.scenario) return
    const key = `${drill.seed}:${player.value}`
    if (recordedFor.value === key) return
    recordedFor.value = key
    pk.record(
      player.value,
      {
        score: drill.grade.total,
        grade: drill.grade.letter,
        rMultiple: drill.outcome?.rMultiple ?? null,
        symbol: drill.scenario.instrument.symbol,
        sessionDate: drill.scenario.sessionDate,
        regime: drill.scenario.regime,
        playedAt: new Date().toISOString(),
      },
      drill.seed,
    )
  },
)

onMounted(() => {
  settings.hydrate()
  pk.hydrate()
  const lastKey = import.meta.client ? sessionStorage.getItem(DRILL_KEY) : null
  if (drill.phase === 'idle' || (lastKey && lastKey !== startKey())) startDrill()
  window.addEventListener('keydown', onKeydown)
})

watch(
  () => drill.phase,
  (phase) => {
    if (phase !== 'review') return
    const letter = drill.grade?.letter
    if (letter !== 'A' && letter !== 'B') return
    celebrate.value = true
    if (celebrationTimer) clearTimeout(celebrationTimer)
    celebrationTimer = setTimeout(() => (celebrate.value = false), 1500)
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (celebrationTimer) clearTimeout(celebrationTimer)
})
</script>

<template>
  <div class="mx-auto max-w-[1480px] px-3 py-4 md:px-6">
    <header class="mb-3 flex flex-wrap items-end gap-3">
      <div>
        <p class="label-micro">{{ t('drill.kicker') }}</p>
        <h1 class="mt-1 text-[24px] font-semibold tracking-tight">{{ t('drill.title') }}</h1>
        <p class="mt-1 max-w-[54ch] text-[12px] leading-relaxed text-ink-3">{{ t('drill.subtitle') }}</p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <Badge v-if="drill.mode === 'daily'" variant="clay">{{ t('daily.badge') }}</Badge>
        <Badge v-else-if="drill.scenarioSource === 'local'" variant="bull" dot>{{
          t('settings.dataSource.localShort')
        }}</Badge>
        <Badge variant="outline">{{ symbolLabel }} · {{ drill.scenario?.timeframeMinutes ?? 5 }}m</Badge>
        <Button variant="secondary" size="sm" @click="startDrill()">
          <RefreshCw class="size-3.5" aria-hidden="true" />
          {{ t('drill.newSample') }}
        </Button>
      </div>
    </header>

    <div class="mb-3 flex items-center gap-2">
      <template v-for="index in 3" :key="index">
        <div class="flex items-center gap-2">
          <span
            class="grid size-6 place-items-center rounded-full border font-mono text-[10.5px]"
            :class="
              step === index
                ? 'border-clay bg-clay text-on-clay'
                : step > index
                  ? 'border-bull/40 bg-bull-soft text-bull-strong'
                  : 'border-line text-ink-3'
            "
            >{{ index }}</span
          >
          <span class="text-[11px]" :class="step === index ? 'font-medium text-ink' : 'text-ink-3'">{{
            t(`drill.steps.${index}`)
          }}</span>
        </div>
        <div v-if="index < 3" class="h-[length:var(--hairline)] w-8 bg-line sm:w-16" aria-hidden="true" />
      </template>
    </div>

    <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section class="overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-surface-2">
        <div class="flex items-center gap-0.5 border-b-[length:var(--hairline)] border-line px-2 py-1.5">
          <Tooltip v-for="tool in tools" :key="tool.value" :content="tool.label" side="bottom">
            <button
              type="button"
              class="grid size-7 place-items-center rounded-sm transition-colors"
              :class="
                drill.tool === tool.value
                  ? 'bg-clay-soft text-clay-ink'
                  : 'text-ink-3 hover:bg-ink/[0.05] hover:text-ink-2'
              "
              :aria-label="tool.label"
              :aria-pressed="drill.tool === tool.value"
              @click="drill.tool = tool.value"
            >
              <component :is="tool.icon" class="size-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
          <span class="mx-1 h-4 w-[length:var(--hairline)] bg-line" aria-hidden="true" />
          <button
            type="button"
            class="grid size-7 place-items-center rounded-sm text-ink-3 hover:bg-ink/5 hover:text-ink-2"
            :aria-label="t('chart.clear')"
            @click="drill.drawings = []"
          >
            <Eraser class="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="grid size-7 place-items-center rounded-sm text-ink-3 hover:bg-ink/5 hover:text-ink-2"
            :aria-label="t('chart.zoomIn')"
            @click="chart?.zoom(0.85)"
          >
            <Plus class="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="grid size-7 place-items-center rounded-sm text-ink-3 hover:bg-ink/5 hover:text-ink-2"
            :aria-label="t('chart.zoomOut')"
            @click="chart?.zoom(1.15)"
          >
            <Minus class="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="flex h-7 items-center gap-1 rounded-sm px-2 text-[10.5px] text-ink-3 hover:bg-ink/5 hover:text-ink-2"
            @click="chart?.fit()"
          >
            <Maximize2 class="size-3" aria-hidden="true" />
            {{ t('chart.fit') }}
          </button>
          <div class="ml-auto flex items-center gap-2">
            <ExamAnalysisControls
              v-model:enabled="analysisEnabled"
              v-model:frameworks="analysisFrameworks"
              v-model:layers="analysisLayers"
              :report="analysisReport"
              :status="analysisStatus"
              :count="analysisCount"
              @retry="retryAnalysis"
            />
            <Badge :variant="isRevealed ? 'bull' : 'clay'" size="sm" dot>{{
              isRevealed ? t('chart.revealed') : t('chart.blind')
            }}</Badge>
          </div>
        </div>

        <ChartCanvas
          ref="chart"
          :analysis="analysisOverlay"
          :candles="drill.candles"
          :visible-count="drill.visibleCount"
          :drawings="drill.drawings"
          :overlays="overlays"
          :executions="chartExecutions"
          :show-overlay-labels="!drill.revealed"
          :tool="drill.tool"
          :blind="!drill.revealed"
          :timeframe-minutes="drill.scenario?.timeframeMinutes ?? 5"
          :price-precision="instrument?.pricePrecision ?? 2"
          :tick-size="instrument?.tickSize ?? 0.25"
          :overlay-draggable="drill.phase === 'planning'"
          :symbol-mask="symbolLabel"
          class="h-[460px] lg:h-[560px]"
          @update:drawings="drill.drawings = $event"
          @overlay-drag="(kind, price) => drill.updateLevel(kind, price)"
        />
        <div
          class="flex items-center justify-between border-t-[length:var(--hairline)] border-line px-3 py-2 text-[10.5px] text-ink-3"
        >
          <span>{{ isRevealed ? t('drill.revealHint') : t('drill.blindHint') }}</span>
          <span class="num">{{ drill.visibleCount }} / {{ drill.candles.length }}</span>
        </div>
      </section>

      <aside class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 p-3.5">
        <ReadPanel
          v-if="drill.phase === 'reading'"
          :state="drill.plan.state"
          :direction="drill.plan.direction"
          :thesis="drill.plan.thesis"
          :waited-bars="drill.plan.waitedBars"
          @update:state="drill.updatePlan({ state: $event })"
          @update:direction="drill.setDirection($event)"
          @update:thesis="drill.updatePlan({ thesis: $event })"
          @commit="drill.commitRead()"
          @wait="drill.wait()"
        />
        <PlanPanel
          v-else-if="drill.phase === 'planning'"
          :plan="drill.plan"
          :validation="drill.validation"
          :sizing="drill.sizing"
          :precision="instrument?.pricePrecision ?? 2"
          :tick-size="instrument?.tickSize ?? 0.25"
          :instrument-symbol="instrument?.symbol ?? ''"
          @update:level="(kind, price) => (price != null ? drill.updateLevel(kind, price) : undefined)"
          @back="drill.backToRead()"
          @submit="drill.submit()"
        />
        <DrillResult
          v-else-if="drill.phase === 'review' && drill.grade"
          :grade="drill.grade"
          :outcome="
            drill.outcome ?? {
              filled: false,
              entryBar: null,
              entryPrice: null,
              exitBar: null,
              exitPrice: null,
              exitReason: 'no-entry',
              rMultiple: null,
              maeR: null,
              mfeR: null,
              barsToEntry: 0,
              barsHeld: 0,
            }
          "
          :scenario="drill.scenario!"
          :plan="drill.plan"
          :seed="drill.seed"
          :executions="executions"
          @focus="focusExecution"
          @next="drill.next()"
        />
        <NuxtLink
          v-if="route.query.pk"
          to="/pk"
          class="mt-2 block text-center text-[10.5px] text-ink-3 hover:text-ink-2"
        >
          {{ t('pk.backToRoom') }}
        </NuxtLink>
        <div v-if="drill.phase === 'idle'" class="py-10 text-center text-[12px] text-ink-3">
          {{ t('drill.drawing') }}
        </div>
      </aside>
    </div>
    <CelebrationBurst :active="celebrate" />
  </div>
</template>
