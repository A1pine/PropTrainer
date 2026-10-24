<script setup lang="ts">
import { ArrowRight, BookOpen, ShieldCheck } from '@lucide/vue'

useHead({ title: 'Guide' })

const { t } = useI18n()

const sections = computed(() => [
  {
    id: 'read',
    n: '01',
    title: t('guide.sections.read.title'),
    body: t('guide.sections.read.body'),
    body2: t('guide.sections.read.body2'),
    bullets: [t('guide.sections.read.b1'), t('guide.sections.read.b2'), t('guide.sections.read.b3')],
    note: t('guide.sections.read.note'),
    noteLabel: t('guide.fieldNote'),
  },
  {
    id: 'invalidation',
    n: '02',
    title: t('guide.sections.invalidation.title'),
    body: t('guide.sections.invalidation.body'),
    body2: t('guide.sections.invalidation.body2'),
    bullets: [
      t('guide.sections.invalidation.b1'),
      t('guide.sections.invalidation.b2'),
      t('guide.sections.invalidation.b3'),
    ],
    note: t('guide.sections.invalidation.note'),
    noteLabel: t('guide.fieldNote'),
  },
  {
    id: 'sizing',
    n: '03',
    title: t('guide.sections.sizing.title'),
    body: t('guide.sections.sizing.body'),
    body2: t('guide.sections.sizing.body2'),
    bullets: [t('guide.sections.sizing.b1'), t('guide.sections.sizing.b2'), t('guide.sections.sizing.b3')],
    note: t('guide.sections.sizing.note'),
    noteLabel: t('guide.formula'),
  },
  {
    id: 'tape',
    n: '04',
    title: t('guide.sections.tape.title'),
    body: t('guide.sections.tape.body'),
    body2: t('guide.sections.tape.body2'),
    bullets: [t('guide.sections.tape.b1'), t('guide.sections.tape.b2'), t('guide.sections.tape.b3')],
    note: t('guide.sections.tape.note'),
    noteLabel: t('guide.fieldNote'),
  },
  {
    id: 'grading',
    n: '05',
    title: t('guide.sections.grading.title'),
    body: t('guide.sections.grading.body'),
    body2: t('guide.sections.grading.body2'),
    bullets: [
      t('guide.sections.grading.b1'),
      t('guide.sections.grading.b2'),
      t('guide.sections.grading.b3'),
      t('guide.sections.grading.b4'),
    ],
    note: t('guide.sections.grading.note'),
    noteLabel: t('guide.formula'),
  },
  {
    id: 'exam-analysis',
    n: '06',
    title: t('guide.sections.examTA.title'),
    body: t('guide.sections.examTA.body'),
    body2: t('guide.sections.examTA.body2'),
    bullets: [
      t('guide.sections.examTA.b1'),
      t('guide.sections.examTA.b2'),
      t('guide.sections.examTA.b3'),
      t('guide.sections.examTA.b4'),
    ],
    note: t('guide.sections.examTA.note'),
    noteLabel: t('guide.fieldNote'),
  },
  {
    id: 'terminal',
    n: '07',
    title: t('guide.sections.terminal.title'),
    body: t('guide.sections.terminal.body'),
    body2: t('guide.sections.terminal.body2'),
    bullets: [
      t('guide.sections.terminal.b1'),
      t('guide.sections.terminal.b2'),
      t('guide.sections.terminal.b3'),
      t('guide.sections.terminal.b4'),
    ],
    note: t('guide.sections.terminal.note'),
    noteLabel: t('guide.fieldNote'),
  },
])

const shortcuts = computed(() => [
  { keys: ['Space'], action: t('guide.keys.space') },
  { keys: ['N'], action: t('guide.keys.next') },
  { keys: ['1', '2', '3', '4'], action: t('guide.keys.state') },
  { keys: ['L', 'S'], action: t('guide.keys.direction') },
  { keys: ['↵'], action: t('guide.keys.commit') },
  { keys: ['⌘', 'K'], action: t('guide.keys.palette') },
  { keys: ['Esc'], action: t('guide.keys.escape') },
])

const glossary = computed(() => [
  { term: 'R', body: t('guide.glossary.r') },
  { term: 'ATR', body: t('guide.glossary.atr') },
  { term: t('guide.glossary.drawdownTerm'), body: t('guide.glossary.drawdown') },
  { term: t('guide.glossary.bracketTerm'), body: t('guide.glossary.bracket') },
  { term: t('guide.glossary.noFillTerm'), body: t('guide.glossary.noFill') },
  { term: t('guide.glossary.processTerm'), body: t('guide.glossary.process') },
])
</script>

<template>
  <div class="mx-auto max-w-[1020px] px-4 py-10 md:px-8">
    <header>
      <p class="label-micro flex items-center gap-2">
        <BookOpen class="size-3.5 text-clay" aria-hidden="true" />
        {{ t('guide.kicker') }}
      </p>
      <h1 class="serif mt-3 text-[clamp(2.2rem,4.6vw,3.6rem)] font-medium leading-[1.02] tracking-tight">
        {{ t('guide.title') }}
      </h1>
      <p class="mt-4 max-w-[60ch] text-[13px] leading-relaxed text-ink-2">{{ t('guide.subtitle') }}</p>
      <div class="mt-6 flex flex-wrap items-center gap-2.5">
        <NuxtLink to="/trainer">
          <Button variant="primary" size="md"
            >{{ t('guide.cta') }}<ArrowRight class="size-3.5" aria-hidden="true"
          /></Button>
        </NuxtLink>
        <NuxtLink to="/drill">
          <Button variant="secondary" size="md">{{ t('nav.drill') }}</Button>
        </NuxtLink>
      </div>
    </header>

    <div class="mt-10">
      <section
        v-for="section in sections"
        :key="section.id"
        class="grid gap-6 border-t-[length:var(--hairline)] border-line py-8 md:grid-cols-[1fr_300px] md:gap-10"
      >
        <div>
          <div class="flex items-baseline gap-3">
            <span class="num text-[10px] text-clay">{{ section.n }}</span>
            <h2 class="text-[19px] font-semibold tracking-tight">{{ section.title }}</h2>
          </div>
          <p class="mt-3 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-2">{{ section.body }}</p>
          <p class="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-2">{{ section.body2 }}</p>
          <ul class="mt-4 space-y-1.5">
            <li
              v-for="bullet in section.bullets"
              :key="bullet"
              class="flex gap-2 text-[11.5px] leading-relaxed text-ink-2"
            >
              <span class="mt-1.5 size-1 shrink-0 rounded-full bg-clay/70" aria-hidden="true" />
              {{ bullet }}
            </li>
          </ul>
        </div>
        <aside class="h-fit rounded-lg border-[length:var(--hairline)] border-line bg-sunken p-4">
          <p class="label-micro">{{ section.noteLabel }}</p>
          <p
            class="mt-2 whitespace-pre-line font-mono text-[11px] leading-relaxed text-ink-2"
            :class="section.noteLabel === t('guide.formula') ? 'text-[11px]' : ''"
          >
            {{ section.note }}
          </p>
        </aside>
      </section>
    </div>

    <section class="border-t-[length:var(--hairline)] border-line py-8">
      <h2 class="text-[19px] font-semibold tracking-tight">{{ t('guide.keys.title') }}</h2>
      <p class="mt-1 text-[11.5px] text-ink-3">{{ t('guide.keys.hint') }}</p>
      <div class="mt-4 overflow-hidden rounded-lg border-[length:var(--hairline)] border-line">
        <div
          v-for="(row, index) in shortcuts"
          :key="index"
          class="flex items-center justify-between gap-4 px-4 py-2.5"
          :class="index % 2 === 0 ? 'bg-surface-2' : 'bg-sunken/60'"
        >
          <span class="text-[11.5px] text-ink-2">{{ row.action }}</span>
          <Kbd :keys="row.keys" />
        </div>
      </div>
    </section>

    <section class="border-t-[length:var(--hairline)] border-line py-8">
      <h2 class="text-[19px] font-semibold tracking-tight">{{ t('guide.glossary.title') }}</h2>
      <div
        class="mt-4 grid gap-px overflow-hidden rounded-lg border-[length:var(--hairline)] border-line bg-line sm:grid-cols-2"
      >
        <div v-for="entry in glossary" :key="entry.term" class="bg-surface-2 p-4">
          <p class="font-mono text-[11px] font-medium text-clay-ink">{{ entry.term }}</p>
          <p class="mt-1 text-[11px] leading-relaxed text-ink-2">{{ entry.body }}</p>
        </div>
      </div>
    </section>

    <section class="mt-2 flex items-start gap-3 rounded-lg border border-warn/30 bg-warn-soft p-4">
      <ShieldCheck class="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
      <div>
        <p class="text-[11.5px] font-medium text-ink">{{ t('guide.disclaimer.title') }}</p>
        <p class="mt-1 max-w-[70ch] text-[11px] leading-relaxed text-ink-2">{{ t('guide.disclaimer.body') }}</p>
      </div>
    </section>
  </div>
</template>
