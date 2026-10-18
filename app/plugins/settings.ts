/**
 * Apply persisted preferences before the first render. The locale travels in a
 * cookie so SSR and hydration agree; everything else lives in localStorage.
 */
export default defineNuxtPlugin(async (nuxtApp) => {
  const settings = useSettingsStore()
  settings.hydrate()

  const i18n = nuxtApp.$i18n
  const cookie = useCookie<string | null>('propdesk-locale', { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  const supported = ['en', 'zh-CN', 'ja']

  const preferred =
    (cookie.value && supported.includes(cookie.value) ? cookie.value : null) ??
    (import.meta.client ? settings.settings.locale : null) ??
    'en'

  if (i18n.locale.value !== preferred) {
    await i18n.setLocale(preferred)
  }

  if (import.meta.client) {
    cookie.value = preferred
    if (settings.settings.locale !== preferred) {
      settings.update({ locale: preferred as typeof settings.settings.locale })
    }
    watch(
      () => settings.settings.locale,
      (next) => {
        cookie.value = next
        if (i18n.locale.value !== next) i18n.setLocale(next)
      },
    )
  }
})
