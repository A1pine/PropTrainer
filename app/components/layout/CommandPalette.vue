<script setup lang="ts">
import { ArrowRight, Moon, Search, Volume2 } from '@lucide/vue'
import type { Component } from 'vue'
import { navItems, secondaryNavItems } from '~/composables/useNav'

interface Command {
  id: string
  group: 'navigate' | 'actions'
  label: string
  hint?: string
  icon: Component
  run: () => void
}

const { t } = useI18n()
const router = useRouter()
const settings = useSettingsStore()
const { toggle: toggleTheme } = useAppTheme()
const { open, hide } = useCommandPalette()

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const actions = computed<Command[]>(() => [
  {
    id: 'new-session',
    group: 'actions',
    label: t('actions.newSession'),
    hint: t('actions.newSessionHint'),
    icon: ArrowRight,
    run: () => router.push({ path: '/trainer', query: { new: '1' } }),
  },
  { id: 'theme', group: 'actions', label: t('actions.toggleTheme'), icon: Moon, run: toggleTheme },
  {
    id: 'sound',
    group: 'actions',
    label: settings.settings.sound ? t('actions.muteSound') : t('actions.unmuteSound'),
    icon: Volume2,
    run: () => settings.update({ sound: !settings.settings.sound }),
  },
  ...navItems.map((item) => ({
    id: `nav-${item.to}`,
    group: 'navigate' as const,
    label: t(item.labelKey),
    icon: item.icon,
    run: () => router.push(item.to),
  })),
  ...secondaryNavItems.map((item) => ({
    id: `nav-${item.to}`,
    group: 'navigate' as const,
    label: t(item.labelKey),
    icon: item.icon,
    run: () => router.push(item.to),
  })),
])

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return actions.value
  return actions.value.filter((command) => command.label.toLowerCase().includes(needle))
})

const groups = computed(() => [
  {
    id: 'actions' as const,
    label: t('palette.actions'),
    commands: filtered.value.filter((c) => c.group === 'actions'),
  },
  {
    id: 'navigate' as const,
    label: t('palette.navigate'),
    commands: filtered.value.filter((c) => c.group === 'navigate'),
  },
])

function run(command: Command | undefined) {
  if (!command) return
  hide()
  command.run()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = Math.min(filtered.value.length - 1, activeIndex.value + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = Math.max(0, activeIndex.value - 1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    run(filtered.value[activeIndex.value])
  } else if (event.key === 'Escape') {
    event.preventDefault()
    hide()
  }
}

watch(query, () => (activeIndex.value = 0))

watch(open, async (isOpen) => {
  if (!isOpen) return
  query.value = ''
  activeIndex.value = 0
  await nextTick()
  inputRef.value?.focus()
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-[var(--ease-enter)]"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-90" role="presentation">
        <div class="absolute inset-0 bg-black/35 backdrop-blur-[6px]" @click="hide" />
        <div
          class="absolute left-1/2 top-[16vh] w-[calc(100vw-2rem)] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-xl border-[length:var(--hairline)] border-line bg-overlay shadow-lg"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div class="flex items-center gap-3 border-b-[length:var(--hairline)] border-line px-4">
            <Search class="size-4 shrink-0 text-ink-3" aria-hidden="true" />
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-list"
              class="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-3"
              :placeholder="t('palette.placeholder')"
              @keydown="onKeydown"
            />
            <Kbd :keys="['Esc']" />
          </div>
          <div id="command-list" ref="listRef" class="max-h-[52vh] overflow-y-auto p-2" role="listbox">
            <div v-if="!filtered.length" class="px-3 py-8 text-center text-[12.5px] text-ink-3">
              {{ t('palette.empty') }}
            </div>
            <template v-for="group in groups" :key="group.id">
              <div v-if="group.commands.length" class="px-2 pb-1 pt-2">
                <p class="label-micro px-1">{{ group.label }}</p>
                <button
                  v-for="command in group.commands"
                  :key="command.id"
                  type="button"
                  role="option"
                  :aria-selected="filtered[activeIndex]?.id === command.id"
                  class="mt-0.5 flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors"
                  :class="
                    filtered[activeIndex]?.id === command.id
                      ? 'bg-clay-soft text-clay-ink'
                      : 'text-ink-2 hover:bg-ink/[0.04]'
                  "
                  @mouseenter="activeIndex = filtered.findIndex((c) => c.id === command.id)"
                  @click="run(command)"
                >
                  <component :is="command.icon" class="size-4 shrink-0" aria-hidden="true" />
                  <span class="flex-1 text-[13px] font-medium">{{ command.label }}</span>
                  <span v-if="command.hint" class="text-[11px] text-ink-3">{{ command.hint }}</span>
                </button>
              </div>
            </template>
          </div>
          <div
            class="flex items-center gap-4 border-t-[length:var(--hairline)] border-line px-4 py-2 text-[10.5px] text-ink-3"
          >
            <span class="flex items-center gap-1"><Kbd :keys="['↑', '↓']" /> {{ t('palette.move') }}</span>
            <span class="flex items-center gap-1"><Kbd :keys="['↵']" /> {{ t('palette.open') }}</span>
            <span class="ml-auto flex items-center gap-1.5">
              <span class="size-1.5 rounded-full bg-clay" aria-hidden="true" />
              {{ t('app.name') }}
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
