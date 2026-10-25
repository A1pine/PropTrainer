import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, arch, release, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright'
import { captureEvidence, verifyEvidence } from './perf-evidence.mjs'

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
const SEED = process.env.PERF_SEED ?? 'terminal-bench-v1'
assert.ok(SEED.length > 0, 'PERF_SEED must not be empty')
const seedHash = createHash('sha256').update(SEED).digest('hex')
const UUID_PREFIX = `${seedHash.slice(0, 8)}-${seedHash.slice(8, 12)}-4${seedHash.slice(12, 15)}-8${seedHash.slice(15, 18)}`
const STRESS = process.env.PERF_STRESS === '1'
const HISTORY_TRADES = intEnv('PERF_HISTORY_TRADES', 1000, 1000)
const WORKING_ORDERS = intEnv('PERF_WORKING_ORDERS', 16, 16)
const LATE_CURSOR = intEnv('PERF_LATE_CURSOR', 1200, 1200)
// TA-off and TA-on each take one warmup plus SAMPLES steps, then a flush
// step. Verify a successor for every landed bar to avoid session liquidation.
const STRESS_RESERVED_STEPS = 2 * (SAMPLES + 1) + 1
const STRESS_TAIL_BARS = 3 * SAMPLES
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
    deterministic: {
      seed: SEED,
      uuidPrefix: UUID_PREFIX,
      algorithm:
        'SHA-256(seed) UUID prefix plus a monotonically increasing 48-bit sequence; sessionStorage cursor survives reload',
      scope: 'crypto.randomUUID overridden before app code in each fresh context; all contexts start the same sequence',
      excludes:
        'wall-clock timestamps, browser scheduling, GC timing, and engine or instrument accounting are not overridden',
    },
    stress: {
      enabled: STRESS,
      historyTrades: HISTORY_TRADES,
      workingOrders: WORKING_ORDERS,
      lateCursor: LATE_CURSOR,
      reservedSteps: STRESS_RESERVED_STEPS,
      minimumWarmupBars: 260,
      minimumTailBars: STRESS_TAIL_BARS,
      sampleScenarios: ['late-three-pane-ta-off', 'late-three-pane-ta-on'],
      restoreChecks: [
        'run id, template id, cursor, replay/engine clock, and storage status',
        'all account fields including balances, P&L, fees, contracts, margin, and buying power',
        'order, working-order, fill, and closed-trade counts',
        'open position symbol, side, and quantity',
        'three persisted 5m panes and one active pane',
        'chart analysis reset after reload (TA is component-local, not persisted)',
        'every pane canvas drew the restored cursor',
      ],
      workload: `actual terminal.newAttempt({ template: practiceClone, reuseTapes: true }); ${HISTORY_TRADES} market submit/flatten round trips at five per bar through store.submit and store.flatten; ${WORKING_ORDERS} resting GTC limit orders placed 6%+ away from the mark; one open market contract`,
      lateCursorMeaning: 'minimum bars advanced after the initial >=260-bar warmup',
      budgeted: false,
    },
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
  stress: STRESS
    ? {
        setup: null,
        hot: [],
        flush: null,
        restore: null,
        heap: { samples: [], deltas: null },
        longTasks: [],
        assertions: null,
        note: null,
        budgeted: false,
        boundaries: {
          hot: 'same DOM-click, synchronous-handler, chart RAF callback CPU, and next-RAF coverage boundaries as the default scenarios; storageStatus === "saved" is awaited between samples, not included as an end condition. Checkpoint CPU may still overlap a response window; a separate step+flush measures persistence completion',
          history:
            'every closed trade and resting order is created through the real store engine in a pinned practice attempt; this exposes actual history-dependent snapshot and checkpoint costs without assuming a specific clone implementation',
          setup:
            'separate wall time for actual store actions, initial checkpoint, layout and TA setup; not part of hot/restore budgets',
          flush:
            'real toolbar step capture -> awaited terminal.flush() in the same evaluate task; separate from hot RAF latency; includes queued IndexedDB work but not a rewrite of immutable tapes',
          restore:
            'new document performance time origin -> RAF poll observing ready store, expected cursor/run ID, restored pane count, and every pane canvas drawn at that cursor; not DOMContentLoaded; TA is expected off after reload',
          heap: 'CDP Runtime.getHeapUsage at phase boundaries; no explicit GC; observed JS heap can include garbage and instrumentation, excludes full browser/process memory and is not a leak verdict',
        },
      }
    : null,
  checks: null,
  finishedAt: null,
  durationMs: null,
}

let browser = null
let productionTree = false
let evidenceBefore = null
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
  await context.addInitScript(
    ({ prefix, hash }) => {
      const key = `propdesk.bench.uuid-sequence:${hash}`
      // Every fresh context starts the same sequence; reloads continue their
      // tab-local sequence without changing engine accounting/event IDs.
      let sequence = 0
      try {
        const saved = Number(sessionStorage.getItem(key))
        if (Number.isSafeInteger(saved) && saved >= 0) sequence = saved
      } catch {
        // about:blank and opaque origins have no storage.
      }
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        value: () => {
          sequence += 1
          if (sequence > 0xffffffffffff) throw new Error('Benchmark UUID sequence exhausted')
          try {
            sessionStorage.setItem(key, String(sequence))
          } catch {
            // The current document still has a deterministic, collision-free sequence.
          }
          return `${prefix}-${sequence.toString(16).padStart(12, '0')}`
        },
      })
    },
    { prefix: UUID_PREFIX, hash: seedHash },
  )
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
      navigation: { createdAt: performance.now(), domContentLoadedAt: null },
      restore: null,
    })

    try {
      if (document.readyState === 'loading') {
        document.addEventListener(
          'DOMContentLoaded',
          () => {
            bench.navigation.domContentLoadedAt = performance.now()
          },
          { once: true },
        )
      } else {
        bench.navigation.domContentLoadedAt = performance.now()
      }
    } catch {
      // Navigation timing is evidence, not a requirement.
    }

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
        time: store?.replayTime ?? null,
        engineTime: store?.snapshot?.time ?? null,
        symbol: store?.symbol ?? null,
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
        paneAnalysis: panes.map((pane) => ({
          active: pane.getAttribute('data-active') === 'true',
          symbol: pane.getAttribute('data-symbol'),
          analysisEnabled:
            pane.querySelector('[data-testid="analysis-toggle"]')?.getAttribute('aria-pressed') === 'true',
          analysisStatus: pane.querySelector('[data-status]')?.getAttribute('data-status') ?? null,
        })),
        runId: store?.run?.id ?? null,
        templateId: store?.templateId ?? null,
        storageStatus: store?.storageStatus ?? null,
        storageError: store?.storageError ?? null,
        restoreBlocked: store?.restoreBlocked ?? false,
        counts: store
          ? {
              orders: store.orders.length,
              workingOrders: store.workingOrders.length,
              fills: store.fills.length,
              trades: store.trades.length,
            }
          : null,
        position: store?.position
          ? { symbol: store.position.symbol, side: store.position.side, qty: store.position.qty }
          : null,
        account: store?.account
          ? {
              startBalance: store.account.startBalance,
              balance: store.account.balance,
              equity: store.account.equity,
              status: store.account.status,
              openContracts: store.account.openContracts,
              marginUsed: store.account.marginUsed,
              realizedPnl: store.account.realizedPnl,
              unrealizedPnl: store.account.unrealizedPnl,
              fees: store.account.fees,
              dayPnl: store.account.dayPnl,
              buyingPower: store.account.buyingPower,
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

    // Restore evidence is armed only for the reload that follows a checkpoint
    // flush, so cold-start and hot runs keep their original instrumentation.
    const armRestoreWatcher = (expectation) => {
      if (bench.restore) return
      const watch = {
        done: false,
        error: null,
        startedAt: performance.now(),
        readyAt: null,
        drawAt: null,
        cursorAtDraw: null,
        state: null,
      }
      bench.restore = watch
      const probe = () => {
        try {
          const state = bench.snapshot(false)
          const restored =
            state.ready &&
            !state.loading &&
            !state.restoreBlocked &&
            state.runId === expectation.runId &&
            state.cursor === expectation.cursor &&
            state.time === expectation.time &&
            state.engineTime === expectation.engineTime &&
            !!state.account
          if (watch.readyAt == null && restored) watch.readyAt = performance.now()
          const drawn =
            restored &&
            state.paneCount === expectation.paneCount &&
            state.activePaneCount === 1 &&
            state.symbol === expectation.symbol &&
            state.canvases.length === expectation.canvasCount &&
            state.canvases.length > 0 &&
            state.paneAnalysis.every((pane, index) => pane.symbol === expectation.layout[index]?.symbol) &&
            state.canvases.every(
              (canvas) =>
                canvas.width > 0 &&
                canvas.height > 0 &&
                canvas.lastDrawAt != null &&
                canvas.lastDrawCursor === state.cursor,
            )
          if (watch.readyAt != null && drawn) {
            watch.drawAt = performance.now()
            watch.cursorAtDraw = state.cursor
            watch.state = state
            watch.done = true
            return
          }
          requestAnimationFrame(probe)
        } catch (error) {
          watch.error = String(error)
          watch.done = true
        }
      }
      requestAnimationFrame(probe)
    }

    try {
      const expected = sessionStorage.getItem('propdesk.bench.restore-expect')
      if (expected) armRestoreWatcher(JSON.parse(expected))
    } catch (error) {
      bench.restore = { done: true, error: `cannot arm restore watcher: ${String(error)}` }
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
    paneAnalysis: result.state.paneAnalysis,
    counts: result.state.counts,
    position: result.state.position,
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

async function waitPanesAtCursor(page, label) {
  try {
    await page.waitForFunction(
      () => {
        const state = window.__bench.snapshot(false)
        if (!state.store || !state.ready || !state.canvases.length) return false
        return state.canvases.every((canvas) => canvas.lastDrawAt != null && canvas.lastDrawCursor === state.cursor)
      },
      null,
      { timeout: READY_TIMEOUT, polling: 'raf' },
    )
  } catch (error) {
    throw new Error(`${label}: panes did not present the current cursor: ${error.message}`)
  }
}

async function waitSaved(page, label) {
  try {
    await page.waitForFunction(
      () => {
        const store = window.__bench.readStore()
        return !!store && store.storageStatus === 'saved'
      },
      null,
      { timeout: SAMPLE_TIMEOUT, polling: 'raf' },
    )
  } catch (error) {
    throw new Error(`${label}: checkpoint did not reach saved status: ${error.message}`)
  }
}

async function readLayout(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('propdesk.terminal.layout.v1') ?? 'null')
    } catch {
      return null
    }
  })
}

async function activatePane(page, index) {
  const pane = page.locator(`[data-pane="${index}"]`)
  if ((await pane.getAttribute('data-active')) === 'true') return
  await pane.locator('[data-testid="chart-tool-cursor"]').click({ timeout: SAMPLE_TIMEOUT })
  await page.waitForFunction(
    (target) => document.querySelector(`[data-pane="${target}"]`)?.getAttribute('data-active') === 'true',
    index,
    { timeout: SAMPLE_TIMEOUT, polling: 'raf' },
  )
}

async function disableActiveAnalysis(page) {
  const toggle = page.locator('[data-pane][data-active="true"] [data-testid="analysis-toggle"]')
  if ((await toggle.count()) === 0) return false
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') return false
  await toggle.click({ timeout: SAMPLE_TIMEOUT })
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-pane][data-active="true"] [data-testid="analysis-toggle"]')
        ?.getAttribute('aria-pressed') === 'false',
    null,
    { timeout: SAMPLE_TIMEOUT, polling: 'raf' },
  )
  return true
}

// Only real store actions create history. Setup stays outside measured windows.
async function prepareStressWorkload(page) {
  const wallStart = performance.now()
  const workload = await page.evaluate(
    async ({ targetTrades, targetOrders, lateBars, reservedSteps, tailBars }) => {
      const setupStart = performance.now()
      const store = window.__bench.readStore()
      if (!store) throw new Error('terminal Pinia store is not mounted')
      if (!store.ready) throw new Error('terminal is not ready before the stress attempt')
      if (store.playing) throw new Error('pause the replay before building the stress attempt')
      const before = {
        runId: store.run.id,
        cursor: store.cursor,
        templateId: store.templateId,
        trades: store.trades.length,
        startBalance: store.account.startBalance,
        startIndex: store.run.startIndex,
        totalBars: store.totalBars,
      }
      // Obtain the app's preset rather than fabricating accounting or snapshots.
      await store.setTemplate('practice')
      if (store.templateId !== 'practice') throw new Error('could not obtain the practice preset')
      const presetRunId = store.run.id
      const practice = JSON.parse(JSON.stringify(store.template))
      await store.newAttempt({ template: practice, source: 'synthetic', reuseTapes: true })
      if (!store.ready) throw new Error('practice attempt did not become ready')
      if (store.templateId !== 'practice') throw new Error(`template is ${store.templateId}, expected practice`)
      if (store.run.id === before.runId || store.run.id === presetRunId) {
        throw new Error(`newAttempt did not create a fresh run: ${store.error ?? 'unchanged run id'}`)
      }
      if (store.storageStatus !== 'saved') throw new Error(`practice checkpoint not saved: ${store.storageError}`)
      if (store.trades.length !== 0 || store.orders.length !== 0 || store.account.openContracts !== 0) {
        throw new Error('practice attempt did not start empty and flat')
      }
      if (!store.run.tapes.every((tape) => tape.source === 'synthetic')) {
        throw new Error('stress attempt must reuse only synthetic tapes')
      }
      const startCursor = store.cursor
      if (startCursor < 260) throw new Error(`insufficient warmup: ${startCursor} bars`)
      const timeline = [...new Set(store.run.tapes.flatMap((tape) => tape.candles.map((candle) => candle.time)))].sort(
        (a, b) => a - b,
      )
      const minCursor = startCursor + lateBars
      const lastUsable = Math.min(timeline.length - reservedSteps - 2, timeline.length - tailBars)
      if (lastUsable < minCursor) {
        throw new Error(
          `synthetic tape too short: ${timeline.length} bars, start ${startCursor}, late ${lateBars}, reserved ${reservedSteps}`,
        )
      }
      const perBar = 5
      let roundTrips = 0
      let steps = 0
      let skipped = 0
      while (roundTrips < targetTrades) {
        if (store.ended) throw new Error('replay ended while generating stress history')
        if (!store.canTrade) {
          // The replay landed on a session-closing bar; the next bar reopens.
          if (skipped >= 5) throw new Error('cannot trade for five consecutive history bars')
          const cursorBefore = store.cursor
          store.stepBars(1)
          steps += 1
          skipped += 1
          if (store.cursor !== cursorBefore + 1) throw new Error('history skip did not advance one bar')
          if (store.cursor > minCursor) throw new Error('history skip consumed the late window')
          continue
        }
        skipped = 0
        const entry = store.submit({ side: 'long', type: 'market', qty: 1, tif: 'gtc' })
        if (!entry.ok) throw new Error(`stress entry rejected: ${entry.error}`)
        const exit = store.flatten()
        if (!exit.ok) throw new Error(`stress flatten rejected: ${exit.error}`)
        roundTrips += 1
        if (roundTrips % perBar === 0 && roundTrips < targetTrades) {
          const cursorBefore = store.cursor
          store.stepBars(1)
          steps += 1
          if (store.cursor !== cursorBefore + 1) throw new Error('history step did not advance one bar')
          if (store.cursor > minCursor) throw new Error('history consumed the late window')
        }
      }
      if (store.trades.length !== targetTrades) {
        throw new Error(`history produced ${store.trades.length} trades, expected ${targetTrades}`)
      }
      if (!store.trades.every((trade) => trade.entryPrice === trade.exitPrice && trade.grossPnl === 0)) {
        throw new Error('same-bar market/flatten history did not preserve zero gross P&L')
      }
      const expectedFees = Number((targetTrades * store.instrument.feePerContract).toFixed(2))
      if (Math.abs(store.account.balance - (store.account.startBalance - expectedFees)) > 0.01) {
        throw new Error('round-trip history balance does not match pinned instrument fees')
      }
      // Walk the late window until a run of bars is free of every session-close
      // and data-gap boundary: a 15:55 bar would force-close the open position.
      let target = null
      for (let candidate = Math.max(store.cursor, minCursor); candidate <= lastUsable; candidate += 1) {
        let contiguous = true
        // The entry bar and every landing bar must be followed by another 5m
        // bar: a session-closing bar (15:55) would force-close the open
        // position when the replay steps onto it.
        for (let index = candidate - 1; index <= candidate + reservedSteps; index += 1) {
          if (timeline[index + 1] - timeline[index] !== 300) {
            contiguous = false
            break
          }
        }
        if (contiguous) {
          target = candidate
          break
        }
      }
      if (target == null) throw new Error('no session-contiguous late window fits the reserved steps')
      if (target > store.cursor) {
        store.stepBars(target - store.cursor)
        steps += 1
        if (store.cursor !== target) throw new Error(`late jump stopped at ${store.cursor}, expected ${target}`)
      }
      if (!store.canTrade) throw new Error('late window begins at a non-tradable bar')
      const spec = store.instrument
      const mark = store.mark
      if (!spec || !mark) throw new Error('no instrument or mark at the stress cursor')
      const tick = spec.tickSize
      const precision = spec.pricePrecision
      const roundTick = (price) => Number((Math.round(price / tick) * tick).toFixed(precision))
      const baseDistance = Math.max(tick * 400, mark.price * 0.06)
      const stepDistance = Math.max(tick * 200, mark.price * 0.02)
      const restingOrders = []
      for (let index = 0; index < targetOrders; index += 1) {
        const side = index % 2 === 0 ? 'long' : 'short'
        const level = Math.floor(index / 2) + 1
        const distance = baseDistance + (level - 1) * stepDistance
        const price = roundTick(side === 'long' ? mark.price - distance : mark.price + distance)
        if (!Number.isFinite(price) || price <= 0) throw new Error(`resting order price is invalid: ${price}`)
        const placed = store.submit({
          side,
          type: 'limit',
          qty: 1,
          limitPrice: price,
          tif: 'gtc',
        })
        if (!placed.ok) throw new Error(`resting order ${index + 1} rejected: ${placed.error}`)
        restingOrders.push({
          side,
          qty: 1,
          price,
          distanceFromMark: Number(Math.abs(price - mark.price).toFixed(precision)),
        })
      }
      const entry = store.submit({ side: 'long', type: 'market', qty: 1, tif: 'gtc' })
      if (!entry.ok) throw new Error(`open position rejected: ${entry.error}`)
      if (store.workingOrders.length !== targetOrders) {
        throw new Error(`expected ${targetOrders} working orders, found ${store.workingOrders.length}`)
      }
      if (!store.position || store.position.side !== 'long' || store.position.qty !== 1) {
        throw new Error('stress workload did not leave one long contract open')
      }
      if (store.trades.length !== targetTrades) throw new Error('resting/entry orders changed the trade count')
      if (store.orders.length !== targetTrades * 2 + targetOrders + 1) {
        throw new Error('history/working/open order counts do not reconcile')
      }
      if (
        !store.workingOrders.every((order) => order.type === 'limit' && order.status === 'working' && !order.reduceOnly)
      ) {
        throw new Error('resting limits are not all working entry orders')
      }
      const account = store.account
      return {
        setupMs: performance.now() - setupStart,
        before,
        runId: store.run.id,
        seed: store.run.seed,
        symbol: store.symbol,
        templateId: store.templateId,
        template: practice,
        expectedHistoryFees: expectedFees,
        startCursor,
        cursor: store.cursor,
        advancedBars: store.cursor - startCursor,
        totalBars: store.totalBars,
        remainingBars: store.totalBars - store.cursor,
        window: { from: store.cursor, reservedSteps, contiguous: true },
        roundTrips,
        historySteps: steps,
        commands: roundTrips * 2 + targetOrders + 1,
        trades: store.trades.length,
        orders: store.orders.length,
        fills: store.fills.length,
        workingOrders: store.workingOrders.length,
        position: {
          symbol: store.position.symbol,
          side: store.position.side,
          qty: store.position.qty,
          avgPrice: store.position.avgPrice,
        },
        account: {
          startBalance: account.startBalance,
          balance: account.balance,
          equity: account.equity,
          openContracts: account.openContracts,
          marginUsed: account.marginUsed,
        },
        mark: mark.price,
        restingOrders,
      }
    },
    {
      targetTrades: HISTORY_TRADES,
      targetOrders: WORKING_ORDERS,
      lateBars: LATE_CURSOR,
      reservedSteps: STRESS_RESERVED_STEPS,
      tailBars: STRESS_TAIL_BARS,
    },
  )
  assert.equal(workload.templateId, 'practice', 'stress workload did not pin the practice template')
  assert.ok(
    workload.advancedBars >= LATE_CURSOR,
    `stress workload advanced ${workload.advancedBars} bars, need ${LATE_CURSOR}`,
  )
  assert.equal(workload.trades, HISTORY_TRADES, `stress workload produced ${workload.trades} trades`)
  assert.equal(workload.roundTrips, HISTORY_TRADES, `stress workload ran ${workload.roundTrips} round trips`)
  assert.equal(workload.workingOrders, WORKING_ORDERS, `stress workload left ${workload.workingOrders} working orders`)
  assert.equal(workload.position.qty, 1, 'stress workload lost the open contract')
  assert.equal(workload.position.side, 'long', 'stress workload position is not long')
  assert.ok(workload.startCursor >= 260, 'stress workload has fewer than 260 warmup bars')
  assert.ok(
    workload.remainingBars >= Math.max(STRESS_RESERVED_STEPS + 1, STRESS_TAIL_BARS),
    'stress workload left too few bars to finish',
  )
  assert.ok(
    workload.restingOrders.every((order) => order.distanceFromMark >= workload.mark * 0.05),
    'a resting order is closer than 5% to the mark',
  )
  workload.wallMs = performance.now() - wallStart
  return workload
}

async function setupStressPanes(page, expectedTa) {
  const wallStart = performance.now()
  if ((await page.locator(SELECTORS.pane).count()) !== 3) {
    await (await layoutButton(page, 3)).click({ timeout: SAMPLE_TIMEOUT })
  }
  await page.waitForFunction(() => window.__bench.snapshot(false).paneCount === 3, null, {
    timeout: READY_TIMEOUT,
    polling: 'raf',
  })
  for (let index = 0; index < 3; index += 1) {
    await activatePane(page, index)
    // The timeframe picker is in the shared toolbar and edits the active pane.
    await page.locator(SELECTORS.timeframe5m).first().click({ timeout: SAMPLE_TIMEOUT })
    const toggle = page.locator(`[data-pane="${index}"] ${SELECTORS.analysisToggle}`)
    assert.equal(await toggle.count(), 1, `stress pane ${index} has no TA toggle`)
    if (((await toggle.getAttribute('aria-pressed')) === 'true') !== expectedTa) {
      // Setup only: dispatch the button's own DOM click. With a thousand
      // historical rows mounted, Playwright's pointer sequence lands on the
      // icon and the pane can re-render between pointerdown and click, which
      // makes this setup flaky without exercising a different code path.
      await toggle.evaluate((element) => element.click())
    }
    try {
      await page.waitForFunction(
        ({ index: target, expected }) => {
          const pane = document.querySelector(`[data-pane="${target}"]`)
          if (!pane) return false
          const enabled = pane.querySelector('[data-testid="analysis-toggle"]')?.getAttribute('aria-pressed') === 'true'
          const status = pane.querySelector('[data-status]')?.getAttribute('data-status') ?? null
          return enabled === expected && (expected ? status === 'ready' : status == null)
        },
        { index, expected: expectedTa },
        { timeout: READY_TIMEOUT, polling: 'raf' },
      )
    } catch (cause) {
      const diagnostic = await page.evaluate((target) => {
        const pane = document.querySelector(`[data-pane="${target}"]`)
        return {
          pane: Boolean(pane),
          enabled: pane?.querySelector('[data-testid="analysis-toggle"]')?.getAttribute('aria-pressed') ?? null,
          status: pane?.querySelector('[data-status]')?.getAttribute('data-status') ?? null,
          text: pane?.querySelector('[data-status]')?.textContent?.trim() ?? null,
          title: pane?.querySelector('[data-status]')?.getAttribute('title') ?? null,
        }
      }, index)
      throw new Error(`pane ${index} TA state not ready: ${JSON.stringify(diagnostic)}`, { cause })
    }
  }
  // Return to the traded symbol: store.position is scoped to the active symbol.
  await activatePane(page, 0)
  await waitPanesAtCursor(page, 'stress TA setup')
  await waitIdle(page, 'stress TA setup')
  const state = await snapshot(page)
  const layout = await readLayout(page)
  assert.equal(state.paneCount, 3, 'stress setup did not keep three panes')
  assert.equal(state.timeframe, '5m', 'stress panes did not reach the 5m timeframe')
  assert.equal(layout?.length, 3, 'stress layout was not persisted with three panes')
  assert.deepEqual(
    layout.map((pane) => pane.timeframe),
    ['5m', '5m', '5m'],
    'stress panes are not all 5m',
  )
  assert.equal(state.paneAnalysis.length, 3, 'stress setup lost a pane analysis state')
  assert.ok(
    state.paneAnalysis.every(
      (pane) =>
        pane.analysisEnabled === expectedTa &&
        (expectedTa ? pane.analysisStatus === 'ready' : pane.analysisStatus == null),
    ),
    `TA state does not match ${expectedTa ? 'on/ready' : 'off'} on every stress pane`,
  )
  assert.equal(state.activePaneCount, 1, 'stress setup requires exactly one active pane')
  const wasm = await page.evaluate(() => ({
    instantiateCalls: window.__bench.wasm.instantiateCalls,
    errors: window.__bench.wasm.errors,
  }))
  if (expectedTa) {
    assert.ok(wasm.instantiateCalls > 0, 'TA ready but the shared WASM core was never instantiated')
  }
  assert.equal(wasm.errors.length, 0, `TA WASM errors: ${wasm.errors.join(' | ')}`)
  return { ...state, layout, wasm, wallMs: performance.now() - wallStart }
}

async function runStressScenario(page, { id, description, workload, expectedTa }) {
  assert(report.stress, 'stress report is not initialized')
  await waitIdle(page, `${id} setup`)
  const before = await snapshot(page)
  if (!before.store || !before.ready) throw new Error(`${id}: terminal not ready before stress scenario`)
  if (before.playing) throw new Error(`${id}: terminal is playing before stress scenario`)
  assert.equal(before.paneCount, 3, `${id}: stress scenario requires three panes`)
  assert.equal(before.timeframe, '5m', `${id}: stress scenario requires the 5m timeframe`)
  assert.equal(before.counts.trades, workload.trades, `${id}: closed-trade count changed before the scenario`)
  assert.equal(before.counts.workingOrders, workload.workingOrders, `${id}: working orders changed before the scenario`)
  assert.equal(before.account.openContracts, 1, `${id}: stress scenario requires one open contract`)
  assert.equal(before.symbol, workload.symbol, `${id}: active symbol changed from the traded symbol`)
  const paneStateMatches = (panes) =>
    panes.length === 3 &&
    panes.every(
      (pane) =>
        pane.analysisEnabled === expectedTa &&
        (expectedTa ? pane.analysisStatus === 'ready' : pane.analysisStatus == null),
    )
  assert.ok(paneStateMatches(before.paneAnalysis), `${id}: TA state does not match every pane`)
  const checkSample = (sample, label) => {
    assert.equal(sample.drawCanvasCount, before.canvases.length, `${label}: not every pane canvas was redrawn`)
    assert.ok(paneStateMatches(sample.paneAnalysis), `${label}: TA state does not match every pane`)
    assert.deepEqual(sample.counts, before.counts, `${label}: trade/order/fill counts changed`)
    assert.deepEqual(sample.position, before.position, `${label}: open position changed`)
    assert.equal(sample.accountAfter.openContracts, 1, `${label}: open contract disappeared`)
    assert.equal(sample.accountAfter.balance, before.account.balance, `${label}: realized balance changed`)
    assert.equal(sample.analysisEnabled, expectedTa, `${label}: active pane TA state changed`)
  }
  const warmup = await measureStep(page, `${id} warmup`, before.cursor + 1, expectedTa)
  checkSample(warmup, `${id} warmup`)
  await waitSaved(page, `${id} warmup save`)
  const samples = []
  let nextCursor = warmup.cursorAfter
  for (let index = 1; index <= SAMPLES; index += 1) {
    const sample = await measureStep(page, `${id} sample ${index}`, nextCursor + 1, expectedTa)
    checkSample(sample, `${id} sample ${index}`)
    sample.index = index
    samples.push(sample)
    nextCursor = sample.cursorAfter
    await waitSaved(page, `${id} sample ${index} save`)
  }
  const scenario = {
    id,
    description,
    paneCount: 3,
    timeframe: '5m',
    ta: expectedTa,
    analysisStatus: expectedTa ? 'ready' : null,
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
  report.stress.hot.push(scenario)
  console.error(
    `${id}: n=${samples.length} response P95=${scenario.stats.response.p95.toFixed(2)}ms sync P95=${scenario.stats.syncWork.p95.toFixed(2)}ms draw P95=${scenario.stats.drawCpu.p95.toFixed(2)}ms`,
  )
  return scenario
}

// One real toolbar step, then an awaited terminal.flush(); the flush is kept
// out of the hot RAF window and is the only place the full save is timed.
async function flushCheckpointAndPrepareRestore(page) {
  const eventId = nextEventId()
  const wallStart = performance.now()
  const result = await page.evaluate(async (id) => {
    const bench = window.__bench
    const store = bench.readStore()
    if (!store?.ready) throw new Error('terminal not ready before the flush step')
    const button = document.querySelector('[data-testid="replay-bar"] > button:nth-child(2)')
    if (!(button instanceof HTMLButtonElement) || !button.isConnected || button.disabled) {
      throw new Error('step button is not a connected, enabled button')
    }
    const before = bench.snapshot(false)
    bench.pendingEventId = id
    const clickStart = performance.now()
    button.click()
    const clickEnd = performance.now()
    const event = bench.events[id]
    if (!event) throw new Error('flush step did not dispatch a click event')
    event.end = clickEnd
    event.handlerMs = clickEnd - event.start
    event.handlerEndKind = 'dom-click-return'
    const afterClick = bench.snapshot(false)
    const flushStart = performance.now()
    await store.flush()
    const flushEnd = performance.now()
    const afterFlush = bench.snapshot(false)
    return {
      eventStart: event.start,
      clickStart,
      clickEnd,
      syncWorkMs: event.handlerMs,
      flushMs: flushEnd - flushStart,
      totalMs: flushEnd - event.start,
      cursorBefore: before.cursor,
      cursorAfter: afterFlush.cursor,
      before,
      afterClick,
      afterFlush,
      storageStatus: store.storageStatus,
      storageError: store.storageError,
    }
  }, eventId)
  assert.ok(result.eventStart > 0, 'flush click timestamp was not captured')
  assert.ok(Number.isFinite(result.syncWorkMs) && result.syncWorkMs >= 0, 'flush click handler duration is invalid')
  assert.equal(result.cursorAfter, result.cursorBefore + 1, 'flush step did not advance exactly one bar')
  assert.equal(result.afterClick.cursor, result.cursorAfter, 'flush click did not advance the replay')
  assert.deepEqual(result.afterFlush.counts, result.before.counts, 'flush step changed trade/order/fill counts')
  assert.deepEqual(result.afterFlush.position, result.before.position, 'flush step changed the open position')
  assert.equal(result.afterFlush.runId, result.before.runId, 'flush step changed the run')
  assert.equal(result.afterFlush.account.balance, result.before.account.balance, 'flush step changed realized balance')
  assert.equal(result.afterFlush.account.openContracts, 1, 'flush step closed the open contract')
  assert.equal(result.afterFlush.templateId, 'practice', 'flush step left the practice template')
  assert.equal(result.storageStatus, 'saved', `flush did not reach saved status: ${result.storageError ?? 'unknown'}`)
  assert.ok(Number.isFinite(result.flushMs) && result.flushMs > 0, 'flush did not report a positive duration')
  const layout = await readLayout(page)
  assert.equal(layout?.length, 3, 'flush step lost the persisted three-pane layout')
  const expectation = {
    runId: result.afterFlush.runId,
    templateId: result.afterFlush.templateId,
    cursor: result.afterFlush.cursor,
    time: result.afterFlush.time,
    engineTime: result.afterFlush.engineTime,
    symbol: result.afterFlush.symbol,
    paneCount: result.afterFlush.paneCount,
    account: result.afterFlush.account,
    counts: result.afterFlush.counts,
    position: result.afterFlush.position,
    canvasCount: result.afterFlush.canvases.length,
    layout,
    writtenAt: Date.now(),
  }
  await page.evaluate(
    (value) => sessionStorage.setItem('propdesk.bench.restore-expect', JSON.stringify(value)),
    expectation,
  )
  return { ...result, eventId, expectation, wallMs: performance.now() - wallStart }
}

async function measureRestore(page, expectation) {
  const reloadStart = performance.now()
  await page.reload({ waitUntil: 'commit', timeout: READY_TIMEOUT })
  const commitMs = performance.now() - reloadStart
  try {
    await page.waitForFunction(() => window.__bench?.restore?.done === true, null, {
      timeout: READY_TIMEOUT,
      polling: 'raf',
    })
  } catch (error) {
    const state = await page
      .evaluate(() => {
        const store = window.__bench?.readStore?.()
        return {
          watch: window.__bench?.restore ?? null,
          ready: store?.ready ?? null,
          restoreBlocked: store?.restoreBlocked ?? null,
          storageError: store?.storageError ?? null,
          runId: store?.run?.id ?? null,
          cursor: store?.cursor ?? null,
        }
      })
      .catch(() => null)
    throw new Error(`restore did not finish: ${error.message}; state=${JSON.stringify(state)}`)
  }
  const result = await page.evaluate(() => ({
    navigation: window.__bench.navigation,
    restore: window.__bench.restore,
    state: window.__bench.snapshot(true),
    paneSymbols: [...document.querySelectorAll('[data-pane]')].map((pane) => pane.getAttribute('data-symbol')),
    layout: (() => {
      try {
        return JSON.parse(localStorage.getItem('propdesk.terminal.layout.v1') ?? 'null')
      } catch {
        return null
      }
    })(),
    wasm: window.__bench.wasm,
  }))
  const watch = result.restore
  const state = result.state
  if (watch.error) throw new Error(`restore watcher failed: ${watch.error}`)
  const checks = []
  const check = (ok, message, detail = null) => checks.push({ ok: !!ok, message, detail })
  const same = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    check(ok, `${label} mismatch`, ok ? null : { actual, expected })
  }
  check(
    watch.startedAt != null && watch.startedAt - result.navigation.createdAt < 250,
    'restore watcher did not arm near navigation start',
    { startedAt: watch.startedAt, navigation: result.navigation },
  )
  check(watch.readyAt != null && watch.drawAt != null, 'restore never observed ready and drawn panes')
  check(watch.readyAt <= watch.drawAt, 'restore drew before the store was ready')
  check(!!watch.state, 'restore did not capture state at draw time')
  check(state.runId === expectation.runId, 'restored run id changed', {
    actual: state.runId,
    expected: expectation.runId,
  })
  check(state.cursor === expectation.cursor, 'restored cursor changed', {
    actual: state.cursor,
    expected: expectation.cursor,
  })
  check(state.time === expectation.time, 'restored clock changed', {
    actual: state.time,
    expected: expectation.time,
  })
  same('engine clock', state.engineTime, expectation.engineTime)
  same('active symbol', state.symbol, expectation.symbol)
  same('template id', state.templateId, expectation.templateId)
  check(state.storageStatus === 'saved', `restored storage status is ${state.storageStatus}`)
  check(state.restoreBlocked === false, 'restore was blocked')
  check(state.ready && !state.loading && !state.playing, 'restored store is not ready and paused')
  check(state.activePaneCount === 1, 'restore requires exactly one active pane')
  check(state.timeframe === '5m', 'restored active timeframe is not 5m')
  same('account', state.account, expectation.account)
  same('closed-trade count', state.counts?.trades, expectation.counts.trades)
  same('working-order count', state.counts?.workingOrders, expectation.counts.workingOrders)
  same('order count', state.counts?.orders, expectation.counts.orders)
  same('fill count', state.counts?.fills, expectation.counts.fills)
  same('position', state.position, expectation.position)
  check(state.paneCount === expectation.paneCount && state.paneCount === 3, 'restored pane count changed', {
    actual: state.paneCount,
    expected: expectation.paneCount,
  })
  check(
    state.paneAnalysis.length === 3 && state.paneAnalysis.every((pane) => !pane.analysisEnabled),
    'TA was not reset after reload',
  )
  check(
    state.paneAnalysis.every((pane) => pane.analysisStatus == null),
    'TA status leaked across reload',
  )
  check(
    Array.isArray(result.layout) &&
      result.layout.length === 3 &&
      result.layout.every((pane) => pane.timeframe === '5m'),
    'layout did not restore three 5m panes',
  )
  same('persisted layout', result.layout, expectation.layout)
  same(
    'pane symbols',
    result.paneSymbols,
    expectation.layout.map((pane) => pane.symbol),
  )
  check(
    state.canvases.length === expectation.canvasCount &&
      state.canvases.every((canvas) => canvas.lastDrawAt != null && canvas.lastDrawCursor === state.cursor),
    'restored panes did not draw the restored cursor',
    { canvases: state.canvases.length, expected: expectation.canvasCount },
  )
  check(watch.cursorAtDraw === expectation.cursor, 'restore watcher completed at a different cursor', {
    actual: watch.cursorAtDraw,
    expected: expectation.cursor,
  })
  same('draw-time account', watch.state?.account, expectation.account)
  same('draw-time counts', watch.state?.counts, expectation.counts)
  same('draw-time position', watch.state?.position, expectation.position)
  check(result.wasm.errors.length === 0, 'WASM initialization failed after reload', result.wasm.errors)
  const failed = checks.filter((entry) => !entry.ok)
  if (failed.length) {
    throw new Error(
      `restore checks failed: ${failed.map((entry) => `${entry.message} ${JSON.stringify(entry.detail)}`).join(' | ')}`,
    )
  }
  return {
    ...result,
    commitMs,
    pass: true,
    checks,
    metrics: {
      navigationStartToWatcherMs: watch.startedAt,
      instrumentationToWatcherMs: watch.startedAt - result.navigation.createdAt,
      navigationStartToDomContentLoadedMs: result.navigation.domContentLoadedAt,
      navigationStartToReadyMs: watch.readyAt,
      navigationStartToDrawMs: watch.drawAt,
      readyToDrawMs: watch.drawAt - watch.readyAt,
      domContentLoadedToDrawMs:
        result.navigation.domContentLoadedAt != null ? watch.drawAt - result.navigation.domContentLoadedAt : null,
    },
  }
}

async function heapSample(cdp, label, note) {
  const [runtime, performanceMetrics] = await Promise.all([
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Performance.getMetrics'),
  ])
  const metrics = Object.fromEntries(performanceMetrics.metrics.map((metric) => [metric.name, metric.value]))
  assert.ok(Number.isFinite(runtime.usedSize) && runtime.usedSize >= 0, `${label}: invalid observed JS heap used`)
  assert.ok(
    Number.isFinite(runtime.totalSize) && runtime.totalSize >= runtime.usedSize,
    `${label}: invalid observed JS heap size`,
  )
  return {
    label,
    note,
    at: performance.now(),
    jsHeapUsedBytes: Math.round(runtime.usedSize),
    jsHeapTotalBytes: Math.round(runtime.totalSize),
    embedderHeapUsedBytes: Number.isFinite(runtime.embedderHeapUsedSize)
      ? Math.round(runtime.embedderHeapUsedSize)
      : null,
    metrics: {
      JSHeapUsedSize: metrics.JSHeapUsedSize ?? null,
      JSHeapTotalSize: metrics.JSHeapTotalSize ?? null,
      Nodes: metrics.Nodes ?? null,
      Documents: metrics.Documents ?? null,
      LayoutCount: metrics.LayoutCount ?? null,
      RecalcStyleCount: metrics.RecalcStyleCount ?? null,
    },
  }
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
  productionTree = existsSync(resolve(process.env.PERF_APP_ROOT ?? ROOT, '.output'))
  evidenceBefore = captureEvidence(ROOT, 'scripts/bench-terminal.mjs', productionTree)
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

    const longTaskBaseline = await page.evaluate(() => window.__bench.longTasks.length)
    assertNoPageErrors(errors, 'hot run')

    if (STRESS) {
      const stress = report.stress
      assert(stress, 'stress report is not initialized')
      const cdp = await context.newCDPSession(page)
      await cdp.send('Performance.enable')
      stress.heap.samples.push(
        await heapSample(cdp, 'hot-baseline', 'after the default hot scenarios and before the stress attempt'),
      )
      const setupStart = performance.now()
      console.error('stress: building the late workload through the real store engine')
      await disableActiveAnalysis(page)
      const workload = await prepareStressWorkload(page)
      stress.setup = workload
      await waitPanesAtCursor(page, 'stress workload')
      await waitSaved(page, 'stress workload checkpoint')
      workload.savedAfterSetup = await page.evaluate(() => window.__bench.readStore().storageStatus)
      workload.panes = []
      for (const expectedTa of [false, true]) {
        const panes = await setupStressPanes(page, expectedTa)
        workload.panes.push({
          ta: expectedTa,
          paneCount: panes.paneCount,
          timeframe: panes.timeframe,
          layout: panes.layout,
          paneAnalysis: panes.paneAnalysis,
          wasm: panes.wasm,
          wallMs: panes.wallMs,
        })
        assert.equal(panes.counts.trades, workload.trades, 'pane setup changed the trade count')
        assert.equal(panes.counts.workingOrders, workload.workingOrders, 'pane setup changed working orders')
        assert.equal(panes.account.openContracts, 1, 'pane setup closed the open contract')
        if (!expectedTa) {
          workload.initialSetupWallMs = performance.now() - setupStart
          stress.heap.samples.push(
            await heapSample(
              cdp,
              'stress-ready',
              'three 5m panes, TA off, and the late history are mounted; before any stress step',
            ),
          )
        }
        const scenario = await runStressScenario(page, {
          id: `late-three-pane-ta-${expectedTa ? 'on' : 'off'}`,
          description: `late timeline with ${HISTORY_TRADES} real round trips and ${WORKING_ORDERS} resting limits; three 5m panes, TA ${expectedTa ? 'on' : 'off'}, one open contract; real replay toolbar step`,
          workload,
          expectedTa,
        })
        assert.equal(scenario.samples.length, SAMPLES, `stress scenario collected ${scenario.samples.length} samples`)
      }
      workload.setupTotalMs = workload.initialSetupWallMs + workload.panes[1].wallMs
      console.error('stress: timed step + awaited full checkpoint flush')
      const flush = await flushCheckpointAndPrepareRestore(page)
      stress.flush = flush
      await waitIdle(page, 'stress flush')
      stress.heap.samples.push(await heapSample(cdp, 'pre-restore', 'after the timed flush and before the reload'))
      const longTasks = await page.evaluate(() => window.__bench.longTasks)
      report.longTasks = longTasks.slice(0, longTaskBaseline)
      stress.longTasks = longTasks.slice(longTaskBaseline)
      const restore = await measureRestore(page, flush.expectation)
      stress.restore = restore
      stress.restoreLongTasks = await page.evaluate(() => window.__bench.longTasks)
      stress.heap.samples.push(
        await heapSample(
          cdp,
          'post-restore',
          'new document after the reload; the previous renderer context may still be unreclaimed',
        ),
      )
      assertNoPageErrors(errors, 'stress restore')
      stress.assertions = {
        pass: true,
        setup: {
          practiceTemplate: workload.templateId === 'practice',
          roundTrips: workload.roundTrips === HISTORY_TRADES,
          closedTrades: workload.trades === HISTORY_TRADES,
          restingOrders: workload.workingOrders === WORKING_ORDERS,
          openPosition: workload.position.qty === 1 && workload.position.side === 'long',
          lateCursor: workload.advancedBars >= LATE_CURSOR,
          contiguousWindow: workload.window.contiguous === true,
        },
        hot: {
          scenarios: stress.hot.length,
          samples: stress.hot.reduce((sum, item) => sum + item.samples.length, 0),
        },
        flush: {
          storageStatus: flush.storageStatus,
          advancedOneBar: flush.cursorAfter === flush.cursorBefore + 1,
        },
        restore: restore.checks,
      }
    } else {
      report.longTasks = await page.evaluate(() => window.__bench.longTasks)
    }
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
  if (STRESS) {
    const stress = report.stress
    assert(stress, 'PERF_STRESS=1 did not initialize the stress report')
    assert(stress.setup, 'PERF_STRESS=1 collected no stress setup')
    assert(stress.hot.length > 0, 'PERF_STRESS=1 collected no stress hot scenarios')
    assert(stress.flush, 'PERF_STRESS=1 collected no flush measurement')
    assert(stress.restore?.pass === true, 'PERF_STRESS=1 restore checks did not pass')
    const stressSamples = stress.hot.flatMap((scenario) => scenario.samples)
    assert.deepEqual(
      stress.hot.map((scenario) => scenario.id),
      report.config.stress.sampleScenarios,
      'missing stress scenario',
    )
    assert.deepEqual(
      stress.hot.map((scenario) => scenario.ta),
      [false, true],
      'stress TA-off/on coverage changed',
    )
    assert.ok(
      stress.hot.every((scenario) => scenario.samples.length === SAMPLES),
      'stress scenario sample count changed',
    )
    assert.equal(
      stressSamples.length,
      2 * SAMPLES,
      `expected ${2 * SAMPLES} stress samples, got ${stressSamples.length}`,
    )
    assert.equal(stress.setup.templateId, 'practice', `stress setup used template ${stress.setup.templateId}`)
    assert.equal(stress.setup.roundTrips, HISTORY_TRADES, `stress setup ran ${stress.setup.roundTrips} round trips`)
    assert.equal(stress.setup.trades, HISTORY_TRADES, `stress setup produced ${stress.setup.trades} trades`)
    assert.equal(stress.setup.workingOrders, WORKING_ORDERS, `stress setup left ${stress.setup.workingOrders} orders`)
    assert.equal(stress.setup.position.qty, 1, 'stress setup lost the open contract')
    assert.ok(stress.setup.advancedBars >= LATE_CURSOR, `stress setup advanced only ${stress.setup.advancedBars} bars`)
    assert.ok(
      stress.setup.remainingBars >= Math.max(STRESS_RESERVED_STEPS + 1, STRESS_TAIL_BARS),
      `stress setup left only ${stress.setup.remainingBars} bars before sampling`,
    )
    assert.equal(stress.heap.samples.length, 4, `expected four heap samples, got ${stress.heap.samples.length}`)
    assert.deepEqual(
      stress.heap.samples.map((sample) => sample.label),
      ['hot-baseline', 'stress-ready', 'pre-restore', 'post-restore'],
      'heap sample labels are out of order',
    )
    stress.summary = {
      hot: {
        response: stats(stressSamples.map((sample) => sample.responseMs)),
        syncWork: stats(stressSamples.map((sample) => sample.syncWorkMs)),
        drawCpu: stats(stressSamples.map((sample) => sample.drawCpuMs)),
        drawMaxCallback: stats(stressSamples.map((sample) => sample.drawMaxCallbackMs)),
        drawClear: stats(stressSamples.map((sample) => sample.drawClearMs)),
        drawFrames: stats(stressSamples.map((sample) => sample.drawFrames)),
      },
      flush: {
        syncWorkMs: stress.flush.syncWorkMs,
        flushMs: stress.flush.flushMs,
        totalMs: stress.flush.totalMs,
        cursorBefore: stress.flush.cursorBefore,
        cursorAfter: stress.flush.cursorAfter,
        storageStatus: stress.flush.storageStatus,
      },
      restore: stress.restore.metrics,
    }
    stress.heap.deltas = stress.heap.samples.slice(1).map((sample, index) => {
      const prior = stress.heap.samples[index]
      return {
        from: prior.label,
        to: sample.label,
        jsHeapUsedBytes: sample.jsHeapUsedBytes - prior.jsHeapUsedBytes,
        jsHeapTotalBytes: sample.jsHeapTotalBytes - prior.jsHeapTotalBytes,
        nodes:
          sample.metrics.Nodes != null && prior.metrics.Nodes != null
            ? sample.metrics.Nodes - prior.metrics.Nodes
            : null,
        documents:
          sample.metrics.Documents != null && prior.metrics.Documents != null
            ? sample.metrics.Documents - prior.metrics.Documents
            : null,
      }
    })
    stress.note =
      'Exploratory, unbudgeted stress evidence. Default scenario ids, viewport, selectors, measurement boundaries and budget checks are unchanged. History is generated by the real store, so syncWork observes its actual snapshot path without assuming a clone implementation. TA-off and TA-on use successive bars, not paired identical market states. Between stress samples storageStatus === "saved" is awaited; checkpoint CPU may still overlap the same sample response, so flush is not subtracted from hot latency. The separate flush observation is one real toolbar step followed by awaited terminal.flush(), including deferred export and IndexedDB commit but not immutable tape creation. Restore measures navigation start -> ready/drawn restored state, not DOMContentLoaded. Heap observations include instrumentation and potentially uncollected garbage, without forced GC or an absolute memory budget; reload deltas are not retained-memory or leak verdicts.'
    stress.assertions = { ...stress.assertions, pass: true }
    stress.budgeted = false
    console.error(
      `stress: hot response P95=${stress.summary.hot.response.p95.toFixed(2)}ms sync P95=${stress.summary.hot.syncWork.p95.toFixed(2)}ms draw P95=${stress.summary.hot.drawCpu.p95.toFixed(2)}ms flush=${stress.summary.flush.flushMs.toFixed(2)}ms restore draw=${stress.summary.restore.navigationStartToDrawMs.toFixed(2)}ms (unbudgeted)`,
    )
  }
  delete report.__eventSeq
  // Hash the measured app, harness and production build before and after the
  // run; all file reads happen outside the timed samples above.
  const evidenceAfter = captureEvidence(ROOT, 'scripts/bench-terminal.mjs', productionTree)
  verifyEvidence(evidenceBefore, evidenceAfter)
  const servedAssets = []
  if (report.environment.buildMode === 'production' && evidenceAfter.build) {
    for (const url of report.environment.page.scripts.filter((value) => value.includes('/_nuxt/'))) {
      const assetPath = `public${decodeURIComponent(new URL(url).pathname)}`
      const expected = evidenceAfter.build.files.find((item) => item.file === assetPath)
      assert.ok(expected, `Served asset is absent from the measured build: ${assetPath}`)
      const response = await fetch(url)
      assert.ok(response.ok, `Cannot verify served asset: ${url}`)
      const digest = createHash('sha256')
        .update(Buffer.from(await response.arrayBuffer()))
        .digest('hex')
      assert.equal(digest, expected.sha256, `Server does not serve the measured build: ${url}`)
      servedAssets.push({ url, sha256: digest })
    }
    assert.ok(servedAssets.length, 'No production entry asset verified')
  }
  report.evidence = { before: evidenceBefore, after: evidenceAfter, servedAssets, verified: true }
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
