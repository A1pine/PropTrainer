<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Keyboard, RotateCcw, X } from '@lucide/vue'
import {
  DEFAULT_BINDINGS,
  HOTKEY_ACTIONS,
  bindingError,
  formatHotkey,
  withBinding,
  type HotkeyAction,
  type HotkeySettings,
} from '~/lib/sim/hotkeys'

const props = defineProps<{ settings: HotkeySettings }>()
const emit = defineEmits<{
  'update:settings': [HotkeySettings]
  'open-change': [boolean]
}>()
const { t } = useI18n()

const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const toggle = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const capturing = ref<HotkeyAction | null>(null)
const notice = ref<'reserved' | 'duplicate' | null>(null)
const panelId = useId()

const rows = computed(() =>
  HOTKEY_ACTIONS.map((action) => ({
    action,
    label: t(`terminal.hotkeys.actions.${action}`),
    key: props.settings.bindings[action],
  })),
)

function close(options: { restoreFocus?: boolean } = {}) {
  cancelCapture()
  if (!open.value) return
  open.value = false
  emit('open-change', false)
  if (options.restoreFocus) toggle.value?.focus({ preventScroll: true })
}

async function toggleOpen() {
  if (open.value) {
    close({ restoreFocus: true })
    return
  }
  open.value = true
  emit('open-change', true)
  await nextTick()
  if (open.value) panel.value?.focus({ preventScroll: true })
}

function setEnabled(value: boolean) {
  emit('update:settings', { ...props.settings, enabled: value })
}

function startCapture(action: HotkeyAction) {
  if (!open.value) return
  capturing.value = action
  notice.value = null
}

function cancelCapture() {
  capturing.value = null
  notice.value = null
}

function resetDefaults() {
  // Reset bindings without changing the trader's opt-in choice.
  emit('update:settings', { enabled: props.settings.enabled, bindings: { ...DEFAULT_BINDINGS } })
  cancelCapture()
}

function consumeKey(event: KeyboardEvent) {
  event.preventDefault()
  event.stopImmediatePropagation()
}

// Capture rebinding and Escape before the page's window-level hotkey handler.
function onCaptureKeydown(event: KeyboardEvent) {
  if (!open.value) return
  const modified = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
  if (event.key === 'Escape' && !modified) {
    const ignored = event.defaultPrevented || event.repeat || event.isComposing
    consumeKey(event)
    if (ignored) return
    if (capturing.value) cancelCapture()
    else close({ restoreFocus: true })
    return
  }

  const action = capturing.value
  if (!action) return
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    consumeKey(event)
    return
  }
  if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    // Leave Tab/Shift+Tab navigation intact; capture must not trap keyboard users.
    cancelCapture()
    return
  }
  consumeKey(event)
  const error = modified ? 'reserved' : bindingError(action, event.key, props.settings.bindings)
  if (error) {
    notice.value = error
    return
  }
  emit('update:settings', withBinding(props.settings, action, event.key))
  cancelCapture()
}

// Hide keys from the page while preserving native control and Tab behavior.
function onPanelKeydown(event: KeyboardEvent) {
  if (open.value) event.stopImmediatePropagation()
}

function onOutsideInteraction(event: Event) {
  if (!open.value || !(event.target instanceof Node) || root.value?.contains(event.target)) return
  const focusInside = Boolean(panel.value?.contains(document.activeElement))
  close({ restoreFocus: focusInside })
}

function onFocusIn(event: FocusEvent) {
  if (open.value && event.target instanceof Node && !panel.value?.contains(event.target)) {
    cancelCapture()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onCaptureKeydown, true)
  document.addEventListener('keydown', onPanelKeydown)
  document.addEventListener('pointerdown', onOutsideInteraction, true)
  document.addEventListener('click', onOutsideInteraction, true)
  document.addEventListener('focusin', onFocusIn)
})

onBeforeUnmount(() => {
  close({ restoreFocus: Boolean(panel.value?.contains(document.activeElement)) })
  window.removeEventListener('keydown', onCaptureKeydown, true)
  document.removeEventListener('keydown', onPanelKeydown)
  document.removeEventListener('pointerdown', onOutsideInteraction, true)
  document.removeEventListener('click', onOutsideInteraction, true)
  document.removeEventListener('focusin', onFocusIn)
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      ref="toggle"
      type="button"
      class="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink"
      :class="settings.enabled ? '' : 'opacity-60'"
      :aria-label="t('terminal.hotkeys.title')"
      :aria-expanded="open"
      :aria-controls="panelId"
      aria-haspopup="dialog"
      data-testid="hotkeys-toggle"
      @click="toggleOpen"
    >
      <Keyboard class="size-3.5" aria-hidden="true" />
    </button>

    <div
      v-if="open"
      :id="panelId"
      ref="panel"
      class="absolute right-0 top-[calc(100%+6px)] z-40 max-h-[calc(100dvh-96px)] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-lg border-[length:var(--hairline)] border-line bg-surface-2/95 p-3 shadow-lg outline-none backdrop-blur focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay max-sm:fixed max-sm:inset-x-3 max-sm:bottom-[calc(var(--mobile-tabbar)+env(safe-area-inset-bottom)+12px)] max-sm:top-auto max-sm:z-50 max-sm:max-h-[calc(100dvh-var(--mobile-tabbar)-env(safe-area-inset-bottom)-24px)] max-sm:w-auto"
      role="dialog"
      aria-modal="false"
      tabindex="-1"
      :aria-label="t('terminal.hotkeys.title')"
      data-testid="hotkeys-panel"
    >
      <div class="flex items-center justify-between gap-2">
        <h2 class="label-micro">{{ t('terminal.hotkeys.title') }}</h2>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="grid size-6 place-items-center rounded-sm text-ink-3 transition-colors hover:text-ink"
            :aria-label="t('terminal.hotkeys.reset')"
            :title="t('terminal.hotkeys.reset')"
            data-testid="hotkeys-reset"
            @click="resetDefaults"
          >
            <RotateCcw class="size-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="grid size-6 place-items-center rounded-sm text-ink-3 transition-colors hover:text-ink"
            :aria-label="t('terminal.hotkeys.close')"
            data-testid="hotkeys-close"
            @click="close({ restoreFocus: true })"
          >
            <X class="size-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      <label class="mt-2 flex items-center justify-between gap-2 text-[11.5px] text-ink-2">
        <span>{{ t('terminal.hotkeys.enabled') }}</span>
        <input
          type="checkbox"
          class="size-3.5 accent-[var(--clay)]"
          data-testid="hotkeys-enabled"
          :checked="settings.enabled"
          @change="setEnabled(($event.target as HTMLInputElement).checked)"
        />
      </label>

      <ul class="mt-2 space-y-0.5">
        <li v-for="row in rows" :key="row.action" class="flex items-center justify-between gap-2">
          <span class="truncate text-[11.5px] text-ink-2">{{ row.label }}</span>
          <button
            type="button"
            class="min-w-14 rounded-sm border-[length:var(--hairline)] px-1.5 py-0.5 font-mono text-[10.5px] transition-colors"
            :class="
              capturing === row.action
                ? 'border-clay bg-clay-soft text-clay-ink'
                : 'border-line bg-surface-1 text-ink-2 hover:text-ink'
            "
            :aria-label="t('terminal.hotkeys.rebind', { action: row.label })"
            :data-action="row.action"
            @click="startCapture(row.action)"
          >
            {{ capturing === row.action ? t('terminal.hotkeys.press') : formatHotkey(row.key) }}
          </button>
        </li>
      </ul>

      <p v-if="notice" class="mt-2 text-[10.5px] text-danger" role="status">
        {{ t(`terminal.hotkeys.errors.${notice}`) }}
      </p>
      <p class="mt-2 text-[10px] leading-snug text-ink-3">{{ t('terminal.hotkeys.note') }}</p>
    </div>
  </div>
</template>
