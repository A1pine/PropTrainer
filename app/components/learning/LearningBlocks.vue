<script setup lang="ts">
import { learningText, safeResourceUrl } from '~/domain/learning/catalog'
import type { LearningBlock, LearningText, PracticeTool } from '~/domain/learning/types'

const props = withDefaults(
  defineProps<{
    blocks: LearningBlock[]
    checked: string[]
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  check: [id: string, checked: boolean]
}>()

const { locale, t } = useI18n()

const practiceTargets = new Set<PracticeTool>(['/trainer', '/drill', '/analysis', '/terminal'])

function text(value: LearningText) {
  return learningText(value, locale.value)
}

function checkId(blockId: string, itemId: string) {
  return `learning-check-${blockId}-${itemId}`
}

function isPracticeTarget(target: PracticeTool | null): target is PracticeTool {
  return target !== null && practiceTargets.has(target)
}

function onCheck(id: string, event: Event) {
  if (props.disabled) return
  emit('check', id, (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <div class="academy-blocks">
    <section
      v-for="block in blocks"
      :key="block.id"
      class="academy-block"
      :class="{
        'academy-prose': block.type === 'text',
        'academy-callout': block.type === 'callout',
        'academy-checklist': block.type === 'checklist',
        'academy-resources': block.type === 'resources',
        'academy-practice': block.type === 'practice',
      }"
      :data-block-id="block.id"
      :data-block-type="block.type"
    >
      <template v-if="block.type === 'text'">
        <p v-for="(paragraph, index) in block.paragraphs" :key="index">{{ text(paragraph) }}</p>
      </template>

      <template v-else-if="block.type === 'callout'">
        <h2 class="academy-subtitle">{{ text(block.title) }}</h2>
        <div class="academy-prose">
          <p>{{ text(block.body) }}</p>
        </div>
      </template>

      <template v-else-if="block.type === 'checklist'">
        <h2 class="academy-subtitle">{{ text(block.title) }}</h2>
        <ul>
          <li v-for="item in block.items" :key="item.id">
            <label class="academy-check" :for="checkId(block.id, item.id)">
              <input
                :id="checkId(block.id, item.id)"
                type="checkbox"
                :data-check-id="item.id"
                :checked="checked.includes(item.id)"
                :disabled="disabled"
                @change="onCheck(item.id, $event)"
              />
              <span>{{ text(item.text) }}</span>
              <span v-if="item.required" class="academy-required">{{ t('learning.required') }}</span>
            </label>
          </li>
        </ul>
      </template>

      <template v-else-if="block.type === 'resources'">
        <h2 class="academy-subtitle">{{ text(block.title) }}</h2>
        <ul>
          <li v-for="(item, index) in block.items" :key="`${block.id}-${index}`">
            <a
              v-if="safeResourceUrl(item.url)"
              class="academy-link"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ text(item.label) }}
              <span class="sr-only">{{ t('learning.openResource') }}</span>
            </a>
            <span v-else>{{ text(item.label) }}</span>
          </li>
        </ul>
      </template>

      <template v-else-if="block.type === 'practice'">
        <h2 class="academy-subtitle">{{ text(block.title) }}</h2>
        <div class="academy-prose">
          <p>{{ text(block.body) }}</p>
        </div>
        <NuxtLink v-if="isPracticeTarget(block.target)" class="academy-link" :to="block.target">
          {{ t('learning.freePractice') }}
        </NuxtLink>
        <p v-else class="academy-pending">{{ t('learning.practicePending') }}</p>
      </template>
    </section>
  </div>
</template>
