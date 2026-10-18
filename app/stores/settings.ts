import { createWebStore } from '~/lib/storage'
import { defaultSettings, parseSettings, type Settings } from '~/domain/settings/schema'

const KEY = 'settings'
const COOKIE = 'propdesk-settings'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Settings persist twice: localStorage for the device and a small cookie so
 * SSR can render the same theme, account and toggles as the client. Without
 * the cookie, hydration would correct every persisted control after paint.
 */
export const useSettingsStore = defineStore('settings', () => {
  const store = createWebStore('propdesk.v1')
  const cookie = useCookie<Settings | null>(COOKIE, {
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    watch: false,
  })

  const serverSettings = import.meta.server ? parseSettings(cookie.value ?? defaultSettings) : null
  const initial = import.meta.server
    ? (serverSettings as Settings)
    : parseSettings(store.read<Settings>(KEY) ?? cookie.value ?? defaultSettings)

  const settings = ref<Settings>(initial)
  const hydrated = ref(import.meta.server)

  const riskBudget = computed(() => (settings.value.accountSize * settings.value.riskPerTrade) / 100)

  function persist(value: Settings) {
    if (import.meta.client) {
      store.write(KEY, value)
      cookie.value = value
    }
  }

  function hydrate() {
    if (import.meta.server || hydrated.value) return
    settings.value = parseSettings(store.read<Settings>(KEY) ?? cookie.value ?? defaultSettings)
    persist(settings.value)
    hydrated.value = true
  }

  function update(patch: Partial<Settings>) {
    settings.value = parseSettings({ ...settings.value, ...patch })
    persist(settings.value)
  }

  function reset() {
    settings.value = { ...defaultSettings }
    persist(settings.value)
  }

  // One writer for every mutation path (actions, direct field updates, reset).
  watch(
    settings,
    (value) => {
      if (hydrated.value) persist(value)
    },
    { deep: true },
  )

  // Keep the cookie warm on a fresh device that only has localStorage.
  if (import.meta.client && !cookie.value) {
    cookie.value = settings.value
  }

  return { settings, hydrated, riskBudget, hydrate, update, reset }
})
