<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from 'reka-ui'
import { X } from '@lucide/vue'
import { cn } from '~/utils/cn'

withDefaults(
  defineProps<{
    title: string
    description?: string
    size?: 'sm' | 'md' | 'lg'
    hideClose?: boolean
    dismissible?: boolean
  }>(),
  { description: undefined, size: 'md', hideClose: false, dismissible: true },
)

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[6px] data-[state=open]:animate-fade-in dark:bg-black/60"
      />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border-[length:var(--hairline)] border-line bg-surface-2 p-5 shadow-lg outline-none data-[state=open]:animate-scale-in sm:p-6"
        :class="
          cn(
            size === 'sm' && 'sm:max-w-[400px]',
            size === 'md' && 'sm:max-w-[520px]',
            size === 'lg' && 'sm:max-w-[760px]',
          )
        "
        @interact-outside="!dismissible && $event.preventDefault()"
        @escape-key-down="!dismissible && $event.preventDefault()"
      >
        <div class="mb-5 flex items-start justify-between gap-4">
          <div class="space-y-1">
            <DialogTitle class="text-[17px] font-semibold tracking-tight text-ink">{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="text-[12.5px] leading-relaxed text-ink-3">
              {{ description }}
            </DialogDescription>
          </div>
          <DialogClose
            v-if="!hideClose"
            class="grid size-8 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink"
            aria-label="Close dialog"
          >
            <X class="size-4" aria-hidden="true" />
          </DialogClose>
        </div>
        <slot />
        <div v-if="$slots.footer" class="mt-6 flex items-center justify-end gap-2">
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
