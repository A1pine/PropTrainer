import { describe, expect, it } from 'vitest'
import { createInstrumentRegistry } from '@/domain/instruments/registry'
import { createInstrument } from '@/domain/instruments/types'
import { instruments, defaultInstrumentSymbols } from '@/domain/instruments/catalog'
import { createRng, gaussian, hashSeed } from '@/domain/shared/rng'

describe('instrument registry', () => {
  it('exposes the prop-firm universe', () => {
    expect(instruments.list().map((item) => item.symbol)).toEqual([
      'MNQ',
      'NQ',
      'MES',
      'ES',
      'MYM',
      'M2K',
      'MGC',
      'MCL',
    ])
    expect(defaultInstrumentSymbols.length).toBeGreaterThanOrEqual(6)
  })

  it('resolves known symbols and throws for unknown ones', () => {
    expect(instruments.require('MNQ').tickValue).toBe(0.5)
    expect(instruments.has('BTCUSDT')).toBe(false)
    expect(() => instruments.require('NOPE')).toThrow(/Unknown instrument/)
  })

  it('rejects duplicate symbols', () => {
    const registry = createInstrumentRegistry([
      createInstrument({
        symbol: 'AAA',
        name: 'A',
        exchange: 'X',
        category: 'micro-future',
        tickSize: 0.5,
        tickValue: 1,
        pointValue: 2,
        pricePrecision: 1,
        feePerContract: 1,
        intradayMargin: 100,
        sessionLabel: 'all',
        anchorPrice: 100,
        volatility: 1,
        mask: 'A???',
      }),
    ])
    expect(registry.require('AAA').pointValue).toBe(2)
    expect(() =>
      createInstrumentRegistry([
        registry.require('AAA'),
        { ...registry.require('AAA') },
      ]),
    ).toThrow(/Duplicate/)
  })

  it('validates tick economics', () => {
    expect(() =>
      createInstrument({
        ...instruments.require('MNQ'),
        pointValue: 10,
      }),
    ).toThrow(/does not match/)
  })
})

describe('seeded rng', () => {
  it('is deterministic for the same seed', () => {
    const first = createRng('session-42')
    const second = createRng('session-42')
    const a = Array.from({ length: 6 }, () => first())
    const b = Array.from({ length: 6 }, () => second())
    expect(a).toEqual(b)
    expect(a.every((value) => value >= 0 && value < 1)).toBe(true)
  })

  it('differs across seeds', () => {
    expect(hashSeed('a')).not.toBe(hashSeed('b'))
    expect(createRng('a')()).not.toBe(createRng('b')())
  })

  it('produces bounded gaussian samples', () => {
    const rng = createRng('gauss')
    for (let index = 0; index < 500; index += 1) {
      const value = gaussian(rng)
      expect(Math.abs(value)).toBeLessThanOrEqual(4)
    }
  })
})
