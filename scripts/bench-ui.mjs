import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, arch } from 'node:os'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4173'
const samples = Number(process.env.PERF_SAMPLES ?? 40)
const coldSamples = Number(process.env.PERF_COLD_SAMPLES ?? 10)
const slowdown = Number(process.env.PERF_CPU_RATE ?? 1)
const sources = (process.env.PERF_SOURCES ?? 'synthetic,local').split(',')
const output = resolve(process.env.PERF_OUTPUT ?? 'profile_output/ui.json')
const check = process.argv.includes('--check')
const browser = await chromium.launch({ channel: 'chrome' })

function stats(values) {
  assert(values.length > 0, 'No measurements collected')
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (q) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)]
  return { n: values.length, p50: quantile(0.5), p95: quantile(0.95), max: sorted.at(-1), samples: values }
}

async function open(source) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  })
  const settings = {
    locale: 'en',
    theme: 'light',
    reduceMotion: false,
    sound: false,
    accountPreset: 'eval-50k',
    accountSize: 50000,
    riskPerTrade: 1,
    maxContracts: 5,
    feePerContract: 0,
    autoPlaySpeed: 2,
    instruments: ['MNQ'],
    dataSource: source,
    showRMultiple: true,
    confirmBeforeSubmit: true,
  }
  await context.addCookies([
    { name: 'propdesk-settings', value: encodeURIComponent(JSON.stringify(settings)), url: base },
  ])
  await context.addInitScript((settings) => {
    localStorage.setItem('propdesk.v1:settings', JSON.stringify(settings))
    const probe = (window.__perf = { frames: [], draws: 0, presented: [], longTasks: [], ready: null })
    new PerformanceObserver((list) => {
      probe.longTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })))
    }).observe({ type: 'longtask', buffered: true })
    const clear = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.isConnected) probe.draws += 1
      return clear.apply(this, args)
    }
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        const count = probe.draws
        const start = performance.now()
        callback(time)
        if (probe.draws > count) {
          probe.frames.push(performance.now() - start)
          probe.lastDraw = performance.now()
          const draws = probe.draws
          const route = location.pathname.endsWith('/analysis') ? 'analysis' : 'trainer'
          const store = document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get(route)
          const scenario = store?.scenario
          const visible = store?.visibleCount
          const report = route === 'analysis' ? store?.report : null
          raf(() => {
            const at = performance.now()
            probe.presented.push({ draws, scenario, visible, report, at })
            const step = [...document.querySelectorAll('button')].find((el) =>
              el.textContent.trim().startsWith('Next bar'),
            )
            if (
              probe.ready == null &&
              scenario &&
              scenario === store.scenario &&
              step &&
              !step.disabled &&
              (route === 'trainer' ? store.phase === 'judging' : report && report === store.report)
            )
              probe.ready = at
          })
        }
      })
  }, settings)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  if (slowdown !== 1) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown })
  }
  return { context, page, errors }
}

async function ready(page, route, source) {
  await page.goto(`${base}/${route}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__perf.ready != null)
  await page.waitForFunction(() => document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia)
  const state = await page.evaluate((route) => {
    const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get(route)
    const nav = performance.getEntriesByType('navigation')[0]
    return {
      ready: window.__perf.ready,
      source: store.scenario.source,
      navigation: { ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd },
      resources: performance
        .getEntriesByType('resource')
        .filter((e) => /wasm|data\/market/.test(e.name))
        .map((e) => ({
          name: new URL(e.name).pathname,
          ms: e.duration,
          encoded: e.encodedBodySize,
          decoded: e.decodedBodySize,
        })),
    }
  }, route)
  assert.equal(state.source, source, `Benchmark cannot silently use fallback data on ${route}`)
  return state
}

async function measure(page, route, action, count = samples) {
  return page.evaluate(
    async ({ route, action, count }) => {
      const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get(route)
      const results = []
      const cpu = []
      const raf = () => new Promise((resolve) => requestAnimationFrame(resolve))
      const button = (text) =>
        [...document.querySelectorAll('button')].find((el) => el.textContent.trim().startsWith(text))
      const canvas = document.querySelector('canvas')
      const bounds = canvas.getBoundingClientRect()
      for (let i = 0; i < count; i++) {
        await raf()
        const before = { visible: store.visibleCount, scenario: store.scenario, draws: window.__perf.draws }
        const started = performance.now()
        if (action.startsWith('pointer')) {
          canvas.dispatchEvent(
            new PointerEvent('pointermove', {
              clientX: bounds.left + 40 + (i % 20) * 15,
              clientY: bounds.top + 100 + (i % 10) * 3,
              bubbles: true,
            }),
          )
        } else if (action === 'step') {
          const el = button('Next bar')
          if (!el || el.disabled) throw new Error('Step button unavailable')
          el.click()
        } else if (action === 'step10') {
          for (let step = 0; step < 10; step++) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
          }
          if (store.visibleCount !== before.visible + 10) throw new Error('Expected ten replay bars')
        } else if (action === 'sample') {
          const el = button('New sample')
          if (!el || el.disabled) throw new Error('Sample button unavailable')
          el.click()
        }
        const syncMs = performance.now() - started
        let presented
        while (!presented) {
          await raf()
          if (performance.now() - started > 5000) throw new Error(`${action} failed to update`)
          presented = window.__perf.presented.find(
            (frame) =>
              frame.draws > before.draws &&
              (route !== 'analysis' || frame.report != null) &&
              (action === 'sample'
                ? frame.scenario !== before.scenario
                : action === 'step' || action === 'step10'
                  ? frame.visible > before.visible
                  : true),
          )
        }
        results.push(presented.at - started)
        window.__perf.presented.length = 0
        cpu.push(syncMs)
      }
      const frames = window.__perf.frames.splice(0)
      return { results, cpu, frames }
    },
    { route, action, count },
  )
}

const report = {
  environment: {
    timestamp: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    browser: browser.version(),
    base,
    viewport: '1440x1000',
    dpr: 2,
    slowdown,
    samples,
    coldSamples,
    method:
      'Production build. Fresh browser contexts for cold loads. Cold ready requires scenario, enabled Next bar, report for analysis, and chart draw. Full motion enabled. Event dispatch to frame after changed store + canvas draw; includes Vue updates and RAF scheduling, not OS input delivery or the 200ms decorative candle animation. Canvas CPU = duration of RAF callbacks containing canvas clears. Samples use normal app-generated seeds; no ignored seed query parameter.',
  },
  sources: {},
}
try {
  for (const source of sources) {
    const result = (report.sources[source] = { cold: {}, hot: {} })
    for (const route of ['trainer', 'analysis']) {
      const cold = []
      for (let i = 0; i < coldSamples; i++) {
        const { context, page, errors } = await open(source)
        try {
          cold.push(await ready(page, route, source))
          assert.deepEqual(errors, [])
        } finally {
          await context.close()
        }
      }
      result.cold[route] = { ...stats(cold.map((r) => r.ready)), details: cold }
      const { context, page, errors } = await open(source)
      try {
        await ready(page, route, source)
        // Let entry transitions and the idle WASM warm-up finish, outside measurements.
        await page.waitForTimeout(2800)
        await page.evaluate(() => {
          window.__perf.frames.length = 0
        })
        for (const action of route === 'trainer'
          ? ['pointer', 'step', 'step10']
          : ['pointer', 'step', 'sample', 'pointerRevealed']) {
          if (action === 'pointerRevealed') {
            await page.getByRole('button', { name: 'Reveal', exact: true }).click()
            await page.waitForTimeout(250)
            await page.evaluate(() => {
              window.__perf.frames.length = 0
            })
          }
          // Judging allows only a few wait bars; use a real pending order during playback.
          if (route === 'trainer' && action === 'step') {
            await page.getByRole('radio', { name: 'Uptrend', exact: true }).click()
            await page.getByRole('tab', { name: 'Long', exact: true }).click()
            await page
              .locator('#thesis')
              .fill('Performance benchmark: read structure and invalidate below the last swing.')
            await page.getByRole('button', { name: /Commit read/ }).click()
            await page.getByRole('button', { name: /Place bracket/ }).click()
            await page.getByRole('button', { name: 'Pause', exact: true }).click()
          }
          const measurement = await measure(page, route, action, action === 'step10' ? Math.min(samples, 12) : samples)
          result.hot[`${route}.${action}`] = {
            response: stats(measurement.results),
            handler: stats(measurement.cpu),
            chart: stats(measurement.frames),
          }
          console.log(source, route, action, 'P95', result.hot[`${route}.${action}`].response.p95.toFixed(2), 'ms')
        }
        assert.deepEqual(errors, [])
        result.hot[`${route}.longTasks`] = await page.evaluate(() => window.__perf.longTasks)
      } finally {
        await context.close()
      }
    }
  }
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  if (check) {
    for (const [source, result] of Object.entries(report.sources)) {
      for (const [route, timing] of Object.entries(result.cold))
        assert(timing.p95 <= 1000, `${source} ${route} cold P95 > 1000ms`)
      for (const [action, timing] of Object.entries(result.hot)) {
        if (!timing.response) continue
        assert(timing.response.p95 <= 50, `${source} ${action} response P95 > 50ms`)
        assert(timing.chart.p95 <= 16.7, `${source} ${action} chart P95 > 16.7ms`)
      }
    }
  }
  console.log(`Saved ${output}`)
} finally {
  await browser.close()
}
