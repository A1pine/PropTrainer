<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from '@lucide/vue'
import { useToastStore, type ToastVariant } from '~/stores/toasts'

const store = useToastStore()

const icons: Record<ToastVariant, unknown> = {
  default: Info,
  info: Info,
  success: CheckCircle2,
  danger: XCircle,
  warn: AlertTriangle,
}

const tones: Record<ToastVariant, string> = {
  default: 'text-ink-3',
  info: 'text-clay',
  success: 'text-bull',
  danger: 'text-danger',
  warn: 'text-warn',
}
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-3 top-3 z-100 flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:top-auto sm:items-end"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      <TransitionGroup
        enter-active-class="transition duration-300 ease-[var(--ease-enter)]"
        enter-from-class="translate-y-2 opacity-0 sm:translate-y-3"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0 translate-y-1"
        move-class="transition-transform duration-200"
      >
        <div
          v-for="toast in store.items"
          :key="toast.id"
          class="pointer-events-auto flex w-full max-w-[380px] items-start gap-3 rounded-lg border-[length:var(--hairline)] border-line bg-overlay px-3.5 py-3 shadow-overlay"
          role="status"
        >
          <component :is="icons[toast.variant ?? 'default']" class="mt-0.5 size-4 shrink-0" :class="tones[toast.variant ?? 'default']" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <p class="text-[12.5px] font-medium leading-snug text-ink">{{ toast.title }}</p>
            <p v-if="toast.description" class="mt-0.5 text-[11.5px] leading-snug text-ink-3">{{ toast.description }}</p>
            <button
              v-if="toast.action"
              type="button"
              class="mt-2 text-[11.5px] font-medium text-clay hover:underline"
              @click="
                toast.action.onClick()
                store.dismiss(toast.id)
              "
            >
              {{ toast.action.label }}
            </button>
          </div>
          <button
            type="button"
            class="grid size-5 place-items-center rounded-xs text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink"
            aria-label="Dismiss notification"
            @click="store.dismiss(toast.id)"
          >
            <X class="size-3" aria-hidden="true" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
