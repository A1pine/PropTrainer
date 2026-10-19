<script setup lang="ts">
import { ChartCandlestick, Search, Volume2, VolumeX } from '@lucide/vue'
import { navItems, secondaryNavItems, isActivePath } from '~/composables/useNav'

const { t } = useI18n()
const route = useRoute()
const settings = useSettingsStore()
const palette = useCommandPalette()

const activeItem = computed(() => [...navItems, ...secondaryNavItems].find((item) => isActivePath(route.path, item.to)))

const title = computed(() => (activeItem.value ? t(activeItem.value.labelKey) : t('app.name')))

function toggleSound() {
  settings.update({ sound: !settings.settings.sound })
}
</script>

<template>
  <header
    class="sticky top-0 z-30 flex h-[var(--topbar-height)] items-center gap-3 border-b-[length:var(--hairline)] border-line bg-surface-1/85 px-4 backdrop-blur-xl md:px-6"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <NuxtLink
        to="/"
        class="grid size-7 place-items-center rounded-md bg-clay text-on-clay md:hidden"
        aria-label="Prop Desk home"
      >
        <ChartCandlestick class="size-4" aria-hidden="true" />
      </NuxtLink>
      <div class="min-w-0">
        <p class="label-micro hidden sm:block">{{ t('app.eyebrow') }}</p>
        <h1 class="truncate text-[15px] font-semibold leading-tight tracking-tight">{{ title }}</h1>
      </div>
    </div>

    <div class="flex items-center gap-1.5">
      <span class="hidden items-center gap-1.5 rounded-pill border border-line px-2 py-1 lg:inline-flex">
        <span class="size-1.5 rounded-full bg-clay animate-pulse-dot" aria-hidden="true" />
        <span class="text-[10.5px] font-medium text-ink-2">{{ t('common.simulated') }}</span>
      </span>

      <button
        type="button"
        class="hidden h-8 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-[11.5px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2 sm:flex"
        @click="palette.show()"
      >
        <Search class="size-3.5" aria-hidden="true" />
        <span>{{ t('common.search') }}</span>
        <Kbd :keys="['⌘', 'K']" class="ml-2" />
      </button>

      <ClientOnly>
        <Tooltip :content="settings.settings.sound ? t('common.soundOn') : t('common.soundOff')">
          <button
            type="button"
            class="grid size-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink"
            :aria-label="settings.settings.sound ? t('common.soundOn') : t('common.soundOff')"
            :aria-pressed="settings.settings.sound"
            @click="toggleSound"
          >
            <Volume2 v-if="settings.settings.sound" class="size-4" aria-hidden="true" />
            <VolumeX v-else class="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </ClientOnly>

      <ThemeToggle :labels="{ switchToLight: t('actions.switchToLight'), switchToDark: t('actions.switchToDark') }" />
    </div>
  </header>
</template>
