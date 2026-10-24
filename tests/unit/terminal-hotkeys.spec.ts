// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_BINDINGS,
  HOTKEYS_KEY,
  bindingError,
  defaultHotkeys,
  fallbackHotkeys,
  formatHotkey,
  matchHotkey,
  normalizeHotkeys,
  normalizeKey,
  readHotkeys,
  validHotkeys,
  withBinding,
  writeHotkeys,
  type HotkeySettings,
} from '~/lib/sim/hotkeys'

function settings(patch: Partial<HotkeySettings> = {}): HotkeySettings {
  return { enabled: true, bindings: { ...DEFAULT_BINDINGS }, ...patch }
}

const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({ key: value, ...extra })

describe('terminal hotkeys', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('ships disabled so a fresh desk never fires a shortcut', () => {
    expect(defaultHotkeys.enabled).toBe(false)
    expect(readHotkeys()).toEqual(fallbackHotkeys())
    expect(readHotkeys().enabled).toBe(false)
    expect(matchHotkey(key('b'), defaultHotkeys)).toBeNull()
  })

  it('normalizes literal space, names and letter case', () => {
    expect(normalizeKey(' ')).toBe('Space')
    expect(normalizeKey('space')).toBe('Space')
    expect(normalizeKey('Spacebar')).toBe('Space')
    expect(normalizeKey(' b ')).toBe('B')
    expect(normalizeKey('n')).toBe('N')
    expect(normalizeKey('7')).toBe('7')
    expect(normalizeKey('Escape')).toBe('Escape')
    expect(normalizeKey('esc')).toBe('Escape')
  })

  it('rejects function, modifier, navigation, dead and IME keys', () => {
    for (const value of [
      'F1',
      'F12',
      'Shift',
      'Control',
      'Alt',
      'Meta',
      'CapsLock',
      'Tab',
      'Enter',
      'Backspace',
      'ArrowUp',
      'Dead',
      'Process',
      'Unidentified',
      '',
      'ab',
    ]) {
      expect(normalizeKey(value), value).toBe('')
    }
  })

  it('rejects duplicates regardless of case or space spelling', () => {
    expect(bindingError('buy', 'n', DEFAULT_BINDINGS)).toBe('duplicate')
    expect(bindingError('buy', 'N', DEFAULT_BINDINGS)).toBe('duplicate')
    expect(bindingError('step', ' ', DEFAULT_BINDINGS)).toBe('duplicate')
    expect(bindingError('step', 'SPACE', DEFAULT_BINDINGS)).toBe('duplicate')
    expect(bindingError('buy', 'q', DEFAULT_BINDINGS)).toBeNull()
  })

  it('rejects reserved keys when rebinding', () => {
    expect(bindingError('buy', 'F5', DEFAULT_BINDINGS)).toBe('reserved')
    expect(bindingError('buy', 'Control', DEFAULT_BINDINGS)).toBe('reserved')
    expect(bindingError('buy', 'Process', DEFAULT_BINDINGS)).toBe('reserved')
    expect(bindingError('buy', '', DEFAULT_BINDINGS)).toBe('reserved')
  })

  it('matches the default table case-insensitively', () => {
    expect(matchHotkey(key(' '), settings())).toBe('play-pause')
    expect(matchHotkey(key('n'), settings())).toBe('step')
    expect(matchHotkey(key('B'), settings())).toBe('buy')
    expect(matchHotkey(key('s'), settings())).toBe('sell')
    expect(matchHotkey(key('Escape'), settings(), { ticketOpen: true })).toBe('close')
  })

  it('requires a position for flatten and an open ticket for close', () => {
    expect(matchHotkey(key('f'), settings())).toBeNull()
    expect(matchHotkey(key('f'), settings(), { hasPosition: true })).toBe('flatten')
    expect(matchHotkey(key('Escape'), settings())).toBeNull()
  })

  it('ignores held keys, IME composition and already-handled events', () => {
    expect(matchHotkey(key('b', { repeat: true }), settings())).toBeNull()
    expect(matchHotkey(key('b', { isComposing: true }), settings())).toBeNull()
    expect(matchHotkey(key('b', { defaultPrevented: true }), settings())).toBeNull()
  })

  it('ignores modifier chords instead of matching the bare key', () => {
    for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) {
      expect(matchHotkey(key('b', { [modifier]: true }), settings()), modifier).toBeNull()
    }
  })

  it('rebinds immutably and refuses invalid keys', () => {
    const base = settings()
    const next = withBinding(base, 'buy', 'q')
    expect(next.bindings.buy).toBe('Q')
    expect(base.bindings.buy).toBe('B')
    expect(withBinding(base, 'buy', 'N')).toBe(base)
    expect(withBinding(base, 'buy', 'F4')).toBe(base)
  })

  it('validates persisted payloads', () => {
    expect(validHotkeys(settings())).toBe(true)
    expect(validHotkeys({ enabled: false, bindings: DEFAULT_BINDINGS })).toBe(true)
    expect(validHotkeys({ enabled: true, bindings: { ...DEFAULT_BINDINGS, buy: 'Tab' } })).toBe(false)
    expect(validHotkeys({ enabled: true, bindings: { ...DEFAULT_BINDINGS, buy: 'S' } })).toBe(false)
    expect(validHotkeys({ enabled: true, bindings: { ...DEFAULT_BINDINGS, buy: 's' } })).toBe(false)
    expect(validHotkeys({ enabled: true, bindings: { ...DEFAULT_BINDINGS, buy: undefined } })).toBe(false)
    expect(validHotkeys({ enabled: 'yes', bindings: DEFAULT_BINDINGS })).toBe(false)
    expect(validHotkeys(null)).toBe(false)
    expect(validHotkeys([])).toBe(false)
  })

  it('normalizes into a detached clone', () => {
    const source = { enabled: false, bindings: { ...DEFAULT_BINDINGS, buy: ' q ' } }
    const normalized = normalizeHotkeys(source)
    expect(normalized).not.toBeNull()
    expect(normalized?.bindings.buy).toBe('Q')
    expect(normalized?.bindings).not.toBe(source.bindings)
    expect(source.bindings.buy).toBe(' q ')
  })

  it('round-trips through storage and keeps the disabled flag', () => {
    writeHotkeys({ enabled: false, bindings: { ...DEFAULT_BINDINGS, buy: ' q ' } })
    const stored = JSON.parse(localStorage.getItem(HOTKEYS_KEY) ?? '{}') as HotkeySettings
    expect(stored.enabled).toBe(false)
    expect(stored.bindings.buy).toBe('Q')

    const restored = readHotkeys()
    expect(restored.enabled).toBe(false)
    expect(restored.bindings.buy).toBe('Q')
    expect(restored.bindings).not.toBe(DEFAULT_BINDINGS)
  })

  it('falls back on corrupt or hand-edited storage', () => {
    localStorage.setItem(HOTKEYS_KEY, '{not json')
    expect(readHotkeys()).toEqual(fallbackHotkeys())

    localStorage.setItem(HOTKEYS_KEY, JSON.stringify({ enabled: true }))
    expect(readHotkeys()).toEqual(fallbackHotkeys())

    localStorage.setItem(HOTKEYS_KEY, JSON.stringify({ enabled: true, bindings: { ...DEFAULT_BINDINGS, buy: 'F9' } }))
    expect(readHotkeys()).toEqual(fallbackHotkeys())

    localStorage.setItem(HOTKEYS_KEY, JSON.stringify({ enabled: true, bindings: { ...DEFAULT_BINDINGS, buy: 'n' } }))
    expect(readHotkeys()).toEqual(fallbackHotkeys())
  })

  it('never persists a table that would fail validation', () => {
    writeHotkeys({ enabled: true, bindings: { ...DEFAULT_BINDINGS, buy: 'S' } })
    expect(localStorage.getItem(HOTKEYS_KEY)).toBeNull()
  })

  it('formats keys for the settings panel', () => {
    expect(formatHotkey('Space')).toBe('Space')
    expect(formatHotkey('Escape')).toBe('Esc')
    expect(formatHotkey('N')).toBe('N')
  })
})
