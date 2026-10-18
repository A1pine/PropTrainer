import { describe, expect, it } from 'vitest'
import { defaultSettings, parseSettings, settingsSchema } from '@/domain/settings/schema'
import { createRules, PROP_PRESETS } from '@/domain/trading/types'

describe('settings schema', () => {
  it('accepts the defaults', () => {
    expect(settingsSchema.safeParse(defaultSettings).success).toBe(true)
  })

  it('falls back to defaults for invalid input', () => {
    expect(parseSettings(null)).toEqual(defaultSettings)
    expect(parseSettings({ locale: 'xx', theme: 'neon', accountSize: 10 })).toEqual(defaultSettings)
  })

  it('rejects out-of-range risk values', () => {
    const base = { ...defaultSettings }
    expect(parseSettings({ ...base, riskPerTrade: 0 }).riskPerTrade).toBe(defaultSettings.riskPerTrade)
    expect(parseSettings({ ...base, maxContracts: 1000 }).maxContracts).toBe(defaultSettings.maxContracts)
    expect(parseSettings({ ...base, instruments: [] }).instruments.length).toBeGreaterThan(0)
  })

  it('preserves valid custom values', () => {
    const custom = parseSettings({ ...defaultSettings, locale: 'ja', theme: 'dark', accountSize: 100_000 })
    expect(custom.locale).toBe('ja')
    expect(custom.theme).toBe('dark')
    expect(custom.accountSize).toBe(100_000)
  })
})

describe('account presets', () => {
  it('keeps the evaluation math intact', () => {
    expect(PROP_PRESETS['eval-50k'].profitTarget).toBe(3_000)
    expect(PROP_PRESETS['eval-50k'].maxDrawdown).toBe(2_000)
    expect(PROP_PRESETS['eval-50k'].dailyLossLimit).toBe(1_000)
  })

  it('allows the account size to override a preset', () => {
    const rules = createRules({ preset: 'eval-50k', accountSize: 75_000, maxContracts: 7 })
    expect(rules.accountSize).toBe(75_000)
    expect(rules.profitTarget).toBe(3_000)
    expect(rules.maxContracts).toBe(7)
  })
})
