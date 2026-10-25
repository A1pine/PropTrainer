<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight } from '@lucide/vue'
import { courseLessons, courseProgress, findCourse, learningText } from '~/domain/learning/catalog'
import '~/assets/css/academy.css'

const route = useRoute()
const { t, locale } = useI18n()
const learning = useLearningStore()

const course = computed(() => findCourse(String(route.params.course ?? '')))
const lessons = computed(() => (course.value ? courseLessons(course.value) : []))
const progress = computed(() => (course.value ? courseProgress(course.value, learning.state) : null))
const resume = computed(() => {
  if (!course.value) return null
  const id = learning.lastLesson(course.value.id)
  const entry = lessons.value.find((item) => item.lesson.id === id && item.lesson.status === 'published')
  return entry ?? lessons.value.find((item) => item.lesson.status === 'published') ?? null
})

onMounted(() => learning.initialize())

useHead({
  title: computed(() => (course.value ? learningText(course.value.title, locale.value) : t('learning.notFoundTitle'))),
  meta: [
    {
      name: 'description',
      content: computed(() =>
        course.value ? learningText(course.value.summary, locale.value) : t('learning.notFoundBody'),
      ),
    },
  ],
})
</script>

<template>
  <div v-if="course" class="academy academy-overview">
    <header class="academy-overview-head">
      <div class="academy-page-heading">
        <p class="academy-caption">{{ t('learning.course') }}</p>
        <h1>{{ learningText(course.title, locale) }}</h1>
        <p>{{ learningText(course.summary, locale) }}</p>
      </div>
      <NuxtLink v-if="resume" :to="`/learn/${course.id}/${resume.lesson.id}`" class="academy-primary">
        {{ learning.lastLesson(course.id) ? t('learning.resume') : t('learning.startGuide') }}
        <ArrowRight class="size-4" aria-hidden="true" />
      </NuxtLink>
    </header>

    <LearningStorageNotice />

    <div class="academy-overview-grid">
      <section aria-labelledby="course-contents">
        <h2 id="course-contents" class="academy-outline-heading">{{ t('learning.contents') }}</h2>
        <LearningOutline :course="course" />
      </section>

      <aside class="academy-overview-aside">
        <div class="academy-readiness-block">
          <p>{{ t('learning.curriculumProgress') }}</p>
          <strong>{{
            progress?.total
              ? t('learning.completedOf', { done: progress.completed, total: progress.total })
              : t('learning.curriculumPending')
          }}</strong>
          <p class="mt-2">{{ t('learning.progressHint') }}</p>
        </div>
        <p class="academy-scope-note">{{ t('learning.scopeNote') }}</p>
      </aside>
    </div>
  </div>
  <div v-else class="academy academy-not-found">
    <h1>{{ t('learning.notFoundTitle') }}</h1>
    <p class="academy-prose mt-3">{{ t('learning.notFoundBody') }}</p>
    <NuxtLink to="/learn" class="academy-secondary mt-6">{{ t('learning.backToLibrary') }}</NuxtLink>
  </div>
</template>
