// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TimeframePicker from '@/components/terminal/TimeframePicker.vue'
import Watchlist, { type WatchlistRow } from '@/components/terminal/Watchlist.vue'
import type { SimTimeframe } from '@/domain/sim/types'

enableAutoUnmount(afterEach)

const messages = {
  en: {
    terminal: {
      timeframe: {
        label: 'Timeframe',
        unavailable: 'Not available for this tape',
        custom: {
          label: 'Custom timeframe in minutes',
          apply: 'Apply custom timeframe',
          selected: 'Custom timeframe {label} selected',
          baseHint: 'Multiples of 5 minutes, up to 1440. Bars finer than 5m are not available.',
          errors: {
            invalid: 'Enter a whole number of minutes.',
            finer: 'The tape is 5-minute bars, so finer timeframes are not available.',
            step: 'Use a multiple of 5 minutes.',
            tooLarge: 'Keep the timeframe within one trading day (1440 minutes).',
          },
        },
      },
      watchlist: {
        title: 'Watchlist',
        hint: 'Select a symbol to load its tape',
        volume: 'Vol',
        volumeTitle: 'Volume of the last revealed base bar',
      },
    },
  },
  'zh-CN': {
    terminal: {
      timeframe: {
        label: '周期',
        unavailable: '该行情不支持此周期',
        custom: {
          label: '自定义周期（分钟）',
          apply: '应用自定义周期',
          selected: '已选自定义周期 {label}',
          baseHint: '请输入 5 分钟的整数倍，最大 1440 分钟；不支持比 5 分钟更细的周期。',
          errors: {
            invalid: '请输入整数分钟。',
            finer: '行情为 5 分钟 K 线，不支持更细的周期。',
            step: '请输入 5 分钟的整数倍。',
            tooLarge: '周期需在一个交易日内（1440 分钟）。',
          },
        },
      },
      watchlist: {
        title: '自选合约',
        hint: '选择合约以载入行情',
        volume: '量',
        volumeTitle: '最新已揭示基础 K 线的成交量',
      },
    },
  },
  ja: {
    terminal: {
      timeframe: {
        label: '時間足',
        unavailable: 'このデータでは利用できません',
        custom: {
          label: 'カスタム時間足（分）',
          apply: 'カスタム時間足を適用',
          selected: 'カスタム時間足 {label} を選択中',
          baseHint: '5分の倍数、最大1440分。5分より細かい時間足は利用できません。',
          errors: {
            invalid: '整数の分数を入力してください。',
            finer: 'このデータは5分足のため、より細かい時間足は利用できません。',
            step: '5分の倍数で入力してください。',
            tooLarge: '時間足は1取引日以内（1440分）にしてください。',
          },
        },
      },
      watchlist: {
        title: 'ウォッチリスト',
        hint: '銘柄を選ぶと相場を読み込みます',
        volume: '出来高',
        volumeTitle: '表示済みの直近ベース足の出来高',
      },
    },
  },
} as const

function globalOptions(locale: 'en' | 'zh-CN' | 'ja' = 'en') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
  return { plugins: [i18n] }
}

function mountPicker(props: { modelValue: SimTimeframe; disabled?: boolean } = { modelValue: '5m' }) {
  return mount(TimeframePicker, { props, global: globalOptions() })
}

const row = (overrides: Partial<WatchlistRow> = {}): WatchlistRow => ({
  symbol: 'ES',
  name: 'E-mini S&P 500',
  price: 5123.5,
  changePercent: 0.42,
  position: null,
  active: false,
  ...overrides,
})

describe('TimeframePicker presets', () => {
  it('keeps the six supported presets in order and never offers 1m/1s/tick', () => {
    const wrapper = mountPicker()
    const labels = wrapper.findAll('button[data-preset]').map((item) => item.text())
    expect(labels).toEqual(['5M', '15M', '30M', '1H', '4H', '1D'])
    const text = wrapper.text().toLowerCase()
    expect(text).not.toContain('1m')
    expect(text).not.toContain('1s')
    expect(text).not.toContain('tick')
  })

  it('marks the active preset and emits on selection', async () => {
    const wrapper = mountPicker({ modelValue: '15m' })
    expect(wrapper.get('[data-testid="timeframe-15m"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="timeframe-5m"]').attributes('aria-pressed')).toBe('false')

    await wrapper.get('[data-testid="timeframe-1h"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['1h']])
  })

  it('disables presets, custom input and apply when disabled, and emits nothing', async () => {
    const wrapper = mountPicker({ modelValue: '5m', disabled: true })
    for (const button of wrapper.findAll('button')) expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="timeframe-custom-input"]').attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="timeframe-1h"]').trigger('click')
    await wrapper.get('[data-testid="timeframe-custom-input"]').setValue('45')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('TimeframePicker custom minutes', () => {
  it.each(['5', '45', '90', '120'])('accepts %s minutes and emits the domain timeframe', async (minutes) => {
    const wrapper = mountPicker()
    await wrapper.get('[data-testid="timeframe-custom-input"]').setValue(minutes)
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('update:modelValue')).toEqual([[`${minutes}m`]])
    expect(wrapper.find('[data-testid="timeframe-custom-error"]').exists()).toBe(false)
  })

  it('shows the custom selection label instead of inventing a preset', () => {
    const wrapper = mountPicker({ modelValue: '45m' })
    const chip = wrapper.get('[data-testid="timeframe-custom-active"]')
    expect(chip.text()).toBe('45M')
    expect(chip.attributes('aria-label')).toContain('45M')
    expect(wrapper.get('[data-testid="timeframe-custom-input"]').element).toHaveProperty('value', '45')
    for (const preset of ['5m', '15m', '30m', '1h', '4h', '1D']) {
      expect(wrapper.get(`[data-testid="timeframe-${preset}"]`).attributes('aria-pressed')).toBe('false')
    }
  })

  it.each(['', 'abc', '5.5', '-5', '1s', 'tick', '9007199254740992'])(
    'rejects invalid minutes %j with a localized reason and no emit',
    async (value) => {
      const wrapper = mountPicker()
      const input = wrapper.get('[data-testid="timeframe-custom-input"]')
      await input.setValue(value)
      await wrapper.get('form').trigger('submit')

      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      expect(wrapper.get('[data-testid="timeframe-custom-error"]').text()).toBe('Enter a whole number of minutes.')
      expect(input.attributes('aria-invalid')).toBe('true')
      const errorId = wrapper.get('[role="alert"]').attributes('id')
      expect(input.attributes('aria-describedby').split(' ')).toContain(errorId)
    },
  )

  it('rejects finer-than-base frames (1m, 2m) rather than faking them', async () => {
    const wrapper = mountPicker()
    const input = wrapper.get('[data-testid="timeframe-custom-input"]')

    await input.setValue('1')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[data-testid="timeframe-custom-error"]').text()).toBe(
      'The tape is 5-minute bars, so finer timeframes are not available.',
    )

    await input.setValue('2')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[data-testid="timeframe-custom-error"]').text()).toBe(
      'The tape is 5-minute bars, so finer timeframes are not available.',
    )
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('rejects non-multiples of five and out-of-range values', async () => {
    const wrapper = mountPicker()
    const input = wrapper.get('[data-testid="timeframe-custom-input"]')

    await input.setValue('7')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[data-testid="timeframe-custom-error"]').text()).toBe('Use a multiple of 5 minutes.')

    await input.setValue('1500')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[data-testid="timeframe-custom-error"]').text()).toBe(
      'Keep the timeframe within one trading day (1440 minutes).',
    )
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('clears a previous error once the input changes', async () => {
    const wrapper = mountPicker()
    const input = wrapper.get('[data-testid="timeframe-custom-input"]')
    await input.setValue('0')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.find('[data-testid="timeframe-custom-error"]').exists()).toBe(true)

    await input.setValue('45')
    expect(wrapper.find('[data-testid="timeframe-custom-error"]').exists()).toBe(false)
  })

  it('accepts the domain one-day ceiling and rejects one step beyond it', async () => {
    const wrapper = mountPicker()
    const input = wrapper.get('[data-testid="timeframe-custom-input"]')

    await input.setValue('1440')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('update:modelValue')).toEqual([['1440m']])

    await input.setValue('1445')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[data-testid="timeframe-custom-error"]').text()).toBe(
      'Keep the timeframe within one trading day (1440 minutes).',
    )
    expect(wrapper.emitted('update:modelValue')).toEqual([['1440m']])
  })

  it('returns to a preset after a custom frame, clearing the custom chip and draft', async () => {
    const wrapper = mountPicker({ modelValue: '45m' })
    expect(wrapper.find('[data-testid="timeframe-custom-active"]').exists()).toBe(true)

    await wrapper.setProps({ modelValue: '5m' })
    expect(wrapper.find('[data-testid="timeframe-custom-active"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="timeframe-custom-input"]').element).toHaveProperty('value', '')
    expect(wrapper.get('[data-testid="timeframe-5m"]').attributes('aria-pressed')).toBe('true')
  })

  it('describes the minutes field with the localized base hint', () => {
    const wrapper = mountPicker()
    const input = wrapper.get('[data-testid="timeframe-custom-input"]')
    const hintId = input.attributes('aria-describedby')
    expect(hintId).toBeTruthy()
    const hint = wrapper.get(`#${hintId}`)
    expect(hint.text()).toBe('Multiples of 5 minutes, up to 1440. Bars finer than 5m are not available.')
  })

  it('stops keyboard events so desk shortcuts do not fire while typing', async () => {
    const listener = vi.fn()
    document.addEventListener('keydown', listener)
    try {
      const wrapper = mount(TimeframePicker, {
        props: { modelValue: '5m' },
        global: globalOptions(),
        attachTo: document.body,
      })
      const input = wrapper.get('[data-testid="timeframe-custom-input"]')
      await input.trigger('keydown', { key: 'n' })
      await input.trigger('keydown', { key: 'b' })
      await input.trigger('keydown', { key: 's' })
      expect(listener).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', listener)
    }
  })

  it('localizes validation reasons', async () => {
    const wrapper = mount(TimeframePicker, {
      props: { modelValue: '5m' },
      global: globalOptions('zh-CN'),
    })
    await wrapper.get('[data-testid="timeframe-custom-input"]').setValue('1')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[data-testid="timeframe-custom-error"]').text()).toBe('行情为 5 分钟 K 线，不支持更细的周期。')
  })
})

describe('Watchlist', () => {
  it('renders last, change, position and the localized volume label', () => {
    const wrapper = mount(Watchlist, {
      props: {
        rows: [row({ symbol: 'ES', position: 'long', active: true, volume: 1234 })],
      },
      global: globalOptions(),
    })

    const item = wrapper.get('[data-testid="watchlist-row"]')
    expect(item.get('[data-testid="watchlist-price"]').text()).toBe('5,123.50')
    expect(item.get('[data-testid="watchlist-change"]').text()).toBe('+0.42%')
    expect(item.get('[data-testid="watchlist-position"]').text()).toBe('long')
    expect(item.get('[data-testid="watchlist-volume"]').text()).toContain('Vol')
    expect(item.get('[data-testid="watchlist-volume"]').text()).toContain('1,234')
    expect(item.attributes('aria-current')).toBe('true')
  })

  it('formats the price with the per-symbol precision', () => {
    const wrapper = mount(Watchlist, {
      props: {
        rows: [
          row({ symbol: 'ES', price: 5123.456, precision: 2 }),
          row({ symbol: 'BTC', name: 'Bitcoin', price: 51234.5678, precision: 1 }),
          row({ symbol: 'JPY', name: 'Yen', price: 0.0067891, precision: 5 }),
          row({ symbol: 'NQ', name: 'Nasdaq', price: 17900.123 }),
          row({ symbol: 'YM', name: 'Dow', price: 39123.5, precision: 0 }),
        ],
      },
      global: globalOptions(),
    })

    const prices = wrapper.findAll('[data-testid="watchlist-price"]').map((item) => item.text())
    expect(prices).toEqual(['5,123.46', '51,234.6', '0.00679', '17,900.12', '39,124'])
  })

  it('shows a zero volume as zero rather than as missing data', () => {
    const wrapper = mount(Watchlist, {
      props: { rows: [row({ volume: 0 })] },
      global: globalOptions(),
    })
    const volume = wrapper.get('[data-testid="watchlist-volume"]').text()
    expect(volume).toContain('0')
    expect(volume).not.toContain('—')
  })

  it('never invents a volume when the row has none', () => {
    const wrapper = mount(Watchlist, {
      props: { rows: [row({ volume: null }), row({ symbol: 'NQ', name: 'Nasdaq', volume: undefined })] },
      global: globalOptions(),
    })
    const volumes = wrapper.findAll('[data-testid="watchlist-volume"]')
    expect(volumes).toHaveLength(2)
    for (const volume of volumes) {
      expect(volume.text()).toContain('—')
      expect(volume.text()).not.toMatch(/\d/)
    }
  })

  it('keeps the truncation title on the instrument name and emits selection', async () => {
    const wrapper = mount(Watchlist, {
      props: {
        rows: [row({ symbol: 'NQ', name: 'E-mini Nasdaq 100 futures contract', volume: 88 })],
      },
      global: globalOptions(),
    })

    const name = wrapper.get('[data-testid="watchlist-name"]')
    expect(name.attributes('title')).toBe('E-mini Nasdaq 100 futures contract')
    expect(name.classes()).toContain('truncate')

    await wrapper.get('[data-testid="watchlist-row"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['NQ']])
  })

  it('keeps missing prices and changes empty instead of inventing a quote', () => {
    const wrapper = mount(Watchlist, {
      props: {
        rows: [
          row({ price: null, changePercent: null }),
          row({
            symbol: 'NQ',
            name: 'Nasdaq',
            price: Number.NaN,
            changePercent: null,
            volume: Number.POSITIVE_INFINITY,
          }),
        ],
      },
      global: globalOptions(),
    })
    const prices = wrapper.findAll('[data-testid="watchlist-price"]').map((item) => item.text())
    expect(prices).toEqual(['—', '—'])
    expect(wrapper.findAll('[data-testid="watchlist-change"]').map((item) => item.text())).toEqual(['—', '—'])
    expect(wrapper.findAll('[data-testid="watchlist-volume"]').map((item) => item.text())).toEqual(['Vol—', 'Vol—'])
    expect(wrapper.find('[data-testid="watchlist-position"]').exists()).toBe(false)
  })

  it('replaces volume on prop updates rather than accumulating session volume', async () => {
    const wrapper = mount(Watchlist, {
      props: { rows: [row({ volume: 1234 })] },
      global: globalOptions(),
    })
    const volume = wrapper.get('[data-testid="watchlist-volume"]')
    expect(volume.attributes('title')).toBe('Volume of the last revealed base bar')

    await wrapper.setProps({ rows: [row({ volume: 12, changePercent: -0.5, position: 'short' })] })
    expect(volume.findAll('span').map((item) => item.text())).toEqual(['Vol', '12'])
    expect(wrapper.get('[data-testid="watchlist-change"]').text()).toBe('-0.50%')
    expect(wrapper.get('[data-testid="watchlist-position"]').text()).toBe('short')
  })

  it('localizes the volume label', () => {
    const wrapper = mount(Watchlist, {
      props: { rows: [row({ volume: 12 })] },
      global: globalOptions('ja'),
    })
    expect(wrapper.get('[data-testid="watchlist-volume"]').text()).toContain('出来高')
  })
})
