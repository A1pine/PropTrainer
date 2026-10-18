<script setup lang="ts">
import { Check, Download, RotateCcw, Trash2 } from '@lucide/vue'
import { PROP_PRESETS, createRules } from '~/domain/trading/types'
import type { AccountPresetId } from '~/domain/settings/schema'

useHead({ title: 'Settings' })

const { t, locale } = useI18n()
const settingsStore = useSettingsStore()
const history = useHistoryStore()
const computeStatus = useComputeCoreStatus()
const toasts = useToastStore()

const settings = computed(() => settingsStore.settings)
const themeLabels = computed(() => ({ light: t('common.light'), dark: t('common.dark'), system: t('common.system') }))

const presetOptions = computed(() => [
  { value: 'eval-50k', label: t('settings.presets.eval50'), hint: t('settings.presets.evaluation') },
  { value: 'eval-100k', label: t('settings.presets.eval100'), hint: t('settings.presets.evaluation') },
  { value: 'funded-50k', label: t('settings.presets.funded50'), hint: t('settings.presets.funded') },
  { value: 'custom', label: t('settings.presets.custom'), hint: t('settings.presets.manual') },
])

const presetModel = computed({
  get: () => settings.value.accountPreset,
  set: (value: string) => {
    const preset = value as AccountPresetId
    if (preset === 'custom') {
      settingsStore.update({ accountPreset: preset })
      return
    }
    const rule = PROP_PRESETS[preset]
    settingsStore.update({ accountPreset: preset, accountSize: rule.accountSize, maxContracts: rule.maxContracts })
  },
})

const speedOptions = [
  { value: '1', label: '0.5×' },
  { value: '2', label: '1×' },
  { value: '4', label: '2×' },
  { value: '8', label: '4×' },
]
const speedModel = computed({
  get: () => String(settings.value.autoPlaySpeed),
  set: (value: string) => settingsStore.update({ autoPlaySpeed: Number(value) }),
})

const motionModel = computed({
  get: () => (settings.value.reduceMotion ? 'reduced' : 'full'),
  set: (value: string) => settingsStore.update({ reduceMotion: value === 'reduced' }),
})
const motionOptions = computed(() => [
  { value: 'full', label: t('settings.appearance.full') },
  { value: 'reduced', label: t('settings.appearance.reduced') },
])

const themeModel = computed({
  get: () => settings.value.theme,
  set: (value: string) => settingsStore.update({ theme: value as typeof settings.value.theme }),
})
const themeOptions = computed(() => [
  { value: 'light', label: themeLabels.value.light },
  { value: 'dark', label: themeLabels.value.dark },
  { value: 'system', label: themeLabels.value.system },
])

const derived = computed(() =>
  createRules({
    preset: settings.value.accountPreset,
    accountSize: settings.value.accountSize,
    maxContracts: settings.value.maxContracts,
  }),
)

const resetHistoryOpen = ref(false)
const resetSettingsOpen = ref(false)

function toggleInstrument(symbol: string) {
  const current = settings.value.instruments
  const next = current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol]
  if (next.length < 1) return
  settingsStore.update({ instruments: next })
}

function setAccountSize(value: number | null) {
  if (value == null) return
  settingsStore.update({ accountSize: value, accountPreset: 'custom' })
}

function exportJson() {
  const blob = new Blob([history.exportJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `prop-desk-history-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function resetHistory() {
  history.clear()
  resetHistoryOpen.value = false
  toasts.success(t('settings.data.historyCleared'))
}

function resetSettings() {
  settingsStore.reset()
  resetSettingsOpen.value = false
  toasts.success(t('settings.data.settingsReset'))
}

onMounted(() => {
  settingsStore.hydrate()
  history.hydrate()
})
</script>

<template>
  <div class="mx-auto max-w-[820px] px-4 py-8 md:px-6 md:py-10">
    <header>
      <p class="label-micro">{{ t('settings.kicker') }}</p>
      <h1 class="serif mt-2 text-[clamp(1.9rem,3.6vw,2.8rem)] font-medium tracking-tight">{{ t('settings.title') }}</h1>
      <p class="mt-2 max-w-[58ch] text-[12.5px] leading-relaxed text-ink-2">{{ t('settings.subtitle') }}</p>
    </header>

    <div class="mt-6 space-y-3">
      <Panel :padded="false">
        <div class="border-b-[length:var(--hairline)] border-line px-5 py-3.5">
          <p class="text-[12.5px] font-semibold">{{ t('settings.appearance.title') }}</p>
          <p class="mt-0.5 text-[10.5px] text-ink-3">{{ t('settings.appearance.hint') }}</p>
        </div>
        <div class="divide-y-[length:var(--hairline)] divide-line">
          <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p class="text-[11.5px] font-medium">{{ t('common.theme') }}</p>
              <p class="text-[10.5px] text-ink-3">{{ t('settings.appearance.themeHint') }}</p>
            </div>
            <SegmentedControl
              v-model="themeModel"
              :options="themeOptions"
              size="sm"
              :aria-label="t('common.theme')"
              class="w-[220px]"
            />
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p class="text-[11.5px] font-medium">{{ t('settings.appearance.motion') }}</p>
              <p class="text-[10.5px] text-ink-3">{{ t('settings.appearance.motionHint') }}</p>
            </div>
            <SegmentedControl
              v-model="motionModel"
              :options="motionOptions"
              size="sm"
              :aria-label="t('settings.appearance.motion')"
              class="w-[200px]"
            />
          </div>
        </div>
      </Panel>

      <Panel :padded="false">
        <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <p class="text-[12.5px] font-semibold">{{ t('settings.language.title') }}</p>
            <p class="mt-0.5 text-[10.5px] text-ink-3">{{ t('settings.languageNote') }}</p>
          </div>
          <LocaleSwitcher variant="select" />
        </div>
      </Panel>

      <Panel :padded="false">
        <div class="border-b-[length:var(--hairline)] border-line px-5 py-3.5">
          <p class="text-[12.5px] font-semibold">{{ t('settings.risk.title') }}</p>
          <p class="mt-0.5 text-[10.5px] text-ink-3">{{ t('settings.risk.hint') }}</p>
        </div>
        <div class="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field :label="t('settings.risk.preset')">
            <Select v-model="presetModel" :options="presetOptions" />
          </Field>
          <Field :label="t('settings.risk.accountSize')" :hint="t('settings.risk.accountSizeHint')">
            <NumberField
              :model-value="settings.accountSize"
              :min="1000"
              :max="10000000"
              :step="1000"
              :precision="0"
              suffix="USD"
              @update:model-value="setAccountSize"
            />
          </Field>
          <Field
            :label="t('settings.risk.riskPerTrade')"
            :hint="
              t('settings.risk.riskPerTradeHint', {
                amount: formatMoney((settings.accountSize * settings.riskPerTrade) / 100, { decimals: 0 }),
              })
            "
          >
            <NumberField
              :model-value="settings.riskPerTrade"
              :min="0.1"
              :max="10"
              :step="0.1"
              :precision="1"
              suffix="%"
              @update:model-value="settingsStore.update({ riskPerTrade: $event ?? 1 })"
            />
          </Field>
          <Field :label="t('settings.risk.maxContracts')" :hint="t('settings.risk.maxContractsHint')">
            <NumberField
              :model-value="settings.maxContracts"
              :min="1"
              :max="100"
              :step="1"
              :precision="0"
              @update:model-value="settingsStore.update({ maxContracts: $event ?? 1 })"
            />
          </Field>
          <Field :label="t('settings.risk.fee')" :hint="t('settings.risk.feeHint')" class="sm:col-span-2">
            <NumberField
              :model-value="settings.feePerContract"
              :min="0"
              :max="20"
              :step="0.01"
              :precision="2"
              suffix="/ contract"
              @update:model-value="settingsStore.update({ feePerContract: $event ?? 0 })"
            />
          </Field>
        </div>
        <div class="mx-5 mb-4 grid grid-cols-2 gap-2 rounded-md border border-line bg-sunken p-3 sm:grid-cols-4">
          <div>
            <p class="label-micro">{{ t('settings.risk.profitTarget') }}</p>
            <p class="num mt-0.5 text-[12px]">{{ formatMoney(derived.profitTarget, { decimals: 0 }) }}</p>
          </div>
          <div>
            <p class="label-micro">{{ t('settings.risk.trailing') }}</p>
            <p class="num mt-0.5 text-[12px]">{{ formatMoney(derived.maxDrawdown, { decimals: 0 }) }}</p>
          </div>
          <div>
            <p class="label-micro">{{ t('settings.risk.daily') }}</p>
            <p class="num mt-0.5 text-[12px]">{{ formatMoney(derived.dailyLossLimit, { decimals: 0 }) }}</p>
          </div>
          <div>
            <p class="label-micro">{{ t('settings.risk.contractCap') }}</p>
            <p class="num mt-0.5 text-[12px]">{{ derived.maxContracts }}</p>
          </div>
        </div>
      </Panel>

      <Panel :padded="false">
        <div class="border-b-[length:var(--hairline)] border-line px-5 py-3.5">
          <p class="text-[12.5px] font-semibold">{{ t('settings.universe.title') }}</p>
          <p class="mt-0.5 text-[10.5px] text-ink-3">{{ t('settings.universe.hint') }}</p>
        </div>
        <div class="px-5 py-4">
          <InstrumentRail :selected="settings.instruments" @toggle="toggleInstrument" />
        </div>
      </Panel>

      <Panel :padded="false">
        <div class="border-b-[length:var(--hairline)] border-line px-5 py-3.5">
          <p class="text-[12.5px] font-semibold">{{ t('settings.session.title') }}</p>
          <p class="mt-0.5 text-[10.5px] text-ink-3">{{ t('settings.session.hint') }}</p>
        </div>
        <div class="divide-y-[length:var(--hairline)] divide-line">
          <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p class="text-[11.5px] font-medium">{{ t('settings.session.speed') }}</p>
              <p class="text-[10.5px] text-ink-3">{{ t('settings.session.speedHint') }}</p>
            </div>
            <SegmentedControl
              v-model="speedModel"
              :options="speedOptions"
              size="sm"
              class="w-[220px]"
              :aria-label="t('settings.session.speed')"
            />
          </div>
          <div class="flex items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p class="text-[11.5px] font-medium">{{ t('settings.session.showR') }}</p>
              <p class="text-[10.5px] text-ink-3">{{ t('settings.session.showRHint') }}</p>
            </div>
            <Switch
              :model-value="settings.showRMultiple"
              :aria-label="t('settings.session.showR')"
              @update:model-value="settingsStore.update({ showRMultiple: $event })"
            />
          </div>
          <div class="flex items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p class="text-[11.5px] font-medium">{{ t('settings.session.confirm') }}</p>
              <p class="text-[10.5px] text-ink-3">{{ t('settings.session.confirmHint') }}</p>
            </div>
            <Switch
              :model-value="settings.confirmBeforeSubmit"
              :aria-label="t('settings.session.confirm')"
              @update:model-value="settingsStore.update({ confirmBeforeSubmit: $event })"
            />
          </div>
          <div class="flex items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p class="text-[11.5px] font-medium">{{ t('settings.audio.sound') }}</p>
              <p class="text-[10.5px] text-ink-3">{{ t('settings.audio.hint') }}</p>
            </div>
            <Switch
              :model-value="settings.sound"
              :aria-label="t('settings.audio.sound')"
              @update:model-value="settingsStore.update({ sound: $event })"
            />
          </div>
        </div>
      </Panel>

      <Panel :padded="false">
        <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <p class="text-[12.5px] font-semibold">{{ t('settings.compute.title') }}</p>
            <p class="mt-0.5 max-w-[52ch] text-[10.5px] text-ink-3">{{ t('settings.compute.hint') }}</p>
          </div>
          <Badge :variant="computeStatus === 'rust' ? 'bull' : 'warn'" dot>
            {{ t(`settings.compute.${computeStatus}`) }}
          </Badge>
        </div>
      </Panel>

      <Panel :padded="false">
        <div class="border-b-[length:var(--hairline)] border-line px-5 py-3.5">
          <p class="text-[12.5px] font-semibold">{{ t('settings.data.title') }}</p>
          <p class="mt-0.5 text-[10.5px] text-ink-3">{{ t('settings.data.hint') }}</p>
        </div>
        <div class="divide-y-[length:var(--hairline)] divide-line">
          <div class="flex items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p class="text-[11.5px] font-medium">{{ t('settings.data.export') }}</p>
              <p class="text-[10.5px] text-ink-3">{{ t('settings.data.exportHint') }}</p>
            </div>
            <Button variant="secondary" size="sm" @click="exportJson"
              ><Download class="size-3.5" aria-hidden="true" />{{ t('common.export') }}</Button
            >
          </div>
          <div class="flex items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p class="text-[11.5px] font-medium">{{ t('settings.data.resetHistory') }}</p>
              <p class="text-[10.5px] text-ink-3">{{ t('settings.data.resetHistoryHint') }}</p>
            </div>
            <Button
              variant="danger-ghost"
              size="sm"
              :disabled="!history.sessions.length"
              @click="resetHistoryOpen = true"
              ><Trash2 class="size-3.5" aria-hidden="true" />{{ t('common.reset') }}</Button
            >
          </div>
          <div class="flex items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p class="text-[11.5px] font-medium">{{ t('settings.data.resetSettings') }}</p>
              <p class="text-[10.5px] text-ink-3">{{ t('settings.data.resetSettingsHint') }}</p>
            </div>
            <Button variant="ghost" size="sm" @click="resetSettingsOpen = true"
              ><RotateCcw class="size-3.5" aria-hidden="true" />{{ t('common.reset') }}</Button
            >
          </div>
        </div>
      </Panel>
    </div>

    <div class="mt-5 flex flex-wrap items-center gap-3 text-[10px] text-ink-3">
      <span class="flex items-center gap-1.5"
        ><Check class="size-3 text-bull" aria-hidden="true" />{{ t('settings.saved') }}</span
      >
      <span class="h-2.5 w-[length:var(--hairline)] bg-line" aria-hidden="true" />
      <span class="font-mono">v{{ $config.public.appVersion }}</span>
      <span>·</span>
      <span>{{ t('settings.disclaimer') }}</span>
    </div>

    <Dialog
      v-model:open="resetHistoryOpen"
      :title="t('settings.data.resetHistory')"
      :description="t('settings.data.resetHistoryBody')"
      size="sm"
    >
      <p class="text-[12px] leading-relaxed text-ink-2">{{ t('settings.data.resetHistoryNote') }}</p>
      <template #footer>
        <Button variant="ghost" size="sm" @click="resetHistoryOpen = false">{{ t('common.cancel') }}</Button>
        <Button variant="danger" size="sm" @click="resetHistory">{{ t('settings.data.confirmReset') }}</Button>
      </template>
    </Dialog>

    <Dialog
      v-model:open="resetSettingsOpen"
      :title="t('settings.data.resetSettings')"
      :description="t('settings.data.resetSettingsBody')"
      size="sm"
    >
      <p class="text-[12px] leading-relaxed text-ink-2">{{ t('settings.data.resetSettingsNote') }}</p>
      <template #footer>
        <Button variant="ghost" size="sm" @click="resetSettingsOpen = false">{{ t('common.cancel') }}</Button>
        <Button variant="danger" size="sm" @click="resetSettings">{{ t('settings.data.confirmReset') }}</Button>
      </template>
    </Dialog>
  </div>
</template>
