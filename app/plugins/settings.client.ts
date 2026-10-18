/**
 * Apply persisted preferences before hydration and keep the i18n locale in
 * sync with the settings store. Uses nuxtApp.$i18n because plugins do not run
 * inside a component setup scope.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const settings = useSettingsStore()
  settings.hydrate()

  const i18n = nuxtApp.$i18n
  if (import.meta.client && i18n.locale.value !== settings.settings.locale) {
    i18n.setLocale(settings.settings.locale)
  }

  watch(
    () => settings.settings.locale,
    (next) => {
      if (i18n.locale.value !== next) i18n.setLocale(next)
    },
  )
})
