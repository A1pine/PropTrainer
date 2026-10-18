<script setup lang="ts">
import { computed } from 'vue'

/**
 * Lightweight celebratory burst for a strong process grade. It is decorative,
 * respects reduced motion, and never intercepts pointer events.
 */
const props = withDefaults(
  defineProps<{
    active: boolean
    count?: number
  }>(),
  { count: 34 },
)

const palette = ['var(--clay)', 'var(--bull)', 'var(--warn)', 'var(--ink-2)']

interface Piece {
  id: number
  x: number
  y: number
  rotation: number
  delay: number
  size: number
  color: string
}

const pieces = computed<Piece[]>(() =>
  Array.from({ length: props.count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / props.count + (index % 3) * 0.12
    const distance = 90 + ((index * 37) % 150)
    return {
      id: index,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance - 70,
      rotation: (index * 73) % 360,
      delay: (index % 7) * 24,
      size: 4 + (index % 3) * 2,
      color: palette[index % palette.length]!,
    }
  }),
)
</script>

<template>
  <Teleport to="body">
    <div v-if="active" class="celebration pointer-events-none fixed inset-0 z-[80] overflow-hidden" aria-hidden="true">
      <span
        v-for="piece in pieces"
        :key="piece.id"
        class="celebration-piece absolute left-1/2 top-[32%] block"
        :style="{
          width: `${piece.size}px`,
          height: `${piece.size * 1.6}px`,
          background: piece.color,
          animationDelay: `${piece.delay}ms`,
          '--px': `${piece.x}px`,
          '--py': `${piece.y}px`,
          '--pr': `${piece.rotation}deg`,
        }"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.celebration-piece {
  border-radius: 1px;
  opacity: 0;
  animation: particle-out 1100ms var(--ease-swift) forwards;
}

@media (prefers-reduced-motion: reduce) {
  .celebration {
    display: none;
  }
}
</style>
