<script setup lang="ts">
import { ArrowRight, Check, Copy, Link2, Swords, Trophy, Users, X } from '@lucide/vue'
import type { GradeLetter } from '~/domain/drill/grade'
import type { Regime } from '~/domain/market/types'

useHead({ title: 'Friends PK' })

const { t, locale } = useI18n()
const pk = usePkStore()
const settings = useSettingsStore()

const p1 = ref('')
const p2 = ref('')
const seed = ref(`pk-${Math.random().toString(36).slice(2, 8)}`)
const copied = ref(false)

const room = computed(() => pk.room)
const winner = computed(() => pk.winner)

const gradeTone = (grade: GradeLetter) => {
  if (grade === 'A' || grade === 'B') return 'border-bull/40 bg-bull-soft text-bull-strong'
  if (grade === 'C') return 'border-clay/40 bg-clay-soft text-clay-ink'
  if (grade === 'D') return 'border-warn/40 bg-warn-soft text-warn'
  return 'border-danger/40 bg-danger-soft text-danger'
}

function createRoom() {
  pk.createRoom(p1.value, p2.value, seed.value.trim() || `pk-${Math.random().toString(36).slice(2, 8)}`)
}

function play(slot: 1 | 2) {
  if (!room.value) return
  navigateTo(`/drill?seed=${encodeURIComponent(room.value.seed)}&pk=1&player=${slot}`)
}

function shareLink(slot: 1 | 2) {
  if (!room.value) return ''
  return `${window.location.origin}/drill?seed=${encodeURIComponent(room.value.seed)}&pk=1&player=${slot}`
}

async function copySeed() {
  if (!room.value) return
  await writeClipboard(room.value.seed)
}

async function copyLink(slot: 1 | 2) {
  if (!room.value || !import.meta.client) return
  await writeClipboard(shareLink(slot))
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch {
    copied.value = false
  }
}

function rematch() {
  pk.rematch(`pk-${Math.random().toString(36).slice(2, 8)}`)
}

function resultLabel(result: { score: number; grade: GradeLetter } | null) {
  return result ? `${result.score}/100` : t('pk.waiting')
}

onMounted(() => {
  settings.hydrate()
  pk.hydrate()
})
</script>

<template>
  <div class="mx-auto max-w-[1180px] px-4 py-8 md:px-8 md:py-10">
    <header class="flex flex-wrap items-end gap-3">
      <div>
        <p class="label-micro flex items-center gap-2">
          <Users class="size-3.5 text-clay" aria-hidden="true" />
          {{ t('pk.kicker') }}
        </p>
        <h1 class="serif mt-2 text-[clamp(1.9rem,3.6vw,2.8rem)] font-medium tracking-tight">{{ t('pk.title') }}</h1>
        <p class="mt-2 max-w-[58ch] text-[12.5px] leading-relaxed text-ink-2">{{ t('pk.subtitle') }}</p>
      </div>
      <Badge variant="outline" class="ml-auto">{{ t('pk.localNote') }}</Badge>
    </header>

    <div v-if="!room" class="mt-8 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      <section class="panel p-6">
        <div class="flex items-center gap-2">
          <span class="grid size-9 place-items-center rounded-lg bg-clay-soft text-clay-ink"
            ><Swords class="size-4" aria-hidden="true"
          /></span>
          <div>
            <p class="text-[13px] font-semibold">{{ t('pk.setup.title') }}</p>
            <p class="text-[10.5px] text-ink-3">{{ t('pk.setup.hint') }}</p>
          </div>
        </div>

        <div class="mt-6 grid gap-3 sm:grid-cols-2">
          <Field :label="t('pk.setup.player1')" html-for="p1">
            <Input id="p1" v-model="p1" :placeholder="t('pk.setup.placeholder1')" maxlength="18" />
          </Field>
          <Field :label="t('pk.setup.player2')" html-for="p2">
            <Input id="p2" v-model="p2" :placeholder="t('pk.setup.placeholder2')" maxlength="18" />
          </Field>
        </div>

        <Field :label="t('pk.setup.seed')" :hint="t('pk.setup.seedHint')" class="mt-3">
          <Input v-model="seed" suffix="" class="font-mono" />
        </Field>

        <div class="mt-5 flex items-center gap-2">
          <Button variant="primary" size="md" block @click="createRoom">
            {{ t('pk.setup.create') }}
            <ArrowRight class="size-3.5" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="md" @click="seed = `pk-${Math.random().toString(36).slice(2, 8)}`">
            {{ t('pk.setup.reroll') }}
          </Button>
        </div>
      </section>

      <aside class="space-y-4">
        <div class="panel p-5">
          <p class="label-micro">{{ t('pk.rules.title') }}</p>
          <ul class="mt-3 space-y-2.5 text-[11.5px] leading-relaxed text-ink-2">
            <li class="flex gap-2"><span class="text-clay">01</span>{{ t('pk.rules.one') }}</li>
            <li class="flex gap-2"><span class="text-clay">02</span>{{ t('pk.rules.two') }}</li>
            <li class="flex gap-2"><span class="text-clay">03</span>{{ t('pk.rules.three') }}</li>
            <li class="flex gap-2"><span class="text-clay">04</span>{{ t('pk.rules.four') }}</li>
          </ul>
        </div>
        <div class="rounded-lg border border-dashed border-line p-4 text-[10.5px] leading-relaxed text-ink-3">
          {{ t('pk.rules.note') }}
        </div>
      </aside>
    </div>

    <div v-else class="mt-6 space-y-4">
      <div class="panel flex flex-wrap items-center gap-3 px-4 py-3">
        <span class="label-micro">{{ t('pk.room.seed') }}</span>
        <code class="rounded-sm bg-sunken px-2 py-1 font-mono text-[11px]">{{ room.seed }}</code>
        <Button variant="ghost" size="xs" @click="copySeed">
          <Check v-if="copied" class="size-3" aria-hidden="true" />
          <Copy v-else class="size-3" aria-hidden="true" />
          {{ copied ? t('pk.copied') : t('pk.copySeed') }}
        </Button>
        <span class="text-[10px] text-ink-3">{{
          t('pk.room.created', { date: formatDate(room.createdAt, locale) })
        }}</span>
        <div class="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="xs" @click="copyLink(2)">
            <Link2 class="size-3" aria-hidden="true" />
            {{ t('pk.copyLink') }}
          </Button>
          <Button variant="ghost" size="xs" @click="rematch">{{ t('pk.room.rematch') }}</Button>
          <Button variant="ghost" size="xs" @click="pk.clear()"
            ><X class="size-3" aria-hidden="true" />{{ t('pk.room.close') }}</Button
          >
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)] md:items-stretch">
        <article
          v-for="slot in [1, 2] as const"
          :key="slot"
          class="panel relative flex flex-col gap-4 p-5"
          :class="[
            winner === slot ? 'border-clay/45 bg-clay-soft/30' : '',
            slot === 1 ? 'md:col-start-1' : 'md:col-start-3',
          ]"
        >
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <span
                class="grid size-10 place-items-center rounded-full bg-sunken font-mono text-[13px] font-medium text-ink-2"
              >
                {{ (slot === 1 ? room.player1 : room.player2).slice(0, 2).toUpperCase() }}
              </span>
              <div>
                <p class="text-[13px] font-semibold">{{ slot === 1 ? room.player1 : room.player2 }}</p>
                <p class="text-[10px] text-ink-3">{{ slot === 1 ? t('pk.room.player1') : t('pk.room.player2') }}</p>
              </div>
            </div>
            <Badge v-if="winner === slot" variant="clay" dot>{{ t('pk.winner') }}</Badge>
            <Badge v-else-if="room.results[slot]" variant="bull" dot>{{ t('pk.submitted') }}</Badge>
            <Badge v-else variant="neutral" dot>{{ t('pk.waiting') }}</Badge>
          </div>

          <template v-if="room.results[slot]">
            <div class="flex items-end justify-between">
              <div>
                <p class="label-micro">{{ t('review.process') }}</p>
                <p class="num text-[30px] font-medium leading-none">
                  {{ room.results[slot]!.score }}<span class="text-[11px] text-ink-3">/100</span>
                </p>
              </div>
              <div
                class="grid size-14 place-items-center rounded-full border"
                :class="gradeTone(room.results[slot]!.grade)"
              >
                <span class="serif text-[24px]">{{ room.results[slot]!.grade }}</span>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2 font-mono text-[10.5px]">
              <div class="rounded-sm border border-line bg-sunken px-2 py-1.5">
                <span class="text-ink-3">R</span>
                <span
                  class="float-right"
                  :class="
                    (room.results[slot]!.rMultiple ?? 0) > 0
                      ? 'text-bull-strong'
                      : (room.results[slot]!.rMultiple ?? 0) < 0
                        ? 'text-bear-strong'
                        : ''
                  "
                  >{{ formatR(room.results[slot]!.rMultiple) }}</span
                >
              </div>
              <div class="rounded-sm border border-line bg-sunken px-2 py-1.5">
                <span class="text-ink-3">{{ t(`read.states.${room.results[slot]!.regime}`) }}</span>
              </div>
            </div>
            <p class="text-[10px] text-ink-3">
              {{ room.results[slot]!.symbol }} · {{ formatDate(room.results[slot]!.sessionDate, locale) }}
            </p>
          </template>

          <template v-else>
            <div class="flex flex-1 flex-col justify-center gap-2 py-4">
              <p class="text-[11.5px] leading-relaxed text-ink-3">
                {{ t('pk.room.waitingBody', { player: slot === 1 ? room.player1 : room.player2 }) }}
              </p>
              <Button variant="primary" size="md" block @click="play(slot)">
                {{ t('pk.room.playAs', { player: slot === 1 ? room.player1 : room.player2 }) }}
                <ArrowRight class="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </template>
        </article>

        <div class="hidden flex-col items-center justify-center gap-2 md:col-start-2 md:row-start-1 md:flex">
          <span class="grid size-10 place-items-center rounded-full border border-line bg-surface-2 text-clay"
            ><Swords class="size-4" aria-hidden="true"
          /></span>
          <span class="font-mono text-[10px] text-ink-3">VS</span>
        </div>
      </div>

      <div v-if="winner" class="panel flex flex-wrap items-center gap-3 border-clay/35 bg-clay-soft/40 px-5 py-4">
        <Trophy class="size-5 text-clay" aria-hidden="true" />
        <div>
          <p class="text-[13px] font-semibold">
            {{ t('pk.result.title', { player: winner === 1 ? room.player1 : winner === 2 ? room.player2 : '' }) }}
          </p>
          <p class="text-[11px] text-ink-2">{{ t('pk.result.body') }}</p>
        </div>
        <div class="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" @click="rematch">{{ t('pk.result.rematch') }}</Button>
          <NuxtLink to="/stats"
            ><Button variant="ghost" size="sm">{{ t('summary.viewStats') }}</Button></NuxtLink
          >
        </div>
      </div>

      <p class="text-[10px] leading-relaxed text-ink-3">{{ t('pk.rules.note') }}</p>
    </div>
  </div>
</template>
