<script setup lang="ts">
import { Check, Languages } from '@lucide/vue'
import type { LocaleCode } from '~/domain/settings/schema'

withDefaults(defineProps<{ variant?: 'select' | 'button' }>(), { variant: 'select' })

const { locale, t } = useI18n()
const settings = useSettingsStore()
const open = ref(false)

const options: { value: 'en' | 'zh-CN' | 'ja'; label: string; native: string }[] = [
  { value: 'en', label: 'English', native: 'English' },
  { value: 'zh-CN', label: '简体中文', native: 'Chinese' },
  { value: 'ja', label: '日本語', native: 'Japanese' },
]

const current = computed({
  get: () => locale.value,
  set: (value: string) => settings.update({ locale: value as LocaleCode }),
})

function choose(code: LocaleCode) {
  settings.update({ locale: code })
  open.value = false
}
</script>

<template>
  <Select v-if="variant === 'select'" v-model="current" :options="options" size="sm" :aria-label="t('common.language')" class="min-w-[132px]" />
  <template v-else>
    <Tooltip :content="t('common.language')" side="right">
      <button
        type="button"
        class="grid size-9 place-items-center rounded-md text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink"
        :aria-label="t('common.language')"
        @click="open = true"
      >
        <Languages class="size-[17px]" aria-hidden="true" />
      </button>
    </Tooltip>
    <Dialog v-model:open="open" :title="t('common.language')" :description="t('settings.languageNote')" size="sm">
      <div class="space-y-1" role="listbox" :aria-label="t('common.language')">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          role="option"
          :aria-selected="option.value === locale"
          class="flex w-full items-center justify-between rounded-md border border-transparent px-3 py-2.5 text-left transition-colors"
          :class="option.value === locale ? 'border-line bg-clay-soft text-clay-ink' : 'text-ink-2 hover:bg-ink/[0.04]'"
          @click="choose(option.value)"
        >
          <span class="text-[13px] font-medium">{{ option.label }}</span>
          <span class="flex items-center gap-2">
            <span class="font-mono text-[10px] uppercase tracking-wide text-ink-3">{{ option.value }}</span>
            <Check v-if="option.value === locale" class="size-3.5" aria-hidden="true" />
          </span>
        </button>
      </div>
    </Dialog>
  </template>
</template>
