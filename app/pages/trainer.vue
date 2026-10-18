<script setup lang="ts">
import {
  Activity,
  ArrowRight,
  Crosshair,
  Eraser,
  Maximize2,
  Minus,
  MousePointer2,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Undo2,
} from '@lucide/vue'
import type { LogRow } from '~/domain/stats/types'
import type { ChartTool } from '~/lib/chart/types'
import type { PlaceOrderInput } from '~/domain/trading/types'
import { REGIME_LABELS } from '~/domain/market/types'

useHead({ title: 'Blind trainer' })

const { t, locale } = useI18n()
const trainer = useTrainerStore()
const settings = useSettingsStore()
const history = useHistoryStore()
const chart = ref<{
  fit: () => void
  zoom: (factor: number) => void
  scrollToLatest: () => void
  focusOn: (index: number, span?: number) => void
} | null>(null)
const showTicket = ref(false)

const instrument = computed(() => trainer.instrument)
const account = computed(() => trainer.account)
const isLastRound = computed(() => trainer.roundIndex >= trainer.totalRounds)

const phaseLabel = computed(() => t(`phase.${trainer.phase}`))
const phaseTone = computed(() => {
  switch (trainer.phase) {
    case 'live':
      return 'bg-bull'
    case 'judging':
    case 'planning':
      return 'bg-clay'
    case 'review':
    case 'summary':
      return 'bg-ink-3'
    default:
      return 'bg-clay'
  }
})

const overlays = computed(() => {
  const position = account.value?.position
  if (position) {
    return { entry: position.entryPrice, stop: position.stopLoss, target: position.takeProfit }
  }
  return { entry: trainer.plan.entry, stop: trainer.plan.stop, target: trainer.plan.target }
})

const logRows = computed<LogRow[]>(() => {
  const trades = account.value?.trades ?? []
  return trades.map((trade) => ({
    id: trade.id,
    bar: trade.exitBar + 1,
    side: trade.side,
    qty: trade.qty,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    pnl: trade.pnl,
    rMultiple: trade.rMultiple,
    exitReason: trade.exitReason,
  }))
})

const sessionNet = computed(
  () =>
    trainer.rounds.reduce((total, round) => total + round.netPnl, 0) +
    (trainer.phase === 'review' ? 0 : (account.value?.netPnl ?? 0)),
)

const revealedDate = computed(() => {
  if (!trainer.scenario) return ''
  return formatDate(trainer.scenario.sessionDate, locale.value)
})

watch(
  () => trainer.revealed,
  async (revealed) => {
    if (!revealed) return
    await nextTick()
    const decision = trainer.plan.submittedAtBar || Math.max(0, trainer.scenario?.replayStart ?? 0)
    chart.value?.focusOn(decision + 30, 72)
  },
)

const symbolLabel = computed(() => {
  if (!instrument.value) return 'M???'
  return trainer.revealed ? instrument.value.symbol : instrument.value.mask
})

const tools: { value: ChartTool; icon: typeof Crosshair; label: string }[] = [
  { value: 'cursor', icon: MousePointer2, label: 'Cursor / pan' },
  { value: 'trend', icon: TrendingUp, label: 'Trend line' },
  { value: 'horizontal', icon: Minus, label: 'Horizontal line' },
  { value: 'fib', icon: Activity, label: 'Fibonacci' },
]

const thesisLength = computed(() => trainer.plan.thesis.trim().length)

function onCommitRead() {
  trainer.commitRead()
}

function setTool(tool: ChartTool) {
  trainer.tool = tool
}

function undoDrawing() {
  trainer.drawings = trainer.drawings.slice(0, -1)
}

function clearDrawings() {
  trainer.drawings = []
}

function onOverlayDrag(kind: 'entry' | 'stop' | 'target', price: number) {
  trainer.updateLevel(kind, price)
}

function submitTicket(input: PlaceOrderInput) {
  trainer.placeTicketOrder(input)
  showTicket.value = false
}

function nextRound() {
  trainer.advanceRound()
  showTicket.value = false
}

function togglePlayback() {
  if (trainer.playing) trainer.stopPlayback()
  else trainer.startPlayback()
}

function revealFuture() {
  trainer.revealEverything()
  chart.value?.scrollToLatest()
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  if (event.metaKey || event.ctrlKey || event.altKey) return

  if (event.code === 'Space') {
    event.preventDefault()
    if (trainer.phase === 'judging') trainer.waitBar()
    else if (trainer.phase === 'live') togglePlayback()
    return
  }
  if (event.key.toLowerCase() === 'n' && trainer.phase === 'live') {
    event.preventDefault()
    trainer.step()
    return
  }
  if (trainer.phase === 'judging') {
    const stateMap: Record<string, 'uptrend' | 'downtrend' | 'range' | 'expansion'> = {
      '1': 'uptrend',
      '2': 'downtrend',
      '3': 'range',
      '4': 'expansion',
    }
    if (stateMap[event.key]) {
      trainer.updatePlan({ state: stateMap[event.key] })
      return
    }
    if (event.key.toLowerCase() === 'l') trainer.setDirection('long')
    if (event.key.toLowerCase() === 's') trainer.setDirection('short')
  }
}

onMounted(() => {
  settings.hydrate()
  history.hydrate()
  if (trainer.phase === 'idle' || trainer.phase === 'summary') void trainer.startSession()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  trainer.stopPlayback()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="mx-auto flex max-w-[1480px] flex-col gap-3 p-3 md:p-4 lg:h-[calc(100dvh-var(--topbar-height))]">
    <!-- Session header -->
    <header class="flex shrink-0 flex-wrap items-center gap-3">
      <div class="min-w-0">
        <p class="label-micro">
          {{ t('trainer.roundOf', { index: Math.max(1, trainer.roundIndex), total: trainer.totalRounds }) }}
        </p>
        <div class="mt-1 flex items-center gap-2">
          <span
            class="size-2 rounded-full"
            :class="phaseTone"
            :style="trainer.phase === 'live' ? 'animation: pulse-dot 1.8s infinite' : ''"
            aria-hidden="true"
          />
          <p class="text-[14px] font-semibold tracking-tight">{{ phaseLabel }}</p>
          <span class="h-3 w-[length:var(--hairline)] bg-line" aria-hidden="true" />
          <span class="font-mono text-[11px] text-ink-3"
            >{{ symbolLabel }} · {{ trainer.scenario?.timeframeMinutes ?? 5 }}m</span
          >
          <span class="hidden font-mono text-[11px] text-ink-3 sm:inline"
            >· {{ trainer.revealed ? revealedDate : t('trainer.dayHidden') }}</span
          >
        </div>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <div class="hidden text-right sm:block">
          <p class="label-micro">{{ t('stats.equity') }}</p>
          <NumberTicker
            :value="account?.equity ?? settings.settings.accountSize"
            :decimals="2"
            prefix="$"
            class="text-[13px] font-medium"
          />
        </div>
        <Badge variant="outline" dot class="hidden lg:inline-flex">{{ t('common.simulated') }}</Badge>
        <Button v-if="trainer.phase !== 'summary'" variant="ghost" size="sm" @click="trainer.endSession()">
          {{ t('trainer.endSession') }}
        </Button>
      </div>
    </header>

    <div class="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_356px]">
      <!-- Chart -->
      <section
        class="flex min-h-[420px] flex-col overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 lg:min-h-0"
      >
        <div class="flex flex-wrap items-center gap-0.5 border-b-[length:var(--hairline)] border-line px-2 py-1.5">
          <Tooltip v-for="tool in tools" :key="tool.value" :content="tool.label" side="bottom">
            <button
              type="button"
              class="grid size-7 place-items-center rounded-sm transition-colors"
              :class="
                trainer.tool === tool.value
                  ? 'bg-clay-soft text-clay-ink'
                  : 'text-ink-3 hover:bg-ink/[0.05] hover:text-ink-2'
              "
              :aria-label="tool.label"
              :aria-pressed="trainer.tool === tool.value"
              @click="setTool(tool.value)"
            >
              <component :is="tool.icon" class="size-3.5" :stroke-width="1.8" aria-hidden="true" />
            </button>
          </Tooltip>
          <span class="mx-1 h-4 w-[length:var(--hairline)] bg-line" aria-hidden="true" />
          <Tooltip :content="t('chart.undo')" side="bottom">
            <button
              type="button"
              class="grid size-7 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-ink/[0.05] hover:text-ink-2 disabled:opacity-35"
              :disabled="!trainer.drawings.length"
              :aria-label="t('chart.undo')"
              @click="undoDrawing"
            >
              <Undo2 class="size-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip :content="t('chart.clear')" side="bottom">
            <button
              type="button"
              class="grid size-7 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-ink/[0.05] hover:text-ink-2 disabled:opacity-35"
              :disabled="!trainer.drawings.length"
              :aria-label="t('chart.clear')"
              @click="clearDrawings"
            >
              <Eraser class="size-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
          <span class="mx-1 h-4 w-[length:var(--hairline)] bg-line" aria-hidden="true" />
          <Tooltip :content="t('chart.zoomIn')" side="bottom">
            <button
              type="button"
              class="grid size-7 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-ink/[0.05] hover:text-ink-2"
              :aria-label="t('chart.zoomIn')"
              @click="chart?.zoom(0.85)"
            >
              <Plus class="size-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip :content="t('chart.zoomOut')" side="bottom">
            <button
              type="button"
              class="grid size-7 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-ink/[0.05] hover:text-ink-2"
              :aria-label="t('chart.zoomOut')"
              @click="chart?.zoom(1.15)"
            >
              <Minus class="size-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
          <button
            type="button"
            class="ml-1 flex h-7 items-center gap-1 rounded-sm px-2 text-[10.5px] text-ink-3 transition-colors hover:bg-ink/[0.05] hover:text-ink-2"
            @click="chart?.fit()"
          >
            <Maximize2 class="size-3" aria-hidden="true" />
            {{ t('chart.fit') }}
          </button>

          <div class="ml-auto flex items-center gap-1.5">
            <Badge :variant="trainer.revealed ? 'bull' : 'clay'" size="sm" dot>
              {{ trainer.revealed ? t('chart.revealed') : t('chart.blind') }}
            </Badge>
            <span v-if="trainer.revealed" class="font-mono text-[10px] text-ink-3">{{
              trainer.scenario?.instrument.exchange
            }}</span>
          </div>
        </div>

        <ChartCanvas
          ref="chart"
          :candles="trainer.candles"
          :visible-count="trainer.visibleCount"
          :drawings="trainer.drawings"
          :overlays="overlays"
          :tool="trainer.tool"
          :blind="!trainer.revealed"
          :timeframe-minutes="trainer.scenario?.timeframeMinutes ?? 5"
          :price-precision="instrument?.pricePrecision ?? 2"
          :tick-size="instrument?.tickSize ?? 0.25"
          :overlay-draggable="trainer.phase === 'planning'"
          :symbol-mask="symbolLabel"
          class="min-h-[300px] flex-1"
          @update:drawings="trainer.drawings = $event"
          @overlay-drag="onOverlayDrag"
        >
          <template #empty>{{ t('trainer.drawing') }}</template>
        </ChartCanvas>

        <StatStrip
          :phase="trainer.phase"
          :account="account"
          :playing="trainer.playing"
          :speed="trainer.speed"
          :visible-count="trainer.visibleCount"
          :total-bars="Math.max(trainer.visibleCount, trainer.roundEndIndex + 1)"
          :progress="trainer.progress"
          :win-rate="trainer.roundStats.winRate"
          :session-pnl="sessionNet"
          :round-index="Math.min(trainer.roundIndex, trainer.totalRounds)"
          :total-rounds="trainer.totalRounds"
          :revealed="trainer.revealed"
          @toggle="togglePlayback"
          @step="trainer.phase === 'judging' ? trainer.waitBar() : trainer.step()"
          @set-speed="trainer.setSpeed"
          @reveal="revealFuture"
        />
      </section>

      <!-- Side panel -->
      <aside class="min-h-0 space-y-3 lg:overflow-y-auto lg:pr-0.5">
        <div class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 p-3.5">
          <template v-if="trainer.phase === 'loading'">
            <div class="space-y-3">
              <Skeleton width="w-24" height="h-3" />
              <Skeleton width="w-full" height="h-6" />
              <div class="grid grid-cols-2 gap-2">
                <Skeleton height="h-16" rounded="rounded-md" />
                <Skeleton height="h-16" rounded="rounded-md" />
                <Skeleton height="h-16" rounded="rounded-md" />
                <Skeleton height="h-16" rounded="rounded-md" />
              </div>
              <Skeleton width="w-full" height="h-20" rounded="rounded-md" />
            </div>
            <p class="mt-4 text-center text-[10.5px] text-ink-3">{{ t('trainer.drawing') }}</p>
          </template>

          <ReadPanel
            v-else-if="trainer.phase === 'judging'"
            :state="trainer.plan.state"
            :direction="trainer.plan.direction"
            :thesis="trainer.plan.thesis"
            :waited-bars="trainer.plan.waitedBars"
            @update:state="trainer.updatePlan({ state: $event })"
            @update:direction="trainer.setDirection($event)"
            @update:thesis="trainer.updatePlan({ thesis: $event })"
            @commit="onCommitRead"
            @wait="trainer.waitBar()"
          />

          <PlanPanel
            v-else-if="trainer.phase === 'planning'"
            :plan="trainer.plan"
            :validation="trainer.validation"
            :sizing="trainer.sizing"
            :precision="instrument?.pricePrecision ?? 2"
            :tick-size="instrument?.tickSize ?? 0.25"
            :instrument-symbol="instrument?.symbol ?? ''"
            @update:level="(kind, price) => (price != null ? trainer.updateLevel(kind, price) : undefined)"
            @back="trainer.phase = 'judging'"
            @submit="trainer.submitPlan()"
          />

          <template v-else-if="trainer.phase === 'live' || trainer.phase === 'review'">
            <div v-if="trainer.phase === 'live'" class="space-y-3">
              <PositionCard
                v-if="account?.position"
                :position="account.position"
                :instrument="instrument!"
                :mark-price="account.markPrice"
                :unrealized="account.unrealizedPnl"
                :round-r="account.roundR"
                :symbol-label="symbolLabel"
                @close="trainer.closePosition()"
                @breakeven="trainer.moveStopToBreakEven()"
              />
              <template v-else-if="trainer.plan.direction !== 'none'">
                <TradeTicket
                  :instrument="instrument!"
                  :account="account"
                  :default-side="trainer.plan.direction === 'short' ? 'short' : 'long'"
                  :default-qty="Math.max(1, trainer.sizing?.contracts ?? 1)"
                  :default-stop="trainer.plan.stop"
                  :default-target="trainer.plan.target"
                  :risk-budget="trainer.riskBudget"
                  :max-contracts="trainer.rules.maxContracts"
                  :pending="trainer.orderPending"
                  :symbol-label="symbolLabel"
                  :disabled="account?.status !== 'active'"
                  @submit="submitTicket"
                  @cancel="trainer.cancelOrder"
                />
              </template>
              <div v-else class="rounded-lg border border-dashed border-line bg-sunken p-3">
                <p class="label-micro">{{ t('plan.standAsideTitle') }}</p>
                <p class="mt-2 text-[11.5px] leading-relaxed text-ink-2">{{ t('plan.standAsideBody') }}</p>
                <p class="mt-2 text-[10.5px] leading-relaxed text-ink-3">{{ t('trainer.standAsideHint') }}</p>
              </div>

              <div class="border-t-[length:var(--hairline)] border-line pt-3">
                <div class="mb-2 flex items-center justify-between">
                  <p class="label-micro">{{ t('rules.title') }}</p>
                  <Badge variant="neutral" size="sm">{{
                    trainer.rules.phase === 'evaluation' ? t('rules.evaluation') : t('rules.funded')
                  }}</Badge>
                </div>
                <RulePanel v-if="account" :rules="trainer.rules" :statuses="account.ruleStatuses" compact />
              </div>

              <Button variant="outline" size="sm" block @click="trainer.finishRound()">
                <ShieldCheck class="size-3.5" aria-hidden="true" />
                {{ t('trainer.finishRound') }}
              </Button>
            </div>

            <ReviewPanel
              v-else-if="trainer.grade && account"
              :grade="trainer.grade"
              :scenario="trainer.scenario!"
              :account="account"
              :round-index="trainer.roundIndex"
              :total-rounds="trainer.totalRounds"
              :is-last="isLastRound"
              @next="nextRound"
              @end="trainer.endSession()"
              @replay="revealFuture"
            />
            <div v-else-if="trainer.phase === 'review' && !trainer.grade" class="space-y-3">
              <p class="label-micro">{{ t('review.standAside') }}</p>
              <p class="text-[12px] leading-relaxed text-ink-2">
                {{
                  t('review.standAsideBody', {
                    regime: trainer.scenario ? t(`read.states.${trainer.scenario.regime}`) : '',
                  })
                }}
              </p>
              <Button variant="primary" size="md" block @click="nextRound">{{
                isLastRound ? t('review.finishSession') : t('review.nextRound')
              }}</Button>
            </div>
          </template>

          <template v-else-if="trainer.phase === 'summary'">
            <div class="space-y-3">
              <p class="label-micro">{{ t('summary.title') }}</p>
              <div>
                <p
                  class="text-[30px] font-medium tracking-tight serif"
                  :class="sessionNet >= 0 ? 'text-bull-strong' : 'text-bear-strong'"
                >
                  {{ formatMoney(sessionNet, { signed: true, decimals: 2 }) }}
                </p>
                <p class="text-[11px] text-ink-3">{{ t('summary.subtitle', { rounds: trainer.rounds.length }) }}</p>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="rounded-md border border-line p-2">
                  <p class="label-micro">{{ t('stats.winRate') }}</p>
                  <p class="num mt-0.5 text-[15px]">{{ trainer.roundStats.winRate.toFixed(1) }}%</p>
                </div>
                <div class="rounded-md border border-line p-2">
                  <p class="label-micro">{{ t('summary.avgR') }}</p>
                  <p class="num mt-0.5 text-[15px]">{{ formatR(trainer.roundStats.avgR) }}</p>
                </div>
                <div class="rounded-md border border-line p-2">
                  <p class="label-micro">{{ t('summary.breaches') }}</p>
                  <p class="num mt-0.5 text-[15px]">{{ trainer.roundStats.breaches }}</p>
                </div>
                <div class="rounded-md border border-line p-2">
                  <p class="label-micro">{{ t('stats.fees') }}</p>
                  <p class="num mt-0.5 text-[15px]">{{ formatMoney(trainer.roundStats.fees) }}</p>
                </div>
              </div>
              <div class="space-y-1">
                <div
                  v-for="round in trainer.rounds"
                  :key="round.id"
                  class="flex items-center justify-between rounded-sm px-1 py-1 text-[11px]"
                >
                  <span class="text-ink-3">#{{ round.index }} · {{ round.symbol }}</span>
                  <span class="num" :class="round.netPnl >= 0 ? 'text-bull-strong' : 'text-bear-strong'">{{
                    formatMoney(round.netPnl, { signed: true })
                  }}</span>
                </div>
              </div>
              <div class="flex flex-col gap-2 border-t-[length:var(--hairline)] border-line pt-3">
                <Button variant="primary" size="md" block @click="trainer.startSession()">
                  <RefreshCw class="size-3.5" aria-hidden="true" />
                  {{ t('summary.newSession') }}
                </Button>
                <NuxtLink to="/stats">
                  <Button variant="secondary" size="md" block>
                    {{ t('summary.viewStats') }}
                    <ArrowRight class="size-3.5" aria-hidden="true" />
                  </Button>
                </NuxtLink>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="space-y-3 py-2">
              <PencilLine class="size-5 text-clay" aria-hidden="true" />
              <h3 class="text-[16px] font-semibold tracking-tight">{{ t('trainer.startTitle') }}</h3>
              <p class="text-[12px] leading-relaxed text-ink-2">{{ t('trainer.startBody') }}</p>
              <Button variant="primary" size="md" block @click="trainer.startSession()">
                <Play class="size-3.5" aria-hidden="true" />
                {{ t('trainer.start') }}
              </Button>
            </div>
          </template>
        </div>

        <div
          v-if="trainer.phase === 'judging'"
          class="rounded-lg border border-dashed border-line px-3 py-2.5 text-[10.5px] leading-relaxed text-ink-3"
        >
          {{ t('trainer.judgingHint') }}
        </div>
        <div
          v-if="trainer.phase === 'planning'"
          class="rounded-lg border border-dashed border-line px-3 py-2.5 text-[10.5px] leading-relaxed text-ink-3"
        >
          {{ t('trainer.planningHint') }}
        </div>
      </aside>
    </div>

    <div class="hidden shrink-0 lg:block">
      <TradeLog :rows="logRows" :precision="instrument?.pricePrecision ?? 2" />
    </div>

    <!-- Mobile ticket trigger -->
    <button
      v-if="trainer.phase === 'live' && trainer.plan.direction !== 'none'"
      type="button"
      class="fixed bottom-[calc(var(--mobile-tabbar)+12px)] right-4 z-30 flex items-center gap-2 rounded-pill bg-clay px-4 py-3 text-[12px] font-medium text-on-clay shadow-lg md:hidden"
      @click="showTicket = true"
    >
      <Crosshair class="size-4" aria-hidden="true" />
      {{ t('ticket.title') }}
    </button>

    <Sheet v-model:open="showTicket" :title="t('ticket.title')" :description="t('ticket.sheetNote')">
      <div v-if="instrument && account" class="space-y-3">
        <PositionCard
          v-if="account.position"
          :position="account.position"
          :instrument="instrument"
          :mark-price="account.markPrice"
          :unrealized="account.unrealizedPnl"
          :round-r="account.roundR"
          :symbol-label="symbolLabel"
          @close="trainer.closePosition()"
          @breakeven="trainer.moveStopToBreakEven()"
        />
        <TradeTicket
          v-else-if="trainer.plan.direction !== 'none'"
          :instrument="instrument"
          :account="account"
          :default-side="trainer.plan.direction === 'short' ? 'short' : 'long'"
          :default-qty="Math.max(1, trainer.sizing?.contracts ?? 1)"
          :default-stop="trainer.plan.stop"
          :default-target="trainer.plan.target"
          :risk-budget="trainer.riskBudget"
          :max-contracts="trainer.rules.maxContracts"
          :pending="trainer.orderPending"
          :symbol-label="symbolLabel"
          @submit="submitTicket"
          @cancel="trainer.cancelOrder"
        />
        <div v-else class="rounded-lg border border-dashed border-line bg-sunken p-3">
          <p class="text-[12px] leading-relaxed text-ink-2">{{ t('plan.standAsideBody') }}</p>
        </div>
      </div>
    </Sheet>
  </div>
</template>
