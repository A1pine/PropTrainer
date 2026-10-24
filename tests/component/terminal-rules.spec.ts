// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { computed, defineComponent, ref, watch } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RulesPanel from '@/components/terminal/RulesPanel.vue'
import { formatMoney, formatPrice } from '@/utils/format'
import { cloneTemplate, PROP_TEMPLATES } from '@/domain/sim/presets'
import type { ConsistencyStatus, PropTemplate, RiskState } from '@/domain/sim/types'
import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh-CN.json'
import ja from '../../i18n/locales/ja.json'
import patch from '../../profile_output/terminal-ticket-translations.json'

enableAutoUnmount(afterEach)
const Select = defineComponent({
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  template:
    '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>',
})
const Switch = defineComponent({
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template:
    '<button type="button" role="switch" :disabled="disabled" :aria-checked="modelValue" @click="$emit(\'update:modelValue\', !modelValue)"></button>',
})
const Button = defineComponent({
  props: { type: { default: 'button' }, disabled: Boolean },
  template: '<button :type="type" :disabled="disabled"><slot /></button>',
})

function dictionary(base: object, additions: Record<string, string>) {
  const messages = JSON.parse(JSON.stringify(base))
  for (const [path, value] of Object.entries(additions)) {
    const keys = path.split('.')
    let node = messages
    for (const key of keys.slice(0, -1)) node = node[key] ??= {}
    node[keys.at(-1)!] = value
  }
  return messages
}

beforeEach(() => {
  for (const [key, value] of Object.entries({ ref, watch, computed, formatPrice, formatMoney }))
    vi.stubGlobal(key, value)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function template(): PropTemplate {
  return cloneTemplate(PROP_TEMPLATES[0]!)
}
function risk(config = template()): RiskState {
  return {
    template: cloneTemplate(config),
    startBalance: 50_000,
    peakEquity: 51_000,
    floor: 49_000,
    status: 'active',
    breach: null,
    days: [
      { key: '2026-01-02', realizedPnl: 123.45, trades: 1, fills: 3, startEquity: 50_000, finalized: true },
      { key: '2026-01-03', realizedPnl: -5, trades: 0, fills: 1, startEquity: 50_123.45, finalized: true },
      { key: '2026-01-04', realizedPnl: -200, trades: 2, fills: 4, startEquity: 50_118.45, finalized: false },
    ],
    currentDay: '2026-01-04',
    dayStartEquity: 50_118.45,
    lastEquity: 50_200,
    lastBalance: 49_918.45,
    lastTime: Date.UTC(2026, 0, 4, 13) / 1000,
    dailyTriggered: false,
    dailyWarned: false,
  }
}
const consistency: ConsistencyStatus = {
  bestDay: 123.45,
  totalNetProfit: 118.45,
  ratio: 123.45 / 118.45,
  limit: 0.55,
  eligible: false,
  gate: 'pass',
}

function rules(props: Partial<InstanceType<typeof RulesPanel>['$props']> = {}, locale: 'en' | 'zh-CN' | 'ja' = 'en') {
  const config = template()
  return mount(RulesPanel, {
    props: {
      templateId: config.id,
      template: config,
      risk: risk(config),
      statuses: [],
      consistency,
      precision: 2,
      ...props,
    },
    global: {
      components: { Select, Switch, Button },
      plugins: [
        createI18n({
          legacy: false,
          locale,
          messages: {
            en: dictionary(en, patch.en),
            'zh-CN': dictionary(zh, patch['zh-CN']),
            ja: dictionary(ja, patch.ja),
          },
        }),
      ],
    },
  })
}
type Rules = ReturnType<typeof rules>
const control = (view: Rules, id: string) => view.get(`[data-testid="${id}"]`)
const fieldValue = (view: Rules, id: string) => (control(view, `draft-${id}`).element as HTMLInputElement).value
const open = (view: Rules) => control(view, 'rules-edit').trigger('click')
const apply = (view: Rules) => control(view, 'rules-editor').trigger('submit')

function freeze<T extends object>(value: T): T {
  Object.freeze(value)
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child)
  return value
}

describe('terminal rules immutable custom draft', () => {
  it('preserves template selection and reset contracts without changing current state', async () => {
    const config = freeze(template())
    const state = freeze(risk())
    const view = rules({ template: config, risk: state })
    await control(view, 'rules-template').setValue('practice')
    expect(view.emitted('update:templateId')).toEqual([['practice']])
    expect(view.props('template')).toBe(config)
    await control(view, 'rules-reset').trigger('click')
    expect(view.emitted('reset')).toEqual([[]])
    expect(view.emitted('configure')).toBeUndefined()
  })

  it('edits every requested setting in a detached draft and emits a custom copy for parent confirmation only', async () => {
    const config = freeze(template())
    const state = freeze(risk(config))
    const original = JSON.stringify({ config, state })
    const view = rules({ template: config, risk: state })
    await open(view)
    const values = {
      label: 'My generic practice',
      accountSize: '75000',
      profitTarget: '4500',
      drawdownAmount: '3000',
      drawdownMode: 'trailing-intraday',
      drawdownBasis: 'equity',
      floorCap: '75000',
      dailyAmount: '1500',
      dailyAction: 'flatten-lock',
      maxContracts: '12',
      maxTradesPerDay: '6',
      minTradingDays: '4',
      consistencyRatio: '0.4',
      consistencyGate: 'payout',
    }
    for (const [key, value] of Object.entries(values)) await control(view, `draft-${key}`).setValue(value)
    await control(view, 'draft-includeUnrealized').trigger('click')
    expect(JSON.stringify({ config, state })).toBe(original)
    expect(view.emitted('configure')).toBeUndefined()
    await apply(view)
    expect(view.find('[data-testid="rules-error"]').exists()).toBe(false)
    expect(view.emitted('configure')).toHaveLength(1)
    const emitted = view.emitted('configure')![0]![0] as PropTemplate
    expect(emitted).toEqual({
      id: `custom-${config.id}`,
      label: 'My generic practice',
      accountSize: 75000,
      profitTarget: 4500,
      drawdown: { mode: 'trailing-intraday', basis: 'equity', floorCap: 75000, amount: 3000, includeUnrealized: false },
      dailyLoss: { amount: 1500, action: 'flatten-lock' },
      maxContracts: 12,
      maxTradesPerDay: 6,
      minTradingDays: 4,
      consistency: { maxBestDayRatio: 0.4, gate: 'payout' },
      source: patch.en['terminal.rules.customSource'],
    })
    expect(emitted.drawdown).not.toBe(config.drawdown)
    expect(emitted.dailyLoss).not.toBe(config.dailyLoss)
    expect(emitted.consistency).not.toBe(config.consistency)
    expect(JSON.stringify({ config, state })).toBe(original)
    expect(view.emitted('reset')).toBeUndefined()
    expect(view.emitted('update:templateId')).toBeUndefined()
    await control(view, 'draft-drawdownAmount').setValue('3100')
    expect(emitted.drawdown.amount).toBe(3000)
    expect(view.text()).toContain(patch.en['terminal.rules.draftHint'])
  })

  it('supports disabled rules, uncapped drawdown and consistency off without reviving stale configuration', async () => {
    const view = rules()
    await open(view)
    for (const key of ['profitTarget', 'dailyAmount', 'maxTradesPerDay', 'minTradingDays'])
      await control(view, `draft-${key}`).setValue('0')
    await control(view, 'draft-floorCap').setValue('')
    await control(view, 'draft-drawdownMode').setValue('static')
    await control(view, 'draft-dailyAction').setValue('warn')
    await control(view, 'draft-consistencyRatio').setValue('invalid')
    await control(view, 'draft-consistencyOn').trigger('click')
    await apply(view)
    expect(view.emitted('configure')![0]![0]).toMatchObject({
      profitTarget: 0,
      dailyLoss: { amount: 0, action: 'warn' },
      drawdown: { mode: 'static', floorCap: null },
      maxTradesPerDay: 0,
      minTradingDays: 0,
      consistency: null,
    })
  })

  it('discards draft edits, refreshes after a parent-confirmed template change, and recognizes a custom option', async () => {
    const view = rules()
    await open(view)
    await control(view, 'draft-accountSize').setValue('123')
    await control(view, 'rules-discard').trigger('click')
    expect(fieldValue(view, 'accountSize')).toBe('50000')
    const custom = { ...template(), id: 'custom-other', label: 'Other draft', accountSize: 100_000 }
    await view.setProps({ template: custom, templateId: custom.id })
    expect(fieldValue(view, 'accountSize')).toBe('100000')
    expect(fieldValue(view, 'label')).toBe('Other draft')
    expect(control(view, 'rules-template').text()).toContain('Other draft')
    expect(view.emitted('configure')).toBeUndefined()
  })

  it('does not discard a draft when live risk updates arrive', async () => {
    const view = rules()
    await open(view)
    await control(view, 'draft-profitTarget').setValue('3210')
    await view.setProps({ risk: { ...risk(), lastBalance: 51_000 } })
    expect(fieldValue(view, 'profitTarget')).toBe('3210')
    expect(control(view, 'rule-target').text()).toContain('+$1,000')
  })

  it.each([
    ['label', ''],
    ['label', ' '],
    ['label', 'a'.repeat(101)],
    ['accountSize', ''],
    ['accountSize', '0'],
    ['accountSize', '-1'],
    ['accountSize', 'Infinity'],
    ['accountSize', '1e309'],
    ['drawdownAmount', '0'],
    ['drawdownAmount', '-1'],
    ['drawdownAmount', 'NaN'],
    ['drawdownAmount', '100x'],
    ['profitTarget', '-1'],
    ['profitTarget', 'NaN'],
    ['profitTarget', ''],
    ['dailyAmount', '-1'],
    ['dailyAmount', 'Infinity'],
    ['dailyAmount', ''],
    ['floorCap', '47999'],
    ['floorCap', 'NaN'],
    ['floorCap', 'Infinity'],
    ['maxContracts', '0'],
    ['maxContracts', '1.5'],
    ['maxContracts', ''],
    ['maxContracts', '9007199254740992'],
    ['maxTradesPerDay', '-1'],
    ['maxTradesPerDay', '1.5'],
    ['maxTradesPerDay', ''],
    ['minTradingDays', '-1'],
    ['minTradingDays', '0.5'],
    ['minTradingDays', 'NaN'],
    ['consistencyRatio', '0'],
    ['consistencyRatio', '-1'],
    ['consistencyRatio', '1.01'],
    ['consistencyRatio', 'Infinity'],
    ['consistencyRatio', ''],
  ])('rejects malformed %s = %s without emitting or mutating the current attempt', async (key, value) => {
    const config = freeze(template())
    const state = freeze(risk(config))
    const original = JSON.stringify({ config, state })
    const view = rules({ template: config, risk: state })
    await open(view)
    await control(view, `draft-${key}`).setValue(value)
    await apply(view)
    expect(view.emitted('configure')).toBeUndefined()
    expect(control(view, 'rules-error').text()).not.toBe('')
    expect(JSON.stringify({ config, state })).toBe(original)
  })

  it.each(['drawdownMode', 'drawdownBasis', 'dailyAction', 'consistencyGate'])(
    'rejects unsupported enum values emitted by %s control',
    async (key) => {
      const view = rules()
      await open(view)
      const select = view.findAllComponents(Select).find((node) => node.attributes('data-testid') === `draft-${key}`)!
      select.vm.$emit('update:modelValue', 'unsupported')
      await apply(view)
      expect(view.emitted('configure')).toBeUndefined()
      expect(control(view, 'rules-error').text()).toBe(patch.en['terminal.rules.errors.option'])
    },
  )
})

describe('terminal rules risk and session evidence', () => {
  it('clearly labels generic rules, finalized/provisional sessions and completed trading days', () => {
    const view = rules()
    expect(control(view, 'rules-generic').text()).toBe(patch.en['terminal.rules.genericDisclaimer'])
    expect(control(view, 'rule-days').text()).toContain('2 / 5')
    const ledger = view.findAll('[data-testid="rules-ledger-day"]')
    expect(ledger).toHaveLength(3)
    expect(ledger[0]!.attributes('data-finalized')).toBe('true')
    expect(ledger[0]!.text()).toContain('Finalized')
    expect(ledger[0]!.text()).toContain('+$123.45')
    expect(ledger[2]!.attributes('data-finalized')).toBe('false')
    expect(ledger[2]!.text()).toContain('Provisional')
    expect(ledger[2]!.text()).toContain('2 completed trades · 4 fills')
    expect(ledger[2]!.text()).toContain('-$200.00')
  })

  it.each([0, -1])('shows consistency ratio as undefined for total %s, not a hard failure', (totalNetProfit) => {
    const view = rules({ consistency: { ...consistency, totalNetProfit, ratio: 0.25, eligible: true } })
    const row = control(view, 'rule-consistency')
    expect(row.text()).not.toContain('25%')
    expect(row.text()).toContain('—')
    expect(row.get('dd').attributes('aria-label')).toBe('Gated')
    expect(control(view, 'rules-ratio-undefined').text()).toBe(patch.en['terminal.rules.ratioUndefined'])
    expect(control(view, 'rules-consistency-note').text()).toContain('not a hard account failure')
    expect(view.find('[data-testid="rules-breach"]').exists()).toBe(false)
  })

  it('displays eligibility gating separately from breach with a positive denominator', () => {
    const view = rules()
    expect(control(view, 'rule-consistency').text()).toContain('104%')
    expect(control(view, 'rule-consistency').get('dd').attributes('aria-label')).toBe('Gated')
    expect(view.find('[data-testid="rules-ratio-undefined"]').exists()).toBe(false)
    expect(control(view, 'rules-consistency-note').text()).toContain('Evaluation pass')
    expect(view.find('[data-testid="rules-breach"]').exists()).toBe(false)
  })

  it('renders all recorded breach evidence without recomputing it from the current account', () => {
    const state = risk()
    state.status = 'breached'
    state.breach = {
      rule: 'drawdown',
      bar: 42,
      time: Date.UTC(2026, 0, 4, 13, 14, 15) / 1000,
      equity: 48_999.5,
      floor: 49_000,
      message: 'Recorded adverse touch',
    }
    const view = rules({ risk: state })
    const evidence = control(view, 'rules-breach').text()
    for (const text of [
      'Recorded adverse touch',
      'Drawdown',
      'Bar 42',
      '2026-01-04 13:14:15 UTC',
      '$48,999.50',
      '$49,000.00',
    ])
      expect(evidence).toContain(text)
    expect(evidence).not.toContain('$50,200')
  })

  it('handles no ledger and no consistency rule without invented evidence', () => {
    const config = template()
    config.consistency = null
    const view = rules({ risk: null, template: config, consistency: null })
    expect(view.find('[data-testid="rules-ledger-day"]').exists()).toBe(false)
    expect(view.find('[data-testid="rules-consistency-note"]').exists()).toBe(false)
    expect(control(view, 'rule-consistency').text()).toContain('No limit')
  })

  it.each(['en', 'zh-CN', 'ja'] as const)(
    'uses the %s patch for rule editing and evidence, never raw keys',
    async (locale) => {
      const state = risk()
      state.breach = { rule: 'drawdown', bar: 1, time: 0, equity: 48_000, floor: 48_000, message: 'test' }
      const view = rules({ risk: state }, locale)
      await open(view)
      expect(view.text()).toContain(patch[locale]['terminal.rules.draftHint'])
      expect(view.text()).toContain(patch[locale]['terminal.rules.genericDisclaimer'])
      expect(view.text()).not.toContain('terminal.')
    },
  )
})
