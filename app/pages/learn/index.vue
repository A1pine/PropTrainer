<script setup lang="ts">
import { BookOpen, NotebookPen } from '@lucide/vue'
import { courseProgress, learningCourses, learningText } from '~/domain/learning/catalog'
import '~/assets/css/academy.css'

const { t, locale } = useI18n()
const learning = useLearningStore()

onMounted(() => learning.initialize())
useHead({
  title: computed(() => t('learning.title')),
  meta: [{ name: 'description', content: computed(() => t('learning.subtitle')) }],
})
</script>

<template>
  <div class="academy academy-library">
    <header class="academy-page-heading">
      <h1>{{ t('learning.title') }}</h1>
      <p>{{ t('learning.subtitle') }}</p>
    </header>

    <section class="academy-courses" :aria-label="t('learning.courses')">
      <article v-for="course in learningCourses" :key="course.id" class="academy-course-entry">
        <div class="academy-course-description">
          <BookOpen class="size-8 text-clay" aria-hidden="true" />
          <h2>{{ learningText(course.title, locale) }}</h2>
          <p class="academy-prose">{{ learningText(course.summary, locale) }}</p>
          <p class="academy-readiness">
            {{
              courseProgress(course, learning.state).total
                ? t('learning.completedOf', {
                    done: courseProgress(course, learning.state).completed,
                    total: courseProgress(course, learning.state).total,
                  })
                : t('learning.curriculumPending')
            }}
          </p>
          <NuxtLink :to="`/learn/${course.id}`" class="academy-primary" data-testid="open-course">{{
            t('learning.openCourse')
          }}</NuxtLink>
        </div>
        <div class="academy-course-index">
          <h3>{{ t('learning.inWorkspace') }}</h3>
          <ol>
            <li>
              <span>{{ t('learning.read') }}</span>
              <p>{{ t('learning.readHint') }}</p>
            </li>
            <li>
              <span>{{ t('learning.observe') }}</span>
              <p>{{ t('learning.observeHint') }}</p>
            </li>
            <li>
              <span>{{ t('learning.review') }}</span>
              <p>{{ t('learning.reviewHint') }}</p>
            </li>
          </ol>
        </div>
      </article>
    </section>

    <footer class="academy-library-footer">
      <NotebookPen class="size-5 shrink-0" aria-hidden="true" />
      <p>{{ t('learning.frameworkHint') }}</p>
    </footer>
  </div>
</template>
