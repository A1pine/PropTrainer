import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.BASE_URL ?? 'http://localhost:3000'
const browser = await chromium.launch({ channel: 'chrome' })
let releaseWasm
const held = new Promise((resolve) => {
  releaseWasm = resolve
})

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  const wasmRequests = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('request', (request) => {
    if (request.url().includes('prop_core.wasm')) wasmRequests.push(request.url())
  })
  await page.route('**/wasm/prop_core.wasm*', async (route) => {
    await held
    await route.continue()
  })
  const warmup = page.waitForRequest((request) => request.url().includes('prop_core.wasm'), { timeout: 10000 })

  // Hold the actual download: a heading alone does not prove a usable TS fallback.
  await page.goto(`${base}/trainer`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const store = document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get('trainer')
    return store?.phase === 'judging' && store.scenario && store.visibleCount > 0
  })
  const before = await page.evaluate(
    () => document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('trainer').visibleCount,
  )
  await page
    .getByRole('button', { name: /^Next bar/ })
    .first()
    .click()
  await page.waitForFunction(
    (before) =>
      document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('trainer').visibleCount ===
      before + 1,
    before,
  )
  console.log('ok   trainer starts and advances a bar while the WASM download is held')

  await warmup
  assert.equal(wasmRequests.length, 1, 'Idle warm-up must request the core exactly once')
  releaseWasm()
  console.log('ok   idle warm-up requested one core; releasing the download')

  // Navigation may share the in-flight warm-up or the completed instance; neither refetches.
  await page.getByRole('link', { name: 'Analysis', exact: true }).first().click()
  await page.waitForFunction(() => {
    const store = document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get('analysis')
    return store?.coreReady && store.report != null && !store.coreError
  })
  await page.waitForSelector('text=Market structure')
  assert.equal(wasmRequests.length, 1, 'Analysis must reuse the warm-up request/module')
  assert.deepEqual(errors, [], 'Browser errors during WASM load check')
  console.log('ok   analysis has a real report and reuses the core across navigation')

  const direct = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const directRequests = []
  direct.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  direct.on('request', (request) => {
    if (request.url().includes('prop_core.wasm')) directRequests.push(request.url())
  })
  const response = await direct.goto(`${base}/analysis`, { waitUntil: 'domcontentloaded' })
  const hasPreload = await direct.evaluate(
    (html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return [...doc.querySelectorAll('link[rel="preload"]')].some((link) =>
        link.getAttribute('href')?.includes('prop_core.wasm'),
      )
    },
    await response.text(),
  )
  assert(hasPreload, 'Direct analysis HTML must retain its early preload')
  await direct.waitForFunction(() => {
    const store = document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get('analysis')
    return store?.coreReady && store.report != null && !store.coreError
  })
  assert.equal(directRequests.length, 1, 'Direct analysis must reuse its preload')
  assert.deepEqual(errors, [], 'Browser errors during direct analysis load')
  console.log('ok   direct analysis retains its SSR preload and fetches the core once')
} finally {
  releaseWasm()
  await browser.close()
}
