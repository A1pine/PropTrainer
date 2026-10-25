<script setup lang="ts">
import { AlertCircle } from '@lucide/vue'

const { t } = useI18n()
const learning = useLearningStore()
const attention = computed(() => learning.storageStatus === 'corrupt' || learning.storageStatus === 'invalid')
const message = computed(() =>
  learning.storageStatus === 'corrupt'
    ? 'learning.storageCorrupt'
    : learning.storageStatus === 'invalid'
      ? 'learning.storageInvalid'
      : 'learning.storageUnavailable',
)
function reset() {
  if (window.confirm(t('learning.resetConfirm'))) learning.reset()
}
</script>

<template>
  <section
    v-if="attention || learning.storageStatus === 'unavailable'"
    role="alert"
    class="academy-storage-warning"
    data-testid="learning-storage-warning"
  >
    <AlertCircle class="mt-1 size-5 shrink-0" aria-hidden="true" />
    <div>
      <p>{{ t(message) }}</p>
      <div class="mt-3 flex flex-wrap gap-3">
        <button type="button" class="academy-secondary" @click="learning.retry()">{{ t('learning.retry') }}</button>
        <button v-if="learning.storageStatus === 'corrupt'" type="button" class="academy-secondary" @click="reset">
          {{ t('learning.resetLearning') }}
        </button>
      </div>
    </div>
  </section>
</template>
