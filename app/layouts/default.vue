<script setup lang="ts">
const { apply } = useAppTheme()
const { open } = useCommandPalette()
const settings = useSettingsStore()

onMounted(() => {
  apply()
  settings.hydrate()
  window.addEventListener('keydown', onGlobalKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
})

function onGlobalKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    open.value = !open.value
  }
}
</script>

<template>
  <div class="min-h-dvh bg-surface-1">
    <AppRail />
    <div class="flex min-h-dvh flex-col md:pl-[76px]">
      <AppTopbar />
      <main class="flex-1 pb-[var(--mobile-tabbar)] md:pb-0">
        <slot />
      </main>
    </div>
    <MobileTabBar />
    <Toaster />
    <CommandPalette />
  </div>
</template>
