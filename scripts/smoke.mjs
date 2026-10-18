/**
 * End-to-end smoke test against a running dev server.
 * Usage: `bun run dev` in another terminal, then `bun scripts/smoke.mjs`.
 */
import { chromium } from 'playwright'

const base = process.env.BASE_URL ?? 'http://localhost:3000'
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})

function check(condition, label) {
  if (!condition) throw new Error(`FAILED: ${label}`)
  console.log(`ok   ${label}`)
}

const thesis =
  'Higher lows above the opening range; I want the retest of the broken shelf with the trend, invalidation under the last swing low.'

async function playTrainerRound() {
  await page.goto(`${base}/trainer`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.getByRole('radio', { name: /Uptrend/ }).click()
  await page.getByRole('tab', { name: /^Long/ }).click()
  await page.locator('#thesis').fill(thesis)
  await page.getByRole('button', { name: /Commit read/ }).click()
  await page.waitForTimeout(400)
  check(await page.getByText('Place the invalidation before the entry.').isVisible(), 'trainer: plan step')
  await page.getByRole('button', { name: /Place bracket/ }).click()
  await page.waitForTimeout(1200)
  check(
    (await page
      .getByText('Trade ticket')
      .first()
      .isVisible()
      .catch(() => false)) ||
      (await page
        .getByText('OPEN')
        .first()
        .isVisible()
        .catch(() => false)),
    'trainer: live step',
  )
  await page
    .getByRole('button', { name: /Pause/ })
    .click()
    .catch(() => {})
  await page
    .getByRole('button', { name: /Finish round/ })
    .click()
    .catch(() => {})
  await page.waitForTimeout(700)
  check(await page.getByText('The tape is unblind.').isVisible(), 'trainer: review')
}

async function drillFlow() {
  await page.goto(`${base}/drill?seed=smoke-drill`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.getByRole('radio', { name: /Range/ }).click()
  await page.getByRole('tab', { name: /No trade/ }).click()
  await page
    .locator('#thesis')
    .fill('Two-sided tape with no clean sweep. Standing aside is the trade until the edge fails.')
  await page.getByRole('button', { name: /Commit read/ }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /Confirm no trade/ }).click()
  await page.waitForTimeout(600)
  check(await page.getByText('What the tape said.').isVisible(), 'drill: graded result')
}

async function dailyFlow() {
  await page.goto(`${base}/daily`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.getByRole('link', { name: /Play today/ }).click()
  await page.waitForTimeout(900)
  await page.getByRole('radio', { name: /Uptrend/ }).click()
  await page.getByRole('tab', { name: /^Long/ }).click()
  await page.locator('#thesis').fill(thesis)
  await page.getByRole('button', { name: /Commit read/ }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /Place bracket/ }).click()
  await page.waitForTimeout(500)
  await page.goto(`${base}/daily`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  check(await page.getByText('Your submission').isVisible(), 'daily: result unlocked')
  check(await page.getByText('Reference board').isVisible(), 'daily: reference board')
}

async function settingsFlow() {
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.getByRole('tab', { name: 'Dark' }).click()
  await page.waitForTimeout(300)
  check(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'settings: dark theme applied')
  await page.getByRole('tab', { name: 'Light' }).click()
  await page.waitForTimeout(300)
}

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  check(await page.getByRole('heading', { name: /Trade the chart/ }).isVisible(), 'lobby renders')
  await playTrainerRound()
  await drillFlow()
  await dailyFlow()
  await settingsFlow()
  if (errors.length) throw new Error(`Console errors:\n${errors.slice(0, 5).join('\n')}`)
  console.log('\nSmoke test passed with no console errors.')
} finally {
  await browser.close()
}
