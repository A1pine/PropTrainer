// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { computed, defineComponent, nextTick, onMounted, ref, watch } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OrderTicket from '@/components/terminal/OrderTicket.vue'
import { formatPrice } from '@/utils/format'
import { ATM_PRESETS_KEY, readAtmPresets, validAtmPreset, writeAtmPresets } from '@/lib/sim/atm-presets'
import type { SimOrderInput } from '@/domain/sim/types'
import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh-CN.json'
import ja from '../../i18n/locales/ja.json'
import patch from '../../profile_output/terminal-ticket-translations.json'

enableAutoUnmount(afterEach)
const replayTime = Date.UTC(2024, 5, 3, 13, 27, 18) / 1000
const Select = defineComponent({
  props: ['modelValue', 'options', 'placeholder'],
  emits: ['update:modelValue'],
  template:
    '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-if="placeholder" value="" disabled>{{ placeholder }}</option><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>',
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
  localStorage.clear()
  for (const [key, value] of Object.entries({ ref, watch, computed, onMounted, formatPrice })) vi.stubGlobal(key, value)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function ticket(props: Partial<InstanceType<typeof OrderTicket>['$props']> = {}, locale: 'en' | 'zh-CN' | 'ja' = 'en') {
  return mount(OrderTicket, {
    props: { mark: 100, precision: 2, tickSize: 0.25, maxQty: 20, symbol: 'MNQ', replayTime, ...props },
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
type Ticket = ReturnType<typeof ticket>
const control = (view: Ticket, id: string) => view.get(`[data-testid="${id}"]`)
const value = (view: Ticket, id: string) => (control(view, id).element as HTMLInputElement).value
const submit = (view: Ticket) => control(view, 'order-ticket').trigger('submit')
const lastInput = (view: Ticket) => view.emitted('submit')?.at(-1)?.[0] as SimOrderInput | undefined

async function bracket(view: Ticket, quantity = '2') {
  await control(view, 'ticket-qty').setValue(quantity)
  await control(view, 'ticket-bracket').trigger('click')
}

describe('terminal ticket entry validation', () => {
  it.each(['', '0', '-1', '1.5', 'NaN', 'Infinity', '1e309', '2oops', '0x10', '9007199254740992', '21'])(
    'does not emit a malformed/excess quantity %s',
    async (quantity) => {
      const view = ticket()
      await control(view, 'ticket-qty').setValue(quantity)
      await submit(view)
      expect(view.emitted('submit')).toBeUndefined()
      expect(control(view, 'ticket-error').text()).not.toBe('')
    },
  )

  it.each(['limit', 'stop', 'stop-limit'] as const)(
    'rejects non-finite and off-tick %s prices without coercion',
    async (type) => {
      const view = ticket()
      await control(view, 'ticket-type').setValue(type)
      const id = type === 'stop' ? 'ticket-stop' : 'ticket-limit'
      for (const invalid of ['', 'NaN', 'Infinity', '1e309', '100.12', 'abc']) {
        await control(view, id).setValue(invalid)
        await submit(view)
        expect(view.emitted('submit')).toBeUndefined()
      }
    },
  )

  it.each([0, -0.25])('accepts finite tick-aligned zero and negative entry prices: %s', async (price) => {
    const view = ticket({ mark: 0 })
    await control(view, 'ticket-type').setValue('limit')
    await control(view, 'ticket-limit').setValue(String(price))
    await submit(view)
    expect(lastInput(view)).toMatchObject({ side: 'long', type: 'limit', limitPrice: price, qty: 1 })
  })

  it.each(['market', 'limit', 'stop', 'stop-limit', 'trailing-stop', 'trailing-stop-limit'] as const)(
    'emits the complete %s contract',
    async (type) => {
      const view = ticket()
      await control(view, 'ticket-type').setValue(type)
      if (type === 'trailing-stop-limit') await control(view, 'ticket-limit-offset').setValue('3')
      await submit(view)
      expect(view.find('[data-testid="ticket-error"]').exists()).toBe(false)
      expect(lastInput(view)).toEqual({
        side: 'long',
        type,
        qty: 1,
        tif: 'day',
        limitPrice: type === 'limit' || type === 'stop-limit' ? 99 : null,
        stopPrice: type === 'stop' || type === 'stop-limit' ? 101 : null,
        trailTicks: type.startsWith('trailing') ? 8 : null,
        limitOffsetTicks: type === 'trailing-stop-limit' ? 3 : null,
        releaseAt: null,
        expiresAt: null,
        reduceOnly: false,
        bracket: null,
      })
    },
  )

  it.each(['0', '-1', '1.5', '', 'NaN', 'Infinity'])('rejects malformed trailing distance %s', async (distance) => {
    const view = ticket()
    await control(view, 'ticket-type').setValue('trailing-stop')
    await control(view, 'ticket-trail').setValue(distance)
    await submit(view)
    expect(view.emitted('submit')).toBeUndefined()
  })

  it.each(['-1', '1.5', '', 'NaN', 'Infinity'])('rejects malformed trailing limit offset %s', async (offset) => {
    const view = ticket()
    await control(view, 'ticket-type').setValue('trailing-stop-limit')
    await control(view, 'ticket-limit-offset').setValue(offset)
    await submit(view)
    expect(view.emitted('submit')).toBeUndefined()
  })

  it.each([
    { mark: null },
    { mark: Number.NaN },
    { tickSize: 0 },
    { tickSize: Number.NaN },
    { replayTime: null },
    { replayTime: replayTime + 0.5 },
    { disabled: true },
  ])('does not submit without a valid current market/replay contract: %j', async (props) => {
    const view = ticket(props)
    await submit(view)
    expect(view.emitted('submit')).toBeUndefined()
  })
})

describe('terminal ticket price lifecycle and native keyboard controls', () => {
  it('reinitializes entry and protection for a side change and a different symbol, including zero marks', async () => {
    const view = ticket()
    await bracket(view)
    await control(view, 'ticket-type').setValue('limit')
    await control(view, 'ticket-limit').setValue('88')
    await control(view, 'ticket-stop-loss').setValue('80')
    await control(view, 'target-price').setValue('200')
    await control(view, 'ticket-short').trigger('click')
    expect(value(view, 'ticket-limit')).toBe('101')
    expect(value(view, 'ticket-stop-loss')).toBe('103')
    expect(value(view, 'target-price')).toBe('97')
    await view.setProps({ symbol: 'MES', mark: 0, tickSize: 0.5 })
    expect(value(view, 'ticket-limit')).toBe('2')
    expect(value(view, 'ticket-stop-loss')).toBe('6')
    expect(value(view, 'target-price')).toBe('-6')
    await submit(view)
    expect(lastInput(view)?.bracket?.targets).toEqual([{ price: -6, qty: 2 }])
  })

  it('clears unavailable symbol prices, then initializes when its first mark arrives', async () => {
    const view = ticket()
    await bracket(view)
    await control(view, 'ticket-type').setValue('limit')
    await view.setProps({ symbol: 'MES', mark: null })
    expect(value(view, 'ticket-limit')).toBe('')
    expect(value(view, 'ticket-stop-loss')).toBe('')
    expect(value(view, 'target-price')).toBe('')
    await submit(view)
    expect(view.emitted('submit')).toBeUndefined()
    await view.setProps({ mark: 50 })
    expect(value(view, 'ticket-limit')).toBe('49')
    expect(value(view, 'ticket-stop-loss')).toBe('47')
    expect(value(view, 'target-price')).toBe('53')
  })

  it('uses chart/ladder hints only for entry, including stop-limit routing and zero prices', async () => {
    const view = ticket()
    await bracket(view)
    await control(view, 'ticket-stop-loss').setValue('95')
    await control(view, 'target-price').setValue('110')
    await view.setProps({ priceHint: 99 })
    expect(value(view, 'ticket-type')).toBe('limit')
    expect(value(view, 'ticket-limit')).toBe('99')
    expect(value(view, 'ticket-stop-loss')).toBe('95')
    expect(value(view, 'target-price')).toBe('110')
    await control(view, 'ticket-type').setValue('stop-limit')
    await view.setProps({ priceHint: 102, priceHintType: 'stop', priceHintSide: 'long' })
    expect(value(view, 'ticket-type')).toBe('stop-limit')
    expect(value(view, 'ticket-stop')).toBe('102')
    expect(value(view, 'ticket-limit')).toBe('99')
    await view.setProps({ priceHint: 0, priceHintType: 'limit' })
    expect(value(view, 'ticket-limit')).toBe('0')
    expect(value(view, 'ticket-stop-loss')).toBe('95')
    await view.setProps({ priceHint: Number.NaN })
    expect(value(view, 'ticket-limit')).toBe('0')
  })

  it('accepts initial side/type hints and initializes the correct side protection', async () => {
    const view = ticket({ priceHint: 102, priceHintType: 'stop', priceHintSide: 'short' })
    expect(control(view, 'ticket-short').attributes('aria-pressed')).toBe('true')
    expect(value(view, 'ticket-type')).toBe('stop')
    expect(value(view, 'ticket-stop')).toBe('102')
    await bracket(view)
    expect(value(view, 'ticket-stop-loss')).toBe('104')
    expect(value(view, 'target-price')).toBe('98')
  })

  it('resets explicitly and on replay rewind without retaining schedule, brackets or wrong prices', async () => {
    const view = ticket()
    await bracket(view)
    await control(view, 'ticket-short').trigger('click')
    await control(view, 'ticket-release').setValue('2024-06-03T13:40:00')
    await control(view, 'ticket-reset').trigger('click')
    expect(value(view, 'ticket-qty')).toBe('1')
    expect(value(view, 'ticket-type')).toBe('market')
    expect(value(view, 'ticket-release')).toBe('')
    expect(view.find('[data-testid="ticket-stop-loss"]').exists()).toBe(false)
    await bracket(view)
    await control(view, 'ticket-short').trigger('click')
    await view.setProps({ replayTime: replayTime - 600, mark: 200 })
    expect(control(view, 'ticket-long').attributes('aria-pressed')).toBe('true')
    expect(view.find('[data-testid="ticket-stop-loss"]').exists()).toBe(false)
    await control(view, 'ticket-type').setValue('limit')
    expect(value(view, 'ticket-limit')).toBe('199')
  })

  it('lets native form submission work and stops editing key events from triggering page hotkeys', async () => {
    const listener = vi.fn()
    window.addEventListener('keydown', listener)
    const view = ticket()
    for (const key of ['b', 's', ' ', 'Enter']) {
      await control(view, 'ticket-qty').trigger('keydown', { key })
    }
    expect(listener).not.toHaveBeenCalled()
    expect(view.emitted('submit')).toBeUndefined()
    expect(control(view, 'ticket-submit').attributes('type')).toBe('submit')
    await submit(view)
    expect(view.emitted('submit')).toHaveLength(1)
    window.removeEventListener('keydown', listener)
  })
})

describe('terminal ticket replay scheduling', () => {
  it('defaults GTD to the next replay hour and converts UTC fields without using wall clock', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2099, 0, 1))
    const view = ticket()
    await control(view, 'ticket-tif').setValue('gtd')
    expect(value(view, 'ticket-expiry')).toBe('2024-06-03T14:00')
    await control(view, 'ticket-release').setValue('2024-06-03T13:30:01')
    await submit(view)
    expect(lastInput(view)).toMatchObject({
      tif: 'gtd',
      expiresAt: Date.UTC(2024, 5, 3, 14) / 1000,
      releaseAt: Date.UTC(2024, 5, 3, 13, 30, 1) / 1000,
    })
  })

  it.each(['', '2024-06-03T13:27:18', '2024-06-03T13:00:00', '2024-02-30T14:00:00', '2024-06-03T14:00:00.500'])(
    'rejects invalid, fractional or nonfuture GTD %s',
    async (expiry) => {
      const view = ticket()
      await control(view, 'ticket-tif').setValue('gtd')
      await control(view, 'ticket-expiry').setValue(expiry)
      await submit(view)
      expect(view.emitted('submit')).toBeUndefined()
    },
  )

  it.each(['2024-06-03T13:27:18', '2024-06-03T13:00:00', '2024-06-03T14:00:00', '2024-06-03T15:00:00'])(
    'rejects release at/before replay or at/after GTD expiry: %s',
    async (release) => {
      const view = ticket()
      await control(view, 'ticket-tif').setValue('gtd')
      await control(view, 'ticket-release').setValue(release)
      await submit(view)
      expect(view.emitted('submit')).toBeUndefined()
    },
  )

  it('does not automatically move an expired user deadline when the replay advances', async () => {
    const view = ticket()
    await control(view, 'ticket-tif').setValue('gtd')
    await view.setProps({ replayTime: Date.UTC(2024, 5, 3, 14) / 1000 })
    await submit(view)
    expect(view.emitted('submit')).toBeUndefined()
    expect(value(view, 'ticket-expiry')).toBe('2024-06-03T14:00')
    await control(view, 'ticket-tif').setValue('gtc')
    await submit(view)
    expect(lastInput(view)?.expiresAt).toBeNull()
  })
})

describe('terminal ticket brackets and ATM', () => {
  it('emits zero and negative target prices without dropping them, preserving runner remainder', async () => {
    const view = ticket({ mark: -2 })
    await bracket(view, '3')
    await control(view, 'target-price').setValue('-1')
    await control(view, 'target-qty').setValue('1')
    await control(view, 'add-target').trigger('click')
    await view.findAll('[data-testid="target-price"]')[1]!.setValue('0')
    await view.findAll('[data-testid="target-qty"]')[1]!.setValue('1')
    await submit(view)
    expect(lastInput(view)?.bracket).toMatchObject({
      stopLoss: -4,
      targets: [
        { price: -1, qty: 1 },
        { price: 0, qty: 1 },
      ],
    })
    expect(control(view, 'ticket-runner').text()).toContain('1 contracts')
  })

  it.each(['', 'NaN', 'Infinity', '0.12'])(
    'rejects the whole bracket instead of silently dropping bad target price %s',
    async (price) => {
      const view = ticket()
      await bracket(view)
      await control(view, 'target-price').setValue(price)
      await submit(view)
      expect(view.emitted('submit')).toBeUndefined()
      expect(view.findAll('[data-testid="ticket-target"]')).toHaveLength(1)
    },
  )

  it.each(['', '0', '-1', '0.5', 'NaN', 'Infinity', '3'])(
    'rejects invalid or excess target quantity %s without clamping it',
    async (quantity) => {
      const view = ticket()
      await bracket(view)
      await control(view, 'target-qty').setValue(quantity)
      await submit(view)
      expect(view.emitted('submit')).toBeUndefined()
      expect(value(view, 'target-qty')).toBe(quantity)
    },
  )

  it('limits target count to five, checks aggregate quantities and never silently resizes targets', async () => {
    const view = ticket()
    await bracket(view, '10')
    await control(view, 'target-qty').setValue('1')
    for (let index = 1; index < 5; index++) {
      await control(view, 'add-target').trigger('click')
      await view.findAll('[data-testid="target-qty"]')[index]!.setValue('1')
    }
    expect(view.findAll('[data-testid="ticket-target"]')).toHaveLength(5)
    expect(control(view, 'add-target').attributes('disabled')).toBeDefined()
    await submit(view)
    expect(lastInput(view)?.bracket?.targets).toHaveLength(5)
    await control(view, 'ticket-qty').setValue('4')
    await submit(view)
    expect(view.emitted('submit')).toHaveLength(1)
    expect(view.findAll('[data-testid="target-qty"]').map((node) => (node.element as HTMLInputElement).value)).toEqual([
      '1',
      '1',
      '1',
      '1',
      '1',
    ])
    await control(view, 'remove-target').trigger('click')
    await submit(view)
    expect(view.emitted('submit')).toHaveLength(2)
  })

  it('supports a stop-only runner and rejects wrong-side protection', async () => {
    const view = ticket()
    await bracket(view)
    await control(view, 'remove-target').trigger('click')
    await control(view, 'ticket-stop-loss').setValue('100')
    await submit(view)
    expect(view.emitted('submit')).toBeUndefined()
    await control(view, 'ticket-stop-loss').setValue('98')
    await submit(view)
    expect(lastInput(view)?.bracket).toEqual({ stopLoss: 98, targets: [], atm: null })
    await control(view, 'ticket-stop-loss').setValue('')
    await submit(view)
    expect(view.emitted('submit')).toHaveLength(1)
  })

  it('requires bracket plus stop before ATM can be enabled, and never ignores invalid enabled ATM', async () => {
    const view = ticket()
    await control(view, 'ticket-atm').trigger('click')
    expect(control(view, 'ticket-break-even').attributes('disabled')).toBeDefined()
    await bracket(view)
    await control(view, 'ticket-break-even').trigger('click')
    await control(view, 'ticket-trailing').trigger('click')
    await submit(view)
    expect(lastInput(view)?.bracket?.atm).toEqual({
      breakEven: { triggerTicks: 10, offsetTicks: 1 },
      trailing: { triggerTicks: 10, distanceTicks: 8, stepTicks: 2 },
    })
    for (const id of ['be-trigger', 'be-offset', 'atm-trigger', 'atm-distance', 'atm-step']) {
      const old = value(view, id)
      await control(view, id).setValue('0.5')
      await submit(view)
      expect(view.emitted('submit')).toHaveLength(1)
      await control(view, id).setValue(old)
    }
    await control(view, 'ticket-stop-loss').setValue('')
    await submit(view)
    expect(view.emitted('submit')).toHaveLength(1)
    expect(control(view, 'ticket-break-even').attributes('aria-checked')).toBe('true')
    await control(view, 'ticket-bracket').trigger('click')
    expect(control(view, 'ticket-break-even').attributes('aria-checked')).toBe('false')
    expect(control(view, 'ticket-trailing').attributes('aria-checked')).toBe('false')
    await submit(view)
    expect(lastInput(view)?.bracket).toBeNull()
  })

  it('emits an explicit reduce-only switch with no attached bracket or hidden enabled ATM', async () => {
    const view = ticket()
    await bracket(view)
    await control(view, 'ticket-atm').trigger('click')
    await control(view, 'ticket-break-even').trigger('click')
    await control(view, 'ticket-reduce').trigger('click')
    expect(control(view, 'ticket-bracket').attributes('disabled')).toBeDefined()
    expect(control(view, 'ticket-break-even').attributes('aria-checked')).toBe('false')
    await control(view, 'ticket-short').trigger('click')
    await submit(view)
    expect(lastInput(view)).toMatchObject({ side: 'short', reduceOnly: true, bracket: null })
  })
})

describe('terminal ticket symbol-specific presets', () => {
  it('persists ticks and quantities, reconstructs at a new entry/side, isolates symbols and deletes', async () => {
    const view = ticket()
    await bracket(view, '3')
    await control(view, 'target-qty').setValue('2')
    await control(view, 'ticket-atm').trigger('click')
    await control(view, 'ticket-break-even').trigger('click')
    await control(view, 'preset-name').setValue('Runner')
    await control(view, 'preset-save').trigger('click')
    expect(view.find('[data-testid="preset-error"]').exists()).toBe(false)
    expect(readAtmPresets()).toEqual([
      {
        name: 'Runner',
        symbol: 'MNQ',
        qty: 3,
        stopTicks: 8,
        targets: [{ ticks: 16, qty: 2 }],
        atm: { breakEven: { triggerTicks: 10, offsetTicks: 1 }, trailing: null },
      },
    ])
    expect(localStorage.getItem(ATM_PRESETS_KEY)).not.toContain('stopLoss')
    expect(localStorage.getItem(ATM_PRESETS_KEY)).not.toContain('price')
    const restored = ticket({ mark: 200 })
    await nextTick()
    await control(restored, 'ticket-short').trigger('click')
    await control(restored, 'preset-select').setValue('Runner')
    await control(restored, 'preset-load').trigger('click')
    expect(value(restored, 'ticket-stop-loss')).toBe('202')
    expect(value(restored, 'target-price')).toBe('196')
    expect(value(restored, 'ticket-qty')).toBe('3')
    await submit(restored)
    expect(lastInput(restored)?.bracket?.atm?.breakEven).toEqual({ triggerTicks: 10, offsetTicks: 1 })
    await restored.setProps({ symbol: 'MES', tickSize: 0.5, mark: 50 })
    expect(control(restored, 'preset-select').findAll('option')).toHaveLength(1)
    expect(value(restored, 'preset-select')).toBe('')
    await restored.setProps({ symbol: 'MNQ', tickSize: 0.5 })
    await control(restored, 'preset-select').setValue('Runner')
    await control(restored, 'preset-load').trigger('click')
    expect(value(restored, 'ticket-stop-loss')).toBe('54')
    expect(value(restored, 'target-price')).toBe('42')
    await control(restored, 'preset-delete').trigger('click')
    expect(readAtmPresets()).toEqual([])
  })

  it('replaces a named preset and refuses an invalid bracket or name instead of saving it', async () => {
    const view = ticket()
    await control(view, 'preset-name').setValue('One')
    await control(view, 'preset-save').trigger('click')
    expect(readAtmPresets()).toEqual([])
    await bracket(view)
    await control(view, 'preset-save').trigger('click')
    await control(view, 'ticket-stop-loss').setValue('97')
    await control(view, 'preset-save').trigger('click')
    expect(readAtmPresets()).toHaveLength(1)
    expect(readAtmPresets()[0]?.stopTicks).toBe(12)
    await control(view, 'preset-name').setValue(' ')
    await control(view, 'preset-save').trigger('click')
    expect(readAtmPresets()).toHaveLength(1)
    await control(view, 'preset-name').setValue('Two')
    await control(view, 'target-price').setValue('Infinity')
    await control(view, 'preset-save').trigger('click')
    expect(readAtmPresets()).toHaveLength(1)
  })

  it.each([
    'broken json',
    '{}',
    '{"version":2,"presets":[]}',
    '{"version":1,"presets":[{"name":"Bad","symbol":"MNQ","qty":1,"stopTicks":-8,"targets":[],"atm":null}]}',
  ])('ignores malformed persisted input %s', async (raw) => {
    localStorage.setItem(ATM_PRESETS_KEY, raw)
    const view = ticket()
    await nextTick()
    expect(readAtmPresets()).toEqual([])
    expect(control(view, 'preset-select').findAll('option')).toHaveLength(1)
    await submit(view)
    expect(view.emitted('submit')).toHaveLength(1)
  })

  it('validates unknown storage payloads and catches unavailable storage on read/write', async () => {
    expect(
      validAtmPreset({ name: 'X', symbol: 'MNQ', qty: 1, stopTicks: 8, targets: [{ ticks: 2, qty: 2 }], atm: null }),
    ).toBe(false)
    expect(
      validAtmPreset({
        name: 'X',
        symbol: 'MNQ',
        qty: 1,
        stopTicks: null,
        targets: [{ ticks: 2, qty: 1 }],
        atm: { breakEven: { triggerTicks: 1, offsetTicks: 0 }, trailing: null },
      }),
    ).toBe(false)
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    expect(readAtmPresets(storage)).toEqual([])
    expect(writeAtmPresets([], storage)).toBe(false)
    const view = ticket()
    await bracket(view)
    await control(view, 'preset-name').setValue('Blocked')
    vi.stubGlobal('localStorage', storage)
    await control(view, 'preset-save').trigger('click')
    expect(control(view, 'preset-error').text()).toBe(patch.en['terminal.ticket.errors.storage'])
    expect(readAtmPresets()).toEqual([])
  })
})

describe('terminal ticket translation patch', () => {
  it.each(['en', 'zh-CN', 'ja'] as const)(
    'renders all ticket additions using the local %s dictionary',
    async (locale) => {
      const view = ticket({}, locale)
      await bracket(view)
      await control(view, 'ticket-atm').trigger('click')
      await control(view, 'ticket-break-even').trigger('click')
      await control(view, 'ticket-trailing').trigger('click')
      await control(view, 'ticket-tif').setValue('gtd')
      await control(view, 'ticket-type').setValue('trailing-stop-limit')
      expect(view.text()).toContain(patch[locale]['terminal.ticket.expiresAt'])
      expect(view.text()).toContain(patch[locale]['terminal.ticket.atmRequiresStop'])
      expect(view.text()).not.toContain('terminal.')
      expect(Object.keys(patch[locale]).sort()).toEqual(Object.keys(patch.en).sort())
    },
  )
})
