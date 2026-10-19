<script setup lang="ts">
import { Monitor, Moon, Sun } from '@lucide/vue'

const props = withDefaults(defineProps<{ variant?: 'icon' | 'segmented'; labels?: Record<string, string> }>(), {
  variant: 'icon',
  labels: () => ({ light: 'Light', dark: 'Dark', system: 'System', theme: 'Toggle theme' }),
})

const settings = useSettingsStore()
const { toggle, set, isDark } = useAppTheme()

const options = computed(() => [
  { value: 'light', label: props.labels.light ?? 'Light', icon: Sun },
  { value: 'dark', label: props.labels.dark ?? 'Dark', icon: Moon },
  { value: 'system', label: props.labels.system ?? 'System', icon: Monitor },
])

// The icon advertises the *action*, not the current state: sun = switch to
// light, moon = switch to dark. That keeps it unambiguous next to an already
// light or dark page.
// The icon advertises the *action*, not the current state: a sun on a dark
// page means "switch to light". Visibility is CSS-driven (`dark:` variants) so
// server and client markup agree even when `theme: 'system'` flips the resolved
// palette after hydration.
const actionLabel = computed(() =>
  isDark.value
    ? (props.labels.switchToLight ?? 'Switch to light theme')
    : (props.labels.switchToDark ?? 'Switch to dark theme'),
)

const mode = computed({
  get: () => settings.settings.theme as string,
  set: (value) => set(value as 'light' | 'dark' | 'system'),
})
</script>

<template>
  <SegmentedControl v-if="variant === 'segmented'" v-model="mode" :options="options" />
  <Tooltip v-else :content="actionLabel" side="right">
    <button
      type="button"
      class="grid size-9 place-items-center rounded-md text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink"
      aria-label="Toggle colour theme"
      @click="toggle"
    >
      <Sun class="hidden size-4 dark:block" aria-hidden="true" />
      <Moon class="size-4 dark:hidden" aria-hidden="true" />
    </button>
  </Tooltip>
</template>
