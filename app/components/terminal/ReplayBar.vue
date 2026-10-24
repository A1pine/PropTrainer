<script setup lang="ts">
import { Pause, Play, RotateCcw, SkipForward } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  playing: boolean
  speed: number
  progress: number
  index: number
  total: number
  timeLabel: string
  source: 'loading' | 'local' | 'synthetic'
}>()

const emit = defineEmits<{
  toggle: []
  step: []
  reset: []
  speed: [value: number]
}>()

const { t } = useI18n()
const speeds = [0.5, 1, 2, 4]

const sourceLabel = computed(() =>
  props.source === 'local'
    ? t('terminal.replay.local')
    : props.source === 'synthetic'
      ? t('terminal.replay.synthetic')
      : t('terminal.replay.loading'),
)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" data-testid="replay-bar">
    <button
      type="button"
      class="grid size-8 place-items-center rounded-md bg-clay text-on-clay shadow-xs transition-transform active:scale-95 disabled:opacity-45"
      :aria-label="playing ? t('terminal.replay.pause') : t('terminal.replay.play')"
      :disabled="source === 'loading'"
      @click="emit('toggle')"
    >
      <Pause v-if="playing" class="size-4" aria-hidden="true" />
      <Play v-else class="size-4 translate-x-px" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="grid size-8 place-items-center rounded-md border border-line bg-surface-2 text-ink-2 transition-colors hover:text-ink disabled:opacity-45"
      :aria-label="t('terminal.replay.step')"
      :disabled="source === 'loading'"
      @click="emit('step')"
    >
      <SkipForward class="size-4" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="grid size-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-45"
      :aria-label="t('terminal.replay.reset')"
      :disabled="source === 'loading'"
      @click="emit('reset')"
    >
      <RotateCcw class="size-3.5" aria-hidden="true" />
    </button>

    <div
      class="flex items-center gap-1 rounded-pill bg-ink/[0.06] p-0.5 dark:bg-white/[0.07]"
      role="group"
      :aria-label="t('terminal.replay.speed')"
    >
      <button
        v-for="value in speeds"
        :key="value"
        type="button"
        class="rounded-pill px-2 py-1 font-mono text-[10.5px] tabular-nums transition-colors"
        :class="speed === value ? 'bg-surface-2 text-ink shadow-xs' : 'text-ink-3 hover:text-ink'"
        :aria-pressed="speed === value"
        @click="emit('speed', value)"
      >
        {{ value }}×
      </button>
    </div>

    <div class="min-w-[110px] flex-1 sm:max-w-[220px]">
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <span class="font-mono text-[10px] tabular-nums text-ink-3" data-testid="replay-index"
          >{{ index }} / {{ total }}</span
        >
        <span class="text-[10px] text-ink-3">{{ sourceLabel }}</span>
      </div>
      <div
        class="h-1 overflow-hidden rounded-pill bg-ink/[0.08]"
        role="progressbar"
        :aria-valuenow="Math.round(progress * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="h-full rounded-pill bg-clay transition-[width] duration-200 ease-linear"
          :style="{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }"
        />
      </div>
    </div>

    <div class="font-mono text-[11px] tabular-nums text-ink-2">{{ timeLabel }}</div>
  </div>
</template>
