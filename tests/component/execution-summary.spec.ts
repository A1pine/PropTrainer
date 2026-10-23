// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExecutionSummary from '@/components/trading/ExecutionSummary.vue'
import { formatPrice } from '@/utils/format'
import type { TradeExecution } from '@/domain/trading/executions'
import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh-CN.json'
import ja from '../../i18n/locales/ja.json'

const locale = ref('en')
const messages: Record<string, unknown> = { en, 'zh-CN': zh, ja }
function t(key: string, params: Record<string, number> = {}) {
  let value: unknown = messages[locale.value]
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing translation: ${locale.value}:${key}`)
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? name))
}

const execution: TradeExecution = {
  id: 'first',
  side: 'short',
  entryBar: 0,
  entryPrice: 0,
  entryTime: 0,
  exitBar: 2,
  exitPrice: -1.25,
  exitTime: 86_400,
  exitReason: 'timeout',
}
let wrapper: ReturnType<typeof mount> | undefined

beforeEach(() => {
  locale.value = 'en'
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useI18n', () => ({ t, locale }))
  vi.stubGlobal('formatPrice', formatPrice)
})

afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
})

function render(executions: TradeExecution[] = [execution]) {
  wrapper = mount(ExecutionSummary, {
    props: { executions, precision: 2 },
    global: { mocks: { formatPrice } },
  })
  return wrapper
}

describe('execution summary', () => {
  it('shows exact fill prices, one-based candle positions, and explicit UTC candle times', () => {
    const view = render()
    expect(view.get('[data-testid="execution-entry-price"]').text()).toBe('0.00')
    expect(view.get('[data-testid="execution-exit-price"]').text()).toBe('-1.25')
    expect(view.text()).toContain('Bar 1')
    expect(view.text()).toContain('Bar 3')
    expect(view.findAll('time').map((time) => time.attributes('datetime'))).toEqual([
      '1970-01-01T00:00:00.000Z',
      '1970-01-02T00:00:00.000Z',
    ])
    expect(view.findAll('time')[0]!.text()).toMatch(/00:00/)
    expect(view.text()).toContain('UTC')
    expect(view.text()).toContain('Replay window ended')
    expect(view.text()).toContain('not the exact intrabar fill time')
  })

  it('shows all trades and emits the selected trade for chart focus', async () => {
    const second: TradeExecution = { ...execution, id: 'second', side: 'long', exitReason: 'target' }
    const view = render([execution, second])
    expect(view.findAll('[data-testid="execution-row"]')).toHaveLength(2)
    expect(view.text()).toContain('Trade 2')
    await view.get('button[aria-label="Locate trade 2 on chart"]').trigger('click')
    expect(view.emitted('focus')).toEqual([[second]])
  })

  it('clears prior fills and focus controls when the next result has no fills', async () => {
    const view = render()
    await view.setProps({ executions: [] })
    expect(view.findAll('[data-testid="execution-row"]')).toHaveLength(0)
    expect(view.findAll('time')).toHaveLength(0)
    expect(view.find('button').exists()).toBe(false)
    expect(view.text()).toContain('No completed trade')
  })

  it.each([
    ['en', 'Entry & exit fills', 'Entry fill'],
    ['zh-CN', '进出场位置', '进场成交'],
    ['ja', 'エントリーと決済の位置', 'エントリー約定'],
  ])('localizes the %s result labels and timezone note', (language, title, entry) => {
    locale.value = language!
    const view = render()
    expect(view.get('section').attributes('aria-label')).toBe(title)
    expect(view.text()).toContain(entry)
    expect(view.text()).toContain('UTC')
  })
})
