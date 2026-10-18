import { createWebStore } from '~/lib/storage'
import { defaultSettings, parseSettings, type Settings } from '~/domain/settings/schema'

const KEY = 'settings'

export const useSettingsStore = defineStore('settings', () => {
  const store = createWebStore('propdesk.v1')
  const settings = ref<Settings>(parseSettings(store.read<Settings>(KEY) ?? defaultSettings))
  const hydrated = ref(false)

  const riskBudget = computed(() => (settings.value.accountSize * settings.value.riskPerTrade) / 100)

  function hydrate() {
    if (import.meta.server || hydrated.value) return
    settings.value = parseSettings(store.read<Settings>(KEY) ?? defaultSettings)
    hydrated.value = true
  }

  function update(patch: Partial<Settings>) {
    settings.value = parseSettings({ ...settings.value, ...patch })
    if (import.meta.client) store.write(KEY, settings.value)
  }

  function reset() {
    settings.value = { ...defaultSettings }
    if (import.meta.client) store.write(KEY, settings.value)
  }

  // Keep persistence in one place instead of scattering writes across components.
  watch(
    settings,
    (value) => {
      if (import.meta.client && hydrated.value) store.write(KEY, value)
    },
    { deep: true },
  )

  return { settings, hydrated, riskBudget, hydrate, update, reset }
})
