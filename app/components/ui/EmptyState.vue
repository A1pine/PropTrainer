<script setup lang="ts">
withDefaults(
  defineProps<{
    icon?: unknown
    title: string
    description?: string
    compact?: boolean
  }>(),
  { compact: false },
)
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 text-center" :class="compact ? 'py-6' : 'py-12'">
    <div
      class="grid size-10 place-items-center rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 text-ink-3"
    >
      <component :is="icon" v-if="icon" class="size-4.5" aria-hidden="true" />
      <span v-else class="size-1.5 rounded-full bg-clay" />
    </div>
    <div class="space-y-1">
      <p class="text-[13px] font-medium text-ink">{{ title }}</p>
      <p v-if="description" class="mx-auto max-w-[34ch] text-[12px] leading-relaxed text-ink-3">
        {{ description }}
      </p>
    </div>
    <slot />
  </div>
</template>
