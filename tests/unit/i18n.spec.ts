import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Bundle {
  [key: string]: string | Bundle
}

const locales = ['en', 'zh-CN', 'ja'] as const

function flatten(bundle: Bundle, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>()
  for (const [key, value] of Object.entries(bundle)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') entries.set(path, value)
    else for (const [nested, nestedValue] of flatten(value, path)) entries.set(nested, nestedValue)
  }
  return entries
}

function load(code: (typeof locales)[number]) {
  const file = resolve(process.cwd(), 'i18n/locales', `${code}.json`)
  return flatten(JSON.parse(readFileSync(file, 'utf8')) as Bundle)
}

describe('i18n locale bundles', () => {
  const english = load('en')

  it('ships a non-trivial English source bundle', () => {
    expect(english.size).toBeGreaterThan(500)
  })

  it.each(locales)('%s has the same keys as English', (code) => {
    const bundle = load(code)
    expect([...bundle.keys()].sort()).toEqual([...english.keys()].sort())
  })

  it.each(locales)('%s has no empty values', (code) => {
    const empty = [...load(code)].filter(([, value]) => value.trim().length === 0)
    expect(empty).toEqual([])
  })

  it.each(locales)('%s preserves interpolation placeholders', (code) => {
    const bundle = load(code)
    for (const [key, value] of english) {
      const expected = [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
      const actual = [...(bundle.get(key) ?? '').matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
      expect(actual, key).toEqual(expected)
    }
  })
})
