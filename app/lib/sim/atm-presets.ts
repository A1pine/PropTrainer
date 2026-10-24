import type { SimAtm } from '~/domain/sim/types'

export interface AtmPreset {
  name: string
  symbol: string
  qty: number
  stopTicks: number | null
  targets: { ticks: number; qty: number }[]
  atm: SimAtm | null
}

export const ATM_PRESETS_KEY = 'propdesk.terminal.atm-presets.v1'
const MAX_PRESETS = 100

type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integer(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
}

export function validAtm(value: unknown): value is SimAtm {
  if (!record(value)) return false
  const be = value.breakEven
  const trail = value.trailing
  return (
    (be === null || (record(be) && integer(be.triggerTicks, 1) && integer(be.offsetTicks, 0))) &&
    (trail === null ||
      (record(trail) &&
        integer(trail.triggerTicks, 1) &&
        integer(trail.distanceTicks, 1) &&
        integer(trail.stepTicks, 1)))
  )
}

export function validAtmPreset(value: unknown): value is AtmPreset {
  if (!record(value)) return false
  if (
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name !== value.name.trim() ||
    value.name.length > 64
  )
    return false
  if (
    typeof value.symbol !== 'string' ||
    !value.symbol.trim() ||
    value.symbol !== value.symbol.trim() ||
    value.symbol.length > 32
  )
    return false
  if (!integer(value.qty, 1) || (value.stopTicks !== null && !integer(value.stopTicks, 1))) return false
  if (!Array.isArray(value.targets) || value.targets.length > 5) return false
  let total = 0
  for (const target of value.targets) {
    if (!record(target) || !integer(target.ticks, 1) || !integer(target.qty, 1)) return false
    total += target.qty
  }
  if (!Number.isSafeInteger(total) || total > value.qty) return false
  if (value.stopTicks === null && value.targets.length === 0) return false
  if (value.atm !== null && (!validAtm(value.atm) || value.stopTicks === null)) return false
  return true
}

function copyPreset(preset: AtmPreset): AtmPreset {
  return {
    name: preset.name,
    symbol: preset.symbol,
    qty: preset.qty,
    stopTicks: preset.stopTicks,
    targets: preset.targets.map(({ ticks, qty }) => ({ ticks, qty })),
    atm: preset.atm
      ? {
          breakEven: preset.atm.breakEven
            ? { triggerTicks: preset.atm.breakEven.triggerTicks, offsetTicks: preset.atm.breakEven.offsetTicks }
            : null,
          trailing: preset.atm.trailing
            ? {
                triggerTicks: preset.atm.trailing.triggerTicks,
                distanceTicks: preset.atm.trailing.distanceTicks,
                stepTicks: preset.atm.trailing.stepTicks,
              }
            : null,
        }
      : null,
  }
}

export function readAtmPresets(storage?: StorageAccess): AtmPreset[] {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(ATM_PRESETS_KEY)
    if (!raw || raw.length > 200_000) return []
    const saved: unknown = JSON.parse(raw)
    if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.presets) || saved.presets.length > MAX_PRESETS)
      return []
    const result: AtmPreset[] = []
    for (const value of saved.presets) {
      if (!validAtmPreset(value) || result.some((item) => item.symbol === value.symbol && item.name === value.name))
        continue
      result.push(copyPreset(value))
    }
    return result
  } catch {
    return []
  }
}

export function writeAtmPresets(presets: AtmPreset[], storage?: StorageAccess): boolean {
  try {
    if (presets.length > MAX_PRESETS || !presets.every(validAtmPreset)) return false
    const unique = new Set(presets.map((preset) => JSON.stringify([preset.symbol, preset.name])))
    if (unique.size !== presets.length) return false
    ;(storage ?? globalThis.localStorage).setItem(
      ATM_PRESETS_KEY,
      JSON.stringify({ version: 1, presets: presets.map(copyPreset) }),
    )
    return true
  } catch {
    return false
  }
}
