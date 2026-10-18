import { z } from 'zod'

export const localeSchema = z.enum(['en', 'zh-CN', 'ja'])
export type LocaleCode = z.infer<typeof localeSchema>

export const themeSchema = z.enum(['light', 'dark', 'system'])
export type ThemeMode = z.infer<typeof themeSchema>

export const accountPresetSchema = z.enum(['eval-50k', 'eval-100k', 'funded-50k', 'custom'])
export type AccountPresetId = z.infer<typeof accountPresetSchema>

export const settingsSchema = z.object({
  locale: localeSchema,
  theme: themeSchema,
  reduceMotion: z.boolean(),
  sound: z.boolean(),
  accountPreset: accountPresetSchema,
  accountSize: z.number().min(1_000).max(10_000_000),
  riskPerTrade: z.number().min(0.1).max(10),
  maxContracts: z.number().int().min(1).max(100),
  feePerContract: z.number().min(0).max(100),
  autoPlaySpeed: z.number().int().min(1).max(8),
  instruments: z.array(z.string()).min(1),
  showRMultiple: z.boolean(),
  confirmBeforeSubmit: z.boolean(),
})

export type Settings = z.infer<typeof settingsSchema>

export const defaultSettings: Settings = {
  locale: 'en',
  theme: 'system',
  reduceMotion: false,
  sound: false,
  accountPreset: 'eval-50k',
  accountSize: 50_000,
  riskPerTrade: 1,
  maxContracts: 5,
  feePerContract: 0,
  autoPlaySpeed: 2,
  instruments: ['MNQ', 'MES', 'MYM', 'M2K', 'MGC', 'MCL'],
  showRMultiple: true,
  confirmBeforeSubmit: true,
}

export function parseSettings(input: unknown): Settings {
  const parsed = settingsSchema.safeParse(input)
  if (parsed.success) return parsed.data
  return { ...defaultSettings }
}
