import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Theme contrast guard.
 *
 * Reads the token blocks out of main.css and asserts WCAG AA for the pairs the
 * UI actually uses. This is intentionally token-level (not a screenshot diff):
 * it fails the build the moment a palette tweak makes muted text unreadable,
 * which is the class of bug that made dark mode look washed out.
 */

const css = readFileSync(resolve(process.cwd(), 'app/assets/css/main.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`missing ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('\n}', open)
  const body = css.slice(open + 1, close)
  const tokens: Record<string, string> = {}
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    tokens[match[1]!] = match[2]!.trim()
  }
  return tokens
}

const light = block(':root {')
const darkBlock = css.indexOf('.dark {')
const dark = block('.dark {')
void darkBlock

// `:root` is parsed first, so a later `.dark` block overrides it token by token.
const themes = {
  light: { ...light },
  dark: { ...light, ...dark },
}

function parseColor(value: string): { rgb: [number, number, number]; alpha: number } {
  const text = value.trim()
  if (text.startsWith('#')) {
    const hex = text.slice(1)
    if (hex.length !== 6) throw new Error(`expected a 6-digit hex, got ${value}`)
    return {
      rgb: [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [number, number, number],
      alpha: 1,
    }
  }
  const match = text.match(/rgba?\(([^)]+)\)/)
  if (!match) throw new Error(`cannot parse colour ${value}`)
  const parts = match[1]!.split(',').map((part) => Number.parseFloat(part.trim()))
  return { rgb: [parts[0]!, parts[1]!, parts[2]!], alpha: parts[3] ?? 1 }
}

/** Composite a translucent fill over an opaque base, the way the browser does. */
function composite(foreground: string, background: string): string {
  const top = parseColor(foreground)
  const bottom = parseColor(background)
  if (top.alpha >= 1) return foreground
  const mixed = top.rgb.map((value, index) => Math.round(value * top.alpha + bottom.rgb[index]! * (1 - top.alpha)))
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function rgb(value: string): [number, number, number] {
  return parseColor(value.trim()).rgb
}

function channel(value: number): number {
  const normalized = value / 255
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(foreground: string, background: string): number {
  const [lightest, darkest] = [luminance(rgb(foreground)), luminance(rgb(background))].sort((a, b) => b - a)
  return (lightest! + 0.05) / (darkest! + 0.05)
}

const pairs: { fg: string; bg: string; label: string; minimum?: number }[] = [
  { fg: '--ink', bg: '--surface-1', label: 'primary text on page' },
  { fg: '--ink', bg: '--surface-2', label: 'primary text on panel' },
  { fg: '--ink-2', bg: '--surface-2', label: 'secondary text on panel' },
  { fg: '--ink-3', bg: '--surface-1', label: 'muted text on page' },
  { fg: '--ink-3', bg: '--surface-2', label: 'muted text on panel' },
  { fg: '--ink-3', bg: '--surface-0', label: 'muted text on rail' },
  { fg: '--on-clay', bg: '--clay', label: 'primary button label' },
  { fg: '--on-bull', bg: '--bull', label: 'long button label' },
  { fg: '--on-bear', bg: '--bear', label: 'short button label' },
  { fg: '--on-danger', bg: '--danger', label: 'danger button label' },
  { fg: '--clay-ink', bg: '--clay-soft', label: 'active nav label' },
]

describe.each(['light', 'dark'] as const)('%s theme contrast', (mode) => {
  const tokens = themes[mode]

  it.each(pairs)('$label meets WCAG AA', ({ fg, bg, minimum }) => {
    const foreground = tokens[fg]
    const background = tokens[bg]
    expect(foreground, `${fg} missing in ${mode}`).toBeDefined()
    expect(background, `${bg} missing in ${mode}`).toBeDefined()
    // Resolve translucent fills (e.g. clay-soft) over the panel they sit on.
    const resolvedBackground = composite(background!, tokens['--surface-2']!)
    // Filled-button labels are large-ish UI text; still aim for 4.5:1 so the
    // contrast survives a projector and macOS subpixel rendering.
    const ratio = contrast(foreground!, resolvedBackground)
    expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimum ?? 4.5)
  })
})

describe('theme primitives', () => {
  it('declares both colour schemes so auto-dark leaves the page alone', () => {
    expect(css).toMatch(/color-scheme:\s*light dark/)
  })

  it('defines an explicit label colour for every filled accent', () => {
    for (const token of ['--on-clay', '--on-bull', '--on-bear', '--on-danger']) {
      expect(themes.light[token], `${token} light`).toBeDefined()
      expect(themes.dark[token], `${token} dark`).toBeDefined()
    }
  })

  it('keeps muted text readable in both modes', () => {
    expect(contrast(themes.light['--ink-3']!, themes.light['--surface-1']!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(themes.dark['--ink-3']!, themes.dark['--surface-1']!)).toBeGreaterThanOrEqual(4.5)
  })
})
