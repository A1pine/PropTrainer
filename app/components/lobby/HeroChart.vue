<script setup lang="ts">
import { createScenarioFactory } from '~/domain/market/scenario'

const scenario = createScenarioFactory({ now: new Date('2026-01-05T00:00:00Z') }).createFromSeed(
  'lobby-hero-v1',
  'MES',
  'uptrend',
)

const width = 620
const height = 300
const padding = { top: 24, right: 16, bottom: 20, left: 16 }

const bars = computed(() => scenario.candles.slice(8, 78))

const geometry = computed(() => {
  const data = bars.value
  const min = Math.min(...data.map((bar) => bar.low))
  const max = Math.max(...data.map((bar) => bar.high))
  const span = max - min || 1
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const slot = innerW / data.length
  const y = (price: number) => padding.top + (1 - (price - min) / span) * innerH
  return {
    slot,
    y,
    candles: data.map((bar, index) => {
      const x = padding.left + index * slot + slot / 2
      const up = bar.close >= bar.open
      return {
        x,
        up,
        top: y(Math.max(bar.open, bar.close)),
        bottom: y(Math.min(bar.open, bar.close)),
        high: y(bar.high),
        low: y(bar.low),
        delay: index * 16,
      }
    }),
    last: data[data.length - 1],
    lastY: y(data[data.length - 1]?.close ?? min),
  }
})

const lastPrice = computed(() => geometry.value.last?.close ?? 0)
</script>

<template>
  <div class="relative overflow-hidden rounded-xl border-[length:var(--hairline)] border-line bg-surface-2 shadow-sm">
    <div class="pointer-events-none absolute inset-0 mesh-glow opacity-70" aria-hidden="true" />

    <div class="relative flex items-center justify-between border-b-[length:var(--hairline)] border-line px-4 py-2.5">
      <div class="flex items-center gap-2">
        <span class="size-1.5 rounded-full bg-clay animate-pulse-dot" aria-hidden="true" />
        <span class="font-mono text-[11px] font-medium tracking-wide">M??? · 5m</span>
        <span class="text-[10px] text-ink-3">DAY ??</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="rounded-sm bg-clay-soft px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.12em] text-clay-ink">Blind</span>
        <span class="font-mono text-[10.5px] text-ink-3">SIM</span>
      </div>
    </div>

    <div class="relative px-1 pb-1 pt-2">
      <svg :viewBox="`0 0 ${width} ${height}`" class="w-full" role="img" aria-label="Animated candlestick preview in blind mode">
        <defs>
          <linearGradient id="hero-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#fff" stop-opacity="0" />
            <stop offset="100%" stop-color="#fff" stop-opacity="1" />
          </linearGradient>
          <clipPath id="hero-reveal">
            <rect x="0" y="0" :width="width" :height="height" class="hero-clip" />
          </clipPath>
        </defs>

        <g class="text-ink-3">
          <line v-for="row in 4" :key="`h-${row}`" :x1="padding.left" :x2="width - padding.right" :y1="padding.top + (row * (height - padding.top - padding.bottom)) / 5" :y2="padding.top + (row * (height - padding.top - padding.bottom)) / 5" stroke="currentColor" stroke-opacity="0.07" stroke-width="1" />
        </g>

        <g clip-path="url(#hero-reveal)">
          <g v-for="(candle, index) in geometry.candles" :key="index" class="hero-candle" :class="candle.up ? 'text-bull' : 'text-bear'" :style="{ animationDelay: `${candle.delay}ms` }">
            <line :x1="candle.x" :x2="candle.x" :y1="candle.high" :y2="candle.low" stroke="currentColor" stroke-width="1" />
            <rect
              :x="candle.x - geometry.slot * 0.28"
              :y="candle.top"
              :width="Math.max(2, geometry.slot * 0.56)"
              :height="Math.max(1.5, candle.bottom - candle.top)"
              fill="currentColor"
              fill-opacity="0.8"
              rx="0.8"
            />
          </g>
        </g>

        <line :x1="padding.left" :x2="width - padding.right" :y1="geometry.lastY" :y2="geometry.lastY" stroke="var(--clay)" stroke-opacity="0.5" stroke-dasharray="4 4" />
        <g class="hero-tag" :style="{ transform: `translateY(${geometry.lastY}px)` }">
          <rect :x="width - 70" :y="-9" width="58" height="18" rx="4" fill="var(--clay)" />
          <text :x="width - 41" y="0" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="10" font-family="var(--font-mono-stack)">•••</text>
        </g>
      </svg>

      <div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <span class="serif text-[clamp(2.5rem,9vw,4.5rem)] font-medium leading-none tracking-[0.12em] text-ink/[0.045]">BLIND</span>
      </div>

      <div class="absolute left-3 top-2 flex flex-col gap-1">
        <span class="w-fit rounded-sm border-[length:var(--hairline)] border-line bg-surface-2/85 px-1.5 py-0.5 font-mono text-[9.5px] text-ink-3 backdrop-blur">ATR 14 · <span class="veil">••.</span></span>
      </div>

      <div class="absolute bottom-4 left-4 flex items-end gap-1.5 opacity-90">
        <span class="rounded-md border-[length:var(--hairline)] border-line bg-surface-2/90 px-2 py-1 font-mono text-[9.5px] text-ink-2 shadow-xs backdrop-blur">
          BUY 2 · MES
        </span>
        <span class="rounded-md border border-bear/30 bg-bear-soft px-2 py-1 font-mono text-[9.5px] text-bear-strong shadow-xs">
          STOP 5,4••.••
        </span>
        <span class="hidden rounded-md border border-bull/30 bg-bull-soft px-2 py-1 font-mono text-[9.5px] text-bull-strong shadow-xs sm:block">
          TGT 5,5••.••
        </span>
      </div>
    </div>

    <div class="relative flex items-center justify-between border-t-[length:var(--hairline)] border-line px-4 py-2 text-[10px] text-ink-3">
      <span>{{ lastPrice ? 'Candles printing' : 'Waiting' }}</span>
      <span class="flex items-center gap-1.5"><span class="size-1 rounded-full bg-clay" aria-hidden="true" /> price hidden</span>
    </div>
  </div>
</template>

<style scoped>
.hero-candle {
  animation: candle-pop 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
  transform-box: fill-box;
  transform-origin: center;
  transform-box: fill-box;
}

.hero-clip {
  animation: hero-wipe 1.5s cubic-bezier(0.19, 1, 0.22, 1) both;
}

.hero-tag {
  animation: fade-in 0.4s ease 1.1s both;
}

@keyframes candle-pop {
  from {
    opacity: 0;
    transform: scaleY(0.25) translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes hero-wipe {
  from {
    width: 0;
  }
  to {
    width: 620px;
  }
}
</style>
