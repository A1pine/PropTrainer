<script setup lang="ts">
import { usePreferredDark } from '@vueuse/core'

const { locale, t } = useI18n()
const settings = useSettingsStore()
const prefersDark = usePreferredDark()

const resolvedTheme = computed<'light' | 'dark'>(() => {
  const mode = settings.settings.theme
  if (mode === 'system') return prefersDark.value ? 'dark' : 'light'
  return mode
})

useHead({
  htmlAttrs: { lang: computed(() => locale.value) },
  titleTemplate: (title?: string) => (title ? `${title} · ${t('app.name')}` : t('app.name')),
  meta: [
    // Tells the browser (and dark-mode extensions) that both schemes are
    // first-class here. Chrome's auto-dark and Safari's tint then leave the
    // page alone instead of inverting a light page into a muddy dark one.
    { name: 'color-scheme', content: 'light dark' },
    {
      name: 'theme-color',
      content: computed(() => (resolvedTheme.value === 'dark' ? '#0b0b0b' : '#f9f9f7')),
    },
  ],
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
