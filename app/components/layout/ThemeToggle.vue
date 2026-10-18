<script setup lang="ts">
import { Monitor, Moon, Sun } from '@lucide/vue'

const props = withDefaults(defineProps<{ variant?: 'icon' | 'segmented'; labels?: Record<string, string> }>(), {
  variant: 'icon',
  labels: () => ({ light: 'Light', dark: 'Dark', system: 'System', theme: 'Toggle theme' }),
})

const settings = useSettingsStore()
const { toggle, set } = useAppTheme()

const options = computed(() => [
  { value: 'light', label: props.labels.light ?? 'Light', icon: Sun },
  { value: 'dark', label: props.labels.dark ?? 'Dark', icon: Moon },
  { value: 'system', label: props.labels.system ?? 'System', icon: Monitor },
])

const mode = computed({
  get: () => settings.settings.theme as string,
  set: (value) => set(value as 'light' | 'dark' | 'system'),
})
</script>

<template>
  <SegmentedControl v-if="variant === 'segmented'" v-model="mode" :options="options" />
  <Tooltip v-else :content="labels.theme ?? 'Toggle theme'" side="right">
    <button
      type="button"
      class="grid size-9 place-items-center rounded-md text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink"
      :aria-label="labels.theme ?? 'Toggle theme'"
      @click="toggle"
    >
      <Sun class="size-4 dark:hidden" aria-hidden="true" />
      <Moon class="hidden size-4 dark:block" aria-hidden="true" />
    </button>
  </Tooltip>
</template>
