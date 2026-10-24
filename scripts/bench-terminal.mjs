import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, arch, release, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BASE_URL = (process.env.BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/+$/, '')
const ROUTE = `${BASE_URL}/terminal`
const CHECK = process.argv.includes('--check')
const VIEWPORT = { width: 1440, height: 1000 }
const DPR = 2

function intEnv(name, fallback, minimum = 1) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}, got ${JSON.stringify(raw)}`)
  }
  return value
}

const SAMPLES = intEnv('PERF_SAMPLES', intEnv('SAMPLES', 30))
const COLD_SAMPLES = intEnv('PERF_COLD_SAMPLES', intEnv('COLD_SAMPLES', 30))
const READY_TIMEOUT = intEnv('PERF_READY_TIMEOUT', 30_000, 1000)
const SAMPLE_TIMEOUT = intEnv('PERF_SAMPLE_TIMEOUT', 10_000, 1000)
const IDLE_TIMEOUT = intEnv('PERF_IDLE_TIMEOUT', 5_000, 1000)
const HEADLESS = process.env.HEADLESS !== '0'
const OUTPUT = resolve(ROOT, process.env.PERF_OUTPUT ?? 'profile_output/terminal-ui.json')
const SELECTORS = {
  step: '[data-testid="replay-bar"] > button:nth-child(2)',
  pane: '[data-pane]',
  layoutGroup: '[role="group"][aria-label="Chart layout"]',
  timeframe5m: '[data-testid="timeframe-5m"]',
  analysisToggle: '[data-testid="analysis-toggle"]',
  analysisReady: '[data-status="ready"]',
}
const SETTINGS = {
  locale: 'en',
  theme: 'light',
  reduceMotion: false,
  sound: false,
  accountPreset: 'eval-50k',
  accountSize: 50_000,
  riskPerTrade: 1,
  maxContracts: 5,
  feePerContract: 0,
  autoPlaySpeed: 2,
  instruments: ['MNQ'],
  dataSource: 'synthetic',
  showRMultiple: true,
  confirmBeforeSubmit: true,
}
const BUDGETS = {
  responseP95Ms: 50,
  chartCallbackCpuP95Ms: 16.7,
  coldP95Ms: 1500,
}

function stats(values) {
  assert(values.length > 0, 'No measurements collected')
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (q) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)]
  return { n: values.length, p50: quantile(0.5), p95: quantile(0.95), max: sorted.at(-1), samples: values }
}

function command(command, args) {
  try {
    return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch (error) {
    return `unavailable: ${error.message}`
  }
}

function gitInfo() {
  const status = command('git', ['status', '--porcelain=v1'])
  return {
    commit: command('git', ['rev-parse', 'HEAD']),
    shortCommit: command('git', ['rev-parse', '--short', 'HEAD']),
    branch: command('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    describe: command('git', ['describe', '--always', '--dirty']),
    dirty: !status.startsWith('unavailable:') && status.length > 0,
    changedFiles: status.startsWith('unavailable:') ? [] : status.split('\n').filter(Boolean),
  }
}

function hostIsLocal() {
  try {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(BASE_URL).hostname)
  } catch {
    return false
  }
}

const report = {
  schemaVersion: 1,
  kind: 'terminal-ui-benchmark',
  startedAt: new Date().toISOString(),
  environment: {
    baseURL: BASE_URL,
    route: ROUTE,
    buildMode: null,
    evidence: null,
    platform: platform(),
    osRelease: release(),
    arch: arch(),
    cpu: { model: cpus()[0]?.model ?? null, logicalCores: cpus().length },
    totalMemoryBytes: totalmem(),
    node: process.version,
    browser: null,
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    headless: HEADLESS,
    page: null,
  },
  git: gitInfo(),
  config: {
    samplesPerHotScenario: SAMPLES,
    coldSamples: COLD_SAMPLES,
    readyTimeoutMs: READY_TIMEOUT,
    sampleTimeoutMs: SAMPLE_TIMEOUT,
    idleTimeoutMs: IDLE_TIMEOUT,
    selectors: SELECTORS,
    settings: { ...SETTINGS },
    budgets: BUDGETS,
  },
  boundaries: {
    coldStart: 'page performance time origin (navigation start)',
    coldEnd:
      'first requestAnimationFrame poll tick that observes terminal.store.ready, loading=false, cursor>0, a non-null account, and every visible [data-pane] canvas last completed clearRect with lastDrawCursor equal to terminal.cursor',
    hotStart:
      'window capture-phase click timestamp for HTMLElement.click() on the real toolbar button inside a Playwright locator.evaluate() task',
    hotEnd:
      'start of the next requestAnimationFrame callback after the draw callback that cleared every visible [data-pane] canvas with terminal.cursor equal to the post-step/control target',
    syncWork:
      'timestamp immediately after HTMLElement.click() returns minus its window capture timestamp, in the same JavaScript task; includes synchronous event dispatch and handlers, excludes Vue render microtasks, browser/OS input delivery, and IndexedDB checkpoint drain',
    chartCallbackCpu:
      'sum of instrumented requestAnimationFrame callback durations that called CanvasRenderingContext2D.clearRect in the event window; excludes Vue render microtasks, WASM analysis computation outside those callbacks, paint, compositing, and GPU work',
    stepCursor: 'terminal.cursor after minus terminal.cursor before must equal exactly 1',
    account: 'terminal.account must remain non-null and startBalance must be unchanged',
  },
  method: {
    input:
      'programmatic DOM HTMLElement.click() on real toolbar buttons, via Playwright locator.evaluate(); no pointer/keyboard or OS-level input is claimed',
    settling:
      'each hot sample waits for a condition-based chart-idle check (three consecutive RAF polls with no new canvas draw) before the next sample; no fixed sleeps are used',
    staleDraws:
      'draw frames are eligible only if they started at or after the click event and report the target terminal.cursor after their callback; TA-on samples additionally require the draw-time analysis toggle to be enabled and status ready, so an old, pre-toggle chart draw cannot satisfy the measurement',
    coldData: 'fresh browser context per sample; synthetic settings cookie and localStorage; no private data',
    hotData:
      'one fresh browser context for all hot scenarios; synthetic settings cookie and localStorage; no private data',
    checkpoint:
      'cold readiness includes the app initial checkpoint because store.ready flips only after createCheckpoint resolves; hot step response does not await queueCheckpoint() (IndexedDB drain is excluded)',
    excluded: [
      'OS input delivery',
      'browser input queue latency before the DOM click event',
      'paint, compositing, and GPU work',
      'IndexedDB checkpoint drain during hot samples',
      'decorative candle entry animation after the presented frame',
    ],
  },
  cold: { samples: [], stats: null },
  hot: [],
  controls: [],
  longTasks: [],
  checks: null,
  finishedAt: null,
  durationMs: null,
}

let browser = null
const started = performance.now()

function attachErrors(page) {
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (error) => {
    pageErrors.push({ message: error.message, stack: error.stack ?? null })
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  return { pageErrors, consoleErrors }
}

function assertNoPageErrors(errors, label) {
  if (errors.pageErrors.length) {
    throw new Error(`${label}: page error(s): ${errors.pageErrors.map((entry) => entry.message).join(' | ')}`)
  }
}

async function addSyntheticSettings(context) {
  await context.addCookies([
    {
      name: 'propdesk-settings',
      value: encodeURIComponent(JSON.stringify(SETTINGS)),
      url: BASE_URL,
    },
  ])
  await context.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        // about:blank and opaque origins have no storage.
      }
    },
    { key: 'propdesk.v1:settings', value: JSON.stringify(SETTINGS) },
  )
}

async function openContext() {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    colorScheme: 'light',
    locale: 'en-US',
  })
  await addSyntheticSettings(context)
  await context.addInitScript(() => {
    const bench = (window.__bench = {
      createdAt: performance.now(),
      seq: 0,
      frames: [],
      presented: [],
      events: Object.create(null),
      pendingEventId: null,
      lastDrawAt: null,
      lastDrawCursor: null,
      drawsByCanvas: new WeakMap(),
      lastDrawAtByCanvas: new WeakMap(),
      lastDrawCursorByCanvas: new WeakMap(),
      canvasToken: new WeakMap(),
      tokenSeq: 0,
      wasm: { instantiateCalls: 0, errors: [] },
      longTasks: [],
      analysisReadyAt: null,
      idleProbeLastDraw: undefined,
      idleProbeFrames: 0,
    })

    const token = (canvas) => {
      let value = bench.canvasToken.get(canvas)
      if (!value) {
        value = `canvas-${++bench.tokenSeq}`
        bench.canvasToken.set(canvas, value)
      }
      return value
    }

    const readStore = () =>
      document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get('terminal') ?? null

    bench.token = token
    bench.readStore = readStore
    bench.drawState = () => {
      const store = readStore()
      return {
        cursor: store?.cursor ?? null,
        analysisEnabled:
          document
            .querySelector('[data-pane][data-active="true"] [data-testid="analysis-toggle"]')
            ?.getAttribute('aria-pressed') === 'true',
        analysisStatus:
          document.querySelector('[data-pane][data-active="true"] [data-status]')?.getAttribute('data-status') ?? null,
      }
    }
    bench.snapshot = (withGeometry = true) => {
      const store = readStore()
      const panes = [...document.querySelectorAll('[data-pane]')]
      const canvases = panes.flatMap((pane) => [...pane.querySelectorAll('canvas')])
      return {
        at: performance.now(),
        store: !!store,
        ready: !!store?.ready,
        loading: !!store?.loading,
        playing: !!store?.playing,
        ended: !!store?.ended,
        cursor: store?.cursor ?? null,
        timeframe: store?.timeframe ?? null,
        source: store?.source ?? null,
        paneCount: panes.length,
        activePaneCount: document.querySelectorAll('[data-pane][data-active="true"]').length,
        analysisEnabled:
          document
            .querySelector('[data-pane][data-active="true"] [data-testid="analysis-toggle"]')
            ?.getAttribute('aria-pressed') === 'true',
        analysisStatus:
          document.querySelector('[data-pane][data-active="true"] [data-status]')?.getAttribute('data-status') ?? null,
        account: store?.account
          ? {
              startBalance: store.account.startBalance,
              balance: store.account.balance,
              equity: store.account.equity,
              status: store.account.status,
            }
          : null,
        canvases: canvases.map((canvas) => {
          const entry = {
            token: token(canvas),
            width: canvas.width,
            height: canvas.height,
            lastDrawAt: bench.lastDrawAtByCanvas.get(canvas) ?? null,
            lastDrawCursor: bench.lastDrawCursorByCanvas.get(canvas) ?? null,
          }
          if (withGeometry) {
            const bounds = canvas.getBoundingClientRect()
            entry.cssWidth = Number(bounds.width.toFixed(2))
            entry.cssHeight = Number(bounds.height.toFixed(2))
          }
          return entry
        }),
      }
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          bench.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          })
        }
      }).observe({ type: 'longtask', buffered: true })
    } catch {
      // Long tasks are optional evidence.
    }

    const originalInstantiate = WebAssembly.instantiate
    try {
      WebAssembly.instantiate = function (...args) {
        bench.wasm.instantiateCalls += 1
        try {
          const result = originalInstantiate.apply(this, args)
          if (result && typeof result.then === 'function') {
            result.catch((error) => bench.wasm.errors.push(String(error)))
          }
          return result
        } catch (error) {
          bench.wasm.errors.push(String(error))
          throw error
        }
      }
    } catch (error) {
      bench.wasm.errors.push(`cannot instrument WebAssembly.instantiate: ${String(error)}`)
    }

    let currentFrame = null
    const originalClearRect = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      const frame = currentFrame
      const canvas = this.canvas
      const clearStarted = performance.now()
      try {
        return originalClearRect.apply(this, args)
      } finally {
        const clearEnded = performance.now()
        if (frame && canvas && canvas.isConnected) {
          frame.clearMs += clearEnded - clearStarted
          frame.canvases.add(canvas)
          bench.drawsByCanvas.set(canvas, (bench.drawsByCanvas.get(canvas) ?? 0) + 1)
        }
      }
    }

    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback) => {
      if (typeof callback !== 'function') return raf(callback)
      return raf((frameTime) => {
        const rec = {
          id: ++bench.seq,
          frameTime,
          startedAt: performance.now(),
          endedAt: null,
          durationMs: null,
          clearMs: 0,
          canvases: new Set(),
          tokens: [],
          cursor: null,
          analysisEnabled: null,
          analysisStatus: null,
          draws: 0,
          presentedAt: null,
          presentedFrameTime: null,
          error: null,
        }
        currentFrame = rec
        try {
          callback(frameTime)
        } catch (error) {
          rec.error = String(error)
          throw error
        } finally {
          rec.endedAt = performance.now()
          rec.durationMs = rec.endedAt - rec.startedAt
          currentFrame = null
          if (rec.canvases.size > 0) {
            const state = bench.drawState()
            rec.cursor = state.cursor
            rec.analysisEnabled = state.analysisEnabled
            rec.analysisStatus = state.analysisStatus
            rec.draws = rec.canvases.size
            rec.tokens = [...rec.canvases].map(token)
            bench.frames.push(rec)
            bench.lastDrawAt = rec.endedAt
            bench.lastDrawCursor = rec.cursor
            for (const canvas of rec.canvases) {
              bench.lastDrawAtByCanvas.set(canvas, rec.endedAt)
              bench.lastDrawCursorByCanvas.set(canvas, rec.cursor)
            }
            raf((nextFrameTime) => {
              rec.presentedAt = performance.now()
              rec.presentedFrameTime = nextFrameTime
              bench.presented.push(rec)
            })
          }
        }
      })
    }

    const startAnalysisObserver = () => {
      if (!document.documentElement) return false
      try {
        new MutationObserver(() => {
          if (bench.analysisReadyAt == null && document.querySelector('[data-status="ready"]')) {
            bench.analysisReadyAt = performance.now()
          }
        }).observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['data-status'],
        })
        return true
      } catch {
        return true
      }
    }
    if (!startAnalysisObserver()) {
      document.addEventListener('DOMContentLoaded', startAnalysisObserver, { once: true })
    }

    window.addEventListener(
      'click',
      (event) => {
        const id = bench.pendingEventId
        bench.pendingEventId = null
        const target = event.target instanceof Element ? event.target : null
        const control = target?.closest?.('button') ?? null
        const rec = {
          id,
          start: performance.now(),
          end: null,
          handlerMs: null,
          target: control
            ? {
                tag: control.tagName.toLowerCase(),
                testid: control.getAttribute('data-testid'),
                ariaLabel: control.getAttribute('aria-label'),
                text: (control.textContent ?? '').trim().slice(0, 40),
              }
            : null,
        }
        if (id != null) bench.events[id] = rec
      },
      true,
    )
  })
  return context
}

async function pageReadyValue(page, timeout = READY_TIMEOUT) {
  const handle = await page.waitForFunction(
    () => {
      const bench = window.__bench
      if (!bench) return false
      const state = bench.snapshot(false)
      if (!state.store || !state.ready || state.loading || !state.account || !(state.cursor > 0)) {
        return false
      }
      if (!state.canvases.length) return false
      if (!state.canvases.every((canvas) => canvas.lastDrawAt != null && canvas.lastDrawCursor === state.cursor)) {
        return false
      }
      return performance.now()
    },
    null,
    { timeout, polling: 'raf' },
  )
  return handle.jsonValue()
}

async function waitReady(page, label) {
  try {
    return await pageReadyValue(page)
  } catch (error) {
    throw new Error(`${label}: terminal did not become ready: ${error.message}`)
  }
}

async function snapshot(page) {
  return page.evaluate(() => window.__bench.snapshot())
}

async function waitIdle(page, label) {
  try {
    await page.evaluate(() => {
      window.__bench.idleProbeLastDraw = window.__bench.lastDrawAt
      window.__bench.idleProbeFrames = 0
    })
    await page.waitForFunction(
      () => {
        const bench = window.__bench
        if (!bench) return false
        const state = bench.snapshot(false)
        if (!state.store) return false
        if (bench.idleProbeLastDraw !== bench.lastDrawAt) {
          bench.idleProbeLastDraw = bench.lastDrawAt
          bench.idleProbeFrames = 0
          return false
        }
        bench.idleProbeFrames = (bench.idleProbeFrames ?? 0) + 1
        return bench.idleProbeFrames >= 3 && bench.lastDrawCursor === state.cursor
      },
      null,
      { timeout: IDLE_TIMEOUT, polling: 'raf' },
    )
  } catch (error) {
    throw new Error(`${label}: chart did not become idle: ${error.message}`)
  }
}

async function pauseIfPlaying(page) {
  const state = await snapshot(page)
  if (!state.playing) return false
  await page.locator('[data-testid="replay-bar"] > button:nth-child(1)').click({ timeout: SAMPLE_TIMEOUT })
  await page.waitForFunction(() => !window.__bench.snapshot(false).playing, null, {
    timeout: SAMPLE_TIMEOUT,
    polling: 'raf',
  })
  return true
}

function nextEventId() {
  report.__eventSeq = (report.__eventSeq ?? 0) + 1
  return report.__eventSeq
}

async function clickControl(locator, id) {
  await locator.evaluate(
    (button, eventId) => {
      if (!(button instanceof HTMLButtonElement) || !button.isConnected || button.disabled) {
        throw new Error('Benchmark control must be a connected, enabled button')
      }
      const bounds = button.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) throw new Error('Benchmark control is not visible')
      const bench = window.__bench
      bench.pendingEventId = eventId
      button.click()
      const endedAt = performance.now()
      const event = bench.events[eventId]
      if (!event) throw new Error(`Button did not dispatch click event ${eventId}`)
      event.end = endedAt
      event.handlerMs = endedAt - event.start
      event.handlerEndKind = 'dom-click-return'
    },
    id,
    { timeout: SAMPLE_TIMEOUT },
  )
}

async function readEvent(page, id) {
  await page.waitForFunction(
    (eventId) => {
      const event = window.__bench.events[eventId]
      return !!event && event.handlerMs != null
    },
    id,
    { timeout: SAMPLE_TIMEOUT, polling: 'raf' },
  )
  return page.evaluate((eventId) => window.__bench.events[eventId], id)
}

async function measureStep(page, label, expectedCursor, expectedAnalysis = false) {
  const before = await snapshot(page)
  if (!before.store || !before.ready) throw new Error(`${label}: terminal not ready before step`)
  if (before.playing) throw new Error(`${label}: terminal is playing before step; cursor cannot move exactly one`)
  if (!before.account) throw new Error(`${label}: terminal.account is null before step`)
  if (before.ended) throw new Error(`${label}: replay already ended before step`)
  const target = before.cursor + 1
  if (expectedCursor != null) {
    assert.equal(expectedCursor, target, `${label}: expected cursor does not match the next replay bar`)
  }
  const eventId = nextEventId()

  await clickControl(page.locator(SELECTORS.step), eventId)

  try {
    await page.waitForFunction(
      ({ id, targetCursor, expectedAnalysis: requireAnalysis }) => {
        const bench = window.__bench
        const event = bench.events[id]
        if (!event || event.handlerMs == null) return false
        const state = bench.snapshot(false)
        if (!state.store || !state.ready || state.cursor !== targetCursor) return false
        const visible = [...document.querySelectorAll('[data-pane] canvas')]
        if (!visible.length) return false
        const tokens = visible.map((canvas) => bench.token(canvas))
        const frames = bench.frames.filter(
          (frame) =>
            frame.startedAt >= event.start &&
            frame.cursor === targetCursor &&
            frame.draws > 0 &&
            frame.presentedAt != null &&
            (!requireAnalysis || (frame.analysisEnabled === true && frame.analysisStatus === 'ready')) &&
            frame.tokens.some((token) => tokens.includes(token)),
        )
        const covered = new Set()
        for (const frame of frames) {
          for (const token of frame.tokens) {
            if (tokens.includes(token)) covered.add(token)
          }
        }
        return tokens.every((token) => covered.has(token))
      },
      { id: eventId, targetCursor: target, expectedAnalysis },
      { timeout: SAMPLE_TIMEOUT, polling: 'raf' },
    )
  } catch (error) {
    throw new Error(`${label}: step did not present a complete chart frame: ${error.message}`)
  }

  await readEvent(page, eventId)
  const result = await page.evaluate(
    ({ id, targetCursor, expectedAnalysis: requireAnalysis }) => {
      const bench = window.__bench
      const event = bench.events[id]
      const state = bench.snapshot()
      const visible = [...document.querySelectorAll('[data-pane] canvas')]
      const tokens = visible.map((canvas) => bench.token(canvas))
      const frames = bench.frames.filter(
        (frame) =>
          frame.startedAt >= event.start &&
          frame.cursor === targetCursor &&
          frame.draws > 0 &&
          frame.presentedAt != null &&
          (!requireAnalysis || (frame.analysisEnabled === true && frame.analysisStatus === 'ready')) &&
          frame.tokens.some((token) => tokens.includes(token)),
      )
      const earliestByToken = new Map()
      for (const frame of frames) {
        for (const token of frame.tokens) {
          if (!tokens.includes(token)) continue
          const prior = earliestByToken.get(token)
          if (!prior || frame.presentedAt < prior.presentedAt) earliestByToken.set(token, frame)
        }
      }
      if (!tokens.every((token) => earliestByToken.has(token))) {
        throw new Error('visible pane has no presented draw for the target cursor')
      }
      const presentedAt = Math.max(...tokens.map((token) => earliestByToken.get(token).presentedAt))
      const drawFrames = frames.filter((frame) => frame.presentedAt <= presentedAt)
      return {
        state,
        event,
        presentedAt,
        responseMs: presentedAt - event.start,
        syncWorkMs: event.handlerMs,
        syncWorkEndKind: event.handlerEndKind ?? null,
        drawFrames: drawFrames.length,
        drawCanvasCount: tokens.length,
        drawCpuMs: drawFrames.reduce((sum, frame) => sum + frame.durationMs, 0),
        drawMaxCallbackMs: Math.max(...drawFrames.map((frame) => frame.durationMs)),
        drawClearMs: drawFrames.reduce((sum, frame) => sum + frame.clearMs, 0),
        frameIds: drawFrames.map((frame) => frame.id),
        drawCallbacks: drawFrames.map((frame) => ({
          id: frame.id,
          frameTime: frame.frameTime,
          startedAt: frame.startedAt,
          endedAt: frame.endedAt,
          durationMs: frame.durationMs,
          clearMs: frame.clearMs,
          canvasTokens: frame.tokens,
          cursor: frame.cursor,
          analysisEnabled: frame.analysisEnabled,
          analysisStatus: frame.analysisStatus,
          presentedAt: frame.presentedAt,
          presentedFrameTime: frame.presentedFrameTime,
          error: frame.error,
        })),
      }
    },
    { id: eventId, targetCursor: target, expectedAnalysis },
  )

  assert.equal(result.state.cursor, target, `${label}: cursor did not move exactly one`)
  assert.equal(result.state.analysisEnabled, expectedAnalysis, `${label}: TA state changed during step`)
  if (expectedAnalysis) {
    assert.equal(result.state.analysisStatus, 'ready', `${label}: TA was not ready on the presented chart`)
  }
  assert.ok(result.state.account, `${label}: terminal.account was lost`)
  assert.equal(result.state.account.startBalance, before.account.startBalance, `${label}: account startBalance changed`)
  assert.ok(Number.isFinite(result.responseMs) && result.responseMs >= 0, `${label}: invalid response`)
  assert.ok(Number.isFinite(result.drawCpuMs), `${label}: invalid draw CPU`)
  assert.ok(result.drawFrames > 0, `${label}: no chart callback captured`)
  assert.ok(result.drawMaxCallbackMs <= result.drawCpuMs + 0.001, `${label}: invalid draw callback total`)

  await waitIdle(page, label)
  return {
    index: null,
    eventId,
    responseMs: result.responseMs,
    syncWorkMs: result.syncWorkMs,
    syncWorkEndKind: result.syncWorkEndKind,
    drawCpuMs: result.drawCpuMs,
    drawMaxCallbackMs: result.drawMaxCallbackMs,
    drawClearMs: result.drawClearMs,
    drawFrames: result.drawFrames,
    drawCanvasCount: result.drawCanvasCount,
    cursorBefore: before.cursor,
    cursorAfter: result.state.cursor,
    accountBefore: before.account,
    accountAfter: result.state.account,
    paneCount: result.state.paneCount,
    timeframe: result.state.timeframe,
    analysisEnabled: result.state.analysisEnabled,
    analysisStatus: result.state.analysisStatus,
    eventStart: result.event.start,
    presentedAt: result.presentedAt,
    frameIds: result.frameIds,
    drawCallbacks: result.drawCallbacks,
  }
}

async function measureTransition(page, { id, kind, expected, action }) {
  const before = await snapshot(page)
  if (!before.store || !before.ready) throw new Error(`${id}: terminal not ready before control`)
  if (!before.account) throw new Error(`${id}: terminal.account is null before control`)
  const eventId = nextEventId()
  await action(eventId)

  try {
    await page.waitForFunction(
      ({ eventId, kind, expected }) => {
        const bench = window.__bench
        const event = bench.events[eventId]
        if (!event || event.handlerMs == null) return false
        const state = bench.snapshot(false)
        if (!state.store || !state.ready) return false
        if (kind === 'layout' && state.paneCount !== expected) return false
        if (kind === 'timeframe' && state.timeframe !== expected) return false
        if (kind === 'analysis') {
          if (!document.querySelector('[data-status="ready"]')) return false
          if (bench.wasm.instantiateCalls < 1) return false
          if (bench.analysisReadyAt == null) return false
        }
        const visible = [...document.querySelectorAll('[data-pane] canvas')]
        if (!visible.length) return false
        const tokens = visible.map((canvas) => bench.token(canvas))
        const coverageStart = kind === 'analysis' ? Math.max(event.start, bench.analysisReadyAt ?? 0) : event.start
        const frames = bench.frames.filter(
          (frame) =>
            frame.startedAt >= coverageStart &&
            frame.cursor === state.cursor &&
            frame.draws > 0 &&
            frame.presentedAt != null &&
            frame.tokens.some((token) => tokens.includes(token)),
        )
        const covered = new Set()
        for (const frame of frames) {
          for (const token of frame.tokens) {
            if (tokens.includes(token)) covered.add(token)
          }
        }
        return tokens.every((token) => covered.has(token))
      },
      { eventId, kind, expected },
      { timeout: SAMPLE_TIMEOUT, polling: 'raf' },
    )
  } catch (error) {
    throw new Error(`${id}: control did not present a complete chart frame: ${error.message}`)
  }

  await readEvent(page, eventId)
  const result = await page.evaluate(
    ({ eventId, kind, expected }) => {
      const bench = window.__bench
      const event = bench.events[eventId]
      const state = bench.snapshot()
      const visible = [...document.querySelectorAll('[data-pane] canvas')]
      const tokens = visible.map((canvas) => bench.token(canvas))
      const coverageStart = kind === 'analysis' ? Math.max(event.start, bench.analysisReadyAt ?? 0) : event.start
      const frames = bench.frames.filter(
        (frame) =>
          frame.startedAt >= coverageStart &&
          frame.cursor === state.cursor &&
          frame.draws > 0 &&
          frame.presentedAt != null &&
          frame.tokens.some((token) => tokens.includes(token)),
      )
      const earliestByToken = new Map()
      for (const frame of frames) {
        for (const token of frame.tokens) {
          if (!tokens.includes(token)) continue
          const prior = earliestByToken.get(token)
          if (!prior || frame.presentedAt < prior.presentedAt) earliestByToken.set(token, frame)
        }
      }
      if (!tokens.every((token) => earliestByToken.has(token))) {
        throw new Error('visible pane has no presented draw for the control state')
      }
      const presentedAt = Math.max(...tokens.map((token) => earliestByToken.get(token).presentedAt))
      const drawFrames = frames.filter((frame) => frame.presentedAt <= presentedAt)
      return {
        state,
        event,
        expected,
        kind,
        presentedAt,
        responseMs: presentedAt - event.start,
        syncWorkMs: event.handlerMs,
        syncWorkEndKind: event.handlerEndKind ?? null,
        drawFrames: drawFrames.length,
        drawCanvasCount: tokens.length,
        drawCpuMs: drawFrames.reduce((sum, frame) => sum + frame.durationMs, 0),
        drawMaxCallbackMs: Math.max(...drawFrames.map((frame) => frame.durationMs)),
        drawClearMs: drawFrames.reduce((sum, frame) => sum + frame.clearMs, 0),
        frameIds: drawFrames.map((frame) => frame.id),
        drawCallbacks: drawFrames.map((frame) => ({
          id: frame.id,
          frameTime: frame.frameTime,
          startedAt: frame.startedAt,
          endedAt: frame.endedAt,
          durationMs: frame.durationMs,
          clearMs: frame.clearMs,
          canvasTokens: frame.tokens,
          cursor: frame.cursor,
          analysisEnabled: frame.analysisEnabled,
          analysisStatus: frame.analysisStatus,
          presentedAt: frame.presentedAt,
          presentedFrameTime: frame.presentedFrameTime,
          error: frame.error,
        })),
        wasmInstantiateCalls: bench.wasm.instantiateCalls,
        analysisReadyAt: bench.analysisReadyAt,
      }
    },
    { eventId, kind, expected },
  )

  assert.ok(result.state.account, `${id}: terminal.account was lost`)
  assert.equal(result.state.account.startBalance, before.account.startBalance, `${id}: account startBalance changed`)
  if (kind === 'layout') assert.equal(result.state.paneCount, expected, `${id}: pane count mismatch`)
  if (kind === 'timeframe') assert.equal(result.state.timeframe, expected, `${id}: timeframe mismatch`)
  if (kind === 'analysis') {
    assert.ok(result.state.paneCount === 1, `${id}: expected one pane for TA check`)
    assert.equal(result.state.analysisEnabled, true, `${id}: TA toggle is not enabled`)
    assert.equal(result.state.analysisStatus, 'ready', `${id}: TA is not ready after enable`)
    assert.equal(result.wasmInstantiateCalls > 0, true, `${id}: TA ready without a WASM instantiation`)
  }
  assert.ok(Number.isFinite(result.responseMs) && result.responseMs >= 0, `${id}: invalid response`)

  await waitIdle(page, id)
  return {
    id,
    kind,
    expected,
    responseMs: result.responseMs,
    syncWorkMs: result.syncWorkMs,
    syncWorkEndKind: result.syncWorkEndKind,
    drawCpuMs: result.drawCpuMs,
    drawMaxCallbackMs: result.drawMaxCallbackMs,
    drawClearMs: result.drawClearMs,
    drawFrames: result.drawFrames,
    drawCanvasCount: result.drawCanvasCount,
    cursorBefore: before.cursor,
    cursorAfter: result.state.cursor,
    accountBefore: before.account,
    accountAfter: result.state.account,
    paneCount: result.state.paneCount,
    timeframe: result.state.timeframe,
    analysisEnabled: result.state.analysisEnabled,
    analysisStatus: result.state.analysisStatus,
    eventStart: result.event.start,
    presentedAt: result.presentedAt,
    frameIds: result.frameIds,
    drawCallbacks: result.drawCallbacks,
    wasmInstantiateCalls: result.wasmInstantiateCalls,
    analysisReadyAt: result.analysisReadyAt,
  }
}

async function layoutButton(page, count) {
  const group = page.locator(SELECTORS.layoutGroup)
  const buttons = group.locator('button')
  const n = await buttons.count()
  assert.equal(n, 3, `expected three layout buttons, found ${n}`)
  return buttons.nth(count - 1)
}

async function runStepScenario(page, { id, description, setup, expectedTa, expectedTimeframe }) {
  if (setup) await setup()
  await waitIdle(page, `${id} setup`)
  const before = await snapshot(page)
  if (!before.ready || !before.account) throw new Error(`${id}: terminal not ready before scenario`)
  if (before.playing) throw new Error(`${id}: terminal is playing before scenario`)
  if (expectedTa != null) {
    assert.equal(before.analysisEnabled, expectedTa, `${id}: TA state does not match scenario`)
  }
  if (expectedTimeframe != null) {
    assert.equal(before.timeframe, expectedTimeframe, `${id}: timeframe does not match scenario`)
  }
  if (before.analysisEnabled) {
    assert.equal(before.analysisStatus, 'ready', `${id}: TA is enabled but not ready`)
  }
  const warmup = await measureStep(page, `${id} warmup`, before.cursor + 1, before.analysisEnabled)
  const samples = []
  let nextCursor = warmup.cursorAfter
  for (let index = 1; index <= SAMPLES; index += 1) {
    const sample = await measureStep(page, `${id} sample ${index}`, nextCursor + 1, before.analysisEnabled)
    sample.index = index
    samples.push(sample)
    nextCursor = sample.cursorAfter
  }
  const scenario = {
    id,
    description,
    paneCount: samples[0]?.paneCount ?? null,
    timeframe: samples[0]?.timeframe ?? null,
    ta: samples[0]?.analysisEnabled ?? null,
    analysisStatus: samples[0]?.analysisStatus ?? null,
    warmup,
    samples,
    stats: {
      response: stats(samples.map((sample) => sample.responseMs)),
      syncWork: stats(samples.map((sample) => sample.syncWorkMs)),
      drawCpu: stats(samples.map((sample) => sample.drawCpuMs)),
      drawMaxCallback: stats(samples.map((sample) => sample.drawMaxCallbackMs)),
      drawFrames: stats(samples.map((sample) => sample.drawFrames)),
      drawClear: stats(samples.map((sample) => sample.drawClearMs)),
    },
  }
  report.hot.push(scenario)
  console.error(
    `${id}: n=${samples.length} response P95=${scenario.stats.response.p95.toFixed(2)}ms draw P95=${scenario.stats.drawCpu.p95.toFixed(2)}ms`,
  )
  return scenario
}

async function coldSample(index) {
  const context = await openContext()
  const page = await context.newPage()
  const errors = attachErrors(page)
  const sample = {
    index,
    coldMs: null,
    wallMs: null,
    state: null,
    pageErrors: errors.pageErrors,
    consoleErrors: errors.consoleErrors,
  }
  try {
    const wallStart = performance.now()
    const response = await page.goto(ROUTE, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT })
    if (response && !response.ok()) throw new Error(`cold page returned HTTP ${response.status()}`)
    const coldMs = await pageReadyValue(page)
    sample.coldMs = coldMs
    sample.wallMs = performance.now() - wallStart
    sample.state = await snapshot(page)
    if (sample.state.source !== 'synthetic') {
      throw new Error(`cold sample used source ${JSON.stringify(sample.state.source)}, expected synthetic`)
    }
    if (sample.state.paneCount !== 1) {
      throw new Error(`fresh cold context expected one pane, found ${sample.state.paneCount}`)
    }
    assertNoPageErrors(errors, `cold sample ${index}`)
    console.error(`cold ${index}/${COLD_SAMPLES}: ${sample.coldMs.toFixed(2)}ms (wall ${sample.wallMs.toFixed(2)}ms)`)
    return sample
  } catch (error) {
    sample.error = { message: error.message, stack: error.stack ?? null }
    throw error
  } finally {
    await context.close()
  }
}

async function run() {
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL ?? 'chrome',
    headless: HEADLESS,
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  })

  const version = browser.version()
  report.environment.browser = {
    name: 'chromium',
    channel: process.env.BROWSER_CHANNEL ?? 'chrome',
    version,
    headless: HEADLESS,
  }

  for (let index = 1; index <= COLD_SAMPLES; index += 1) {
    try {
      report.cold.samples.push(await coldSample(index))
    } catch (error) {
      throw new Error(`cold sample ${index} failed: ${error.message}`)
    }
  }
  report.cold.stats = {
    cold: stats(report.cold.samples.map((sample) => sample.coldMs)),
    wall: stats(report.cold.samples.map((sample) => sample.wallMs)),
  }

  const context = await openContext()
  const page = await context.newPage()
  const errors = attachErrors(page)
  try {
    const response = await page.goto(ROUTE, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT })
    if (response && !response.ok()) throw new Error(`hot page returned HTTP ${response.status()}`)
    await waitReady(page, 'hot')
    const pageInfo = await page.evaluate(() => {
      const scripts = [...document.scripts].map((script) => script.src)
      const root = document.querySelector('#__nuxt')
      const store = root?.__vue_app__?.config.globalProperties.$pinia?._s.get('terminal') ?? null
      return {
        scripts,
        dpr: window.devicePixelRatio,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        deviceMemory: navigator.deviceMemory ?? null,
        screen: {
          width: window.screen.width,
          height: window.screen.height,
          availWidth: window.screen.availWidth,
          availHeight: window.screen.availHeight,
        },
        storePresent: !!store,
      }
    })
    const dev = pageInfo.scripts.some((script) => script.includes('/@vite/client'))
    const production = !dev && pageInfo.scripts.some((script) => script.includes('/_nuxt/'))
    report.environment.buildMode = dev ? 'dev' : production ? 'production' : 'unknown'
    report.environment.evidence = {
      mode: report.environment.buildMode,
      local: hostIsLocal(),
      productionEvidence: production && hostIsLocal(),
      label: production
        ? hostIsLocal()
          ? 'production-local'
          : 'production-remote'
        : 'dev-debug — NOT production evidence',
      note: production
        ? 'Production build. Programmatic DOM input only; no OS input, paint, compositing, or hot-sample checkpoint drain included.'
        : 'BASE_URL points at a Vite dev server. These timings are debugging data only and must not be presented as final production evidence.',
    }
    report.environment.page = {
      ...pageInfo,
      viewport: page.viewportSize(),
      dpr: pageInfo.dpr,
    }
    assert.equal(pageInfo.dpr, DPR, `expected DPR ${DPR}, got ${pageInfo.dpr}`)
    assert.equal(pageInfo.innerWidth, VIEWPORT.width, `expected viewport width ${VIEWPORT.width}`)
    assert.equal(pageInfo.innerHeight, VIEWPORT.height, `expected viewport height ${VIEWPORT.height}`)
    assert.equal(pageInfo.storePresent, true, 'terminal Pinia store is not mounted')
    assertNoPageErrors(errors, 'hot setup')
    const initial = await snapshot(page)
    assert.equal(initial.source, 'synthetic', `hot setup used source ${JSON.stringify(initial.source)}`)
    assert.equal(initial.paneCount, 1, `hot setup expected one pane, found ${initial.paneCount}`)
    report.initialPaused = await pauseIfPlaying(page)
    const afterPause = await snapshot(page)
    assert.equal(afterPause.playing, false, 'replay is still playing after hot setup')
    report.hotBaseline = initial

    await runStepScenario(page, {
      id: 'single-pane-ta-off',
      description: 'one pane, TA off; step one bar through the real replay step button',
      expectedTa: false,
      expectedTimeframe: '15m',
    })

    const layout3 = await measureTransition(page, {
      id: 'layout-3',
      kind: 'layout',
      expected: 3,
      action: async (eventId) => clickControl(await layoutButton(page, 3), eventId),
    })
    report.controls.push(layout3)
    await runStepScenario(page, {
      id: 'three-pane-ta-off',
      description: 'three panes, TA off; step one bar through the real replay step button',
      expectedTa: false,
      expectedTimeframe: '15m',
    })

    const layout1 = await measureTransition(page, {
      id: 'layout-1',
      kind: 'layout',
      expected: 1,
      action: async (eventId) => clickControl(await layoutButton(page, 1), eventId),
    })
    report.controls.push(layout1)

    const timeframe5m = await measureTransition(page, {
      id: 'timeframe-5m',
      kind: 'timeframe',
      expected: '5m',
      action: (eventId) => clickControl(page.locator(SELECTORS.timeframe5m).first(), eventId),
    })
    report.controls.push(timeframe5m)

    const toggle = page.locator(SELECTORS.analysisToggle).first()
    assert.equal(await toggle.count(), 1, 'expected exactly one TA toggle at one pane')
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false', 'TA must be off before enable')
    const analysisOn = await measureTransition(page, {
      id: 'analysis-on',
      kind: 'analysis',
      expected: 'ready',
      action: (eventId) => clickControl(toggle, eventId),
    })
    report.controls.push(analysisOn)
    const analysisState = await page.evaluate(() => ({
      ready: document.querySelector('[data-status="ready"]')?.textContent?.trim() ?? null,
      instantiateCalls: window.__bench.wasm.instantiateCalls,
      wasmErrors: window.__bench.wasm.errors,
    }))
    assert.ok(analysisState.ready, 'TA did not report ready after enable')
    assert.ok(analysisState.instantiateCalls > 0, 'TA ready but WebAssembly.instantiate was never called')
    report.analysis = analysisState
    await waitIdle(page, 'analysis-on')

    await runStepScenario(page, {
      id: 'single-pane-ta-on',
      description: 'one pane, 5m timeframe, TA on; step one bar through the real replay step button',
      expectedTa: true,
      expectedTimeframe: '5m',
    })

    assertNoPageErrors(errors, 'hot run')
    report.longTasks = await page.evaluate(() => window.__bench.longTasks)
    report.hotErrors = errors
  } finally {
    await context.close()
  }
}

async function finalize() {
  const hotSamples = report.hot.flatMap((scenario) => scenario.samples)
  const controlSamples = report.controls
  assert(hotSamples.length > 0, 'No hot samples collected')
  assert(controlSamples.length === 4, `Expected four toolbar transition samples, got ${controlSamples.length}`)
  assert(report.cold.samples.length > 0, 'No cold samples collected')
  const interactionSamples = [...hotSamples, ...controlSamples]
  const response = stats(interactionSamples.map((sample) => sample.responseMs))
  const draw = stats(interactionSamples.map((sample) => sample.drawCpuMs))
  const drawMax = stats(interactionSamples.map((sample) => sample.drawMaxCallbackMs))
  const cold = stats(report.cold.samples.map((sample) => sample.coldMs))
  const scopeChecks = [
    ...report.hot.map((scenario) => ({
      id: scenario.id,
      n: scenario.samples.length,
      statistic: 'p95',
      responseMs: scenario.stats.response.p95,
      drawCpuMs: scenario.stats.drawCpu.p95,
      maxCallbackMs: scenario.stats.drawMaxCallback.p95,
    })),
    ...controlSamples.map((sample) => ({
      id: sample.id,
      n: 1,
      statistic: 'single observation, not a sampled distribution',
      responseMs: sample.responseMs,
      drawCpuMs: sample.drawCpuMs,
      maxCallbackMs: sample.drawMaxCallbackMs,
    })),
  ]
  const worstResponse = Math.max(...scopeChecks.map((scope) => scope.responseMs))
  const worstDraw = Math.max(...scopeChecks.map((scope) => scope.drawCpuMs))
  const worstCallback = Math.max(...scopeChecks.map((scope) => scope.maxCallbackMs))
  const checks = {
    response: {
      metric:
        'Worst hot-scenario P95 or individual toolbar transition: event -> next presented RAF covering every pane',
      value: worstResponse,
      budget: BUDGETS.responseP95Ms,
      pass: worstResponse <= BUDGETS.responseP95Ms,
    },
    chartCallbackCpu: {
      metric:
        'Worst hot-scenario P95 or individual toolbar transition: sum of chart RAF callback CPU in the event window',
      value: worstDraw,
      budget: BUDGETS.chartCallbackCpuP95Ms,
      pass: worstDraw <= BUDGETS.chartCallbackCpuP95Ms,
    },
    cold: {
      metric: 'P95 fresh-context cold open to ready and drawn chart',
      value: cold.p95,
      budget: BUDGETS.coldP95Ms,
      pass: cold.p95 <= BUDGETS.coldP95Ms,
    },
    maxSingleCallback: {
      metric: 'Worst hot-scenario P95 or individual toolbar transition: largest single chart RAF callback',
      value: worstCallback,
      budget: BUDGETS.chartCallbackCpuP95Ms,
      pass: worstCallback <= BUDGETS.chartCallbackCpuP95Ms,
    },
    scopes: scopeChecks,
  }
  checks.pass = ['response', 'chartCallbackCpu', 'cold', 'maxSingleCallback'].every((key) => checks[key].pass)
  checks.productionEvidence = report.environment.evidence?.productionEvidence === true
  report.checks = checks
  report.hotSummary = {
    response: stats(hotSamples.map((sample) => sample.responseMs)),
    syncWork: stats(hotSamples.map((sample) => sample.syncWorkMs)),
    drawCpu: stats(hotSamples.map((sample) => sample.drawCpuMs)),
    drawMaxCallback: stats(hotSamples.map((sample) => sample.drawMaxCallbackMs)),
    drawClear: stats(hotSamples.map((sample) => sample.drawClearMs)),
    drawFrames: stats(hotSamples.map((sample) => sample.drawFrames)),
  }
  report.controlsSummary = {
    response: stats(controlSamples.map((sample) => sample.responseMs)),
    syncWork: stats(controlSamples.map((sample) => sample.syncWorkMs)),
    drawCpu: stats(controlSamples.map((sample) => sample.drawCpuMs)),
    drawMaxCallback: stats(controlSamples.map((sample) => sample.drawMaxCallbackMs)),
    drawClear: stats(controlSamples.map((sample) => sample.drawClearMs)),
    drawFrames: stats(controlSamples.map((sample) => sample.drawFrames)),
  }
  report.interactionSummary = {
    response,
    syncWork: stats(interactionSamples.map((sample) => sample.syncWorkMs)),
    drawCpu: draw,
    drawMaxCallback: drawMax,
    drawClear: stats(interactionSamples.map((sample) => sample.drawClearMs)),
    drawFrames: stats(interactionSamples.map((sample) => sample.drawFrames)),
  }
  report.finishedAt = new Date().toISOString()
  report.durationMs = performance.now() - started
  delete report.__eventSeq
  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`)
  return checks
}

try {
  await run()
  const checks = await finalize()
  const label = report.environment.evidence?.label ?? 'unknown'
  console.error(`build: ${report.environment.buildMode} (${label})`)
  if (CHECK) {
    for (const key of ['response', 'chartCallbackCpu', 'cold', 'maxSingleCallback']) {
      const check = checks[key]
      console.error(
        `${key}: ${check.value.toFixed(2)}ms ${check.pass ? '<=' : '>'} ${check.budget}ms ${check.pass ? 'PASS' : 'FAIL'}`,
      )
    }
    if (!checks.productionEvidence) {
      console.error(
        'warning: this run is not production evidence; rerun against the production build for final numbers',
      )
    }
    if (!checks.pass) process.exitCode = 1
  }
  console.error(`saved ${OUTPUT}`)
} catch (error) {
  report.error = { message: error.message, stack: error.stack ?? null }
  report.finishedAt = new Date().toISOString()
  report.durationMs = performance.now() - started
  delete report.__eventSeq
  try {
    mkdirSync(dirname(OUTPUT), { recursive: true })
    writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`)
  } catch (writeError) {
    console.error(`could not write ${OUTPUT}: ${writeError.message}`)
  }
  console.error(`benchmark failed: ${error.stack ?? error.message}`)
  process.exitCode = 1
} finally {
  if (browser) {
    try {
      await browser.close()
    } catch (error) {
      console.error(`browser close failed: ${error.message}`)
      process.exitCode = 1
    }
  }
}
