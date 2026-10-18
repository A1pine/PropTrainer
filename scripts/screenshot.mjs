/**
 * Visual QA helper: capture key routes at desktop and mobile widths.
 * Usage: bun scripts/screenshot.mjs [route ...]
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.BASE_URL ?? 'http://localhost:3000'
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['/', '/trainer', '/drill', '/stats']
const outDir = 'screenshots'

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ deviceScaleFactor: 2 })

const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(error.message))

for (const viewport of viewports) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  for (const route of routes) {
    const name = route === '/' ? 'lobby' : route.replaceAll('/', '')
    await page.goto(`${base}${route}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${outDir}/${name}-${viewport.name}.png`, fullPage: viewport.name === 'desktop' })
    console.log(`captured ${name}-${viewport.name}.png`)
  }
}

if (errors.length) {
  console.error('Console errors:')
  errors.forEach((error) => console.error('-', error))
}

await browser.close()
