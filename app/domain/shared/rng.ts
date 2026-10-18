/**
 * Deterministic 32-bit PRNG (mulberry32) with a string seed hash.
 * Scenarios must be reproducible from a seed so a challenge link, a daily
 * sample, or a failing test can be replayed exactly.
 */
export type Rng = () => number

export function hashSeed(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function createRng(seed: string | number): Rng {
  let state = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

export function randomFloat(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}

export function pickOne<T>(rng: Rng, values: readonly T[]): T {
  const value = values[Math.floor(rng() * values.length)]
  if (value === undefined) throw new Error('pickOne called with an empty list')
  return value
}

/** Box–Muller normal sample, clamped to avoid pathological outliers. */
export function gaussian(rng: Rng, mean = 0, stdDev = 1): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  const sample = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return mean + Math.max(-4, Math.min(4, sample)) * stdDev
}

export function shuffle<T>(rng: Rng, values: readonly T[]): T[] {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    const current = copy[index]!
    copy[index] = copy[swap]!
    copy[swap] = current
  }
  return copy
}
