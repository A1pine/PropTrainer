<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <main class="grid min-h-dvh place-items-center p-8">
    <div class="text-center">
      <p class="text-xs uppercase tracking-[0.28em] text-neutral-500">{{ t('app.tagline') }}</p>
      <h1 class="mt-3 text-4xl font-semibold tracking-tight">{{ t('app.name') }}</h1>
    </div>
  </main>
</template>
