/** User-configurable, opt-in terminal shortcuts. */

export type HotkeyAction = 'play-pause' | 'step' | 'buy' | 'sell' | 'flatten' | 'close'

export const HOTKEY_ACTIONS: HotkeyAction[] = ['play-pause', 'step', 'buy', 'sell', 'flatten', 'close']

export const DEFAULT_BINDINGS: Record<HotkeyAction, string> = {
  'play-pause': 'Space',
  step: 'N',
  buy: 'B',
  sell: 'S',
  flatten: 'F',
  close: 'Escape',
}

export const HOTKEYS_KEY = 'propdesk.terminal.hotkeys.v1'

export interface HotkeySettings {
  enabled: boolean
  bindings: Record<HotkeyAction, string>
}

/** Hotkeys stay off until the trader opts in, matching Tradovate's modules. */
export const defaultHotkeys: HotkeySettings = {
  enabled: false,
  bindings: { ...DEFAULT_BINDINGS },
}

/**
 * Letters, digits, Space and Escape are the only bindable keys. Function keys,
 * modifiers, dead keys, IME `Process` and navigation keys all normalize to an
 * empty string so a shortcut can never swallow browser or assistive input.
 */
export function normalizeKey(value: string): string {
  // The space bar arrives as a literal " ", which trim() would erase.
  if (value === ' ') return 'Space'
  const key = value.trim()
  if (!key) return ''
  const lower = key.toLowerCase()
  if (lower === 'space' || lower === 'spacebar') return 'Space'
  if (lower === 'esc' || lower === 'escape') return 'Escape'
  if (key.length === 1 && /[a-z0-9]/i.test(key)) return key.toUpperCase()
  return ''
}

/**
 * Error code for an unusable binding, or null when the key can be assigned.
 * `reserved` covers everything outside the bindable set (including reserved
 * typing/navigation keys); duplicate detection is case-normalized.
 */
export function bindingError(
  action: HotkeyAction,
  key: string,
  bindings: Record<HotkeyAction, string>,
): 'reserved' | 'duplicate' | null {
  const normalized = normalizeKey(key)
  if (!normalized) return 'reserved'
  for (const other of HOTKEY_ACTIONS) {
    if (other !== action && normalizeKey(bindings[other]) === normalized) return 'duplicate'
  }
  return null
}

/** Apply one rebinding without mutating the input table. */
export function withBinding(settings: HotkeySettings, action: HotkeyAction, key: string): HotkeySettings {
  if (bindingError(action, key, settings.bindings)) return settings
  return { ...settings, bindings: { ...settings.bindings, [action]: normalizeKey(key) } }
}

/**
 * Validate and rebuild a settings object, or null when anything is off. The
 * result is always a fresh object with freshly built bindings, so callers can
 * hand it to reactive state or storage without sharing references.
 */
export function normalizeHotkeys(value: unknown): HotkeySettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<HotkeySettings>
  if (typeof candidate.enabled !== 'boolean') return null
  const raw = candidate.bindings
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const bindings = {} as Record<HotkeyAction, string>
  const seen = new Set<string>()
  for (const action of HOTKEY_ACTIONS) {
    const key = typeof raw[action] === 'string' ? normalizeKey(raw[action]) : ''
    if (!key || seen.has(key)) return null
    seen.add(key)
    bindings[action] = key
  }
  return { enabled: candidate.enabled, bindings }
}

export function validHotkeys(value: unknown): value is HotkeySettings {
  return normalizeHotkeys(value) !== null
}

export function fallbackHotkeys(): HotkeySettings {
  return { enabled: defaultHotkeys.enabled, bindings: { ...DEFAULT_BINDINGS } }
}

export function readHotkeys(): HotkeySettings {
  try {
    if (typeof localStorage === 'undefined') return fallbackHotkeys()
    const raw: unknown = JSON.parse(localStorage.getItem(HOTKEYS_KEY) ?? 'null')
    // Corrupt, partial or hand-edited payloads fall back instead of half-applying.
    return normalizeHotkeys(raw) ?? fallbackHotkeys()
  } catch {
    return fallbackHotkeys()
  }
}

export function writeHotkeys(settings: HotkeySettings): void {
  const normalized = normalizeHotkeys(settings)
  // Never persist a table that would fail validation on the next read.
  if (!normalized) return
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(HOTKEYS_KEY, JSON.stringify(normalized))
  } catch {
    /* Keyboard preferences are optional; the desk keeps working with defaults. */
  }
}

/** Human-readable label for a KeyboardEvent.key value. */
export function formatHotkey(key: string): string {
  if (key === 'Escape') return 'Esc'
  return key
}

export interface HotkeyEventLike {
  key: string
  repeat?: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/**
 * Match an event against the table. Modifier chords are intentionally not
 * supported: they collide with browser shortcuts and are easy to trigger by
 * accident on a trading desk. Held keys, IME composition and events another
 * handler already consumed never fire a shortcut.
 */
export function matchHotkey(
  event: HotkeyEventLike,
  settings: HotkeySettings,
  options: { hasPosition?: boolean; ticketOpen?: boolean } = {},
): HotkeyAction | null {
  if (!settings.enabled) return null
  if (event.defaultPrevented || event.repeat || event.isComposing) return null
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null
  const key = normalizeKey(event.key)
  if (!key) return null
  for (const action of HOTKEY_ACTIONS) {
    if (normalizeKey(settings.bindings[action]) !== key) continue
    if (action === 'flatten' && !options.hasPosition) return null
    if (action === 'close' && !options.ticketOpen) return null
    return action
  }
  return null
}
