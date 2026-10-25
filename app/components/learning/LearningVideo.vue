<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { learningText, safeResourceUrl } from '~/domain/learning/catalog'
import type { LearningVideo } from '~/domain/learning/types'

const props = defineProps<{
  video: LearningVideo
}>()

const { locale, t } = useI18n()

const youtubeVideoId = /^[\w-]{11}$/
const loaded = ref(false)

const title = computed(() => learningText(props.video.title, locale.value))
const sourceKey = computed(() =>
  props.video.type === 'youtube' ? `youtube:${props.video.videoId}` : `file:${props.video.url}`,
)
const youtubeSrc = computed(() =>
  props.video.type === 'youtube' && youtubeVideoId.test(props.video.videoId)
    ? `https://www.youtube-nocookie.com/embed/${props.video.videoId}`
    : null,
)
const fileSrc = computed(() =>
  props.video.type === 'file' && safeResourceUrl(props.video.url) ? props.video.url : null,
)
const available = computed(() => youtubeSrc.value !== null || fileSrc.value !== null)

watch(sourceKey, () => {
  loaded.value = false
})
</script>

<template>
  <section class="academy-video" data-learning-video>
    <h2 class="academy-subtitle">{{ title }}</h2>

    <template v-if="available">
      <template v-if="loaded">
        <iframe
          v-if="youtubeSrc"
          class="academy-video-frame"
          :src="youtubeSrc"
          :title="title"
          loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        ></iframe>
        <video
          v-else-if="fileSrc"
          class="academy-video-frame"
          :src="fileSrc"
          :title="title"
          :aria-label="title"
          controls
          playsinline
          preload="metadata"
        ></video>
        <button type="button" class="academy-secondary" @click="loaded = false">
          {{ t('learning.unloadVideo') }}
        </button>
      </template>
      <template v-else>
        <button type="button" class="academy-secondary" @click="loaded = true">
          {{ t('learning.loadVideo') }}
        </button>
        <p class="academy-video-privacy">{{ t('learning.videoPrivacy') }}</p>
      </template>
    </template>

    <p v-else class="academy-video-unavailable">{{ t('learning.videoUnavailable') }}</p>
  </section>
</template>
