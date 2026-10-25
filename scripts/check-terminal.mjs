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
  window.__terminalFrames = new WeakMap()
  const clear = CanvasRenderingContext2D.prototype.clearRect
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    window.__terminalFrames.set(this.canvas, [])
    return clear.apply(this, args)
  }
  const original = CanvasRenderingContext2D.prototype.fillText
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
    labels.push(String(text))
    if (labels.length > 400) labels.splice(0, 200)
    const frame = window.__terminalFrames.get(this.canvas) ?? []
    frame.push({ text: String(text), x, y })
    window.__terminalFrames.set(this.canvas, frame)
    return original.call(this, text, x, y, ...rest)
  }
})

async function waitForDesk(target) {
  await target.waitForFunction(() => {
    const store = document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get('terminal')
    return store?.ready && store.canTrade
  })
  await target.waitForSelector('canvas')
  await frames(target)
}

async function frames(target = page) {
  await target.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function state(target = page) {
  return target.evaluate(() => {
    const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('terminal')
    return {
      cursor: store.cursor,
      symbol: store.symbol,
      snapshot: JSON.parse(JSON.stringify(store.snapshot)),
      runId: store.run.id,
    }
  })
}

async function waitForSave(target = page) {
  await target.waitForFunction(
    () =>
      document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get('terminal')
        ?.storageStatus === 'saved',
  )
}

await page.goto(`${BASE}/terminal`, { waitUntil: 'networkidle' })
await waitForDesk(page)

check((await page.locator('canvas').count()) === 1, 'terminal renders one chart canvas')
check(await page.getByTestId('positions-table').isVisible(), 'positions panel is visible')
const flat = await page.getByTestId('positions-table').innerText()
check(/Flat/.test(flat), `starts flat, got: ${flat.slice(0, 60)}`)
check(
  await page.getByTestId('account-details').isVisible(),
  'account details show realized/open P&L, margin and buying power',
)
check((await page.getByTestId('watchlist-volume').count()) === 8, 'every watchlist row has a base-bar volume')
check(
  (await page.getByTestId('watchlist-volume').allTextContents()).every((text) => /\d/.test(text)),
  'revealed quote volumes are numeric, not placeholders',
)
await waitForSave()
const displayBaseline = await state()
await page.getByTestId('timeframe-custom-input').fill('1')
await page.getByTestId('timeframe-custom-apply').click()
check(
  await page.getByTestId('timeframe-custom-error').isVisible(),
  'finer-than-base custom timeframe is rejected visibly',
)
await page.getByTestId('timeframe-custom-input').fill('45')
await page.getByTestId('timeframe-custom-apply').click()
await page.getByTestId('timeframe-custom-active').waitFor()
check(
  (await page.getByTestId('timeframe-custom-active').textContent()).trim() === '45M',
  'custom 45-minute timeframe is usable',
)
check(
  JSON.stringify((await state()).snapshot) === JSON.stringify(displayBaseline.snapshot),
  'custom timeframe does not mutate accounting or clock',
)

await page.getByTestId('timeframe-5m').click()
const ta = page.getByTestId('analysis-toggle').first()
check((await ta.getAttribute('aria-pressed')) === 'false', 'terminal studies start off')
await ta.click()
await page.locator('[data-status="ready"]').first().waitFor()
await page.getByTestId('analysis-settings-toggle').first().click()
const settings = page.getByTestId('analysis-settings').first()
await settings.waitFor()
check(
  (await settings.locator('[data-testid^="analysis-framework-"]').count()) === 4,
  'four independent study frameworks are available on terminal charts',
)
await page.getByTestId('analysis-framework-ict').first().click()
check(
  (await page.getByTestId('analysis-framework-ict').first().getAttribute('aria-pressed')) === 'false',
  'terminal ICT framework toggles independently',
)
await page.keyboard.press('Escape')
await ta.click()
check(
  JSON.stringify((await state()).snapshot) === JSON.stringify(displayBaseline.snapshot),
  'studies never mutate the replay or account',
)

// Drawings must not change the ticket draft or create an order.
const canvas = page.locator('canvas').first()
await canvas.scrollIntoViewIfNeeded()
await page.getByTestId('chart-tool-horizontal').first().click()
const beforeDraw = await state()
const draftBeforeDraw = await page
  .getByTestId('order-ticket')
  .first()
  .getByRole('combobox', { name: 'Type', exact: true })
  .innerText()
const canvasBox = await canvas.boundingBox()
await page.mouse.move(canvasBox.x + canvasBox.width * 0.4, canvasBox.y + canvasBox.height * 0.4)
await page.mouse.down()
await page.mouse.move(canvasBox.x + canvasBox.width * 0.6, canvasBox.y + canvasBox.height * 0.4, { steps: 6 })
await page.mouse.up()
await frames()
check(await page.getByTestId('chart-clear-drawings').first().isEnabled(), 'horizontal drawing is added to the chart')
check(
  JSON.stringify((await state()).snapshot) === JSON.stringify(beforeDraw.snapshot),
  'drawing cannot place or amend orders',
)
check(
  (await page.getByTestId('order-ticket').first().getByRole('combobox', { name: 'Type', exact: true }).innerText()) ===
    draftBeforeDraw,
  'drawing does not prefill an order ticket',
)
await page.getByTestId('chart-tool-cursor').first().click()
await page.getByTestId('chart-clear-drawings').first().click()
check(await page.getByTestId('chart-clear-drawings').first().isDisabled(), 'clear drawings removes the drawing')

// A real ticket-created resting order is amended and cancelled using its canvas
// geometry (observed fillText coordinates), not by directly calling store actions.
await page.getByTestId('order-ticket').first().getByRole('combobox', { name: 'Type', exact: true }).click()
await page.getByRole('option', { name: 'Limit', exact: true }).click()
await page.getByTestId('ticket-submit').first().click()
await page.waitForFunction(
  () =>
    document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('terminal').workingOrders
      .length === 1,
)
await frames()
const resting = (await state()).snapshot.orders.find((order) => order.status === 'working')
const orderTag = await canvas.evaluate((node) =>
  window.__terminalFrames.get(node)?.find((label) => /^Buy\b/.test(label.text)),
)
check(!!orderTag, 'resting limit has a visible order tag on the canvas')
if (orderTag) {
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + 80, box.y + orderTag.y)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + orderTag.y + 18, { steps: 8 })
  await page.mouse.up()
  await frames()
  const modified = (await state()).snapshot.orders.find((order) => order.id === resting.id)
  check(
    modified?.status === 'working' && modified.limitPrice !== resting.limitPrice,
    'dragging the order line amends the existing order price',
  )
  const movedTag = await canvas.evaluate((node) =>
    window.__terminalFrames.get(node)?.find((label) => /^Buy\b/.test(label.text)),
  )
  if (movedTag) {
    await canvas.click({ position: { x: movedTag.x - 14, y: movedTag.y } })
    await frames()
  }
  check(
    (await state()).snapshot.orders.find((order) => order.id === resting.id)?.status === 'cancelled',
    'canvas X cancels the working order',
  )
}
await page.getByTestId('ticket-reset').first().click()

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
await layoutGroup.locator('button[aria-pressed]').nth(2).click()
await frames()
for (const pane of await page.locator('[data-pane]').all()) {
  await pane.getByTestId('analysis-toggle').click()
  await pane.getByTestId('analysis-settings-toggle').click()
  const panel = pane.getByTestId('analysis-settings')
  check(await panel.isVisible(), 'analysis settings remain clickable in each narrow pane')
  const bounds = await panel.boundingBox()
  check(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1440, 'narrow-pane study panel stays inside the viewport')
  await page.keyboard.press('Escape')
  await pane.getByTestId('analysis-toggle').click()
}
check(
  await page.locator('[data-pane]').evaluateAll((panes) =>
    panes.every((pane) => {
      const root = pane.getBoundingClientRect()
      const gear = pane.querySelector('[data-testid="analysis-settings-toggle"]').getBoundingClientRect()
      return gear.x >= root.x && gear.right <= root.right
    }),
  ),
  'study controls do not overlap adjacent charts',
)
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
// The ticket must follow the surviving pane instead of pointing at the closed
// chart's instrument.
const ticketSymbol = (await page.getByTestId('ticket-symbol').first().innerText()).trim()
const paneSymbol = await page.evaluate(() => document.querySelector('[data-pane]')?.getAttribute('data-symbol') ?? '')
check(
  !paneSymbol || ticketSymbol.includes(paneSymbol),
  `ticket follows the surviving pane (${paneSymbol} vs ${ticketSymbol})`,
)

// Hotkeys: defaults, remapping, persistence and the typing guard.
const activeTestId = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)
// Hotkeys ship disabled, exactly like the platform we model; the trader has to
// opt in before any letter can reach the desk.
await page.getByTestId('hotkeys-toggle').click()
await page.getByTestId('hotkeys-panel').waitFor()
check(!(await page.getByTestId('hotkeys-enabled').isChecked()), 'hotkeys start disabled')
await page.getByTestId('hotkeys-enabled').check()
await page.getByTestId('hotkeys-close').click()
await page.waitForTimeout(150)
await page.keyboard.press('b')
await page.waitForTimeout(200)
check((await activeTestId()) === 'ticket-long', `B focuses the buy side, got ${await activeTestId()}`)

const replayBeforeTyping = await page.locator('[data-testid="replay-index"]').innerText()
await page.locator('[data-testid="ticket-qty"]:visible').first().click()
await page.keyboard.press('n')
await page.waitForTimeout(250)
const replayAfterTyping = await page.locator('[data-testid="replay-index"]').innerText()
check(replayBeforeTyping === replayAfterTyping, 'typing in the ticket never steps the replay')

await page.getByTestId('hotkeys-toggle').click()
await page.getByTestId('hotkeys-panel').waitFor()
await page.locator('[data-action="buy"]').click()
await page.keyboard.press('q')
await page.waitForTimeout(200)
check((await page.locator('[data-action="buy"]').innerText()).trim() === 'Q', 'rebinding buy to Q updates the table')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
await page.keyboard.press('q')
await page.waitForTimeout(200)
check((await activeTestId()) === 'ticket-long', 'the remapped hotkey opens the buy side')
await page.keyboard.press('Escape')
// Blur the ticket first: otherwise focus simply stays where it already was and
// the assertion cannot tell a fired shortcut from an unchanged focus.
await page.locator('[data-testid="replay-index"]').click()
await page.keyboard.press('b')
await page.waitForTimeout(200)
check((await activeTestId()) !== 'ticket-long', 'the old binding no longer fires after rebinding')

await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('canvas')
await page.waitForTimeout(1500)
await page.keyboard.press('q')
await page.waitForTimeout(250)
check((await activeTestId()) === 'ticket-long', 'remapped hotkey survives a reload')
await page.getByTestId('hotkeys-toggle').click()
await page.getByTestId('hotkeys-panel').waitFor()
await page.getByLabel('Reset to defaults').click()
await page.waitForTimeout(200)
check((await page.locator('[data-action="buy"]').innerText()).trim() === 'B', 'reset restores the default binding')
await page.getByTestId('hotkeys-close').click()

// Exit all must act on the whole account, including the original symbol whose
// pane was closed above. A rejected confirmation must be harmless.
const beforeExit = await state()
page.once('dialog', (dialog) => dialog.dismiss())
await page.getByTestId('exit-all').click()
check(
  JSON.stringify((await state()).snapshot) === JSON.stringify(beforeExit.snapshot),
  'declining Exit all preserves the account',
)
page.once('dialog', (dialog) => dialog.accept())
await page.getByTestId('exit-all').click()
await frames()
const afterExit = await state()
check(afterExit.snapshot.positions.length === 0, 'confirmed Exit all closes every instrument position')
check(
  !afterExit.snapshot.orders.some((order) => ['working', 'suspended'].includes(order.status)),
  'Exit all cancels remaining working orders',
)
await waitForSave()

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check(overflow <= 0, `no horizontal overflow at 1440, got ${overflow}`)

await page.screenshot({ path: 'screenshots/terminal-check-1440.png' })

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
mobile.on('pageerror', (error) => errors.push(String(error)))
await mobile.goto(`${BASE}/terminal`, { waitUntil: 'networkidle' })
await waitForDesk(mobile)
const mobileTA = mobile.getByTestId('analysis-toggle').first()
await mobileTA.click()
await mobile.waitForFunction(() => document.querySelector('[data-status="ready"]'))
await mobile.getByTestId('analysis-settings-toggle').first().click()
const mobileStudies = await mobile.getByTestId('analysis-settings').first().boundingBox()
check(
  mobileStudies && mobileStudies.x >= 0 && mobileStudies.x + mobileStudies.width <= 390,
  'mobile studies settings stay within the viewport',
)
await mobile.keyboard.press('Escape')
await mobileTA.click()
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

// Corrupt only this isolated browser context's checkpoint. A failed restore must
// surface an explicit recovery path, never silently overwrite the saved attempt.
await page.evaluate(async () => {
  const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('terminal')
  await store.flush()
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('propdesk-replay-v1', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('replay', 'readwrite')
      const rows = tx.objectStore('replay')
      const active = rows.get('active')
      active.onsuccess = () => {
        const checkpoint = rows.get(`checkpoint:${active.result}`)
        checkpoint.onsuccess = () =>
          rows.put({ ...checkpoint.result, runId: 'invalid-run-id' }, `checkpoint:${active.result}`)
      }
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })
})
await page.reload({ waitUntil: 'networkidle' })
await page.getByTestId('storage-warning').waitFor()
check(
  await page.getByTestId('storage-warning').getByRole('button', { name: 'Retry', exact: true }).isVisible(),
  'failed restore displays an explicit Retry action',
)
await page.getByTestId('storage-warning').getByRole('button', { name: 'Retry', exact: true }).click()
await page.waitForFunction(() => {
  const store = document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get('terminal')
  return store?.restoreBlocked && !store.loading
})
check(await page.getByTestId('storage-warning').isVisible(), 'retry cannot silently replace a corrupt saved account')
const blockedState = await page.evaluate(() => {
  const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('terminal')
  return !store.ready && !store.canTrade && !store.submit({ side: 'long', type: 'market', qty: 1 }).ok
})
check(
  blockedState && (await page.getByTestId('ticket-submit').count()) === 0,
  'restore-blocked account has no ticket and rejects order submission',
)

check(errors.length === 0, `no console errors, got: ${errors.slice(0, 3).join(' | ')}`)

await browser.close()

if (failures.length) {
  console.error(`Terminal check failed (${failures.length}/${checks}):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`Terminal check passed (${checks} checks).`)
