<script setup lang="ts">
import { Layers, RotateCcw, SlidersHorizontal } from '@lucide/vue'
import { nextTick, useId } from 'vue'
import Switch from '~/components/ui/Switch.vue'
import type { AnalysisReport } from '~/domain/analysis/types'
import type { ExamAnalysisStatus } from '~/composables/useExamAnalysis'
import type { AnalysisFramework, AnalysisFrameworks, AnalysisLayers } from '~/lib/chart/analysis'

const props = defineProps<{
  enabled: boolean
  frameworks: AnalysisFrameworks
  layers: AnalysisLayers
  report: AnalysisReport | null
  status: ExamAnalysisStatus
  count: number
}>()
const emit = defineEmits<{
  'update:enabled': [enabled: boolean]
  'update:frameworks': [frameworks: AnalysisFrameworks]
  'update:layers': [layers: AnalysisLayers]
  retry: []
}>()
const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelId = useId()
const open = ref(false)

const groups: AnalysisFramework[] = ['pa', 'ict', 'flow', 'indicators']
const layerGroups: { key: keyof AnalysisLayers; group: AnalysisFramework }[] = [
  { key: 'ema', group: 'indicators' },
  { key: 'vwap', group: 'indicators' },
  { key: 'bb', group: 'indicators' },
  { key: 'fvg', group: 'ict' },
  { key: 'ob', group: 'ict' },
  { key: 'liquidity', group: 'ict' },
  { key: 'profile', group: 'flow' },
]
const shownLayers = computed(() =>
  layerGroups.filter(({ key, group }) => props.frameworks[group] || (key === 'liquidity' && props.frameworks.pa)),
)
const summaries = computed<Record<AnalysisFramework, string>>(() => {
  const report = props.report
  if (!report) return { pa: '—', ict: '—', flow: '—', indicators: '—' }
  return {
    pa: t(`analysis.structure.${report.trend.structure}`),
    ict: t(`analysis.ict.zones.${report.ict.zone}`),
    flow: `${t('analysis.flow.pressure')} ${(report.flow.pressure * 100).toFixed(0)}%`,
    indicators: `RSI ${report.indicators.latest.rsi?.toFixed(1) ?? '—'} · ADX ${report.indicators.latest.adx?.toFixed(1) ?? '—'}`,
  }
})
const tone = computed(() => {
  if (props.status === 'ready') return 'bg-bull'
  if (props.status === 'unavailable') return 'bg-danger'
  if (props.status === 'loading') return 'bg-clay'
  return 'bg-ink/25'
})
const statusLabel = computed(() => {
  switch (props.status) {
    case 'ready':
      return t('analysis.exam.ready', { count: props.count })
    case 'loading':
      return t('analysis.exam.loadingShort')
    case 'empty':
      return t('analysis.exam.emptyShort')
    case 'insufficient':
      return t('analysis.exam.insufficientShort')
    case 'unavailable':
      return t('analysis.exam.unavailableShort')
    default:
      return t('analysis.exam.off')
  }
})
const statusTitle = computed(() => {
  const key = props.status === 'off' ? 'off' : props.status === 'ready' ? 'visibleOnly' : props.status
  return t(`analysis.exam.${key}`)
})

function toggleFramework(key: AnalysisFramework) {
  emit('update:frameworks', { ...props.frameworks, [key]: !props.frameworks[key] })
}
function toggleLayer(key: keyof AnalysisLayers) {
  emit('update:layers', { ...props.layers, [key]: !props.layers[key] })
}

function onPointerDown(event: PointerEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(event.target as Node)) open.value = false
}
function closeSettings(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) closeSettings(true)
}
function onFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !root.value?.contains(event.relatedTarget)) closeSettings()
}
watch(open, async (value) => {
  if (!value) return
  await nextTick()
  if (open.value) panel.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
})
onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('keydown', onKeydown)
})
// Turning analysis off closes the settings, but the toolbar toggle stays put.
watch(
  () => props.enabled,
  (enabled) => {
    if (!enabled && open.value) closeSettings(!!panel.value?.contains(document.activeElement))
  },
)
</script>

<template>
  <div
    ref="root"
    class="relative flex items-center gap-0.5"
    data-exam-analysis
    @keydown.stop="onKeydown"
    @focusout="onFocusOut"
  >
    <button
      type="button"
      class="flex h-7 items-center gap-1 rounded-sm px-1.5 text-[10.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
      :class="enabled ? 'bg-clay-soft text-clay-ink' : 'text-ink-3 hover:bg-ink/[0.05] hover:text-ink-2'"
      :aria-pressed="enabled"
      :aria-label="t('analysis.exam.toggle')"
      :title="t('analysis.exam.title')"
      data-testid="analysis-toggle"
      @click="emit('update:enabled', !enabled)"
    >
      <Layers class="size-3.5" aria-hidden="true" />
      <span class="hidden sm:inline">TA</span>
      <span class="size-1.5 rounded-full" :class="enabled ? 'bg-clay' : 'bg-ink/25'" aria-hidden="true" />
    </button>

    <span
      v-if="enabled"
      class="hidden items-center gap-1 text-[10px] text-ink-3 md:flex"
      role="status"
      :title="statusTitle"
      :data-status="status"
    >
      <span class="size-1.5 rounded-full" :class="tone" aria-hidden="true" />
      {{ statusLabel }}
    </span>

    <button
      ref="trigger"
      type="button"
      class="grid size-7 place-items-center rounded-sm text-ink-3 transition-colors hover:bg-ink/[0.05] hover:text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
      :aria-label="t('analysis.exam.settings')"
      :aria-expanded="open"
      :aria-controls="panelId"
      data-testid="analysis-settings-toggle"
      @click="open = !open"
    >
      <SlidersHorizontal class="size-3.5" aria-hidden="true" />
    </button>

    <div
      v-if="open"
      :id="panelId"
      ref="panel"
      class="absolute right-0 top-[calc(100%+6px)] z-40 w-[min(420px,calc(100vw-24px))] rounded-lg border-[length:var(--hairline)] border-line bg-surface-2/95 p-2.5 shadow-lg backdrop-blur-sm max-sm:fixed max-sm:inset-x-3 max-sm:bottom-20 max-sm:top-auto max-sm:max-h-[70vh] max-sm:w-auto max-sm:overflow-y-auto"
      role="region"
      :aria-label="t('analysis.exam.title')"
      data-testid="analysis-settings"
    >
      <div class="flex items-center gap-2">
        <Layers class="size-3.5 shrink-0" :class="enabled ? 'text-clay' : 'text-ink-3'" aria-hidden="true" />
        <p class="min-w-0 flex-1 truncate text-[11px] font-medium">{{ t('analysis.exam.title') }}</p>
        <span class="text-[10px] text-ink-3">{{ t(enabled ? 'analysis.exam.on' : 'analysis.exam.off') }}</span>
        <Switch
          :model-value="enabled"
          :aria-label="t('analysis.exam.toggle')"
          @update:model-value="emit('update:enabled', $event)"
        />
      </div>
      <p class="mt-1 text-[10px] text-ink-3">{{ t('analysis.exam.visibleOnly') }}</p>

      <template v-if="enabled">
        <div class="mt-2 grid grid-cols-2 gap-1" :aria-label="t('analysis.exam.frameworks')">
          <button
            v-for="key in groups"
            :key="key"
            type="button"
            class="min-w-0 rounded-md border px-2 py-1 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
            :class="frameworks[key] ? 'border-clay/30 bg-clay-soft' : 'border-line hover:bg-ink/[0.03]'"
            :aria-pressed="frameworks[key]"
            :aria-label="t(`analysis.exam.groups.${key}`)"
            :data-testid="`analysis-framework-${key}`"
            @click="toggleFramework(key)"
          >
            <span
              class="flex items-center gap-1.5 text-[10.5px] font-medium"
              :class="frameworks[key] ? 'text-clay-ink' : 'text-ink-3'"
            >
              <span
                class="size-1.5 shrink-0 rounded-full"
                :class="frameworks[key] ? 'bg-clay' : 'bg-ink/20'"
                aria-hidden="true"
              />
              <span class="truncate">{{ t(`analysis.exam.groups.${key}`) }}</span>
            </span>
            <span class="mt-0.5 block truncate text-[9.5px] text-ink-2">{{
              frameworks[key] ? summaries[key] : t('analysis.exam.off')
            }}</span>
          </button>
        </div>

        <div
          v-if="shownLayers.length"
          class="mt-1.5 flex flex-wrap items-center gap-1"
          :aria-label="t('analysis.exam.layers')"
        >
          <span class="mr-0.5 text-[9.5px] uppercase tracking-wide text-ink-3">{{ t('analysis.exam.layers') }}</span>
          <button
            v-for="{ key } in shownLayers"
            :key="key"
            type="button"
            class="rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay"
            :class="
              layers[key]
                ? 'border-line-strong bg-sunken text-ink'
                : 'border-transparent text-ink-3 hover:bg-ink/[0.04]'
            "
            :aria-pressed="layers[key]"
            :data-testid="`analysis-layer-${key}`"
            @click="toggleLayer(key)"
          >
            {{ key === 'liquidity' ? t('analysis.exam.levels') : t(`analysis.controls.${key}`) }}
          </button>
        </div>

        <div class="mt-1.5 flex items-center gap-1.5 text-[10px] text-ink-3" role="status" :title="statusTitle">
          <span class="size-1.5 rounded-full" :class="tone" aria-hidden="true" />
          <span>{{ statusLabel }}</span>
          <button
            v-if="status === 'unavailable'"
            type="button"
            class="inline-flex items-center gap-0.5 text-clay-ink hover:underline"
            @click="emit('retry')"
          >
            <RotateCcw class="size-3" aria-hidden="true" />{{ t('analysis.exam.retry') }}
          </button>
        </div>
        <p class="mt-1 text-[9.5px] leading-relaxed text-ink-3">{{ t('analysis.exam.disclaimer') }}</p>
      </template>
    </div>
  </div>
</template>
