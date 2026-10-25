<script setup lang="ts">
import { Check, FileText, LockKeyhole } from '@lucide/vue'
import { learningText } from '~/domain/learning/catalog'
import type { LearningCourse, LearningLesson } from '~/domain/learning/types'

const props = defineProps<{ course: LearningCourse; currentId?: string }>()
const { t, locale } = useI18n()
const learning = useLearningStore()
function completed(lesson: LearningLesson) {
  return lesson.status === 'published' && Boolean(learning.getProgress(props.course.id, lesson).completedAt)
}
</script>

<template>
  <nav class="academy-outline" :aria-label="t('learning.contents')">
    <section v-for="chapter in course.chapters" :key="chapter.id">
      <h2 class="academy-outline-heading">{{ learningText(chapter.title, locale) }}</h2>
      <ul>
        <li v-for="lesson in chapter.lessons" :key="lesson.id">
          <NuxtLink
            :to="`/learn/${course.id}/${lesson.id}`"
            class="academy-lesson-link"
            :aria-current="currentId === lesson.id ? 'page' : undefined"
            :data-lesson-link="lesson.id"
          >
            <LockKeyhole v-if="lesson.status === 'draft'" class="size-4 shrink-0" aria-hidden="true" />
            <Check v-else-if="completed(lesson)" class="size-4 shrink-0 text-bull" aria-hidden="true" />
            <FileText v-else class="size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0">
              <span class="block">{{ learningText(lesson.title, locale) }}</span>
              <span class="academy-caption block mt-1">{{
                lesson.status === 'draft'
                  ? t('learning.pending')
                  : completed(lesson)
                    ? t('learning.completed')
                    : t('learning.available')
              }}</span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </nav>
</template>
