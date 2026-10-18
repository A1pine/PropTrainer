<script setup lang="ts">
const { locale, t } = useI18n()
useHead({
  htmlAttrs: { lang: computed(() => locale.value) },
  titleTemplate: (title?: string) => (title ? `${title} · ${t('app.name')}` : t('app.name')),
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
