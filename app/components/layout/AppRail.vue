<script setup lang="ts">
import { isActivePath, navItems, secondaryNavItems } from '~/composables/useNav'

const { t } = useI18n()
const route = useRoute()
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-40 hidden w-[76px] flex-col items-center border-r-[length:var(--hairline)] border-line bg-surface-0 py-4 md:flex"
    aria-label="Primary navigation"
  >
    <NuxtLink
      to="/"
      class="group relative grid size-10 place-items-center rounded-xl bg-clay text-on-clay shadow-sm transition-transform duration-200 ease-snap hover:scale-105 active:scale-95"
      aria-label="Prop Desk home"
    >
      <svg viewBox="0 0 32 32" class="size-5" fill="none" aria-hidden="true">
        <path d="M8 6v20M6 12h4v9H6z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        <path d="M16 4v24M14 10h4v12h-4z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        <path d="M24 8v18M22 14h4v8h-4z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
      <span class="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/15" aria-hidden="true" />
    </NuxtLink>

    <nav class="mt-7 flex w-full flex-col items-center gap-0.5 px-2">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="group relative flex w-full flex-col items-center gap-1 rounded-lg py-2 transition-colors duration-150"
        :class="
          isActivePath(route.path, item.to)
            ? 'bg-clay-soft text-clay-ink'
            : 'text-ink-3 hover:bg-ink/[0.04] hover:text-ink-2'
        "
        :aria-current="isActivePath(route.path, item.to) ? 'page' : undefined"
      >
        <span
          v-if="isActivePath(route.path, item.to)"
          class="absolute -left-2 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-pill bg-clay"
          aria-hidden="true"
        />
        <component :is="item.icon" class="size-[18px]" :stroke-width="1.7" aria-hidden="true" />
        <span class="text-[9.5px] font-medium leading-none tracking-wide">{{ t(item.shortKey) }}</span>
      </NuxtLink>
    </nav>

    <div class="mt-auto flex w-full flex-col items-center gap-1 px-2 pt-3">
      <div class="mb-1 h-[length:var(--hairline)] w-8 bg-line" aria-hidden="true" />
      <ThemeToggle />
      <LocaleSwitcher variant="button" />
      <NuxtLink
        v-for="item in secondaryNavItems"
        :key="item.to"
        :to="item.to"
        class="group relative flex w-full flex-col items-center gap-1 rounded-lg py-2 transition-colors duration-150"
        :class="
          isActivePath(route.path, item.to)
            ? 'bg-clay-soft text-clay-ink'
            : 'text-ink-3 hover:bg-ink/[0.04] hover:text-ink-2'
        "
        :aria-current="isActivePath(route.path, item.to) ? 'page' : undefined"
      >
        <component :is="item.icon" class="size-[17px]" :stroke-width="1.7" aria-hidden="true" />
        <span class="text-[9.5px] font-medium leading-none tracking-wide">{{ t(item.shortKey) }}</span>
      </NuxtLink>
    </div>
  </aside>
</template>
