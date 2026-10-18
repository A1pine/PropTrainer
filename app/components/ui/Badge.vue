<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '~/utils/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border font-medium leading-none',
  {
    variants: {
      variant: {
        neutral: 'border-line bg-surface-2 text-ink-2',
        solid: 'border-transparent bg-ink text-inverse',
        clay: 'border-transparent bg-clay-soft text-clay-ink',
        bull: 'border-transparent bg-bull-soft text-bull-strong',
        bear: 'border-transparent bg-bear-soft text-bear-strong',
        warn: 'border-transparent bg-warn-soft text-warn',
        danger: 'border-transparent bg-danger-soft text-danger',
        outline: 'border-line-strong bg-transparent text-ink-2',
      },
      size: {
        sm: 'h-5 px-2 text-[10.5px]',
        md: 'h-6 px-2.5 text-[11.5px]',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'sm' },
  },
)

type BadgeVariants = VariantProps<typeof badgeVariants>

withDefaults(
  defineProps<{
    variant?: BadgeVariants['variant']
    size?: BadgeVariants['size']
    dot?: boolean
  }>(),
  { variant: 'neutral', size: 'sm', dot: false },
)
</script>

<template>
  <span :class="cn(badgeVariants({ variant, size }), $attrs.class as string)">
    <span v-if="dot" class="size-1.5 rounded-full bg-current" aria-hidden="true" />
    <slot />
  </span>
</template>
