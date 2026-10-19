import { chromium } from 'playwright'

/**
 * End-to-end load timing for the wasm core in a real browser.
 * Measures transfer, compile/instantiate and time-to-report on a cold cache.
 */
const base = process.env.BASE_URL ?? 'http://localhost:3000'
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${base}/analysis`, { waitUntil: 'domcontentloaded' })

const navigation = await page.evaluate(() => {
  const entry = performance.getEntriesByType('navigation')[0]
  return { domContentLoaded: Math.round(entry.domContentLoadedEventEnd), load: Math.round(entry.loadEventEnd) }
})

await page.waitForSelector('text=Market structure', { timeout: 15000 })

const wasmEntry = await page.evaluate(() => {
  const all = performance.getEntriesByType('resource').map((item) => item.name)
  const entries = performance.getEntriesByType('resource').filter((item) => item.name.includes('prop_core'))
  if (!entries.length) return { missing: true, resources: all.slice(-12) }
  const entry = entries[entries.length - 1]
  return {
    transferSize: entry.transferSize,
    encodedBodySize: entry.encodedBodySize,
    decodedBodySize: entry.decodedBodySize,
    duration: Math.round(entry.duration),
    startTime: Math.round(entry.startTime),
  }
})

const reportReady = await page.evaluate(() => Math.round(performance.now()))

console.log('browser load timing')
console.log('-------------------')
console.log(`DOMContentLoaded ${navigation.domContentLoaded} ms`)
console.log(`load event       ${navigation.load} ms`)
if (wasmEntry) {
  console.log(
    `wasm fetch       ${wasmEntry.duration} ms · ${(wasmEntry.encodedBodySize / 1024).toFixed(1)} KiB encoded / ${(wasmEntry.decodedBodySize / 1024).toFixed(1)} KiB decoded · started at ${wasmEntry.startTime} ms`,
  )
}
console.log(`report visible   ${reportReady} ms`)
console.log(`\n${JSON.stringify({ navigation, wasmEntry, reportReady })}`)

await browser.close()
