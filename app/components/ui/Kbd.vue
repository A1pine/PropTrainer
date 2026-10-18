<script setup lang="ts">
defineProps<{ keys: string[] }>()
</script>

<template>
  <span class="inline-flex items-center gap-1">
    <kbd
      v-for="key in keys"
      :key="key"
      class="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-surface-2 px-1.5 font-mono text-[10.5px] font-medium text-ink-3 shadow-[0_1px_0_var(--line)]"
    >
      {{ key }}
    </kbd>
  </span>
</template>
