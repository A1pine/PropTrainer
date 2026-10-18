<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { X } from '@lucide/vue'

withDefaults(
  defineProps<{
    title: string
    description?: string
    side?: 'bottom' | 'right'
  }>(),
  { description: undefined, side: 'bottom' },
)

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[4px] data-[state=open]:animate-fade-in" />
      <DialogContent
        class="fixed z-50 overflow-y-auto border-line bg-surface-2 shadow-lg outline-none data-[state=open]:animate-[sheet-in_.32s_var(--ease-enter)]"
        :class="
          side === 'bottom'
            ? 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl border-t-[length:var(--hairline)] pb-[env(safe-area-inset-bottom)]'
            : 'inset-y-0 right-0 w-[min(420px,100vw)] rounded-l-2xl border-l-[length:var(--hairline)]'
        "
      >
        <div
          class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b-[length:var(--hairline)] border-line bg-surface-2/95 px-5 py-4 backdrop-blur"
        >
          <div class="space-y-0.5">
            <DialogTitle class="text-[15px] font-semibold tracking-tight">{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="text-[11.5px] text-ink-3">{{ description }}</DialogDescription>
          </div>
          <DialogClose
            class="grid size-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink"
            aria-label="Close panel"
          >
            <X class="size-4" aria-hidden="true" />
          </DialogClose>
        </div>
        <div class="p-5">
          <slot />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
@keyframes sheet-in {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
