<script setup lang="ts">
import { MoreHorizontal } from '@lucide/vue'
import { isActivePath, mobileNavItems, secondaryNavItems } from '~/composables/useNav'

const { t } = useI18n()
const route = useRoute()
const moreOpen = ref(false)
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-40 flex h-[calc(var(--mobile-tabbar)+env(safe-area-inset-bottom))] items-start border-t-[length:var(--hairline)] border-line bg-surface-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    aria-label="Primary navigation"
  >
    <NuxtLink
      v-for="item in mobileNavItems"
      :key="item.to"
      :to="item.to"
      class="relative flex flex-1 flex-col items-center gap-1 pt-2.5 transition-colors"
      :class="isActivePath(route.path, item.to) ? 'text-clay' : 'text-ink-3'"
      :aria-current="isActivePath(route.path, item.to) ? 'page' : undefined"
    >
      <span
        v-if="isActivePath(route.path, item.to)"
        class="absolute top-0 h-[2px] w-6 rounded-pill bg-clay"
        aria-hidden="true"
      />
      <component :is="item.icon" class="size-5" :stroke-width="isActivePath(route.path, item.to) ? 2 : 1.7" aria-hidden="true" />
      <span class="text-[9.5px] font-medium leading-none">{{ t(item.shortKey) }}</span>
    </NuxtLink>
    <button
      type="button"
      class="flex flex-1 flex-col items-center gap-1 pt-2.5 text-ink-3"
      :aria-label="t('nav.more')"
      @click="moreOpen = true"
    >
      <MoreHorizontal class="size-5" aria-hidden="true" />
      <span class="text-[9.5px] font-medium leading-none">{{ t('nav.more') }}</span>
    </button>

    <Sheet v-model:open="moreOpen" :title="t('nav.more')">
      <div class="space-y-1">
        <NuxtLink
          v-for="item in secondaryNavItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-md px-3 py-3 text-[13px] text-ink-2 transition-colors hover:bg-ink/[0.04]"
          @click="moreOpen = false"
        >
          <component :is="item.icon" class="size-4 text-ink-3" aria-hidden="true" />
          {{ t(item.labelKey) }}
        </NuxtLink>
        <div class="flex items-center justify-between rounded-md px-3 py-2">
          <span class="text-[12.5px] text-ink-2">{{ t('common.language') }}</span>
          <LocaleSwitcher />
        </div>
        <div class="flex items-center justify-between rounded-md px-3 py-2">
          <span class="text-[12.5px] text-ink-2">{{ t('common.theme') }}</span>
          <ThemeToggle variant="segmented" />
        </div>
      </div>
    </Sheet>
  </nav>
</template>
