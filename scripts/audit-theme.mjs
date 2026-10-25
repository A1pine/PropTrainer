import { chromium } from 'playwright'

/**
 * Contrast + theme audit.
 *
 * Walks representative text nodes on the main routes in light and dark mode,
 * resolves the nearest opaque background, and reports WCAG ratios. Also checks
 * that the html class, color-scheme, theme-color meta and the rail icon agree.
 *
 *   bun run audit:theme
 */
const base = process.env.BASE_URL ?? 'http://localhost:3000'
const routes = [
  '/',
  '/trainer',
  '/terminal',
  '/analysis',
  '/learn',
  '/learn/ict-2022-concept/workspace-guide',
  '/settings',
]
const browser = await chromium.launch({ channel: 'chrome' })

const failures = []

function luminance([r, g, b]) {
  const channel = (value) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function ratio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

async function audit(mode) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
  const page = await context.newPage()
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  await page.getByRole('tab', { name: mode === 'dark' ? 'Dark' : 'Light' }).click()
  await page.waitForTimeout(400)

  const shell = await page.evaluate(() => {
    const root = document.documentElement
    const meta = document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
    const sun = document.querySelector('aside .lucide-sun')
    const moon = document.querySelector('aside .lucide-moon')
    return {
      darkClass: root.classList.contains('dark'),
      colorScheme: getComputedStyle(root).colorScheme,
      themeColor: meta,
      sunVisible: sun ? getComputedStyle(sun).display !== 'none' : null,
      moonVisible: moon ? getComputedStyle(moon).display !== 'none' : null,
    }
  })
  const expectDark = mode === 'dark'
  if (shell.darkClass !== expectDark) failures.push(`${mode}: html.dark = ${shell.darkClass}`)
  // Both schemes are declared so browser auto-dark never force-inverts the
  // light theme; the resolved one is applied through tokens, not color-scheme.
  if (shell.colorScheme !== (expectDark ? 'dark' : 'light dark')) {
    failures.push(`${mode}: color-scheme = ${shell.colorScheme}`)
  }
  if (shell.sunVisible === shell.moonVisible) failures.push(`${mode}: sun/moon visibility not exclusive`)
  // The icon advertises the action: sun on a dark page, moon on a light page.
  if (expectDark && !shell.sunVisible) failures.push('dark: sun icon should offer the light theme')
  if (!expectDark && !shell.moonVisible) failures.push('light: moon icon should offer the dark theme')

  for (const route of routes) {
    await page.goto(base + route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(route === '/trainer' || route === '/terminal' ? 1500 : 500)
    const samples = await page.evaluate(() => {
      const parse = (value) => {
        const match = value.match(/rgba?\(([^)]+)\)/)
        if (!match) return null
        const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
        return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }
      }
      const lum = ([r, g, b]) => {
        const ch = (v) => {
          const x = v / 255
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
      }
      const backdrop = (element) => {
        let node = element
        while (node) {
          const style = getComputedStyle(node)
          const color = parse(style.backgroundColor)
          if (color && color.a > 0.85) return [color.r, color.g, color.b]
          node = node.parentElement
        }
        const body = parse(getComputedStyle(document.body).backgroundColor)
        return body ? [body.r, body.g, body.b] : [255, 255, 255]
      }
      const results = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const seen = new Set()
      while (walker.nextNode()) {
        const node = walker.currentNode
        const text = node.textContent?.trim()
        if (!text || text.length < 2) continue
        const element = node.parentElement
        if (!element || seen.has(element)) continue
        seen.add(element)
        const rect = element.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2) continue
        const style = getComputedStyle(element)
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.5) continue
        const color = parse(style.color)
        if (!color) continue
        const size = Number.parseFloat(style.fontSize)
        const weight = Number(style.fontWeight) || 400
        const large = size >= 24 || (size >= 18.66 && weight >= 700)
        const bg = backdrop(element)
        const value =
          Math.round(
            (() => {
              const [l1, l2] = [lum([color.r, color.g, color.b]), lum(bg)].sort((a, b) => b - a)
              return (l1 + 0.05) / (l2 + 0.05)
            })() * 100,
          ) / 100
        results.push({
          text: text.slice(0, 42),
          ratio: value,
          size,
          large,
          color: `rgb(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)})`,
          bg: `rgb(${bg.map((v) => Math.round(v)).join(',')})`,
          cls: element.className?.toString().slice(0, 90) ?? '',
        })
      }
      return results
    })

    const bad = samples.filter((sample) => sample.ratio < (sample.large ? 3 : 4.5))
    if (bad.length) {
      failures.push(`\n${mode} ${route}: ${bad.length}/${samples.length} text nodes below WCAG AA`)
      for (const sample of bad.slice(0, 8)) {
        failures.push(
          `   ${sample.ratio.toFixed(2)}:1  ${sample.size}px  "${sample.text}"  ${sample.color} on ${sample.bg}  ${sample.cls}`,
        )
      }
    } else {
      console.log(`ok   ${mode} ${route}: ${samples.length} text nodes pass`)
    }
  }
  await context.close()
}

await audit('light')
await audit('dark')
await browser.close()

if (failures.length) {
  console.error('\nTheme audit failures:')
  for (const failure of failures) console.error(failure)
  process.exitCode = 1
} else {
  console.log('\nTheme audit passed.')
}
