import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.BASE_URL ?? 'http://localhost:3000'
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
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
await context.addCookies([
  { name: 'propdesk-settings', value: encodeURIComponent(JSON.stringify(settings)), url: base },
])
await context.addInitScript((settings) => {
  localStorage.setItem('propdesk.v1:settings', JSON.stringify(settings))
  // Observe the real canvas labels; do not replace the renderer or its data.
  window.__executionFrames = new WeakMap()
  const clear = CanvasRenderingContext2D.prototype.clearRect
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    window.__executionFrames.set(this.canvas, [])
    return clear.apply(this, args)
  }
  const text = CanvasRenderingContext2D.prototype.fillText
  CanvasRenderingContext2D.prototype.fillText = function (...args) {
    window.__executionFrames.get(this.canvas)?.push(args[0])
    return text.apply(this, args)
  }
}, settings)
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

async function waitPhase(store, phase) {
  await page.waitForFunction(
    ({ store, phase }) =>
      document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get(store)?.phase === phase,
    { store, phase },
  )
}

async function expectMarkers(present) {
  await page.waitForFunction((present) => {
    const labels = window.__executionFrames.get(document.querySelector('canvas')) ?? []
    const entry = labels.some((text) => text.includes('Entry fill'))
    const exit = labels.some((text) => text.includes('Exit fill'))
    return present ? entry && exit : !entry && !exit
  }, present)
}

async function expectPlanTagsHidden() {
  // The reveal repaints through requestAnimationFrame; sample a settled frame,
  // not the blind frame that may still be on screen when the phase flips.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      ),
  )
  const tags = await page.evaluate(() =>
    (window.__executionFrames.get(document.querySelector('canvas')) ?? []).filter((text) =>
      /^(ENTRY|STOP|TARGET)\b/.test(String(text)),
    ),
  )
  assert.deepEqual(tags, [], 'Plan level tags must stay off the review chart while fill labels are shown')
}

async function verifyRows(expected) {
  const rows = page.getByTestId('execution-row')
  assert.equal(await rows.count(), expected.length, 'Every completed trade must have a result row')
  for (const [index, trade] of expected.entries()) {
    const row = rows.nth(index)
    const price = (value) =>
      new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    assert.equal(await row.getByTestId('execution-entry-price').innerText(), price(trade.entryPrice))
    assert.equal(await row.getByTestId('execution-exit-price').innerText(), price(trade.exitPrice))
    assert.equal(await row.getByTestId('execution-entry').getAttribute('data-bar'), String(trade.entryBar))
    assert.equal(await row.getByTestId('execution-exit').getAttribute('data-bar'), String(trade.exitBar))
    assert.equal(
      await row.locator('time').nth(0).getAttribute('datetime'),
      new Date(trade.entryTime * 1000).toISOString(),
    )
    assert.equal(
      await row.locator('time').nth(1).getAttribute('datetime'),
      new Date(trade.exitTime * 1000).toISOString(),
    )
    await row.getByRole('button').click()
    await expectMarkers(true)
  }
}

async function drillCase(kind) {
  await page.goto(`${base}/drill?seed=executions-${kind}`, { waitUntil: 'networkidle' })
  await waitPhase('drill', 'reading')
  await expectMarkers(false)
  await page.getByRole('tab', { name: kind === 'same-bar-short' ? /^Short/ : /^Long/ }).click()
  await page.getByRole('button', { name: /Commit read/ }).click()
  const planned = await page.evaluate((kind) => {
    const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('drill')
    const tick = store.instrument.tickSize
    const first = store.candles[store.visibleCount]
    // Deterministic boundary fixtures set plans through the store; outcomes are
    // still produced by the real simulator when the UI submits the plan.
    const entry =
      kind === 'no-fill'
        ? Math.min(...store.candles.slice(store.visibleCount).map((bar) => bar.low)) - tick * 4
        : first.open + (kind === 'same-bar-short' ? -2 : 4) * tick
    const stop = kind === 'same-bar-short' ? first.open : Math.min(first.low, entry) - tick * 8
    const target = kind === 'same-bar-short' ? entry - tick * 8 : entry + Math.abs(entry - stop) * 2
    store.updatePlan({ entry, stop, target })
    return entry
  }, kind)
  assert.equal(await page.getByTestId('execution-summary').count(), 0, 'No result detail before reveal')
  await page.getByRole('button', { name: /Place bracket/ }).click()
  await waitPhase('drill', 'review')
  await expectPlanTagsHidden()
  const expected = await page.evaluate(() => {
    const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('drill')
    const outcome = store.outcome
    return outcome?.filled
      ? [{ ...outcome, entryTime: store.candles[outcome.entryBar].time, exitTime: store.candles[outcome.exitBar].time }]
      : []
  })
  await verifyRows(expected)
  if (kind === 'no-fill') {
    assert.equal(expected.length, 0)
    assert.match(await page.getByTestId('execution-summary').innerText(), /No completed trade/)
    await expectMarkers(false)
  } else {
    assert.equal(expected.length, 1)
    assert.notEqual(expected[0].entryPrice, planned, 'Fixture exercises a gap fill, not the planned entry price')
    if (kind === 'same-bar-short') {
      assert.equal(expected[0].entryBar, expected[0].exitBar)
      assert.equal(expected[0].entryPrice, expected[0].exitPrice)
    }
  }
  console.log(`ok   drill: ${kind} result and canvas agree with simulator fills`)
}

try {
  await drillCase('long')
  await mkdir('screenshots', { recursive: true })
  await page.screenshot({ path: 'screenshots/executions-light.png', fullPage: true })
  await drillCase('same-bar-short')
  await page.evaluate(() => {
    const pinia = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia
    pinia._s.get('settings').update({ theme: 'dark' })
  })
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await page.screenshot({ path: 'screenshots/executions-dark.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Locate trade 1 on chart' }).click()
  await page.screenshot({ path: 'screenshots/executions-mobile.png', fullPage: true })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'No mobile overflow',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await drillCase('no-fill')
  await page.getByRole('button', { name: 'New sample' }).click()
  await waitPhase('drill', 'reading')
  await expectMarkers(false)
  await page.getByRole('tab', { name: /No trade/ }).click()
  await page.getByRole('button', { name: /Commit read/ }).click()
  await page.getByRole('button', { name: /Confirm no trade/ }).click()
  await waitPhase('drill', 'review')
  await verifyRows([])
  await expectMarkers(false)
  console.log('ok   drill: next sample and no-trade result clear prior fills')

  await page.goto(`${base}/trainer`, { waitUntil: 'networkidle' })
  await waitPhase('trainer', 'judging')
  await page.getByRole('tab', { name: /^Long/ }).click()
  await page.getByRole('button', { name: /Commit read/ }).click()
  await page.getByRole('button', { name: /Place bracket/ }).click()
  const trades = await page.evaluate(() => {
    const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('trainer')
    store.stopPlayback()
    store.closePosition()
    const mark = store.lastPrice
    store.placeTicketOrder({ side: 'short', type: 'market', qty: 1, stopLoss: mark + 100, takeProfit: mark - 100 })
    store.closePosition()
    return store.account.trades.map((trade) => ({
      ...trade,
      entryTime: store.candles[trade.entryBar].time,
      exitTime: store.candles[trade.exitBar].time,
    }))
  })
  assert.equal(trades.length, 2, 'Fixture creates two real broker fills')
  await expectMarkers(false)
  assert.equal(await page.getByTestId('execution-summary').count(), 0, 'Completed trades remain masked before review')
  await page.getByRole('button', { name: /Finish round/ }).click()
  await waitPhase('trainer', 'review')
  await expectPlanTagsHidden()
  await verifyRows(trades)
  console.log('ok   trainer: every broker trade shown, including manual/same-bar exits; no blind markers')
  await page.getByRole('button', { name: /Next round/ }).click()
  await waitPhase('trainer', 'judging')
  await expectMarkers(false)
  assert.equal(await page.getByTestId('execution-summary').count(), 0)
  assert.deepEqual(errors, [], 'No browser errors')
  console.log('Execution result regression passed.')
} finally {
  await browser.close()
}
