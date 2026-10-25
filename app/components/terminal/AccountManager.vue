<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlertTriangle,
  ArrowRightLeft,
  ChevronDown,
  HardDrive,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Wallet,
} from '@lucide/vue'
import type { ReplayAccount } from '~/lib/sim/accounts'
import type { SimAccountStatus } from '~/domain/sim/types'
import { formatMoney } from '~/utils/format'

type AccountSize = 25000 | 50000 | 100000

const props = withDefaults(
  defineProps<{
    accounts: ReplayAccount[]
    activeId: string | null
    busy?: boolean
    error?: string | null
  }>(),
  { busy: false, error: null },
)

const emit = defineEmits<{
  create: [{ name: string; size: AccountSize }]
  select: [id: string]
  rename: [id: string, name: string]
  remove: [id: string]
  'open-change': [open: boolean]
}>()

const { t } = useI18n()

const sizes: AccountSize[] = [25000, 50000, 100000]
const statusTone: Record<SimAccountStatus, 'neutral' | 'warn' | 'danger' | 'bull'> = {
  active: 'neutral',
  'daily-lock': 'warn',
  breached: 'danger',
  target: 'bull',
}

const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const showCreate = ref(props.accounts.length === 0)
const createName = ref('')
const createSize = ref<AccountSize>(50000)
const createError = ref('')
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameError = ref('')
const confirmingDeleteId = ref<string | null>(null)
const selectRequest = ref<string | null>(null)
const createRequest = ref<{ baseline: Set<string> } | null>(null)
const renameRequest = ref<{ id: string; name: string } | null>(null)
const deleteRequestId = ref<string | null>(null)
const createNameId = useId()

const activeAccount = computed(() => props.accounts.find((account) => account.id === props.activeId) ?? null)

const accountSignature = computed(() =>
  props.accounts.map((account) => `${account.id}\u0000${account.name}`).join('\u0001'),
)

const headerSubline = computed(() => {
  if (activeAccount.value) {
    return `${formatMoney(activeAccount.value.accountSize, { decimals: 0 })} · ${t('terminal.accounts.manage')}`
  }
  if (props.accounts.length) return t('terminal.accounts.count', { count: props.accounts.length })
  return t('terminal.accounts.emptyTitle')
})

const headerLabel = computed(() => {
  const account = activeAccount.value
  if (!account) return t('terminal.accounts.openFallback')
  return t('terminal.accounts.openLabel', {
    name: account.name,
    size: formatMoney(account.accountSize, { decimals: 0 }),
    status: statusLabel(account.status),
  })
})

function statusLabel(status: SimAccountStatus): string {
  return t(`terminal.accounts.status.${status}`)
}

function sizeShort(size: number): string {
  if (size === 25000) return '25K'
  if (size === 50000) return '50K'
  if (size === 100000) return '100K'
  return formatMoney(size, { decimals: 0 })
}

function nameValidation(value: string): string {
  const name = value.trim()
  if (!name) return t('terminal.accounts.nameRequired')
  if (name.length > 60) return t('terminal.accounts.nameTooLong')
  return ''
}

function resetCreateForm() {
  createName.value = ''
  createSize.value = 50000
  createError.value = ''
}

function resetTransient() {
  selectRequest.value = null
  createRequest.value = null
  renameRequest.value = null
  deleteRequestId.value = null
  renamingId.value = null
  renameError.value = ''
  confirmingDeleteId.value = null
  resetCreateForm()
  showCreate.value = props.accounts.length === 0
}

function openManager() {
  if (props.busy) return
  open.value = true
}

function onAccountKeydown(event: KeyboardEvent) {
  // Keep Escape available to Dialog's dismiss handler; stop all other terminal shortcuts.
  if (event.key !== 'Escape') event.stopPropagation()
}

function toggleCreate() {
  if (props.busy) return
  if (showCreate.value) {
    closeCreate()
    return
  }
  showCreate.value = true
  createError.value = ''
}

function closeCreate() {
  if (props.busy) return
  showCreate.value = false
  resetCreateForm()
}

function submitCreate() {
  if (props.busy) return
  const name = createName.value.trim()
  const error = nameValidation(name)
  if (error) {
    createError.value = error
    return
  }
  createError.value = ''
  createRequest.value = { baseline: new Set(props.accounts.map((account) => account.id)) }
  emit('create', { name, size: createSize.value })
}

function selectAccount(account: ReplayAccount) {
  if (props.busy || account.id === props.activeId) return
  selectRequest.value = account.id
  emit('select', account.id)
}

function startRename(account: ReplayAccount) {
  if (props.busy) return
  renamingId.value = account.id
  renameValue.value = account.name
  renameError.value = ''
  confirmingDeleteId.value = null
  deleteRequestId.value = null
}

function cancelRename() {
  if (props.busy) return
  renamingId.value = null
  renameValue.value = ''
  renameError.value = ''
  renameRequest.value = null
}

function submitRename(account: ReplayAccount) {
  if (props.busy) return
  const name = renameValue.value.trim()
  const error = nameValidation(name)
  if (error) {
    renameError.value = error
    return
  }
  renameError.value = ''
  if (name === account.name) {
    renamingId.value = null
    renameValue.value = ''
    renameRequest.value = null
    return
  }
  renameRequest.value = { id: account.id, name }
  emit('rename', account.id, name)
}

function askDelete(account: ReplayAccount) {
  if (props.busy) return
  confirmingDeleteId.value = account.id
  if (renamingId.value === account.id) {
    renamingId.value = null
    renameValue.value = ''
    renameError.value = ''
    renameRequest.value = null
  }
  deleteRequestId.value = null
}

function cancelDelete() {
  if (props.busy) return
  confirmingDeleteId.value = null
  deleteRequestId.value = null
}

function confirmDelete(account: ReplayAccount) {
  if (props.busy) return
  deleteRequestId.value = account.id
  emit('remove', account.id)
}

watch(accountSignature, () => {
  const accounts = props.accounts
  const create = createRequest.value
  if (create && accounts.some((account) => !create.baseline.has(account.id))) {
    createRequest.value = null
    resetCreateForm()
    showCreate.value = false
  }

  const rename = renameRequest.value
  if (rename) {
    const target = accounts.find((account) => account.id === rename.id)
    if (!target || target.name.trim() === rename.name) {
      renamingId.value = null
      renameValue.value = ''
      renameError.value = ''
      renameRequest.value = null
    }
  }

  if (deleteRequestId.value && !accounts.some((account) => account.id === deleteRequestId.value)) {
    deleteRequestId.value = null
    confirmingDeleteId.value = null
  }
  if (confirmingDeleteId.value && !accounts.some((account) => account.id === confirmingDeleteId.value)) {
    confirmingDeleteId.value = null
  }
  if (renamingId.value && !accounts.some((account) => account.id === renamingId.value)) {
    renamingId.value = null
    renameValue.value = ''
    renameError.value = ''
  }
  if (!accounts.length) showCreate.value = true
})

watch(createName, () => {
  if (createError.value) createError.value = ''
})

watch(renameValue, () => {
  if (renameError.value) renameError.value = ''
})

watch(open, (value) => {
  emit('open-change', value)
  if (!value) {
    resetTransient()
    void nextTick(() => trigger.value?.focus())
  }
})

watch(
  () => props.activeId,
  (id) => {
    if (selectRequest.value && id === selectRequest.value) {
      selectRequest.value = null
      open.value = false
    }
  },
)
</script>

<template>
  <section class="min-w-0" data-testid="terminal-accounts" @keydown="onAccountKeydown">
    <button
      ref="trigger"
      type="button"
      data-testid="account-open"
      class="group flex w-full min-w-0 items-center gap-2.5 rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 px-2.5 py-2 text-left shadow-xs transition-[border-color,background-color] duration-150 hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:pointer-events-none disabled:opacity-50"
      :aria-label="headerLabel"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :disabled="busy"
      @click="openManager"
    >
      <span class="grid size-7 shrink-0 place-items-center rounded-md bg-clay-soft text-clay-ink">
        <Wallet class="size-3.5" aria-hidden="true" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex min-w-0 flex-wrap items-center gap-1.5">
          <span class="truncate text-[12px] font-medium leading-tight text-ink">
            {{ activeAccount?.name ?? t('terminal.accounts.none') }}
          </span>
          <Badge
            v-if="activeAccount"
            :variant="statusTone[activeAccount.status]"
            size="sm"
            dot
            class="shrink-0"
            data-testid="account-header-status"
            >{{ statusLabel(activeAccount.status) }}</Badge
          >
        </span>
        <span class="mt-0.5 block truncate font-mono text-[10px] leading-tight tabular-nums text-ink-3">
          {{ headerSubline }}
        </span>
      </span>
      <ChevronDown class="size-3.5 shrink-0 text-ink-3 transition-colors group-hover:text-ink-2" aria-hidden="true" />
    </button>

    <Dialog
      v-model:open="open"
      :title="t('terminal.accounts.title')"
      :description="t('terminal.accounts.description')"
      size="lg"
      :dismissible="!busy"
      :hide-close="busy"
    >
      <div
        class="space-y-4"
        data-testid="account-manager"
        :data-busy="busy || undefined"
        :aria-busy="busy || undefined"
        @keydown="onAccountKeydown"
      >
        <div class="grid gap-2 rounded-lg border-[length:var(--hairline)] border-line bg-sunken p-2.5 sm:grid-cols-2">
          <p class="flex items-start gap-2 text-[11px] leading-relaxed text-ink-2">
            <HardDrive class="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
            <span>{{ t('terminal.accounts.storageHint') }}</span>
          </p>
          <p class="flex items-start gap-2 text-[11px] leading-relaxed text-ink-2">
            <ShieldCheck class="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
            <span>{{ t('terminal.accounts.simulationHint') }}</span>
          </p>
        </div>

        <p
          v-if="busy"
          role="status"
          data-testid="account-busy"
          class="flex items-center gap-2 rounded-md bg-clay-soft px-2.5 py-2 text-[11.5px] font-medium text-clay-ink"
        >
          <Loader2 class="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          {{ t('terminal.accounts.busy') }}
        </p>

        <div
          v-if="error"
          role="alert"
          data-testid="account-error"
          class="rounded-md border-[length:var(--hairline)] border-danger/40 bg-danger-soft px-2.5 py-2"
        >
          <p class="text-[11.5px] font-semibold text-danger">{{ t('terminal.accounts.errorTitle') }}</p>
          <p class="mt-0.5 break-words text-[11px] leading-relaxed text-ink-2">{{ error }}</p>
        </div>

        <div
          v-if="!accounts.length"
          data-testid="account-empty"
          class="rounded-lg border border-dashed border-line-strong bg-sunken/60 px-4 py-5 text-center"
        >
          <span class="mx-auto grid size-9 place-items-center rounded-lg bg-clay-soft text-clay-ink">
            <Wallet class="size-4" aria-hidden="true" />
          </span>
          <p class="mt-2 text-[13px] font-medium text-ink">{{ t('terminal.accounts.emptyTitle') }}</p>
          <p class="mx-auto mt-1 max-w-[38ch] text-[11.5px] leading-relaxed text-ink-3">
            {{ t('terminal.accounts.emptyHint') }}
          </p>
        </div>

        <div v-else class="space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="label-micro">{{ t('terminal.accounts.listLabel') }}</p>
            <Button
              variant="outline"
              size="xs"
              data-testid="account-create-toggle"
              :disabled="busy"
              @click="toggleCreate"
            >
              <Plus class="size-3" aria-hidden="true" />
              {{ showCreate ? t('terminal.accounts.hideForm') : t('terminal.accounts.newAccount') }}
            </Button>
          </div>

          <ul class="space-y-2" data-testid="account-list" :aria-label="t('terminal.accounts.listLabel')">
            <li
              v-for="account in accounts"
              :key="account.id"
              data-testid="account-row"
              :data-account-id="account.id"
              :aria-current="account.id === activeId ? 'true' : undefined"
              class="min-w-0 rounded-lg border-[length:var(--hairline)] p-3"
              :class="account.id === activeId ? 'border-clay/45 bg-clay-soft' : 'border-line bg-surface-2'"
            >
              <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                    <h3 class="min-w-0 break-words text-[13px] font-semibold leading-snug text-ink">
                      {{ account.name }}
                    </h3>
                    <Badge
                      v-if="account.id === activeId"
                      variant="clay"
                      size="sm"
                      data-testid="account-active-marker"
                      >{{ t('terminal.accounts.current') }}</Badge
                    >
                  </div>
                  <div class="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" size="sm" class="font-mono tabular-nums">{{
                      formatMoney(account.accountSize, { decimals: 0 })
                    }}</Badge>
                    <Badge :variant="statusTone[account.status]" size="sm" dot data-testid="account-status">{{
                      statusLabel(account.status)
                    }}</Badge>
                  </div>
                </div>

                <div class="flex shrink-0 flex-wrap items-center gap-1">
                  <Button
                    v-if="account.id !== activeId"
                    variant="outline"
                    size="xs"
                    data-testid="account-select"
                    :disabled="busy"
                    :aria-label="t('terminal.accounts.selectLabel', { name: account.name })"
                    @click="selectAccount(account)"
                  >
                    <ArrowRightLeft class="size-3" aria-hidden="true" />
                    {{ t('terminal.accounts.select') }}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    data-testid="account-rename"
                    :disabled="busy"
                    :aria-label="t('terminal.accounts.renameLabel', { name: account.name })"
                    @click="startRename(account)"
                  >
                    <Pencil class="size-3" aria-hidden="true" />
                    {{ t('terminal.accounts.rename') }}
                  </Button>
                  <Button
                    variant="danger-ghost"
                    size="xs"
                    data-testid="account-delete"
                    :disabled="busy"
                    :aria-label="t('terminal.accounts.deleteLabel', { name: account.name })"
                    @click="askDelete(account)"
                  >
                    <Trash2 class="size-3" aria-hidden="true" />
                    {{ t('terminal.accounts.delete') }}
                  </Button>
                </div>
              </div>

              <dl
                class="mt-2 grid min-w-0 grid-cols-2 gap-2 rounded-md border-[length:var(--hairline)] border-line-soft bg-sunken px-2.5 py-2"
              >
                <div class="min-w-0">
                  <dt class="text-[10px] text-ink-3">{{ t('terminal.accounts.balance') }}</dt>
                  <dd class="num mt-0.5 break-all text-[12.5px] leading-tight text-ink">
                    {{ formatMoney(account.balance, { decimals: 2 }) }}
                  </dd>
                </div>
                <div class="min-w-0">
                  <dt class="text-[10px] text-ink-3">{{ t('terminal.accounts.equity') }}</dt>
                  <dd class="num mt-0.5 break-all text-[12.5px] leading-tight text-ink">
                    {{ formatMoney(account.equity, { decimals: 2 }) }}
                  </dd>
                </div>
              </dl>

              <div
                v-if="renamingId === account.id"
                class="mt-2.5 rounded-md border-[length:var(--hairline)] border-clay/40 bg-surface-2 p-2.5"
                data-testid="account-rename-form"
              >
                <label :for="`account-rename-${account.id}`" class="text-[11px] font-medium text-ink-2">
                  {{ t('terminal.accounts.renameLabel', { name: account.name }) }}
                </label>
                <Input
                  :id="`account-rename-${account.id}`"
                  v-model="renameValue"
                  size="sm"
                  maxlength="60"
                  autocomplete="off"
                  spellcheck="false"
                  class="mt-1.5"
                  data-testid="account-rename-input"
                  :disabled="busy"
                  :invalid="Boolean(renameError)"
                  :aria-label="t('terminal.accounts.renameInput', { name: account.name })"
                  @keydown.enter.prevent="submitRename(account)"
                  @keydown.esc.stop.prevent="cancelRename"
                />
                <p
                  v-if="renameError"
                  role="alert"
                  data-testid="account-rename-error"
                  class="mt-1 text-[11px] text-danger"
                >
                  {{ renameError }}
                </p>
                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="primary"
                    size="xs"
                    data-testid="account-rename-save"
                    :disabled="busy"
                    @click="submitRename(account)"
                    >{{ t('terminal.accounts.saveRename') }}</Button
                  >
                  <Button
                    variant="ghost"
                    size="xs"
                    data-testid="account-rename-cancel"
                    :disabled="busy"
                    @click="cancelRename"
                    >{{ t('terminal.accounts.cancelRename') }}</Button
                  >
                </div>
              </div>

              <div
                v-if="confirmingDeleteId === account.id"
                role="alert"
                data-testid="account-delete-confirm"
                class="mt-2.5 rounded-md border-[length:var(--hairline)] border-danger/40 bg-danger-soft p-2.5"
              >
                <p class="flex items-start gap-1.5 text-[12px] font-semibold text-danger">
                  <AlertTriangle class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{{ t('terminal.accounts.deleteTitle', { name: account.name }) }}</span>
                </p>
                <p class="mt-1 text-[11px] leading-relaxed text-ink-2">{{ t('terminal.accounts.deleteBody') }}</p>
                <div class="mt-2 flex flex-wrap justify-end gap-1.5">
                  <Button
                    variant="secondary"
                    size="xs"
                    data-testid="cancel-delete"
                    :disabled="busy"
                    @click="cancelDelete"
                    >{{ t('terminal.accounts.cancelDelete') }}</Button
                  >
                  <Button
                    variant="danger"
                    size="xs"
                    data-testid="confirm-delete"
                    :disabled="busy"
                    @click="confirmDelete(account)"
                    >{{ t('terminal.accounts.confirmDelete') }}</Button
                  >
                </div>
              </div>
            </li>
          </ul>
        </div>

        <form
          v-if="showCreate"
          novalidate
          data-testid="account-create"
          class="rounded-lg border-[length:var(--hairline)] border-line bg-surface-2 p-3 sm:p-4"
          :aria-label="t('terminal.accounts.newAccount')"
          @submit.prevent="submitCreate"
        >
          <div>
            <h3 class="text-[13px] font-semibold text-ink">{{ t('terminal.accounts.newAccount') }}</h3>
            <p class="mt-0.5 text-[11px] leading-relaxed text-ink-3">
              {{ t('terminal.accounts.independentRules') }}
            </p>
          </div>

          <div class="mt-3 space-y-3">
            <Field :label="t('terminal.accounts.name')" :html-for="createNameId" :error="createError" required>
              <div class="relative">
                <Input
                  :id="createNameId"
                  v-model="createName"
                  maxlength="60"
                  autocomplete="off"
                  spellcheck="false"
                  class="pr-14"
                  data-testid="account-create-name"
                  :disabled="busy"
                  :invalid="Boolean(createError)"
                  :placeholder="t('terminal.accounts.namePlaceholder')"
                  :aria-label="t('terminal.accounts.name')"
                />
                <span
                  class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] tabular-nums text-ink-3"
                >
                  {{ t('terminal.accounts.nameCounter', { count: createName.length }) }}
                </span>
              </div>
            </Field>

            <div>
              <p class="text-[11.5px] font-medium text-ink-2">{{ t('terminal.accounts.size') }}</p>
              <div class="mt-1.5 grid grid-cols-3 gap-1.5" role="radiogroup" :aria-label="t('terminal.accounts.size')">
                <button
                  v-for="size in sizes"
                  :key="size"
                  type="button"
                  role="radio"
                  :aria-checked="createSize === size"
                  :data-testid="`account-create-size-${size}`"
                  :disabled="busy"
                  class="flex min-h-11 flex-col items-center justify-center rounded-md border-[length:var(--hairline)] px-2 py-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2 disabled:opacity-45"
                  :class="
                    createSize === size
                      ? 'border-clay bg-clay-soft shadow-xs'
                      : 'border-line bg-surface-2 hover:border-line-strong'
                  "
                  @click="createSize = size"
                >
                  <span
                    class="text-[12.5px] font-semibold leading-tight"
                    :class="createSize === size ? 'text-clay-ink' : 'text-ink-2'"
                    >{{ sizeShort(size) }}</span
                  >
                  <span
                    class="font-mono text-[9.5px] leading-tight tabular-nums"
                    :class="createSize === size ? 'text-clay-ink' : 'text-ink-3'"
                    >{{ formatMoney(size, { decimals: 0 }) }}</span
                  >
                </button>
              </div>
              <p class="mt-1 text-[10.5px] leading-snug text-ink-3">{{ t('terminal.accounts.sizeHint') }}</p>
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                data-testid="account-create-submit"
                :disabled="busy"
                :loading="busy && Boolean(createRequest)"
              >
                <Plus class="size-3.5" aria-hidden="true" />
                {{ t('terminal.accounts.create') }}
              </Button>
              <Button
                v-if="accounts.length"
                type="button"
                variant="ghost"
                size="sm"
                data-testid="account-create-cancel"
                :disabled="busy"
                @click="closeCreate"
                >{{ t('terminal.accounts.cancel') }}</Button
              >
            </div>
          </div>
        </form>
      </div>
    </Dialog>
  </section>
</template>
