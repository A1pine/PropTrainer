// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  LAYOUT_KEY,
  MAX_PANES,
  readLayout,
  resizePanes,
  validPane,
  writeLayout,
  type TerminalPane,
} from '~/lib/sim/layout'

/**
 * Workspace layouts are display preferences: they must never break the desk if
 * storage holds stale symbols, duplicate panes or an older shape.
 */

const MNQ: TerminalPane = { symbol: 'MNQ', timeframe: '15m', style: 'candles' }
const ES: TerminalPane = { symbol: 'ES', timeframe: '1h', style: 'line' }
const MGC: TerminalPane = { symbol: 'MGC', timeframe: '1D', style: 'ohlc' }
const known = (symbol: string) => ['MNQ', 'ES', 'MGC', 'MCL'].includes(symbol)

beforeEach(() => {
  localStorage.clear()
})

describe('validPane', () => {
  it('accepts a known symbol with a supported timeframe and style', () => {
    expect(validPane(MNQ, known)).toBe(true)
    expect(validPane({ ...MNQ, timeframe: '1D' }, known)).toBe(true)
    expect(validPane({ ...MNQ, style: 'heikin-ashi' }, known)).toBe(true)
  })

  it('rejects unknown symbols, unsupported timeframes and styles', () => {
    expect(validPane({ ...MNQ, symbol: 'ZZZ' }, known)).toBe(false)
    expect(validPane({ ...MNQ, timeframe: '1m' }, known)).toBe(false)
    expect(validPane({ ...MNQ, style: 'renko' }, known)).toBe(false)
  })

  it('rejects non-objects without throwing', () => {
    for (const value of [null, undefined, 42, 'MNQ', [], {}]) {
      expect(validPane(value, known)).toBe(false)
    }
  })
})

describe('readLayout', () => {
  it('returns null when nothing is stored', () => {
    expect(readLayout(known)).toBeNull()
  })

  it('round-trips a saved layout and strips unknown fields', () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify([{ ...MNQ, extra: 'ignored' }, ES]))
    const panes = readLayout(known)
    expect(panes).toEqual([MNQ, ES])
    expect(Object.keys(panes![0]!)).toEqual(['symbol', 'timeframe', 'style'])
  })

  it('rejects the whole layout when one pane is invalid', () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify([MNQ, { ...ES, symbol: 'GONE' }]))
    expect(readLayout(known)).toBeNull()
  })

  it('rejects empty, oversized and malformed payloads', () => {
    for (const raw of [[], [MNQ, ES, MGC, MNQ], 'nope', { panes: [MNQ] }, null]) {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(raw))
      expect(readLayout(known)).toBeNull()
    }
    localStorage.setItem(LAYOUT_KEY, '{not json')
    expect(readLayout(known)).toBeNull()
  })

  it('allows the same symbol on two panes with different timeframes', () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify([MNQ, { ...MNQ, timeframe: '1h' }]))
    expect(readLayout(known)).toHaveLength(2)
  })
})

describe('writeLayout', () => {
  it('persists at most MAX_PANES panes', () => {
    writeLayout([MNQ, ES, MGC, { ...MGC, timeframe: '1h' }])
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!).length).toBe(MAX_PANES)
  })

  it('survives a storage quota failure', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('quota')
    }
    expect(() => writeLayout([MNQ])).not.toThrow()
    Storage.prototype.setItem = original
  })
})

describe('resizePanes', () => {
  it('keeps existing panes and fills new slots with unused symbols', () => {
    const next = resizePanes([MNQ], 3, ['MNQ', 'ES', 'MGC', 'MCL'], MNQ)
    expect(next.map((pane) => pane.symbol)).toEqual(['MNQ', 'ES', 'MGC'])
    expect(next[1]!.timeframe).toBe(MNQ.timeframe)
    expect(next[1]!.style).toBe(MNQ.style)
  })

  it('shrinks without touching the surviving panes', () => {
    const next = resizePanes([MNQ, ES, MGC], 2, ['MNQ', 'ES', 'MGC'], MNQ)
    expect(next).toEqual([MNQ, ES])
  })

  it('returns fresh objects so callers can edit panes safely', () => {
    const source = [MNQ]
    const next = resizePanes(source, 2, ['MNQ', 'ES'], MNQ)
    next[0]!.symbol = 'MCL'
    expect(source[0]!.symbol).toBe('MNQ')
  })

  it('clamps absurd sizes and reuses the first symbol when the list runs out', () => {
    expect(resizePanes([MNQ], 0, ['MNQ'], MNQ)).toHaveLength(1)
    expect(resizePanes([MNQ], 99, ['MNQ'], MNQ)).toHaveLength(MAX_PANES)
    expect(resizePanes([MNQ], 2, ['MNQ'], MNQ).map((pane) => pane.symbol)).toEqual(['MNQ', 'MNQ'])
  })
})
