import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.BASE_URL ?? 'http://localhost:3000'
const browser = await chromium.launch({ channel: 'chrome' })
const settings = {
  locale: 'en',
  theme: 'light',
  reduceMotion: true,
  sound: false,
  accountPreset: 'eval-50k',
  accountSize: 50000,
  riskPerTrade: 1,
  maxContracts: 5,
  feePerContract: 0,
  autoPlaySpeed: 1,
  instruments: ['MNQ'],
  dataSource: 'synthetic',
  showRMultiple: true,
  confirmBeforeSubmit: true,
}

const analysisLabel = /^(FVG|OB\b|BOS\b|CHoCH\b|SWEEP\b|POC\b|VAH\b|VAL\b|SSL\b|BSL\b|EQ\b|S ·|R ·)/

async function contextFor(viewport, mobile = false) {
  const context = await browser.newContext({
    viewport,
    colorScheme: 'light',
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
  })
  await context.addCookies([
    { name: 'propdesk-settings', value: encodeURIComponent(JSON.stringify(settings)), url: base },
  ])
  // Pin the scenario so the ICT/PA tags asserted below are deterministic.
  await context.addInitScript((seed) => {
    Object.defineProperty(crypto, 'randomUUID', { value: () => seed })
  }, '00000000-0000-4000-8000-000000000001')
  await context.addInitScript((settings) => {
    localStorage.setItem('propdesk.v1:settings', JSON.stringify(settings))
    window.__analysisLabels = []
    const clear = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      window.__analysisLabels = []
      return clear.apply(this, args)
    }
    const text = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      window.__analysisLabels.push(String(args[0]))
      return text.apply(this, args)
    }
  }, settings)
  return context
}

function watchErrors(page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

async function labels(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      ),
  )
  return page.evaluate(() => window.__analysisLabels.filter((text) => text.length > 0))
}

async function expectTags(page, pattern, present, message) {
  await labels(page)
  try {
    await page.waitForFunction(
      ({ source, present }) => {
        const regex = new RegExp(source)
        const matched = window.__analysisLabels.some((text) => regex.test(text))
        return present ? matched : !matched
      },
      { source: pattern.source, present },
      { timeout: 6000 },
    )
  } catch (cause) {
    throw new Error(`${message}: ${(await labels(page)).join(', ')}`, { cause })
  }
}

async function waitForExam(page, id) {
  await page.waitForFunction((id) => {
    const store = document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get(id)
    return store?.scenario && store.visibleCount > 0 && ['judging', 'reading'].includes(store.phase)
  }, id)
}

async function examState(page, id) {
  return page.evaluate((id) => {
    const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get(id)
    return {
      count: store.visibleCount,
      phase: store.phase,
      state: store.plan.state,
      direction: store.plan.direction,
      playing: store.playing ?? false,
    }
  }, id)
}

async function checkKeyboardIsolation(page, id) {
  const before = await examState(page, id)
  const toggle = page.getByTestId('analysis-toggle')
  const wasEnabled = (await toggle.getAttribute('aria-pressed')) === 'true'
  await toggle.focus()
  await page.keyboard.press('Space')
  assert.equal(await toggle.getAttribute('aria-pressed'), String(!wasEnabled), 'Space activates the TA toggle')
  assert.deepEqual(await examState(page, id), before, 'Space on TA must not advance the exam')
  await page.keyboard.press('Space')
  const trigger = page.getByTestId('analysis-settings-toggle')
  await trigger.focus()
  await page.keyboard.press('Space')
  await page.waitForSelector('[data-testid="analysis-settings"]')
  assert.ok(await page.getByTestId('analysis-settings').evaluate((node) => node.contains(document.activeElement)))
  assert.deepEqual(await examState(page, id), before, 'Space on settings must not advance the exam')
  const framework = page.getByTestId('analysis-framework-pa')
  await framework.focus()
  for (const key of ['1', '2', '3', '4', 'l', 's', 'n']) await page.keyboard.press(key)
  assert.deepEqual(await examState(page, id), before, 'Settings key presses must not change the answer or playback')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="analysis-settings"]', { state: 'detached' })
  assert.ok(await trigger.evaluate((node) => node === document.activeElement), 'Escape returns focus to settings')
}

const context = await contextFor({ width: 1440, height: 1000 })
const page = await context.newPage()
const errors = watchErrors(page)
await page.goto(base + '/trainer', { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="analysis-toggle"]')
await waitForExam(page, 'trainer')

// 1. Default off: no TA status, no analysis tags on the blind chart.
assert.equal(await page.getByTestId('analysis-toggle').getAttribute('aria-pressed'), 'false')
assert.equal(await page.locator('[data-status]').count(), 0)
const before = await labels(page)
assert.equal(
  before.some((text) => analysisLabel.test(text)),
  false,
  'analysis must be off by default',
)

// 2. Enable: WASM report arrives for the visible prefix, tags appear.
await page.getByTestId('analysis-toggle').click()
await page.waitForSelector('[data-status="ready"]', { timeout: 15000 })
await checkKeyboardIsolation(page, 'trainer')
await expectTags(page, /^(POC|VAH|VAL)\b/, true, 'flow profile appears once analysis is enabled')
await expectTags(page, /^(FVG|OB|BOS|CHoCH|SWEEP|SSL|BSL)\b/, true, 'ICT/PA tags appear once analysis is enabled')

// 3. Framework gates: ICT off removes ICT tags, keeps PA structure and flow.
await page.getByTestId('analysis-settings-toggle').click()
await page.waitForSelector('[data-testid="analysis-settings"]')
await page.getByTestId('analysis-framework-ict').click()
await page.keyboard.press('Escape')
await expectTags(page, /^(FVG|OB|SWEEP|SSL|BSL)\b/, false, 'ICT tags disappear when ICT is off')
await expectTags(page, /^(BOS|CHoCH|S ·|R ·)/, true, 'PA structure survives an ICT toggle')
await expectTags(page, /^(POC|VAH|VAL)\b/, true, 'flow profile survives an ICT toggle')

// 4. All frameworks off reports `empty`, clears the overlay, and keeps the toolbar usable.
await page.getByTestId('analysis-settings-toggle').click()
for (const key of ['pa', 'flow', 'indicators']) {
  await page.getByTestId(`analysis-framework-${key}`).click()
}
await page.keyboard.press('Escape')
await page.waitForSelector('[data-status="empty"]')
await expectTags(page, analysisLabel, false, 'no overlay when every framework is off')
assert.equal(await page.getByTestId('analysis-toggle').getAttribute('aria-pressed'), 'true')

// Restore all frameworks before the disable check so the next enable is ready.
await page.getByTestId('analysis-settings-toggle').click()
for (const key of ['pa', 'ict', 'flow', 'indicators']) {
  await page.getByTestId(`analysis-framework-${key}`).click()
}
await page.keyboard.press('Escape')
await page.waitForSelector('[data-status="ready"]')

// 5. Disabling TA removes the status and the overlay entirely.
await page.getByTestId('analysis-toggle').click()
await page.waitForSelector('[data-status]', { state: 'detached' })
await expectTags(page, analysisLabel, false, 'disabling TA clears the chart overlay')

// 6. Chart card keeps its stat strip at 1366x768 with the settings panel open.
await page.setViewportSize({ width: 1366, height: 768 })
await page.getByTestId('analysis-toggle').click()
await page.waitForSelector('[data-status="ready"]')
await page.getByTestId('analysis-settings-toggle').click()
const layout = await page.evaluate(() => {
  const section = document.querySelector('section')
  const stat = [...document.querySelectorAll('*')].find((node) => node.textContent?.trim() === 'Session P&L')
  const panel = document.querySelector('[data-testid="analysis-settings"]')
  return {
    section: section?.getBoundingClientRect().toJSON(),
    stat: stat?.getBoundingClientRect().toJSON(),
    panel: panel?.getBoundingClientRect().toJSON(),
  }
})
assert.ok(layout.section && layout.stat, 'chart card and stat strip must exist')
assert.ok(layout.stat.bottom <= layout.section.bottom + 0.5, `stat strip clipped: ${JSON.stringify(layout)}`)
assert.ok(layout.panel && layout.panel.left >= 0 && layout.panel.right <= 1366, 'panel stays in the viewport')
await page.keyboard.press('Escape')

// 7. Drill uses the same visible-prefix analysis.
await page.goto(base + '/drill', { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="analysis-toggle"]')
await waitForExam(page, 'drill')
await page.getByTestId('analysis-toggle').click()
await page.waitForSelector('[data-status="ready"]', { timeout: 15000 })
await expectTags(page, /^(POC|VAH|VAL)\b/, true, 'drill analysis uses the current visible bars')
await checkKeyboardIsolation(page, 'drill')
const visibleBeforeStep = await examState(page, 'drill')
await page.getByRole('button', { name: 'Advance one bar', exact: true }).click()
await page.waitForFunction(
  (before) => document.querySelector('[data-status="ready"]')?.textContent?.includes(`${before + 1} visible bars`),
  visibleBeforeStep.count,
)
assert.equal((await examState(page, 'drill')).count, visibleBeforeStep.count + 1)

for (const query of ['mode=daily', 'pk=1&player=1']) {
  await page.goto(`${base}/drill?seed=exam-analysis-modes&${query}`, { waitUntil: 'networkidle' })
  await waitForExam(page, 'drill')
  assert.equal(await page.getByTestId('analysis-toggle').getAttribute('aria-pressed'), 'false')
  await page.getByTestId('analysis-toggle').click()
  await page.waitForSelector('[data-status="ready"]', { timeout: 15000 })
  await checkKeyboardIsolation(page, 'drill')
}
await context.close()

// 8. Mobile sheet: opens inside the viewport, no horizontal overflow.
const mobile = await contextFor({ width: 390, height: 844 }, true)
const phone = await mobile.newPage()
const phoneErrors = watchErrors(phone)
await phone.goto(base + '/trainer', { waitUntil: 'networkidle' })
await phone.waitForSelector('[data-testid="analysis-toggle"]')
await waitForExam(phone, 'trainer')
await phone.getByTestId('analysis-toggle').click()
await phone.getByTestId('analysis-settings-toggle').click()
await phone.waitForSelector('[data-testid="analysis-settings"]')
const mobileLayout = await phone.evaluate(() => {
  const panel = document.querySelector('[data-testid="analysis-settings"]')
  return {
    panel: panel?.getBoundingClientRect().toJSON(),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }
})
assert.ok(mobileLayout.panel, 'mobile settings panel must open')
assert.ok(
  mobileLayout.panel.left >= 0 && mobileLayout.panel.right <= 390,
  `mobile panel off-screen: ${JSON.stringify(mobileLayout)}`,
)
assert.ok(mobileLayout.scrollWidth <= mobileLayout.clientWidth, 'mobile page must not scroll horizontally')
await mkdir('screenshots', { recursive: true })
await phone.screenshot({ path: 'screenshots/analysis-mobile.png' })
await mobile.close()

// 9. A failed WASM download leaves reading usable and Retry recovers in place.
const failure = await contextFor({ width: 1440, height: 1000 })
const blocked = await failure.newPage()
const failureErrors = watchErrors(blocked)
const wasmPattern = '**/wasm/prop_core.wasm*'
await blocked.route(wasmPattern, (route) =>
  route.fulfill({ status: 200, contentType: 'application/wasm', body: 'invalid wasm test fixture' }),
)
await blocked.goto(base + '/trainer', { waitUntil: 'networkidle' })
await waitForExam(blocked, 'trainer')
await blocked.getByTestId('analysis-toggle').click()
await blocked.waitForSelector('[data-status="unavailable"]')
await expectTags(blocked, analysisLabel, false, 'a failed core must not leave stale overlays')
const beforeFailureStep = await examState(blocked, 'trainer')
await blocked.getByRole('button', { name: 'Advance one bar', exact: true }).click()
assert.equal((await examState(blocked, 'trainer')).count, beforeFailureStep.count + 1)
await blocked.getByTestId('analysis-settings-toggle').click()
await blocked.unroute(wasmPattern)
await blocked.getByTestId('analysis-settings').getByRole('button', { name: 'Retry', exact: true }).click()
await blocked.waitForSelector('[data-status="ready"]', { timeout: 15000 })
await blocked.keyboard.press('Escape')
await blocked.getByRole('button', { name: /Commit read/ }).click()
assert.equal((await examState(blocked, 'trainer')).phase, 'planning')
await failure.close()

assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`)
assert.deepEqual(phoneErrors, [], `mobile page errors: ${phoneErrors.join(' | ')}`)
assert.deepEqual(failureErrors, [], `failure/retry errors: ${failureErrors.join(' | ')}`)
await browser.close()
console.log(
  'Exam analysis check passed: framework gates, keyboard isolation, visible-bar stepping, daily/PK, layout and WASM recovery.',
)
