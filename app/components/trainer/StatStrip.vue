<script setup lang="ts">
import { Pause, Play, SkipForward } from '@lucide/vue'
import type { AccountSnapshot } from '~/domain/trading/types'
import type { TrainerPhase } from '~/stores/trainer'

const props = defineProps<{
  phase: TrainerPhase
  account: AccountSnapshot | null
  playing: boolean
  speed: number
  visibleCount: number
  totalBars: number
  progress: number
  winRate: number
  sessionPnl: number
  roundIndex: number
  totalRounds: number
  revealed: boolean
}>()

const emit = defineEmits<{
  toggle: []
  step: []
  'set-speed': [speed: number]
  reveal: []
}>()

const { t } = useI18n()

const speeds = [
  { value: '1', label: '0.5×' },
  { value: '2', label: '1×' },
  { value: '4', label: '2×' },
  { value: '8', label: '4×' },
]

const speedModel = computed({
  get: () => String(props.speed),
  set: (value: string) => emit('set-speed', Number(value)),
})

const canPlay = computed(() => props.phase === 'live')
const canStep = computed(() => props.phase === 'live' || props.phase === 'judging')
const roundPnl = computed(() => props.account?.netPnl ?? 0)
</script>

<template>
  <div class="border-t-[length:var(--hairline)] border-line bg-surface-2">
    <div
      class="scroll-fade flex snap-x snap-mandatory divide-x-[length:var(--hairline)] divide-line overflow-x-auto lg:grid lg:grid-cols-6 lg:overflow-visible"
      role="group"
      :aria-label="t('stats.sessionSummary')"
    >
      <div class="min-w-[138px] shrink-0 snap-start px-3 py-2.5 lg:min-w-0">
        <p class="label-micro">{{ t('stats.starting') }}</p>
        <p class="num mt-1 text-[15px] font-medium">{{ formatMoney(account?.startBalance ?? 0, { decimals: 0 }) }}</p>
      </div>
      <div class="min-w-[138px] shrink-0 snap-start px-3 py-2.5 lg:min-w-0">
        <p class="label-micro">{{ t('stats.equity') }}</p>
        <NumberTicker
          :value="account?.equity ?? 0"
          :decimals="2"
          prefix="$"
          flash
          class="mt-1 block text-[15px] font-medium"
        />
      </div>
      <div class="min-w-[138px] shrink-0 snap-start px-3 py-2.5 lg:min-w-0">
        <p class="label-micro">{{ t('stats.roundPnl') }}</p>
        <NumberTicker
          :value="roundPnl"
          :decimals="2"
          prefix="$"
          signed
          flash
          class="mt-1 block text-[15px] font-medium"
          :class="roundPnl > 0 ? 'text-bull-strong' : roundPnl < 0 ? 'text-bear-strong' : 'text-ink'"
        />
      </div>
      <div class="min-w-[138px] shrink-0 snap-start px-3 py-2.5 lg:min-w-0">
        <p class="label-micro">{{ t('stats.progress') }}</p>
        <div class="mt-1 flex items-center gap-2">
          <span class="num text-[15px] font-medium">{{ roundIndex }}/{{ totalRounds }}</span>
          <div class="h-1 flex-1 overflow-hidden rounded-pill bg-ink/10">
            <div
              class="h-full rounded-pill rule-progress transition-[width] duration-500"
              :style="{ width: `${progress}%` }"
            />
          </div>
        </div>
      </div>
      <div class="min-w-[138px] shrink-0 snap-start px-3 py-2.5 lg:min-w-0">
        <p class="label-micro">{{ t('stats.winRate') }}</p>
        <p class="num mt-1 text-[15px] font-medium">{{ winRate.toFixed(1) }}%</p>
      </div>
      <div class="min-w-[138px] shrink-0 snap-start px-3 py-2.5 lg:min-w-0">
        <p class="label-micro">{{ t('stats.sessionPnl') }}</p>
        <NumberTicker
          :value="sessionPnl"
          :decimals="2"
          prefix="$"
          signed
          flash
          class="mt-1 block text-[15px] font-medium"
          :class="sessionPnl > 0 ? 'text-bull-strong' : sessionPnl < 0 ? 'text-bear-strong' : 'text-ink'"
        />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 border-t-[length:var(--hairline)] border-line px-3 py-2">
      <button
        type="button"
        class="grid size-9 place-items-center rounded-md bg-clay text-on-clay transition-transform active:scale-95 disabled:opacity-40"
        :disabled="!canPlay"
        :aria-label="playing ? t('playback.pause') : t('playback.play')"
        @click="emit('toggle')"
      >
        <Pause v-if="playing" class="size-4" fill="currentColor" aria-hidden="true" />
        <Play v-else class="size-4" fill="currentColor" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 text-[12px] text-ink-2 transition-colors hover:border-line-strong disabled:opacity-40"
        :disabled="!canStep || playing"
        @click="emit('step')"
      >
        <SkipForward class="size-3.5" aria-hidden="true" />
        {{ t('playback.nextBar') }}
        <Kbd :keys="['N']" class="ml-1" />
      </button>

      <SegmentedControl
        v-if="canPlay"
        v-model="speedModel"
        :options="speeds"
        size="sm"
        class="ml-1 max-w-[190px]"
        :aria-label="t('playback.speed')"
      />

      <div class="ml-auto flex items-center gap-3 text-[11px] text-ink-3">
        <span class="num">{{ Math.min(visibleCount, totalBars) }} / {{ totalBars }}</span>
        <span class="hidden h-3 w-[length:var(--hairline)] bg-line sm:block" aria-hidden="true" />
        <span class="hidden items-center gap-1.5 sm:flex">
          <span class="size-1.5 rounded-full bg-clay" :class="playing ? 'animate-pulse-dot' : ''" aria-hidden="true" />
          {{ revealed ? t('playback.revealed') : t('playback.blind') }}
        </span>
        <button
          v-if="revealed"
          type="button"
          class="rounded-pill border border-line px-2 py-1 text-[10.5px] text-ink-2 transition-colors hover:border-line-strong"
          @click="emit('reveal')"
        >
          {{ t('playback.replayFuture') }}
        </button>
      </div>
    </div>
  </div>
</template>
