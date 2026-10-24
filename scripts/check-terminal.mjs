import { chromium } from 'playwright'

/**
 * End-to-end replay-terminal check.
 *
 * Exercises the parts that unit tests cannot prove in a real browser: the page
 * boots on a replay tape, a market order opens a position, the replay clock
 * advances it, the breach line is drawn only when a position exists, timeframe
 * switches do not move the clock, and the layout does not overflow.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const browser = await chromium.launch({ channel: 'chrome' })
const failures = []
let checks = 0

function check(condition, message) {
  checks += 1
  if (!condition) failures.push(message)
}

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(String(error)))

// Record every text drawn into the chart canvas so marker/level assertions
// observe the real pixels instead of guessing from DOM state.
await page.addInitScript(() => {
  const labels = []
  window.__terminalLabels = labels
  const original = CanvasRenderingContext2D.prototype.fillText
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    labels.push(String(text))
    if (labels.length > 400) labels.splice(0, 200)
    return original.call(this, text, ...rest)
  }
})

await page.goto(`${BASE}/terminal`, { waitUntil: 'networkidle' })
await page.waitForSelector('canvas')
await page.waitForTimeout(1600)

check((await page.locator('canvas').count()) === 1, 'terminal renders one chart canvas')
check(await page.getByTestId('positions-table').isVisible(), 'positions panel is visible')
const flat = await page.getByTestId('positions-table').innerText()
check(/Flat/.test(flat), `starts flat, got: ${flat.slice(0, 60)}`)

// Step before trading so the replay clock is unambiguous.
const step = page.getByRole('button', { name: /Step one bar/i }).first()
await step.click()
await page.waitForTimeout(300)

const submit = page.getByTestId('ticket-submit').first()
await submit.click()
await page.waitForTimeout(600)
const afterBuy = await page.getByTestId('positions-table').innerText()
check(/Long|Short/.test(afterBuy), `market order opens a position, got: ${afterBuy.slice(0, 80)}`)

// A $50k account on MNQ puts the breach price thousands of points away, so the
// chart correctly refuses to draw an off-scale line. The position card must
// still state the number instead of inventing a line near the price.
const breachValue = await page.evaluate(() => {
  const match = document.body.innerText.match(/BREACH PRICE\s*([\d,.]+)/i)
  return match ? match[1] : null
})
check(breachValue != null, 'breach price is stated while a position is open')
const labelsAfterBuy = await page.evaluate(() => window.__terminalLabels.slice(-200))
check(!labelsAfterBuy.some((label) => /Breach price/.test(label)), 'off-scale breach line is not drawn on the chart')

for (let index = 0; index < 3; index += 1) {
  await step.click()
  await page.waitForTimeout(150)
}
await page.waitForTimeout(300)
const afterSteps = await page.getByTestId('positions-table').innerText()
check(/Open P&L/.test(afterSteps), 'open P&L is shown after stepping')

const mark = await page
  .locator('[data-testid="replay-index"]')
  .innerText()
  .catch(() => null)
await page.getByRole('button', { name: '5M', exact: true }).click()
await page.waitForTimeout(400)
const afterFrame = await page
  .locator('[data-testid="replay-index"]')
  .innerText()
  .catch(() => null)
if (mark && afterFrame) check(mark === afterFrame, `timeframe switch keeps the clock (${mark} -> ${afterFrame})`)

// Chart styles are a display-only switch: the clock, positions and orders must
// survive it, and the canvas must keep rendering instead of blanking.
const styleTrigger = page.locator('[aria-label="Chart style"]').first()
check(await styleTrigger.isVisible(), 'chart style selector is visible')
await styleTrigger.click()
await page.waitForTimeout(150)
await page.getByRole('option', { name: 'Line' }).click()
await page.waitForTimeout(400)
const styleAfter = (await styleTrigger.innerText()).trim()
check(/Line/.test(styleAfter), `chart style switches to line, got: ${styleAfter}`)
const indexAfterStyle = await page
  .locator('[data-testid="replay-index"]')
  .innerText()
  .catch(() => null)
if (mark && indexAfterStyle) check(mark === indexAfterStyle, 'chart style change keeps the clock')

await page.getByRole('button', { name: 'History', exact: true }).first().click()
await page.waitForTimeout(300)
check(await page.getByTestId('terminal-history').isVisible(), 'history dock opens')

// Workspace layouts: panes share one replay clock, so switching layouts must
// never move the cursor or change the account.
const layoutGroup = page.locator('[role="group"][aria-label="Chart layout"]')
check(await layoutGroup.isVisible(), 'chart layout switch is visible')
const clockBeforeLayout = await page
  .locator('[data-testid="replay-index"]')
  .innerText()
  .catch(() => null)
await layoutGroup.locator('button[aria-pressed]').nth(1).click()
await page.waitForTimeout(900)
const paneState = await page.evaluate(() => ({
  panes: document.querySelectorAll('[data-pane]').length,
  canvases: document.querySelectorAll('canvas').length,
  active: document.querySelectorAll('[data-pane][data-active="true"]').length,
}))
check(
  paneState.panes === 2 && paneState.canvases === 2,
  `two panes render two charts, got ${JSON.stringify(paneState)}`,
)
check(paneState.active === 1, `exactly one pane is active, got ${paneState.active}`)
const clockAfterLayout = await page
  .locator('[data-testid="replay-index"]')
  .innerText()
  .catch(() => null)
if (clockBeforeLayout && clockAfterLayout) {
  check(
    clockBeforeLayout === clockAfterLayout,
    `layout change keeps the clock (${clockBeforeLayout} -> ${clockAfterLayout})`,
  )
}
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('canvas')
await page.waitForTimeout(1500)
const restored = await page.evaluate(() => document.querySelectorAll('[data-pane]').length)
check(restored === 2, `saved layout survives a reload, got ${restored}`)
await page.locator('[data-pane][data-active="true"] button[aria-label="Close pane"]').click()
await page.waitForTimeout(600)
const closed = await page.evaluate(() => document.querySelectorAll('[data-pane]').length)
check(closed === 1, `closing a pane returns to a single chart, got ${closed}`)

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check(overflow <= 0, `no horizontal overflow at 1440, got ${overflow}`)

await page.screenshot({ path: 'screenshots/terminal-check-1440.png' })

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
mobile.on('pageerror', (error) => errors.push(String(error)))
await mobile.goto(`${BASE}/terminal`, { waitUntil: 'networkidle' })
await mobile.waitForSelector('canvas')
await mobile.waitForTimeout(1500)
const mobileOverflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
)
check(mobileOverflow <= 0, `no horizontal overflow at 390, got ${mobileOverflow}`)
const buyBar = mobile.getByRole('button', { name: /Buy ·/ }).first()
check(await buyBar.isVisible(), 'mobile buy bar is visible')
await buyBar.click()
await mobile.waitForTimeout(300)
const mobileSubmit = mobile.locator('[data-testid="ticket-submit"]:visible').first()
check(await mobileSubmit.isVisible(), 'mobile ticket opens')
const submitBox = await mobileSubmit.boundingBox()
const tabbar = await mobile.evaluate(
  () => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mobile-tabbar')) || 64,
)
check(
  submitBox != null && submitBox.y + submitBox.height <= 844 - tabbar,
  `mobile submit sits above the tab bar, got bottom ${submitBox ? Math.round(submitBox.y + submitBox.height) : 'null'}`,
)
const sheet = await mobile.locator('[role="dialog"]').first().boundingBox()
check(
  sheet != null && sheet.x >= 0 && sheet.x + sheet.width <= 390,
  `mobile ticket stays inside the viewport, got ${sheet ? `${Math.round(sheet.x)}..${Math.round(sheet.x + sheet.width)}` : 'null'}`,
)
await mobile.screenshot({ path: 'screenshots/terminal-check-390.png' })

check(errors.length === 0, `no console errors, got: ${errors.slice(0, 3).join(' | ')}`)

await browser.close()

if (failures.length) {
  console.error(`Terminal check failed (${failures.length}/${checks}):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`Terminal check passed (${checks} checks).`)
