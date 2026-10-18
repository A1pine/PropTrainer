import { usePreferredDark } from '@vueuse/core'

/**
 * Resolves the persisted theme preference against the OS setting and applies
 * it to <html>. Kept in one composable so no component mutates the root class.
 */
export function useAppTheme() {
  const settings = useSettingsStore()
  const prefersDark = usePreferredDark()
  const resolved = computed<'light' | 'dark'>(() => {
    const mode = settings.settings.theme
    if (mode === 'system') return prefersDark.value ? 'dark' : 'light'
    return mode
  })

  const isDark = computed(() => resolved.value === 'dark')

  function apply() {
    if (import.meta.server) return
    const root = document.documentElement
    root.classList.toggle('dark', isDark.value)
    root.style.colorScheme = resolved.value
    root.dataset.motion = settings.settings.reduceMotion ? 'reduced' : 'full'
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', isDark.value ? '#0b0b0b' : '#f9f9f7')
  }

  function toggle() {
    settings.update({ theme: isDark.value ? 'light' : 'dark' })
  }

  function set(mode: 'light' | 'dark' | 'system') {
    settings.update({ theme: mode })
  }

  watch([resolved, () => settings.settings.reduceMotion], apply, { flush: 'post' })

  return { resolved, isDark, apply, toggle, set }
}
