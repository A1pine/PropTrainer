// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccountManager from '@/components/terminal/AccountManager.vue'
import type { ReplayAccount } from '~/lib/sim/accounts'
import en from '../../i18n/locales/en.json'
import zhCN from '../../i18n/locales/zh-CN.json'
import ja from '../../i18n/locales/ja.json'

enableAutoUnmount(afterEach)

type Locale = 'en' | 'zh-CN' | 'ja'

const Dialog = defineComponent({
  props: {
    open: Boolean,
    title: String,
    description: String,
    size: String,
    hideClose: Boolean,
    dismissible: { type: Boolean, default: true },
  },
  template: `
    <div
      v-if="open"
      role="dialog"
      data-testid="dialog"
      :data-dismissible="String(dismissible)"
      :data-close-hidden="String(hideClose)"
    >
      <h2>{{ title }}</h2>
      <p v-if="description">{{ description }}</p>
      <slot />
      <slot name="footer" />
    </div>
  `,
})

const Badge = defineComponent({
  props: { variant: String, size: String, dot: Boolean },
  template: '<span :data-variant="variant" :data-dot="dot ? \'true\' : undefined"><slot /></span>',
})

const Button = defineComponent({
  props: {
    type: { type: String, default: 'button' },
    variant: String,
    size: String,
    disabled: Boolean,
    loading: Boolean,
    block: Boolean,
  },
  emits: ['click'],
  template: `
    <button
      :type="type"
      :disabled="disabled || loading"
      :data-variant="variant"
      @click="$emit('click', $event)"
    ><slot /></button>
  `,
})

const Input = defineComponent({
  props: {
    modelValue: { type: [String, Number], default: '' },
    size: String,
    invalid: Boolean,
    disabled: Boolean,
    prefix: String,
    suffix: String,
  },
  emits: ['update:modelValue'],
  template: `
    <input
      :value="modelValue"
      :disabled="disabled"
      :aria-invalid="invalid || undefined"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  `,
})

const Field = defineComponent({
  props: {
    label: String,
    hint: String,
    error: String,
    htmlFor: String,
    required: Boolean,
    inline: Boolean,
  },
  template: `
    <div>
      <label v-if="label" :for="htmlFor">{{ label }}<span v-if="required"> *</span></label>
      <slot />
      <p v-if="error" role="alert" data-testid="field-error">{{ error }}</p>
      <p v-else-if="hint">{{ hint }}</p>
    </div>
  `,
})

const components = { Dialog, Badge, Button, Input, Field }

let sequence = 0

function account(overrides: Partial<ReplayAccount> = {}): ReplayAccount {
  sequence += 1
  return {
    id: `account-${sequence}`,
    name: 'Alpha',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    accountSize: 50000,
    balance: 50000,
    equity: 50000,
    status: 'active',
    breach: null,
    cursor: 0,
    ...overrides,
  }
}

function mountAccounts(
  props: {
    accounts?: ReplayAccount[]
    activeId?: string | null
    busy?: boolean
    error?: string | null
  } = {},
  locale: Locale = 'en',
  attachTo?: Element,
) {
  const { accounts = [], activeId = null, ...rest } = props
  return mount(AccountManager, {
    props: { accounts, activeId, ...rest },
    attachTo,
    global: {
      components,
      plugins: [
        createI18n({
          legacy: false,
          locale,
          fallbackLocale: 'en',
          messages: { en, 'zh-CN': zhCN, ja },
        }),
      ],
    },
  })
}

type View = ReturnType<typeof mountAccounts>

const control = (view: View, id: string) => view.get(`[data-testid="${id}"]`)
const row = (view: View, id: string) => view.get(`[data-testid="account-row"][data-account-id="${id}"]`)
const rowControl = (view: View, id: string, controlId: string) => row(view, id).get(`[data-testid="${controlId}"]`)

async function openManager(view: View) {
  await control(view, 'account-open').trigger('click')
  await nextTick()
}

function flattenKeys(source: object, prefix = '', out: string[] = []): string[] {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flattenKeys(value as object, path, out)
    else out.push(path)
  }
  return out
}

describe('account manager creation', () => {
  it('offers three starting sizes with 50K selected by default', async () => {
    const view = mountAccounts()
    await openManager(view)

    expect(control(view, 'account-empty').text()).toContain(en.terminal.accounts.emptyTitle)
    expect(control(view, 'account-create').exists()).toBe(true)
    for (const [size, short, full] of [
      [25000, '25K', '$25,000'],
      [50000, '50K', '$50,000'],
      [100000, '100K', '$100,000'],
    ] as const) {
      const option = control(view, `account-create-size-${size}`)
      expect(option.text()).toContain(short)
      expect(option.text()).toContain(full)
    }
    expect(control(view, 'account-create-size-50000').attributes('aria-checked')).toBe('true')
    expect(control(view, 'account-create-size-25000').attributes('aria-checked')).toBe('false')
    expect(control(view, 'account-create-size-100000').attributes('aria-checked')).toBe('false')
  })

  it.each([25000, 50000, 100000] as const)('emits a trimmed name at %i without closing the form', async (size) => {
    const view = mountAccounts()
    await openManager(view)

    await control(view, 'account-create-name').setValue('  Eval account  ')
    await control(view, `account-create-size-${size}`).trigger('click')
    await control(view, 'account-create').trigger('submit')

    expect(view.emitted('create')).toEqual([[{ name: 'Eval account', size }]])
    expect(control(view, 'account-create').exists()).toBe(true)
  })

  it('rejects an empty or overlong name without emitting', async () => {
    const view = mountAccounts()
    await openManager(view)

    await control(view, 'account-create').trigger('submit')
    expect(view.emitted('create')).toBeUndefined()
    expect(control(view, 'field-error').text()).toBe(en.terminal.accounts.nameRequired)

    await control(view, 'account-create-name').setValue('x'.repeat(61))
    await control(view, 'account-create').trigger('submit')
    expect(view.emitted('create')).toBeUndefined()
    expect(control(view, 'field-error').text()).toBe(en.terminal.accounts.nameTooLong)
  })

  it('resets the form only after the created account arrives in props', async () => {
    const view = mountAccounts()
    await openManager(view)

    await control(view, 'account-create-name').setValue('Funded 25K')
    await control(view, 'account-create-size-25000').trigger('click')
    await control(view, 'account-create').trigger('submit')

    expect(view.emitted('create')).toEqual([[{ name: 'Funded 25K', size: 25000 }]])
    expect(control(view, 'account-create').exists()).toBe(true)

    const created = account({
      id: 'new-account',
      name: 'Funded 25K',
      accountSize: 25000,
      balance: 25000,
      equity: 25000,
    })
    await view.setProps({ accounts: [created], activeId: 'new-account' })
    await nextTick()

    expect(view.find('[data-testid="account-create"]').exists()).toBe(false)
    expect(row(view, 'new-account').text()).toContain('Funded 25K')

    await control(view, 'account-create-toggle').trigger('click')
    expect((control(view, 'account-create-name').element as HTMLInputElement).value).toBe('')
    expect(control(view, 'account-create-size-50000').attributes('aria-checked')).toBe('true')
  })

  it('keeps the form and name when creation fails', async () => {
    const view = mountAccounts()
    await openManager(view)

    await control(view, 'account-create-name').setValue('Retry account')
    await control(view, 'account-create').trigger('submit')
    expect(view.emitted('create')).toHaveLength(1)

    await view.setProps({ error: 'Local storage is unavailable' })
    await nextTick()

    expect(control(view, 'account-create').exists()).toBe(true)
    expect(control(view, 'account-error').text()).toContain('Local storage is unavailable')
    expect((control(view, 'account-create-name').element as HTMLInputElement).value).toBe('Retry account')
  })
})

describe('account manager selection and rename', () => {
  it('emits select and closes only after activeId confirms the switch', async () => {
    const alpha = account({ id: 'alpha', name: 'Alpha' })
    const beta = account({ id: 'beta', name: 'Beta' })
    const view = mountAccounts({ accounts: [alpha, beta], activeId: 'alpha' })
    await openManager(view)

    expect(row(view, 'alpha').get('[data-testid="account-active-marker"]').text()).toBe(en.terminal.accounts.current)
    expect(row(view, 'alpha').find('[data-testid="account-select"]').exists()).toBe(false)

    await rowControl(view, 'beta', 'account-select').trigger('click')
    expect(view.emitted('select')).toEqual([['beta']])
    expect(control(view, 'account-manager').exists()).toBe(true)
    expect(view.emitted('open-change')?.at(-1)).toEqual([true])

    await view.setProps({ activeId: 'beta' })
    await nextTick()

    expect(view.find('[data-testid="account-manager"]').exists()).toBe(false)
    expect(view.emitted('open-change')?.at(-1)).toEqual([false])
  })

  it('validates trim and 1..60 lengths before emitting rename', async () => {
    const alpha = account({ id: 'alpha', name: 'Alpha' })
    const view = mountAccounts({ accounts: [alpha], activeId: 'alpha' })
    await openManager(view)

    await rowControl(view, 'alpha', 'account-rename').trigger('click')
    const input = rowControl(view, 'alpha', 'account-rename-input')
    const save = rowControl(view, 'alpha', 'account-rename-save')

    await input.setValue('   ')
    await save.trigger('click')
    expect(view.emitted('rename')).toBeUndefined()
    expect(rowControl(view, 'alpha', 'account-rename-error').text()).toBe(en.terminal.accounts.nameRequired)

    await input.setValue('x'.repeat(61))
    await save.trigger('click')
    expect(view.emitted('rename')).toBeUndefined()
    expect(rowControl(view, 'alpha', 'account-rename-error').text()).toBe(en.terminal.accounts.nameTooLong)

    await input.setValue('  Funded 100K  ')
    await save.trigger('click')
    expect(view.emitted('rename')).toEqual([['alpha', 'Funded 100K']])
    expect(row(view, 'alpha').find('[data-testid="account-rename-form"]').exists()).toBe(true)

    await view.setProps({ accounts: [account({ id: 'alpha', name: 'Funded 100K' })] })
    await nextTick()
    expect(row(view, 'alpha').find('[data-testid="account-rename-form"]').exists()).toBe(false)
  })
})

describe('account manager deletion', () => {
  it('requires an explicit confirmation and keeps the account when cancellation or failure occurs', async () => {
    const alpha = account({ id: 'alpha', name: 'Alpha' })
    const beta = account({ id: 'beta', name: 'Beta' })
    const view = mountAccounts({ accounts: [alpha, beta], activeId: 'beta' })
    await openManager(view)

    await rowControl(view, 'alpha', 'account-delete').trigger('click')
    const confirmation = row(view, 'alpha').get('[data-testid="account-delete-confirm"]')
    expect(confirmation.text()).toContain('Alpha')
    expect(confirmation.text()).toContain('ledger')
    expect(confirmation.text()).toContain('positions')
    expect(confirmation.text()).toContain('replay progress')

    await rowControl(view, 'alpha', 'cancel-delete').trigger('click')
    expect(view.emitted('remove')).toBeUndefined()
    expect(row(view, 'alpha').find('[data-testid="account-delete-confirm"]').exists()).toBe(false)

    await rowControl(view, 'alpha', 'account-delete').trigger('click')
    await rowControl(view, 'alpha', 'confirm-delete').trigger('click')
    expect(view.emitted('remove')).toEqual([['alpha']])
    expect(row(view, 'alpha').find('[data-testid="account-delete-confirm"]').exists()).toBe(true)

    await view.setProps({ error: 'Could not delete the account' })
    await nextTick()
    expect(control(view, 'account-error').text()).toContain('Could not delete the account')
    expect(row(view, 'alpha').find('[data-testid="account-delete-confirm"]').exists()).toBe(true)

    await view.setProps({ accounts: [beta] })
    await nextTick()
    expect(view.find('[data-account-id="alpha"]').exists()).toBe(false)
  })
})

describe('account manager status labels', () => {
  it.each([
    ['en', 'Blown account', 'Daily loss lock', 'Target reached'],
    ['zh-CN', '爆仓', '日损锁定', '目标达成'],
    ['ja', '破綻口座', '日次損失ロック', '目標達成'],
  ] as const)('uses distinct breached and daily-lock text in %s', async (locale, breached, locked, target) => {
    const view = mountAccounts(
      {
        accounts: [
          account({ id: 'breached', name: 'Breached account', status: 'breached' }),
          account({ id: 'locked', name: 'Locked account', status: 'daily-lock' }),
          account({ id: 'target', name: 'Target account', status: 'target' }),
        ],
        activeId: 'locked',
      },
      locale,
    )
    await openManager(view)

    expect(rowControl(view, 'breached', 'account-status').text()).toBe(breached)
    expect(rowControl(view, 'locked', 'account-status').text()).toBe(locked)
    expect(rowControl(view, 'target', 'account-status').text()).toBe(target)
    expect(row(view, 'breached').text()).not.toContain(locked)
  })

  it('keeps the accounts namespace in sync across locales', () => {
    const expected = flattenKeys(en.terminal.accounts).sort()
    expect(flattenKeys(zhCN.terminal.accounts).sort()).toEqual(expected)
    expect(flattenKeys(ja.terminal.accounts).sort()).toEqual(expected)
  })
})

describe('account manager busy and error states', () => {
  it('blocks dismissal and writes while busy, shows the error, and does not close', async () => {
    const alpha = account({ id: 'alpha', name: 'Alpha' })
    const beta = account({ id: 'beta', name: 'Beta' })
    const view = mountAccounts({ accounts: [alpha, beta], activeId: 'alpha' })
    await openManager(view)

    await view.setProps({ busy: true, error: 'Could not switch accounts' })
    await nextTick()

    expect(control(view, 'dialog').attributes('data-dismissible')).toBe('false')
    expect(control(view, 'dialog').attributes('data-close-hidden')).toBe('true')
    expect(control(view, 'account-busy').text()).toContain(en.terminal.accounts.busy)
    expect(control(view, 'account-error').text()).toContain('Could not switch accounts')
    expect(control(view, 'account-open').attributes('disabled')).toBeDefined()
    expect(rowControl(view, 'beta', 'account-select').attributes('disabled')).toBeDefined()
    expect(rowControl(view, 'beta', 'account-rename').attributes('disabled')).toBeDefined()
    expect(rowControl(view, 'beta', 'account-delete').attributes('disabled')).toBeDefined()

    await rowControl(view, 'beta', 'account-select').trigger('click')
    await control(view, 'account-create-toggle').trigger('click')

    expect(view.emitted('select')).toBeUndefined()
    expect(control(view, 'account-manager').exists()).toBe(true)
    expect(view.find('[data-testid="account-create"]').exists()).toBe(false)
    expect(view.emitted('open-change')).not.toContainEqual([false])

    await view.setProps({ busy: false, error: null })
    await rowControl(view, 'beta', 'account-select').trigger('click')
    expect(view.emitted('select')).toEqual([['beta']])
  })

  it('does not open the manager from the header while busy', async () => {
    const alpha = account({ id: 'alpha', name: 'Alpha' })
    const view = mountAccounts({ accounts: [alpha], activeId: 'alpha', busy: true })

    expect(control(view, 'account-open').attributes('disabled')).toBeDefined()
    await control(view, 'account-open').trigger('click')
    await nextTick()
    expect(view.find('[data-testid="account-manager"]').exists()).toBe(false)
  })
})

describe('account manager keyboard isolation', () => {
  it('reserves Escape for dialog dismissal while blocking terminal shortcuts', async () => {
    const view = mountAccounts({}, 'en', document.body)
    await openManager(view)

    const keys: string[] = []
    const listener = (event: KeyboardEvent) => keys.push(event.key)
    window.addEventListener('keydown', listener)
    try {
      control(view, 'account-create-name').element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', bubbles: true }),
      )
      control(view, 'account-create-name').element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
      await nextTick()
    } finally {
      window.removeEventListener('keydown', listener)
    }

    expect(keys).toEqual(['Escape'])
  })
})

describe('account manager empty state', () => {
  it('shows a create-first state and hides the cancel action when there is nothing to cancel', async () => {
    const view = mountAccounts()
    expect(control(view, 'account-open').text()).toContain(en.terminal.accounts.none)
    await openManager(view)

    expect(control(view, 'account-empty').exists()).toBe(true)
    expect(control(view, 'account-create').exists()).toBe(true)
    expect(view.find('[data-testid="account-list"]').exists()).toBe(false)
    expect(view.find('[data-testid="account-create-toggle"]').exists()).toBe(false)
    expect(view.find('[data-testid="account-create-cancel"]').exists()).toBe(false)
  })
})
