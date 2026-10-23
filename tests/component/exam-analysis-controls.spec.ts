// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExamAnalysisControls from '@/components/analysis/ExamAnalysisControls.vue'
import { defaultAnalysisFrameworks, defaultAnalysisLayers } from '@/lib/chart/analysis'
import type { AnalysisReport } from '@/domain/analysis/types'
import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh-CN.json'
import ja from '../../i18n/locales/ja.json'

const locale = { value: 'en' }
const messages: Record<string, unknown> = { en, 'zh-CN': zh, ja }
function t(key: string, params: Record<string, string | number> = {}) {
  let value: unknown = messages[locale.value]
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing translation: ${locale.value}:${key}`)
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? name))
}

const report = {
  trend: { structure: 'hh_hl' },
  ict: { zone: 'discount' },
  flow: { pressure: 0.42 },
  indicators: { latest: { rsi: 55.25, adx: 21.4 } },
} as unknown as AnalysisReport

let wrapper: ReturnType<typeof mount> | undefined

beforeEach(() => {
  locale.value = 'en'
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
  vi.stubGlobal('useI18n', () => ({ t, locale }))
})

afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
})

function render(overrides: Record<string, unknown> = {}) {
  wrapper = mount(ExamAnalysisControls, {
    attachTo: document.body,
    props: {
      enabled: true,
      frameworks: { ...defaultAnalysisFrameworks },
      layers: { ...defaultAnalysisLayers },
      report,
      status: 'ready',
      count: 180,
      ...overrides,
    },
  })
  return wrapper
}

async function openSettings(view: ReturnType<typeof render>) {
  await view.get('[data-testid="analysis-settings-toggle"]').trigger('click')
  return view
}

describe('exam analysis controls', () => {
  it('keeps the toolbar compact until settings are opened', async () => {
    const view = render({ enabled: false, status: 'off' })
    expect(view.find('[data-testid="analysis-settings"]').exists()).toBe(false)
    expect(view.find('[data-testid="analysis-framework-pa"]').exists()).toBe(false)

    await openSettings(view)
    expect(view.find('[data-testid="analysis-settings"]').exists()).toBe(true)
    expect(view.find('[data-testid="analysis-framework-pa"]').exists()).toBe(false)
    expect(view.text()).toContain('Off')
  })

  it('enables analysis from the toolbar without opening settings', async () => {
    const view = render({ enabled: false, status: 'off' })
    const toggle = view.get('[data-testid="analysis-toggle"]')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    await toggle.trigger('click')
    expect(view.emitted('update:enabled')).toEqual([[true]])
    expect(view.emitted('update:frameworks')).toBeUndefined()
    expect(view.find('[data-testid="analysis-settings"]').exists()).toBe(false)
  })

  it('emits an enabled toggle from the settings switch', async () => {
    const view = render({ enabled: false, status: 'off' })
    await openSettings(view)
    await view.get('button[role="switch"]').trigger('click')
    expect(view.emitted('update:enabled')).toEqual([[true]])
    expect(view.emitted('update:frameworks')).toBeUndefined()
  })

  it('toggles frameworks without mutating the incoming object', async () => {
    const view = render()
    await openSettings(view)
    const before = { ...defaultAnalysisFrameworks }
    await view.get('[data-testid="analysis-framework-ict"]').trigger('click')
    expect(view.emitted('update:frameworks')).toEqual([[{ ...before, ict: false }]])
    expect(defaultAnalysisFrameworks).toEqual(before)
  })

  it('shows the live summaries for each framework', async () => {
    const view = render()
    await openSettings(view)
    expect(view.get('[data-testid="analysis-framework-pa"]').text()).toContain('HH / HL')
    expect(view.get('[data-testid="analysis-framework-ict"]').text()).toContain('Discount')
    expect(view.get('[data-testid="analysis-framework-flow"]').text()).toContain('42%')
    expect(view.get('[data-testid="analysis-framework-indicators"]').text()).toContain('RSI 55.3')
  })

  it('only offers layers that belong to an enabled framework', async () => {
    const view = render({
      frameworks: { pa: false, ict: false, flow: true, indicators: false },
    })
    await openSettings(view)
    expect(view.find('[data-testid="analysis-layer-fvg"]').exists()).toBe(false)
    expect(view.find('[data-testid="analysis-layer-ema"]').exists()).toBe(false)
    expect(view.find('[data-testid="analysis-layer-profile"]').exists()).toBe(true)
    await view.get('[data-testid="analysis-layer-profile"]').trigger('click')
    expect(view.emitted('update:layers')).toEqual([[{ ...defaultAnalysisLayers, profile: false }]])
  })

  it('explains insufficient and unavailable states in the toolbar and panel', async () => {
    const few = render({ status: 'insufficient', count: 12 })
    expect(few.get('[data-status]').text()).toContain('Need 30+ bars')
    expect(few.get('[data-status]').attributes('title')).toContain('At least 30 visible candles')
    await openSettings(few)
    expect(few.find('[data-testid="analysis-framework-pa"]').exists()).toBe(true)
    wrapper?.unmount()

    const down = render({ status: 'unavailable', report: null })
    expect(down.get('[data-status]').text()).toContain('Unavailable')
    await openSettings(down)
    expect(down.get('[data-testid="analysis-settings"] [role="status"]').attributes('title')).toContain(
      'Analysis is unavailable',
    )
    expect(down.findAll('button').some((button) => button.text().includes('Retry'))).toBe(true)
  })

  it('emits retry from the unavailable state', async () => {
    const view = render({ status: 'unavailable', report: null })
    await openSettings(view)
    const retry = view.findAll('button').find((button) => button.text().includes('Retry'))
    await retry!.trigger('click')
    expect(view.emitted('retry')).toHaveLength(1)
  })

  it('moves focus into the settings region and restores it on Escape', async () => {
    const view = render()
    await openSettings(view)
    await view.vm.$nextTick()
    const trigger = view.get('[data-testid="analysis-settings-toggle"]')
    const panel = view.get('[data-testid="analysis-settings"]')
    expect(trigger.attributes('aria-controls')).toBe(panel.attributes('id'))
    expect(panel.attributes('role')).toBe('region')
    expect(panel.element.contains(document.activeElement)).toBe(true)
    await view.get('button[role="switch"]').trigger('keydown', { key: 'Escape' })
    expect(view.find('[data-testid="analysis-settings"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
  })

  it('does not bubble exam shortcuts from the toolbar or panel', async () => {
    const onKeydown = vi.fn()
    window.addEventListener('keydown', onKeydown)
    try {
      const view = render()
      await view.get('[data-testid="analysis-toggle"]').trigger('keydown', { key: ' ', code: 'Space' })
      await openSettings(view)
      const framework = view.get('[data-testid="analysis-framework-pa"]')
      for (const key of ['1', '2', '3', '4', 'l', 's', 'n', 'Enter', 'Escape']) {
        await framework.trigger('keydown', { key })
      }
      expect(onKeydown).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onKeydown)
    }
  })

  it('closes on focus leaving the region and preserves the new focus target', async () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    try {
      const view = render()
      await openSettings(view)
      await view.vm.$nextTick()
      outside.focus()
      await view.vm.$nextTick()
      expect(view.find('[data-testid="analysis-settings"]').exists()).toBe(false)
      expect(document.activeElement).toBe(outside)
    } finally {
      outside.remove()
    }
  })

  it('localizes titles, groups and the visible-bar caveat', async () => {
    locale.value = 'zh-CN'
    const view = render()
    expect(view.get('[data-testid="analysis-toggle"]').attributes('aria-label')).toBe('开启技术分析')
    await openSettings(view)
    expect(view.get('[data-testid="analysis-settings"]').attributes('aria-label')).toBe('技术分析')
    expect(view.text()).toContain('仅基于当前可见 K 线')
    expect(view.text()).toContain('价格行为')
  })
})
