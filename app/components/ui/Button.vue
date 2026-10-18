<script setup lang="ts">
import { Primitive, type PrimitiveProps } from 'reka-ui'
import { Loader2 } from '@lucide/vue'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '~/utils/cn'

const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap',
    'font-medium leading-none',
    'transition-[background-color,color,box-shadow,transform,border-color] duration-150',
    'ease-[var(--ease-swift)] active:scale-[0.98]',
    'disabled:pointer-events-none disabled:opacity-45',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-clay text-white shadow-xs hover:bg-clay-hover',
        secondary: 'border border-line bg-surface-2 text-ink shadow-xs hover:border-line-strong hover:bg-surface-2',
        ghost: 'text-ink-2 hover:bg-ink/5 hover:text-ink',
        outline: 'border border-line-strong bg-transparent text-ink hover:bg-ink/5',
        danger: 'bg-danger text-white hover:brightness-95',
        'danger-ghost': 'text-danger hover:bg-danger-soft',
        bull: 'bg-bull text-white hover:brightness-95',
        bear: 'bg-bear text-white hover:brightness-95',
        link: 'text-clay underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-7 rounded-sm px-2.5 text-[11.5px]',
        sm: 'h-8 rounded-md px-3 text-[12.5px]',
        md: 'h-9.5 rounded-md px-4 text-[13px]',
        lg: 'h-11.5 rounded-lg px-5 text-[14px]',
        icon: 'size-9 rounded-md',
        'icon-sm': 'size-7 rounded-sm',
        'icon-xs': 'size-6 rounded-xs',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
)

type ButtonVariants = VariantProps<typeof buttonVariants>

const props = withDefaults(
  defineProps<
    PrimitiveProps & {
      variant?: ButtonVariants['variant']
      size?: ButtonVariants['size']
      block?: boolean
      loading?: boolean
      disabled?: boolean
      type?: 'button' | 'submit' | 'reset'
    }
  >(),
  {
    as: 'button',
    variant: 'secondary',
    size: 'md',
    block: false,
    loading: false,
    disabled: false,
    type: 'button',
  },
)

defineOptions({ inheritAttrs: false })

const forwardedAttrs = computed(() => {
  const { class: _className, ...rest } = useAttrs()
  return rest
})
</script>

<template>
  <Primitive
    v-bind="forwardedAttrs"
    :as="props.as"
    :as-child="props.asChild"
    :type="props.as === 'button' ? props.type : undefined"
    :disabled="props.as === 'button' ? props.disabled || props.loading : undefined"
    :aria-busy="props.loading || undefined"
    :class="cn(buttonVariants({ variant: props.variant, size: props.size }), props.block && 'w-full', $attrs.class as string)"
  >
    <Loader2 v-if="props.loading" class="size-3.5 animate-spin" aria-hidden="true" />
    <slot />
  </Primitive>
</template>
