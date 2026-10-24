// @vitest-environment happy-dom
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { DEFAULT_BINDINGS, defaultHotkeys, type HotkeySettings } from '~/lib/sim/hotkeys'
import HotkeySettingsPanel from '~/components/terminal/HotkeySettings.vue'
import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh-CN.json'
import ja from '../../i18n/locales/ja.json'

enableAutoUnmount(afterEach)

const pageHandlers: EventListener[] = []
afterEach(() => {
  for (const handler of pageHandlers) window.removeEventListener('keydown', handler)
  pageHandlers.length = 0
})

function watchPageKeys() {
  const handler = vi.fn()
  window.addEventListener('keydown', handler)
  pageHandlers.push(handler)
  return handler
}

function mountPanel(
  settings: HotkeySettings = { ...defaultHotkeys, bindings: { ...DEFAULT_BINDINGS } },
  locale = 'en',
) {
  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { en, 'zh-CN': zh, ja },
  })
  return mount(HotkeySettingsPanel, {
    props: { settings },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document.activeElement ?? document.body,
) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

async function openPanel(wrapper: VueWrapper) {
  await wrapper.get('[data-testid="hotkeys-toggle"]').trigger('click')
  await nextTick()
  return wrapper.get('[data-testid="hotkeys-panel"]')
}

function keyLabel(wrapper: VueWrapper, action: string) {
  return wrapper.get(`[data-action="${action}"]`).text()
}

function emittedSettings(wrapper: VueWrapper) {
  return wrapper.emitted('update:settings')?.at(-1)?.[0] as HotkeySettings | undefined
}

describe('HotkeySettings panel', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('starts closed and emits open-change when toggled', async () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-testid="hotkeys-panel"]').exists()).toBe(false)
    expect(wrapper.emitted('open-change')).toBeUndefined()

    await openPanel(wrapper)
    expect(wrapper.emitted('open-change')?.at(-1)).toEqual([true])

    await wrapper.get('[data-testid="hotkeys-close"]').trigger('click')
    expect(wrapper.emitted('open-change')?.at(-1)).toEqual([false])
    expect(wrapper.find('[data-testid="hotkeys-panel"]').exists()).toBe(false)
  })

  it('renders a labelled non-modal dialog with every default binding', async () => {
    const wrapper = mountPanel()
    const panel = await openPanel(wrapper)

    expect(panel.attributes('role')).toBe('dialog')
    expect(panel.attributes('aria-modal')).toBe('false')
    expect(panel.attributes('aria-label')).toBe('Hotkeys')
    expect(wrapper.get('[data-testid="hotkeys-toggle"]').attributes('aria-expanded')).toBe('true')

    expect(wrapper.findAll('[data-action]').map((button) => button.text())).toEqual([
      'Space',
      'N',
      'B',
      'S',
      'F',
      'Esc',
    ])
    expect(panel.text()).toContain('Flatten position')
  })

  it.each([
    ['en', en],
    ['zh-CN', zh],
    ['ja', ja],
  ] as const)('renders real %s translations', async (locale, messages) => {
    const wrapper = mountPanel(undefined, locale)
    const panel = await openPanel(wrapper)
    expect(panel.attributes('aria-label')).toBe(messages.terminal.hotkeys.title)
    expect(panel.text()).toContain(messages.terminal.hotkeys.actions.buy)
    expect(panel.text()).toContain(messages.terminal.hotkeys.note)
    await wrapper.get('[data-action="buy"]').trigger('click')
    press('F5')
    await nextTick()
    expect(wrapper.get('[role="status"]').text()).toBe(messages.terminal.hotkeys.errors.reserved)
  })

  it('moves focus into the panel and restores it on Escape', async () => {
    const wrapper = mountPanel()
    const toggle = wrapper.get('[data-testid="hotkeys-toggle"]').element as HTMLElement
    toggle.focus()
    const panel = await openPanel(wrapper)

    expect(document.activeElement).toBe(panel.element)

    press('Escape', {}, document.body)
    await nextTick()
    expect(wrapper.find('[data-testid="hotkeys-panel"]').exists()).toBe(false)
    expect(document.activeElement).toBe(toggle)
    expect(wrapper.emitted('open-change')?.at(-1)).toEqual([false])
  })

  it('starts disabled and toggles the enabled flag without touching the table', async () => {
    const wrapper = mountPanel()
    await openPanel(wrapper)
    const checkbox = wrapper.get<HTMLInputElement>('[data-testid="hotkeys-enabled"]')
    expect(checkbox.element.checked).toBe(false)

    await checkbox.setValue(true)
    expect(emittedSettings(wrapper)).toEqual({ enabled: true, bindings: DEFAULT_BINDINGS })
    await wrapper.setProps({ settings: emittedSettings(wrapper) })
    await checkbox.setValue(false)
    expect(emittedSettings(wrapper)).toEqual({ enabled: false, bindings: DEFAULT_BINDINGS })
  })

  it('captures a plain letter before an earlier-registered page handler', async () => {
    const pageHandler = watchPageKeys()
    const wrapper = mountPanel()
    await openPanel(wrapper)
    await wrapper.get('[data-action="buy"]').trigger('click')
    expect(keyLabel(wrapper, 'buy')).toBe('Press a key')

    const event = press('q')
    await nextTick()

    expect(event.defaultPrevented).toBe(true)
    expect(pageHandler).not.toHaveBeenCalled()
    const next = emittedSettings(wrapper)
    expect(next?.bindings.buy).toBe('Q')
    if (!next) throw new Error('Expected captured hotkey settings')

    await wrapper.setProps({ settings: next })
    expect(keyLabel(wrapper, 'buy')).toBe('Q')
  })

  it('captures Space as a literal space bar', async () => {
    const wrapper = mountPanel({ enabled: true, bindings: { ...DEFAULT_BINDINGS, 'play-pause': 'P' } })
    await openPanel(wrapper)
    await wrapper.get('[data-action="step"]').trigger('click')

    press(' ')
    await nextTick()
    const next = emittedSettings(wrapper)
    expect(next?.bindings.step).toBe('Space')

    await wrapper.setProps({ settings: next })
    expect(keyLabel(wrapper, 'step')).toBe('Space')

    // Space is now taken, so binding it to another action is a duplicate.
    await wrapper.get('[data-action="sell"]').trigger('click')
    press(' ')
    await nextTick()
    expect(wrapper.text()).toContain('already bound')
    expect(keyLabel(wrapper, 'sell')).toBe('Press a key')
  })

  it.each(['Enter', 'F1', 'F5', 'F12', 'Control', 'Dead', 'Process', 'Unidentified'])(
    'rejects %s without remapping',
    async (key) => {
      const wrapper = mountPanel()
      await openPanel(wrapper)
      await wrapper.get('[data-action="buy"]').trigger('click')

      const event = press(key)
      await nextTick()
      expect(event.defaultPrevented).toBe(true)
      expect(wrapper.get('[role="status"]').text()).toBe(en.terminal.hotkeys.errors.reserved)
      expect(emittedSettings(wrapper)).toBeUndefined()
      expect(keyLabel(wrapper, 'buy')).toBe('Press a key')
    },
  )

  it.each(['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const)(
    'rejects a %s chord instead of capturing its bare letter',
    async (modifier) => {
      const wrapper = mountPanel()
      await openPanel(wrapper)
      await wrapper.get('[data-action="buy"]').trigger('click')

      press('q', { [modifier]: true })
      await nextTick()
      expect(wrapper.get('[role="status"]').text()).toBe(en.terminal.hotkeys.errors.reserved)
      expect(emittedSettings(wrapper)).toBeUndefined()
      expect(keyLabel(wrapper, 'buy')).toBe('Press a key')

      press('q')
      await nextTick()
      expect(emittedSettings(wrapper)?.bindings.buy).toBe('Q')
    },
  )

  it('rejects a duplicate binding regardless of case', async () => {
    const wrapper = mountPanel()
    await openPanel(wrapper)
    await wrapper.get('[data-action="buy"]').trigger('click')

    press('s')
    await nextTick()
    expect(wrapper.text()).toContain('already bound')
    expect(emittedSettings(wrapper)).toBeUndefined()
    expect(keyLabel(wrapper, 'buy')).toBe('Press a key')
  })

  it('ignores auto-repeat and IME composition', async () => {
    const wrapper = mountPanel()
    await openPanel(wrapper)
    await wrapper.get('[data-action="buy"]').trigger('click')

    press('q', { repeat: true })
    press('w', { isComposing: true })
    await nextTick()
    expect(emittedSettings(wrapper)).toBeUndefined()
    expect(keyLabel(wrapper, 'buy')).toBe('Press a key')
  })

  it('cancels capture on Escape before closing the panel and restoring focus', async () => {
    const wrapper = mountPanel()
    await openPanel(wrapper)
    const capture = wrapper.get<HTMLButtonElement>('[data-action="sell"]')
    capture.element.focus()
    await capture.trigger('click')

    press('Escape')
    await nextTick()
    expect(keyLabel(wrapper, 'sell')).toBe('S')
    expect(wrapper.find('[data-testid="hotkeys-panel"]').exists()).toBe(true)
    expect(document.activeElement).toBe(capture.element)
    expect(wrapper.emitted('open-change')).toEqual([[true]])

    press('Escape', { repeat: true })
    await nextTick()
    expect(wrapper.find('[data-testid="hotkeys-panel"]').exists()).toBe(true)

    press('Escape')
    await nextTick()
    expect(wrapper.find('[data-testid="hotkeys-panel"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('[data-testid="hotkeys-toggle"]').element)
    expect(wrapper.emitted('open-change')).toEqual([[true], [false]])
  })

  it.each(['close', 'toggle', 'pointerdown', 'click'] as const)(
    'leaves no capture or error behind after %s dismissal',
    async (method) => {
      const wrapper = mountPanel()
      await openPanel(wrapper)
      await wrapper.get('[data-action="buy"]').trigger('click')
      press('F5')
      await nextTick()
      expect(wrapper.find('[role="status"]').exists()).toBe(true)

      if (method === 'close' || method === 'toggle') {
        wrapper.get<HTMLButtonElement>(`[data-testid="hotkeys-${method}"]`).element.click()
      } else if (method === 'pointerdown') {
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
      } else {
        document.body.click()
      }
      expect(wrapper.emitted('open-change')).toEqual([[true], [false]])
      // Test the synchronous boundary, before Vue removes the panel DOM.
      const event = press('q')
      expect(event.defaultPrevented).toBe(false)
      expect(emittedSettings(wrapper)).toBeUndefined()
      await nextTick()
      expect(wrapper.find('[data-testid="hotkeys-panel"]').exists()).toBe(false)
      expect(document.activeElement).toBe(wrapper.get('[data-testid="hotkeys-toggle"]').element)

      await openPanel(wrapper)
      expect(keyLabel(wrapper, 'buy')).toBe('B')
      expect(wrapper.find('[role="status"]').exists()).toBe(false)
      expect(press('q').defaultPrevented).toBe(false)
      expect(emittedSettings(wrapper)).toBeUndefined()
    },
  )

  it('keeps keys away from the page while open, even with focus outside', async () => {
    const pageHandler = watchPageKeys()
    const outside = document.createElement('button')
    document.body.append(outside)
    const wrapper = mountPanel()
    const panel = await openPanel(wrapper)

    expect(press('b', {}, panel.element).defaultPrevented).toBe(false)
    outside.focus()
    expect(document.activeElement).toBe(outside)
    expect(press('b').defaultPrevented).toBe(false)
    expect(pageHandler).not.toHaveBeenCalled()
    expect(wrapper.emitted('open-change')).toEqual([[true]])

    const escape = press('Escape')
    expect(escape.defaultPrevented).toBe(true)
    expect(pageHandler).not.toHaveBeenCalled()
    expect(wrapper.emitted('open-change')).toEqual([[true], [false]])
    await nextTick()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="hotkeys-toggle"]').element)
    press('b')
    expect(pageHandler).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('leaves Tab navigation intact (shiftKey=%s) and cancels capture', async (shiftKey) => {
    const pageHandler = watchPageKeys()
    const wrapper = mountPanel()
    await openPanel(wrapper)
    const capture = wrapper.get<HTMLButtonElement>('[data-action="buy"]')
    capture.element.focus()
    await capture.trigger('click')

    const tab = press('Tab', { shiftKey })
    await nextTick()
    expect(tab.defaultPrevented).toBe(false)
    expect(pageHandler).not.toHaveBeenCalled()
    expect(keyLabel(wrapper, 'buy')).toBe('B')
    expect(wrapper.find('[data-testid="hotkeys-panel"]').exists()).toBe(true)
    expect(emittedSettings(wrapper)).toBeUndefined()

    const outside = document.createElement('input')
    document.body.append(outside)
    outside.focus()
    expect(document.activeElement).toBe(outside)
    expect(press('q').defaultPrevented).toBe(false)
    expect(emittedSettings(wrapper)).toBeUndefined()
  })

  it('abandons capture when focus leaves the non-modal panel', async () => {
    const wrapper = mountPanel()
    await openPanel(wrapper)
    await wrapper.get('[data-action="buy"]').trigger('click')
    const outside = document.createElement('input')
    document.body.append(outside)
    outside.focus()

    expect(press('q').defaultPrevented).toBe(false)
    await nextTick()
    expect(document.activeElement).toBe(outside)
    expect(keyLabel(wrapper, 'buy')).toBe('B')
    expect(emittedSettings(wrapper)).toBeUndefined()
    expect(wrapper.emitted('open-change')).toEqual([[true]])
  })

  it('lets an outside pointer target retain focus when dismissing', async () => {
    const wrapper = mountPanel()
    await openPanel(wrapper)
    await wrapper.get('[data-action="buy"]').trigger('click')
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    outside.focus()
    outside.click()
    await nextTick()

    expect(document.activeElement).toBe(outside)
    expect(wrapper.find('[data-testid="hotkeys-panel"]').exists()).toBe(false)
    expect(wrapper.emitted('open-change')).toEqual([[true], [false]])
    expect(press('q').defaultPrevented).toBe(false)
    expect(emittedSettings(wrapper)).toBeUndefined()
  })

  it('resets the table but keeps the opt-in flag', async () => {
    const wrapper = mountPanel({ enabled: false, bindings: { ...DEFAULT_BINDINGS, buy: 'Q' } })
    await openPanel(wrapper)
    await wrapper.get('[data-testid="hotkeys-reset"]').trigger('click')

    expect(emittedSettings(wrapper)).toEqual({ enabled: false, bindings: DEFAULT_BINDINGS })
  })

  it('removes its listeners when unmounted', async () => {
    const pageHandler = watchPageKeys()

    const wrapper = mountPanel()
    await openPanel(wrapper)
    await wrapper.get('[data-action="buy"]').trigger('click')
    wrapper.unmount()

    press('q', {}, document.body)
    expect(pageHandler).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('update:settings')).toBeUndefined()
  })
})
