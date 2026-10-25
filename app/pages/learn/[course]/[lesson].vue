<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ArrowLeft, ArrowRight, Check } from '@lucide/vue'
import { courseLessons, findCourse, findLesson, learningText } from '~/domain/learning/catalog'
import type { LearningLesson } from '~/domain/learning/types'
import '~/assets/css/academy.css'

const route = useRoute()
const { t, locale } = useI18n()
const learning = useLearningStore()
const note = ref<HTMLTextAreaElement | null>(null)

const course = computed(() => findCourse(String(route.params.course ?? '')))
const entry = computed(() =>
  course.value ? findLesson(course.value.id, String(route.params.lesson ?? '')) : undefined,
)
const lesson = computed(() => entry.value?.lesson)
const flat = computed(() => (course.value ? courseLessons(course.value) : []))
const position = computed(() => flat.value.findIndex((item) => item.lesson.id === lesson.value?.id))
const previous = computed(() => (position.value > 0 ? flat.value[position.value - 1] : null))
const next = computed(() =>
  position.value >= 0 && position.value < flat.value.length - 1 ? flat.value[position.value + 1] : null,
)
const progress = computed(() =>
  course.value && lesson.value ? learning.getProgress(course.value.id, lesson.value) : null,
)
const canNote = computed(() => learning.ready && learning.storageStatus !== 'corrupt')
const canCheck = computed(() => canNote.value && lesson.value?.status === 'published')
const completeDisabled = computed(
  () => !canCheck.value || !lesson.value || !allRequiredChecked(lesson.value, progress.value?.checked ?? []),
)

function allRequiredChecked(value: LearningLesson, checked: string[]) {
  return value.blocks.every(
    (block) => block.type !== 'checklist' || block.items.every((item) => !item.required || checked.includes(item.id)),
  )
}

onMounted(async () => {
  learning.initialize()
  if (!course.value || !entry.value) return
  learning.visit(course.value.id, entry.value.lesson)
})

watch(
  () => [route.params.course, route.params.lesson],
  async () => {
    if (!course.value || !entry.value) return
    learning.visit(course.value.id, entry.value.lesson)
    await nextTick()
    note.value?.blur()
  },
)

function check(id: string, checked: boolean) {
  if (!course.value || !lesson.value) return
  learning.setChecked(course.value.id, lesson.value, id, checked)
}
function complete() {
  if (!course.value || !lesson.value) return
  learning.setCompleted(course.value.id, lesson.value, true)
}
function reopen() {
  if (!course.value || !lesson.value) return
  learning.setCompleted(course.value.id, lesson.value, false)
}

useHead({
  title: computed(() =>
    lesson.value
      ? `${learningText(lesson.value.title, locale.value)} · ${learningText(course.value!.title, locale.value)}`
      : t('learning.notFoundTitle'),
  ),
  meta: [
    {
      name: 'description',
      content: computed(() =>
        lesson.value ? learningText(lesson.value.summary, locale.value) : t('learning.notFoundBody'),
      ),
    },
  ],
})
</script>

<template>
  <div v-if="course && lesson" class="academy academy-lesson">
    <nav class="academy-breadcrumb" :aria-label="t('learning.breadcrumb')">
      <NuxtLink to="/learn">{{ t('learning.title') }}</NuxtLink>
      <span aria-hidden="true">/</span>
      <NuxtLink :to="`/learn/${course.id}`">{{ learningText(course.title, locale) }}</NuxtLink>
      <span aria-hidden="true">/</span>
      <span>{{ learningText(lesson.title, locale) }}</span>
    </nav>

    <header class="academy-lesson-head">
      <p class="academy-caption">{{ learningText(entry!.chapter.title, locale) }}</p>
      <h1>{{ learningText(lesson.title, locale) }}</h1>
      <p class="academy-prose">{{ learningText(lesson.summary, locale) }}</p>
      <p v-if="lesson.status === 'draft'" class="academy-readiness mt-4">{{ t('learning.pendingNotice') }}</p>
    </header>

    <LearningStorageNotice />

    <div class="academy-lesson-layout">
      <details class="academy-outline-disclosure">
        <summary>{{ t('learning.contents') }}</summary>
        <LearningOutline :course="course" :current-id="lesson.id" />
      </details>
      <aside class="academy-outline-rail">
        <LearningOutline :course="course" :current-id="lesson.id" />
      </aside>

      <article class="academy-lesson-main">
        <LearningVideo v-if="lesson.video" :video="lesson.video" />
        <LearningBlocks
          :blocks="lesson.blocks"
          :checked="progress?.checked ?? []"
          :disabled="!canCheck"
          @check="check"
        />
        <p v-if="lesson.status === 'draft'" class="academy-pending">{{ t('learning.draftCannotComplete') }}</p>

        <footer class="academy-pager">
          <NuxtLink v-if="previous" :to="`/learn/${course.id}/${previous.lesson.id}`">
            <span>{{ t('learning.previous') }}</span>
            <ArrowLeft class="mr-1 inline size-3.5" aria-hidden="true" />{{
              learningText(previous.lesson.title, locale)
            }}
          </NuxtLink>
          <span v-else />
          <NuxtLink v-if="next" :to="`/learn/${course.id}/${next.lesson.id}`" class="text-right">
            <span>{{ t('learning.next') }}</span>
            {{ learningText(next.lesson.title, locale) }}<ArrowRight class="ml-1 inline size-3.5" aria-hidden="true" />
          </NuxtLink>
        </footer>
      </article>

      <aside class="academy-notes" :aria-label="t('learning.notes')">
        <h2>{{ t('learning.notes') }}</h2>
        <p>{{ t('learning.notesHint') }}</p>
        <textarea
          ref="note"
          class="academy-note"
          :value="progress?.note ?? ''"
          :readonly="!canNote"
          :maxlength="12000"
          :placeholder="t('learning.notesPlaceholder')"
          :aria-label="t('learning.notes')"
          data-testid="learning-note"
          @input="course && learning.setNote(course.id, lesson, ($event.target as HTMLTextAreaElement).value)"
        />
        <div class="academy-note-meta">
          <span>{{
            t(
              learning.storageStatus === 'corrupt'
                ? 'learning.storageCorruptShort'
                : learning.storageStatus === 'invalid'
                  ? 'learning.storageInvalidShort'
                  : learning.storageStatus === 'unavailable'
                    ? 'learning.storageUnavailableShort'
                    : learning.ready
                      ? 'learning.savedLocally'
                      : 'learning.loading',
            )
          }}</span>
          <span>{{ (progress?.note ?? '').length }} / 12000</span>
        </div>

        <div class="academy-completion">
          <template v-if="lesson.status === 'published'">
            <p v-if="progress?.completedAt">
              {{ t('learning.completedOn', { date: new Date(progress.completedAt).toLocaleDateString(locale) }) }}
            </p>
            <p v-else>{{ t('learning.completeHint') }}</p>
            <button
              v-if="progress?.completedAt"
              type="button"
              class="academy-secondary"
              data-testid="learning-reopen"
              @click="reopen"
            >
              {{ t('learning.reopen') }}
            </button>
            <button
              v-else
              type="button"
              class="academy-primary"
              :disabled="completeDisabled"
              data-testid="learning-complete"
              @click="complete"
            >
              <Check class="size-4" aria-hidden="true" />{{ t('learning.markComplete') }}
            </button>
          </template>
          <p v-else>{{ t('learning.draftCannotComplete') }}</p>
        </div>
      </aside>
    </div>
  </div>
  <div v-else class="academy academy-not-found">
    <h1>{{ t('learning.notFoundTitle') }}</h1>
    <p class="academy-prose mt-3">{{ t('learning.notFoundBody') }}</p>
    <NuxtLink to="/learn" class="academy-secondary mt-6">{{ t('learning.backToLibrary') }}</NuxtLink>
  </div>
</template>
