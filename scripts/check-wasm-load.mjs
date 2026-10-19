import { chromium } from 'playwright'

const base = process.env.BASE_URL ?? 'http://localhost:3000'
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})

const wasmRequests = []
page.on('request', (request) => {
  if (request.url().includes('prop_core.wasm')) wasmRequests.push(request.url())
})

// 1. Trainer must be interactive before wasm is even requested.
await page.goto(`${base}/trainer`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('text=What is the market doing?', { timeout: 5000 })
console.log('ok   trainer interactive without waiting for wasm')

// 2. Idle warm-up should fetch the core exactly once.
await page.waitForTimeout(2500)
const afterWarmup = wasmRequests.length
console.log(`ok   idle warm-up fetched the core ${afterWarmup}×`)
if (afterWarmup > 1) throw new Error('duplicate wasm fetch during warm-up')

// 3. SPA navigation to the analysis lab must reuse the loaded module.
await page.getByRole('link', { name: 'Analysis' }).first().click()
await page.waitForSelector('text=Confluence', { timeout: 8000 })
await page.waitForSelector('text=Market structure', { timeout: 8000 })
console.log('ok   analysis renders the wasm report')
if (wasmRequests.length !== afterWarmup) {
  throw new Error(`analysis refetched the core (${wasmRequests.length} total)`)
}
console.log('ok   module reused across client navigation')

if (errors.length) {
  console.error(errors.slice(0, 5))
  process.exitCode = 1
}
await browser.close()
