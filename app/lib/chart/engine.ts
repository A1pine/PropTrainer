import type { Candle } from '~/domain/market/types'
import { roundToTick } from '~/domain/shared/math'
import {
  clampPriceToTick,
  clampViewport,
  createIndexGeometry,
  createPriceScale,
  fibLevels,
  formatRelativeBars,
  rect,
  type Rect,
  type Viewport,
} from './geometry'
import type {
  ChartCallbacks,
  ChartDrawing,
  ChartOptions,
  ChartOrderLine,
  ChartOverlayLevels,
  ChartTheme,
  ChartTool,
  DrawingPoint,
  DrawingType,
  CrosshairPayload,
  ChartAnalysis,
  ChartExecution,
  ChartStyle,
  ChartTone,
  AnalysisSeries,
} from './types'

const AXIS_WIDTH = 64
const TIME_AXIS = 22
const PAD_TOP = 12
const PAD_LEFT = 8
const EXECUTION_LABEL_GAP = 12
const EXECUTION_LABEL_HEIGHT = 15
const EXECUTION_MARKER_RADIUS = 5.5
const ORDER_HIT_SLOP = 6
const ORDER_TAG_HEIGHT = 16
const ORDER_CANCEL_SIZE = 14
const ORDER_CANCEL_GAP = 2
const CLICK_SLOP = 4

interface DisplayCache {
  source: readonly Candle[] | null
  style: ChartStyle
  built: number
  data: Candle[]
}

type DragState =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startY: number; startEnd: number; inside: boolean; distance: number }
  | { kind: 'overlay'; level: keyof ChartOverlayLevels }
  | { kind: 'order'; id: string; price: number }
  | { kind: 'draw'; anchor: DrawingPoint }

function isValidOrderLine(line: ChartOrderLine): boolean {
  return (
    Number.isFinite(line.price) &&
    Number.isFinite(line.qty) &&
    line.qty > 0 &&
    (line.side === 'long' || line.side === 'short') &&
    (line.kind === 'limit' || line.kind === 'stop')
  )
}

function sameOrderLines(a: readonly ChartOrderLine[], b: readonly ChartOrderLine[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!
    const right = b[index]!
    if (
      left.id !== right.id ||
      left.side !== right.side ||
      left.kind !== right.kind ||
      left.price !== right.price ||
      left.label !== right.label ||
      left.qty !== right.qty ||
      Boolean(left.protective) !== Boolean(right.protective) ||
      (left.draggable !== false) !== (right.draggable !== false)
    ) {
      return false
    }
  }
  return true
}

function isValidExecution(execution: ChartExecution): boolean {
  return (
    (execution.side === 'long' || execution.side === 'short') &&
    Number.isInteger(execution.entryBar) &&
    execution.entryBar >= 0 &&
    Number.isInteger(execution.exitBar) &&
    execution.exitBar >= 0 &&
    Number.isFinite(execution.entryPrice) &&
    Number.isFinite(execution.exitPrice)
  )
}

export class ChartEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private callbacks: ChartCallbacks
  private theme: ChartTheme
  private candles: Candle[] = []
  private seriesKey: string | undefined
  private visibleCount = 0
  private viewport: Viewport = { end: 0, span: 72 }
  private follow = true
  private overlays: ChartOverlayLevels = { entry: null, stop: null, target: null }
  private orderLines: readonly ChartOrderLine[] = []
  private executions: readonly ChartExecution[] = []
  private validExecutions: readonly ChartExecution[] = []
  private drawings: ChartDrawing[] = []
  private draft: ChartDrawing | null = null
  private draftPoint: DrawingPoint | null = null
  private analysis: ChartAnalysis | null = null
  private tool: ChartTool = 'cursor'
  private drag: DragState = { kind: 'none' }
  private hover: { x: number; y: number } | null = null
  private themeDirty = true
  private frame = 0
  private lastPaintAt = 0
  private animateFrom = -1
  private crosshairDirty = false
  private opts: Required<ChartOptions>
  private priceFormatter: Intl.NumberFormat
  private dateTimeFormatter: Intl.DateTimeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' })
  private effectiveTimeZone = 'UTC'
  private displayCache: DisplayCache = { source: null, style: 'candles', built: 0, data: [] }
  private resizeObserver: ResizeObserver | null = null
  private width = 0
  private height = 0
  private dpr = 1
  private frameLayout: {
    price: Rect
    volume: Rect
    plot: Rect
    geo: ReturnType<typeof createIndexGeometry>
    scale: ReturnType<typeof createPriceScale>
  } | null = null

  constructor(canvas: HTMLCanvasElement, callbacks: ChartCallbacks, theme: ChartTheme, options: ChartOptions = {}) {
    this.canvas = canvas
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context unavailable')
    this.ctx = context
    this.callbacks = callbacks
    this.theme = theme
    this.opts = {
      timeframeMinutes: options.timeframeMinutes ?? 5,
      blind: options.blind ?? true,
      showVolume: options.showVolume ?? true,
      showWatermark: options.showWatermark ?? true,
      overlayDraggable: options.overlayDraggable ?? false,
      orderDraggable: options.orderDraggable ?? false,
      pricePickEnabled: options.pricePickEnabled ?? false,
      chartStyle: options.chartStyle ?? 'candles',
      timeZone: options.timeZone ?? 'UTC',
      showDates: options.showDates ?? false,
      showOverlayLabels: options.showOverlayLabels ?? true,
      reducedMotion: options.reducedMotion ?? false,
      pricePrecision: options.pricePrecision ?? 2,
      tickSize: options.tickSize ?? 0.25,
    }
    this.priceFormatter = this.createPriceFormatter()
    this.dateTimeFormatter = this.createDateTimeFormatter()
    this.attach()
    this.measure()
  }

  setCandles(candles: Candle[], visibleCount: number, seriesKey?: string) {
    // A caller that owns a stable series identity can append candles without
    // resetting pan/zoom. Without one, array identity remains the old signal.
    const isNewSeries = seriesKey !== this.seriesKey || (seriesKey === undefined && candles !== this.candles)
    const previousCount = this.visibleCount
    // Forming candles can change in place; array identity cannot validate HA.
    // Count-only reveals still reuse the cache through setVisibleCount.
    this.displayCache.source = null
    this.candles = candles
    this.visibleCount = Math.max(0, Math.min(visibleCount, candles.length))
    this.seriesKey = seriesKey
    if (isNewSeries || this.visibleCount < previousCount) this.cancelDrag()
    if (isNewSeries || previousCount === 0) {
      this.follow = true
      this.viewport = { end: Math.max(0, this.visibleCount - 1), span: 72 }
    } else if (this.visibleCount < previousCount) {
      this.viewport = clampViewport(this.viewport, Math.max(2, this.visibleCount))
    }
    this.viewport.end = this.follow
      ? Math.max(0, this.visibleCount - 1)
      : Math.min(this.viewport.end, Math.max(0, this.visibleCount - 1))
    this.animateFrom = -1
    this.invalidateLayout()
    this.requestRender()
  }

  setVisibleCount(count: number) {
    const next = Math.max(0, Math.min(count, this.candles.length))
    if (next === this.visibleCount) return
    const grew = next > this.visibleCount
    if (next !== this.visibleCount) this.cancelDrag()
    this.visibleCount = next
    if (!grew) this.viewport = clampViewport(this.viewport, Math.max(2, next))
    this.viewport.end = this.follow ? Math.max(0, next - 1) : Math.min(this.viewport.end, Math.max(0, next - 1))
    if (grew && !this.opts.reducedMotion) {
      this.lastPaintAt = performance.now()
      this.animateFrom = next - 1
    } else {
      this.animateFrom = -1
    }
    this.invalidateLayout()
    this.requestRender()
  }

  setBlind(blind: boolean) {
    if (blind === this.opts.blind) return
    this.opts.blind = blind
    this.invalidateLayout()
    this.requestRender()
  }
  setPrecision(pricePrecision: number, tickSize: number) {
    if (pricePrecision === this.opts.pricePrecision && tickSize === this.opts.tickSize) return
    if (pricePrecision !== this.opts.pricePrecision) {
      this.opts.pricePrecision = pricePrecision
      this.priceFormatter = this.createPriceFormatter()
    }
    this.opts.tickSize = tickSize
    this.requestRender()
  }

  setOverlays(overlays: ChartOverlayLevels) {
    if (
      overlays.entry === this.overlays.entry &&
      overlays.stop === this.overlays.stop &&
      overlays.target === this.overlays.target
    )
      return
    this.overlays = { ...overlays }
    this.invalidateLayout()
    this.requestRender()
  }

  setOrderLines(lines: readonly ChartOrderLine[]) {
    const filtered = lines.filter(isValidOrderLine)
    if (sameOrderLines(filtered, this.orderLines)) return
    this.orderLines = filtered.map((line) => ({ ...line }))
    const drag = this.drag
    if (drag.kind === 'order') {
      const active = filtered.find((line) => line.id === drag.id)
      if (!active || active.draggable === false) this.cancelDrag()
    }
    this.requestRender()
  }

  setDrawings(drawings: ChartDrawing[]) {
    this.drawings = drawings
    this.invalidateLayout()
    this.requestRender()
  }

  setExecutions(executions: readonly ChartExecution[]) {
    if (executions === this.executions) return
    this.executions = executions
    this.validExecutions = executions.filter(isValidExecution)
    this.invalidateLayout()
    this.requestRender()
  }

  setAnalysis(analysis: ChartAnalysis | null) {
    this.analysis = analysis
    this.requestRender()
  }

  setTool(tool: ChartTool) {
    this.tool = tool
    this.draft = null
    this.draftPoint = null
    this.canvas.style.cursor = 'crosshair'
    this.requestRender()
  }

  setOptions(options: Partial<ChartOptions>) {
    this.setPrecision(options.pricePrecision ?? this.opts.pricePrecision, options.tickSize ?? this.opts.tickSize)
    const styleChanged = options.chartStyle !== undefined && options.chartStyle !== this.opts.chartStyle
    const timeZoneChanged = options.timeZone !== undefined && options.timeZone !== this.opts.timeZone
    if (options.showVolume !== undefined && options.showVolume !== this.opts.showVolume) this.invalidateLayout()
    if (options.timeframeMinutes !== undefined && options.timeframeMinutes !== this.opts.timeframeMinutes) {
      this.crosshairDirty = true
    }
    if (options.showDates !== undefined && options.showDates !== this.opts.showDates) this.crosshairDirty = true
    this.opts = { ...this.opts, ...options }
    if (timeZoneChanged) {
      this.dateTimeFormatter = this.createDateTimeFormatter()
      this.crosshairDirty = true
    }
    if (styleChanged) this.invalidateLayout()
    if (this.opts.reducedMotion) this.animateFrom = -1
    if (!this.opts.overlayDraggable && this.drag.kind === 'overlay') this.cancelDrag()
    if (!this.opts.orderDraggable && this.drag.kind === 'order') this.cancelDrag()
    this.requestRender()
  }

  setTheme(theme: ChartTheme) {
    this.theme = theme
    this.themeDirty = false
    this.requestRender()
  }

  zoom(factor: number) {
    const center = this.viewport.end - this.viewport.span / 2
    const span = Math.max(28, Math.min(this.candles.length || 28, this.viewport.span * factor))
    this.viewport = clampViewport({ end: center + span / 2, span }, Math.max(2, this.visibleCount))
    this.follow = this.viewport.end >= this.visibleCount - 1.5
    this.emitViewport()
    this.requestRender()
  }

  fit() {
    const span = Math.max(28, Math.min(this.visibleCount || 72, 150))
    this.viewport = { end: Math.max(0, this.visibleCount - 1), span }
    this.follow = true
    this.emitViewport()
    this.requestRender()
  }

  scrollToLatest() {
    this.follow = true
    this.viewport.end = Math.max(0, this.visibleCount - 1)
    this.emitViewport()
    this.requestRender()
  }

  /** Anchor the viewport near a bar, e.g. the decision point after a reveal. */
  focusOn(index: number, span = 72) {
    this.follow = false
    const nextSpan = Math.max(28, Math.min(this.visibleCount || span, span))
    this.viewport = clampViewport({ end: index + nextSpan * 0.3, span: nextSpan }, Math.max(2, this.visibleCount))
    this.viewport.end = Math.min(this.viewport.end, Math.max(0, this.visibleCount - 1))
    this.emitViewport()
    this.requestRender()
  }

  /** Frame a revealed bar range (e.g. entry to exit) with padding. */
  focusRange(from: number, to: number) {
    if (this.visibleCount <= 0) return
    const last = this.visibleCount - 1
    const clampBar = (value: number, fallback: number) =>
      Number.isFinite(value) ? Math.max(0, Math.min(last, Math.round(value))) : fallback
    let first = clampBar(from, 0)
    let final = clampBar(to, last)
    if (final < first) [first, final] = [final, first]
    const bars = final - first + 1
    const padding = Math.max(6, Math.ceil(bars * 0.15))
    const span = Math.min(Math.max(72, bars + padding * 2), this.visibleCount)
    const center = (first + final) / 2
    this.follow = false
    this.viewport = clampViewport({ end: center + span / 2 - 0.5, span }, Math.max(2, this.visibleCount))
    this.emitViewport()
    this.requestRender()
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.resizeObserver?.disconnect()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('dblclick', this.onDoubleClick)
    window.removeEventListener('resize', this.measure)
  }

  private attach() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerCancel)
    this.canvas.addEventListener('pointerleave', this.onPointerLeave)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('dblclick', this.onDoubleClick)
    window.addEventListener('resize', this.measure)
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.measure())
      this.resizeObserver.observe(this.canvas)
    }
  }

  private measure = () => {
    const bounds = this.canvas.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    if (bounds.width === this.width && bounds.height === this.height && dpr === this.dpr) return
    this.width = bounds.width
    this.height = bounds.height
    this.dpr = dpr
    this.canvas.width = Math.round(bounds.width * dpr)
    this.canvas.height = Math.round(bounds.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.invalidateLayout()
    this.requestRender()
  }

  private invalidateLayout() {
    this.frameLayout = null
    this.crosshairDirty = true
  }

  private requestRender() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  private layout(): {
    price: Rect
    volume: Rect
    plot: Rect
    geo: ReturnType<typeof createIndexGeometry>
    scale: ReturnType<typeof createPriceScale>
  } {
    const volumeHeight = this.opts.showVolume ? Math.min(58, this.height * 0.16) : 0
    const priceHeight = Math.max(48, this.height - PAD_TOP - TIME_AXIS - volumeHeight - (volumeHeight ? 8 : 0))
    const plotWidth = Math.max(20, this.width - PAD_LEFT - AXIS_WIDTH)
    const price = rect(PAD_LEFT, PAD_TOP, plotWidth, priceHeight)
    const volume = rect(PAD_LEFT, price.bottom + 8, plotWidth, volumeHeight)
    const plot = rect(PAD_LEFT, PAD_TOP, plotWidth, price.bottom - PAD_TOP + (volumeHeight ? 8 + volumeHeight : 0))
    const geo = createIndexGeometry(this.viewport, price)
    const end = Math.min(this.visibleCount - 1, Math.floor(this.viewport.end))
    const start = Math.max(0, Math.floor(geo.start) - 1)
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    const display = this.displayCandles()
    for (let index = start; index <= end; index += 1) {
      const candle = display[index]
      if (!candle) continue
      if (candle.low < min) min = candle.low
      if (candle.high > max) max = candle.high
    }
    for (const level of [this.overlays.entry, this.overlays.stop, this.overlays.target]) {
      if (level != null) {
        min = Math.min(min, level)
        max = Math.max(max, level)
      }
    }
    for (const drawing of this.drawings) {
      for (const point of drawing.points) {
        min = Math.min(min, point.price)
        max = Math.max(max, point.price)
      }
    }
    if (!this.opts.blind) {
      for (const execution of this.validExecutions) {
        if (execution.entryBar >= this.candles.length || execution.exitBar >= this.candles.length) continue
        if (this.markerOnScreen(execution.entryBar, geo, price)) {
          min = Math.min(min, execution.entryPrice)
          max = Math.max(max, execution.entryPrice)
        }
        if (this.markerOnScreen(execution.exitBar, geo, price)) {
          min = Math.min(min, execution.exitPrice)
          max = Math.max(max, execution.exitPrice)
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0
      max = 1
    }
    if (max - min < 1e-9) {
      min -= 1
      max += 1
    }
    return { price, volume, plot, geo, scale: createPriceScale(min, max, price) }
  }

  private markerOnScreen(bar: number, geo: ReturnType<typeof createIndexGeometry>, area: Rect): boolean {
    if (bar < 0 || bar >= this.visibleCount) return false
    const x = geo.x(bar)
    return x >= area.left && x <= area.right
  }

  render() {
    if (!this.width || !this.height) return
    const ctx = this.ctx
    const layout = this.layout()
    this.frameLayout = layout
    const { price, volume, plot, geo, scale } = layout
    const end = Math.min(this.visibleCount - 1, Math.floor(this.viewport.end))
    const start = Math.max(0, Math.floor(geo.start) - 1)
    if (this.crosshairDirty) this.emitCrosshair(this.hover)

    ctx.clearRect(0, 0, this.width, this.height)
    this.drawGrid(price, geo, scale)

    ctx.save()
    ctx.beginPath()
    ctx.rect(plot.left, plot.top, plot.width, plot.height)
    ctx.clip()
    if (this.analysis) {
      this.drawAnalysisProfile(plot, scale)
      this.drawAnalysisZones(plot, geo, scale, plot.width < 520)
    }
    if (this.opts.showVolume && volume.height > 0) this.drawVolume(volume, geo, scale, start, end)
    this.drawCandles(price, geo, scale, start, end)
    this.drawOverlays(plot, scale)
    this.drawDrawings(plot, geo, scale)
    if (this.analysis) this.drawAnalysisSeries(plot, geo, scale)
    this.drawOrderLines(price, scale)
    this.drawExecutions(price, geo, scale)
    if (this.opts.blind && this.opts.showWatermark) this.drawWatermark(price)
    ctx.restore()

    this.drawAxes(price, geo, scale)
    this.drawLastPrice(price, geo, scale, end)
    if (this.analysis) {
      this.drawAnalysisLevels(plot, scale, plot.width < 520)
      this.drawAnalysisMarkers(plot, geo, scale, plot.width < 520)
    }
    this.drawCrosshair(plot, geo, scale)
    if (this.draft) this.drawDraft(plot, geo, scale)

    const animating =
      !this.opts.reducedMotion &&
      this.animateFrom >= start &&
      this.animateFrom <= end &&
      performance.now() - this.lastPaintAt < 200
    if (animating) this.requestRender()
    else this.animateFrom = -1
  }

  private drawGrid(
    area: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
  ) {
    const ctx = this.ctx
    ctx.strokeStyle = this.theme.grid
    ctx.lineWidth = 1

    for (const tick of scale.ticks) {
      const y = Math.round(scale.y(tick)) + 0.5
      if (y < area.top || y > area.bottom) continue
      ctx.beginPath()
      ctx.moveTo(area.left, y)
      ctx.lineTo(area.right, y)
      ctx.stroke()
    }

    const step = Math.max(1, Math.ceil(80 / geo.slot))
    const first = Math.ceil(geo.start / step) * step
    for (let index = first; index <= geo.start + geo.span; index += step) {
      if (index < 0) continue
      const x = Math.round(geo.x(index)) + 0.5
      if (x < area.left || x > area.right) continue
      ctx.beginPath()
      ctx.moveTo(x, area.top)
      ctx.lineTo(x, area.bottom + (this.opts.showVolume ? 66 : 0))
      ctx.stroke()
    }
  }

  private drawCandles(
    area: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
    start: number,
    end: number,
  ) {
    const style = this.opts.chartStyle
    if (style === 'line') {
      this.drawCloseLine(geo, scale, start, end)
      return
    }

    const ctx = this.ctx
    const candles = this.displayCandles()
    const slot = geo.slot
    const width = Math.max(1, Math.min(14, slot * 0.62))
    const now = performance.now()
    const animate = !this.opts.reducedMotion && this.animateFrom >= 0 && now - this.lastPaintAt < 190
    const progress = animate ? Math.min(1, (now - this.lastPaintAt) / 190) : 1
    const eased = 1 - Math.pow(1 - progress, 3)

    for (let index = start; index <= end; index += 1) {
      const candle = candles[index]
      if (!candle) continue
      const x = geo.x(index)
      if (x < area.left - width || x > area.right + width) continue
      const up = candle.close >= candle.open
      const color = up ? this.theme.bull : this.theme.bear
      const isLast = index === end
      const openY = scale.y(candle.open)
      let closeY = scale.y(candle.close)
      let highY = scale.y(candle.high)
      let lowY = scale.y(candle.low)

      if (index === this.animateFrom && animate && eased < 1) {
        const openPixel = openY
        closeY = openPixel + (closeY - openPixel) * eased
        highY = openPixel + (highY - openPixel) * eased
        lowY = openPixel + (lowY - openPixel) * eased
      }

      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 1
      const xCenter = Math.round(x) + 0.5
      if (style === 'ohlc') {
        const tick = Math.max(2, Math.min(6, Math.round(width / 2)))
        ctx.beginPath()
        ctx.moveTo(xCenter, highY)
        ctx.lineTo(xCenter, lowY)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(xCenter - tick, openY)
        ctx.lineTo(xCenter, openY)
        ctx.moveTo(xCenter, closeY)
        ctx.lineTo(xCenter + tick, closeY)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(xCenter, highY)
        ctx.lineTo(xCenter, lowY)
        ctx.stroke()

        const top = Math.min(openY, closeY)
        const height = Math.max(1, Math.abs(closeY - openY))
        ctx.globalAlpha = 0.92
        ctx.fillRect(Math.round(x - width / 2), Math.round(top), Math.round(width), Math.round(height))
        ctx.globalAlpha = 1
      }

      if (isLast) {
        ctx.fillStyle = this.theme.clay
        ctx.globalAlpha = 0.16
        ctx.fillRect(Math.round(x - width / 2) - 2, highY - 2, Math.round(width) + 4, Math.max(4, lowY - highY + 4))
        ctx.globalAlpha = 1
      }
    }
  }

  private drawCloseLine(
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
    start: number,
    end: number,
  ) {
    const candles = this.displayCandles()
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = this.theme.text
    ctx.globalAlpha = 0.86
    ctx.lineWidth = 1.4
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let drawing = false
    for (let index = Math.max(0, start); index <= end; index += 1) {
      const candle = candles[index]
      if (!candle) continue
      const x = geo.x(index)
      const y = scale.y(candle.close)
      if (!drawing) {
        ctx.moveTo(x, y)
        drawing = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    if (drawing) ctx.stroke()
    ctx.restore()
  }

  private displayCandles(): Candle[] {
    const style = this.opts.chartStyle
    if (style !== 'heikin-ashi') return this.candles
    const cache = this.displayCache
    const target = this.visibleCount
    if (cache.source !== this.candles || cache.style !== style) {
      cache.source = this.candles
      cache.style = style
      cache.built = 0
      cache.data = []
    }
    if (cache.built > target) {
      cache.data.length = target
      cache.built = target
    }
    const data = cache.data
    for (let index = cache.built; index < target; index += 1) {
      const candle = this.candles[index]
      if (!candle) break
      const previous = index > 0 ? data[index - 1] : undefined
      const close = (candle.open + candle.high + candle.low + candle.close) / 4
      const open = previous ? (previous.open + previous.close) / 2 : (candle.open + candle.close) / 2
      const high = Math.max(candle.high, open, close)
      const low = Math.min(candle.low, open, close)
      data.push({ time: candle.time, open, high, low, close, volume: candle.volume })
      cache.built = index + 1
    }
    return data
  }

  private drawVolume(
    area: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    _scale: ReturnType<typeof createPriceScale>,
    start: number,
    end: number,
  ) {
    const ctx = this.ctx
    let maxVolume = 1
    for (let index = start; index <= end; index += 1) {
      const candle = this.candles[index]
      if (candle) maxVolume = Math.max(maxVolume, candle.volume)
    }
    const width = Math.max(1, Math.min(14, geo.slot * 0.62))
    for (let index = start; index <= end; index += 1) {
      const candle = this.candles[index]
      if (!candle) continue
      const x = geo.x(index)
      const height = Math.max(1, (candle.volume / maxVolume) * area.height)
      ctx.fillStyle = candle.close >= candle.open ? this.theme.bull : this.theme.bear
      ctx.globalAlpha = 0.18
      ctx.fillRect(Math.round(x - width / 2), area.bottom - height, Math.round(width), height)
      ctx.globalAlpha = 1
    }
  }

  private drawOverlays(plot: Rect, scale: ReturnType<typeof createPriceScale>) {
    const ctx = this.ctx
    const { entry, stop, target } = this.overlays
    if (entry != null && stop != null) {
      const y1 = scale.y(entry)
      const y2 = scale.y(stop)
      ctx.fillStyle = this.theme.bearSoft
      ctx.fillRect(plot.left, Math.min(y1, y2), plot.width, Math.abs(y2 - y1))
    }
    if (entry != null && target != null) {
      const y1 = scale.y(entry)
      const y2 = scale.y(target)
      ctx.fillStyle = this.theme.bullSoft
      ctx.fillRect(plot.left, Math.min(y1, y2), plot.width, Math.abs(y2 - y1))
    }

    const rows: { price: number | null; color: string; label: string; dash: number[] }[] = [
      { price: entry, color: this.theme.text, label: 'ENTRY', dash: [5, 4] },
      { price: stop, color: this.theme.bear, label: 'STOP', dash: [] },
      { price: target, color: this.theme.bull, label: 'TARGET', dash: [] },
    ]
    for (const row of rows) {
      if (row.price == null) continue
      const y = Math.round(scale.y(row.price)) + 0.5
      if (y < plot.top || y > plot.bottom) continue
      ctx.save()
      ctx.strokeStyle = row.color
      ctx.globalAlpha = 0.72
      ctx.lineWidth = 1
      ctx.setLineDash(row.dash)
      ctx.beginPath()
      ctx.moveTo(plot.left, y)
      ctx.lineTo(plot.right, y)
      ctx.stroke()
      ctx.restore()

      // On the review chart the fill labels take priority; the plan lines stay
      // but their tags would sit underneath the fill callouts on narrow widths.
      if (this.opts.showOverlayLabels) {
        const label = this.opts.blind ? `${row.label} · ${'•••'}` : `${row.label} ${this.formatPrice(row.price)}`
        ctx.font = `10px ${this.theme.fontMono}`
        const width = ctx.measureText(label).width + 10
        const tagX = plot.right - width - 2
        ctx.fillStyle = row.color
        ctx.globalAlpha = 0.12
        ctx.fillRect(tagX, y - 8, width, 16)
        ctx.globalAlpha = 1
        ctx.fillStyle = row.color
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, tagX + 5, y)
      }

      if (this.opts.overlayDraggable) {
        ctx.beginPath()
        ctx.arc(plot.right - 4, y, 3.2, 0, Math.PI * 2)
        ctx.fillStyle = row.color
        ctx.fill()
        ctx.strokeStyle = this.theme.surface
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }
  }

  private drawOrderLines(plot: Rect, scale: ReturnType<typeof createPriceScale>) {
    if (!this.orderLines.length) return
    const ctx = this.ctx
    const height = ORDER_TAG_HEIGHT
    ctx.save()
    ctx.beginPath()
    ctx.rect(plot.left, plot.top, plot.width, plot.height)
    ctx.clip()
    for (const line of this.orderLines) {
      const y = scale.y(line.price)
      // Resting orders never resize the price scale, so off-scale levels are skipped
      // instead of stretching the plot to fit them.
      if (!Number.isFinite(y) || y < plot.top || y > plot.bottom) continue
      const color = line.side === 'long' ? this.theme.bull : this.theme.bear
      const lineY = Math.max(plot.top + 0.5, Math.min(plot.bottom - 0.5, Math.round(y) + 0.5))
      ctx.save()
      ctx.strokeStyle = color
      ctx.globalAlpha = line.protective ? 0.75 : 1
      ctx.lineWidth = line.protective ? 1 : 1.5
      ctx.setLineDash(line.kind === 'stop' ? [4, 3] : [])
      ctx.beginPath()
      ctx.moveTo(plot.left, lineY)
      ctx.lineTo(plot.right, lineY)
      ctx.stroke()
      ctx.setLineDash([])

      const text = `${line.label} ${line.qty}`
      ctx.font = `10px ${this.theme.fontMono}`
      const showCancel = this.canOrderCancel() && line.draggable !== false
      const reserve = showCancel ? ORDER_CANCEL_SIZE + ORDER_CANCEL_GAP : 0
      const width = Math.max(24, Math.min(plot.width - 4 - reserve, Math.ceil(ctx.measureText(text).width) + 10))
      const centerY = Math.max(plot.top + height / 2, Math.min(plot.bottom - height / 2, y))
      const tagX = Math.max(plot.left + 2 + reserve, plot.right - width - 2)
      ctx.globalAlpha = 1
      ctx.fillStyle = this.theme.surface
      this.roundRect(tagX, centerY - height / 2, width, height, 3)
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = color
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, tagX + 5, centerY, Math.max(1, width - 10))

      if (showCancel) this.drawOrderCancel(this.orderCancelRect(line, plot, centerY), color)
      ctx.restore()
    }
    ctx.restore()
  }

  private canOrderCancel(): boolean {
    return (
      this.opts.orderDraggable &&
      !this.opts.blind &&
      this.tool === 'cursor' &&
      typeof this.callbacks.onOrderCancel === 'function'
    )
  }

  private orderCancelRect(line: ChartOrderLine, plot: Rect, centerY: number): Rect {
    const ctx = this.ctx
    ctx.font = `10px ${this.theme.fontMono}`
    const text = `${line.label} ${line.qty}`
    const reserve = ORDER_CANCEL_SIZE + ORDER_CANCEL_GAP
    const width = Math.max(24, Math.min(plot.width - 4 - reserve, Math.ceil(ctx.measureText(text).width) + 10))
    const tagX = Math.max(plot.left + 2 + reserve, plot.right - width - 2)
    return rect(
      tagX - ORDER_CANCEL_GAP - ORDER_CANCEL_SIZE,
      centerY - ORDER_CANCEL_SIZE / 2,
      ORDER_CANCEL_SIZE,
      ORDER_CANCEL_SIZE,
    )
  }

  private drawOrderCancel(area: Rect, color: string) {
    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = 1
    ctx.fillStyle = this.theme.surface
    this.roundRect(area.left, area.top, area.width, area.height, 3)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.stroke()
    const inset = 4
    const cx = area.left + area.width / 2
    const cy = area.top + area.height / 2
    ctx.beginPath()
    ctx.moveTo(cx - inset, cy - inset)
    ctx.lineTo(cx + inset, cy + inset)
    ctx.moveTo(cx + inset, cy - inset)
    ctx.lineTo(cx - inset, cy + inset)
    ctx.stroke()
    ctx.restore()
  }

  private drawDrawings(
    plot: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
  ) {
    const ctx = this.ctx
    for (const drawing of this.drawings) {
      const [first, second] = drawing.points
      if (!first) continue
      const color = drawing.color ?? this.theme.textMuted
      ctx.save()
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.85

      if (drawing.type === 'horizontal') {
        const y = scale.y(first.price)
        ctx.beginPath()
        ctx.moveTo(plot.left, y)
        ctx.lineTo(plot.right, y)
        ctx.stroke()
        this.drawPoint(geo.x(first.index), y, color)
      } else if (first && second) {
        const x1 = geo.x(first.index)
        const y1 = scale.y(first.price)
        const x2 = geo.x(second.index)
        const y2 = scale.y(second.price)
        if (drawing.type === 'trend') {
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
          this.drawPoint(x1, y1, color)
          this.drawPoint(x2, y2, color)
        } else {
          const levels = fibLevels(first.price, second.price)
          const left = Math.min(x1, x2)
          const right = Math.max(x1, x2)
          const width = Math.max(20, right - left)
          ctx.globalAlpha = 0.06
          ctx.fillStyle = this.theme.clay
          ctx.fillRect(
            left,
            scale.y(Math.max(first.price, second.price)),
            width,
            Math.abs(scale.y(first.price) - scale.y(second.price)),
          )
          ctx.globalAlpha = 0.9
          ctx.font = `9.5px ${this.theme.fontMono}`
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          for (const level of levels) {
            const y = scale.y(level.price)
            ctx.globalAlpha = level.ratio === 0 || level.ratio === 1 ? 0.9 : 0.55
            ctx.setLineDash(level.ratio === 0.5 ? [4, 4] : [])
            ctx.beginPath()
            ctx.moveTo(left, y)
            ctx.lineTo(left + width, y)
            ctx.stroke()
            ctx.setLineDash([])
            const text = this.opts.blind ? level.label : `${level.label} · ${this.formatPrice(level.price)}`
            ctx.fillText(text, left + 4, y - 7)
          }
          ctx.globalAlpha = 0.9
          this.drawPoint(x1, y1, color)
          this.drawPoint(x2, y2, color)
        }
      }
      ctx.restore()
    }
  }

  private drawPoint(x: number, y: number, color: string) {
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, 2.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawExecutions(
    area: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
  ) {
    if (this.opts.blind || !this.validExecutions.length) return
    const ctx = this.ctx
    ctx.save()
    ctx.beginPath()
    ctx.rect(area.left, area.top, area.width, area.height)
    ctx.clip()
    for (const execution of this.validExecutions) {
      if (execution.entryBar >= this.candles.length || execution.exitBar >= this.candles.length) continue
      const entryVisible = this.markerOnScreen(execution.entryBar, geo, area)
      const exitVisible = this.markerOnScreen(execution.exitBar, geo, area)
      if (!entryVisible && !exitVisible) continue
      const entryX = geo.x(execution.entryBar)
      const entryY = scale.y(execution.entryPrice)
      const exitX = geo.x(execution.exitBar)
      const exitY = scale.y(execution.exitPrice)
      if (entryVisible && exitVisible) this.drawExecutionConnector(entryX, entryY, exitX, exitY)
      if (entryVisible) {
        const color = execution.side === 'long' ? this.theme.bull : this.theme.bear
        this.drawExecutionLabel(area, entryX, entryY, execution.entryLabel, execution.entryPrice, color, false)
        this.drawExecutionEntry(entryX, entryY, execution.side)
      }
      if (exitVisible) {
        this.drawExecutionLabel(area, exitX, exitY, execution.exitLabel, execution.exitPrice, this.theme.clay, true)
        this.drawExecutionExit(exitX, exitY)
      }
    }
    ctx.restore()
  }

  private drawExecutionConnector(x1: number, y1: number, x2: number, y2: number) {
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = this.theme.clay
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  private drawExecutionEntry(x: number, y: number, side: 'long' | 'short') {
    const ctx = this.ctx
    const radius = EXECUTION_MARKER_RADIUS
    const halfBase = radius * Math.cos(Math.PI / 6)
    const baseOffset = radius * Math.sin(Math.PI / 6)
    const long = side === 'long'
    ctx.save()
    ctx.fillStyle = long ? this.theme.bull : this.theme.bear
    ctx.beginPath()
    ctx.moveTo(x, long ? y - radius : y + radius)
    ctx.lineTo(x - halfBase, long ? y + baseOffset : y - baseOffset)
    ctx.lineTo(x + halfBase, long ? y + baseOffset : y - baseOffset)
    ctx.closePath()
    ctx.fill()
    // Keyline against the surface keeps the fill marker visible on a dense tape.
    ctx.strokeStyle = this.theme.surface
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  private drawExecutionExit(x: number, y: number) {
    const ctx = this.ctx
    const radius = EXECUTION_MARKER_RADIUS - 1.5
    ctx.save()
    ctx.fillStyle = this.theme.clay
    ctx.beginPath()
    ctx.moveTo(x, y - radius)
    ctx.lineTo(x + radius, y)
    ctx.lineTo(x, y + radius)
    ctx.lineTo(x - radius, y)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = this.theme.surface
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  private drawExecutionLabel(
    area: Rect,
    x: number,
    y: number,
    label: string,
    price: number,
    color: string,
    above: boolean,
  ) {
    const ctx = this.ctx
    const text = label ? `${label} ${this.formatPrice(price)}` : this.formatPrice(price)
    ctx.font = `10px ${this.theme.fontMono}`
    const width = Math.ceil(ctx.measureText(text).width) + 10
    if (width > area.width - 2) return
    const boxY = above ? y - EXECUTION_LABEL_GAP - EXECUTION_LABEL_HEIGHT : y + EXECUTION_LABEL_GAP
    if (boxY < area.top || boxY + EXECUTION_LABEL_HEIGHT > area.bottom) return
    const boxX = Math.max(area.left, Math.min(area.right - width, x - width / 2))
    const leaderX = Math.max(boxX + 3, Math.min(boxX + width - 3, x))
    const leaderY = above ? boxY + EXECUTION_LABEL_HEIGHT : boxY
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(leaderX, leaderY)
    ctx.stroke()
    // Near-opaque plate: candles and zone shading otherwise bleed through and
    // make the 10px fill label unreadable over a busy tape.
    ctx.globalAlpha = 0.98
    ctx.fillStyle = this.theme.surface
    ctx.fillRect(boxX, boxY, width, EXECUTION_LABEL_HEIGHT)
    ctx.globalAlpha = 0.45
    ctx.strokeStyle = color
    ctx.strokeRect(Math.round(boxX) + 0.5, Math.round(boxY) + 0.5, width - 1, EXECUTION_LABEL_HEIGHT - 1)
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, boxX + 5, boxY + EXECUTION_LABEL_HEIGHT / 2)
    ctx.restore()
  }

  private drawLastPrice(
    area: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
    end: number,
  ) {
    const candle = this.candles[end]
    if (!candle) return
    const ctx = this.ctx
    const y = Math.round(scale.y(candle.close)) + 0.5
    ctx.save()
    ctx.strokeStyle = this.theme.priceLine
    ctx.lineWidth = 1
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(area.left, y)
    ctx.lineTo(area.right, y)
    ctx.stroke()
    ctx.setLineDash([])

    const label = this.opts.blind ? '•••' : this.formatPrice(candle.close)
    ctx.font = `10.5px ${this.theme.fontMono}`
    const width = Math.max(38, ctx.measureText(label).width + 12)
    ctx.fillStyle = this.theme.clay
    this.roundRect(area.right + 2, y - 9, Math.min(AXIS_WIDTH - 4, width), 18, 3)
    ctx.fill()
    ctx.fillStyle = this.theme.onClay
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, area.right + 2 + Math.min(AXIS_WIDTH - 4, width) / 2, y + 0.5)

    ctx.fillStyle = this.theme.clay
    ctx.beginPath()
    ctx.arc(geo.x(end), scale.y(candle.close), 3.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawAxes(
    area: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
  ) {
    const ctx = this.ctx
    ctx.strokeStyle = this.theme.axis
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(area.left, area.bottom + 0.5)
    ctx.lineTo(area.right, area.bottom + 0.5)
    ctx.stroke()

    ctx.font = `10px ${this.theme.fontMono}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    for (const tick of scale.ticks) {
      const y = Math.round(scale.y(tick)) + 0.5
      if (y < area.top || y > area.bottom) continue
      const label = this.opts.blind ? '•••' : this.formatPrice(tick)
      ctx.fillStyle = this.opts.blind ? this.theme.textMuted : this.theme.axisText
      ctx.fillText(label, area.right + 8, y)
    }

    ctx.fillStyle = this.theme.axisText
    ctx.font = `9.5px ${this.theme.fontMono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const step = Math.max(1, Math.ceil(80 / geo.slot))
    const end = Math.min(this.visibleCount - 1, Math.floor(this.viewport.end))
    const daily = this.opts.timeframeMinutes > 1440
    const first = Math.ceil(geo.start / step) * step
    const ticks: number[] = []
    for (let index = first; index <= geo.start + geo.span; index += step) {
      if (index >= 0 && index <= end) ticks.push(index)
    }

    // Day boundaries get their own date label even when they fall between ticks,
    // and any tick too close to it is dropped so the two labels never overlap.
    const boundaries = new Set<number>()
    if (this.opts.showDates && !daily && !this.opts.blind) {
      const from = Math.max(0, Math.ceil(geo.start))
      const until = Math.min(end, Math.floor(geo.start + geo.span))
      let previous = from > 0 ? this.formatDate(this.candles[from - 1]?.time ?? 0) : ''
      for (let index = from; index <= until; index += 1) {
        const date = this.formatDate(this.candles[index]?.time ?? 0)
        if (date !== previous) {
          if (previous !== '') boundaries.add(index)
          previous = date
        }
      }
    }
    if (boundaries.size) {
      const boundaryX = [...boundaries].map((index) => geo.x(index))
      for (let cursor = ticks.length - 1; cursor >= 0; cursor -= 1) {
        const tickX = geo.x(ticks[cursor]!)
        if (boundaryX.some((x) => Math.abs(x - tickX) < 46)) ticks.splice(cursor, 1)
      }
    }
    const labels = [...ticks, ...boundaries].sort((left, right) => left - right)

    let lastLabeledDate = ''
    for (const index of labels) {
      const x = geo.x(index)
      const offset = index - end
      let label: string
      if (this.opts.blind) {
        label = formatRelativeBars(offset, this.opts.timeframeMinutes)
      } else {
        const stamp = this.candles[index]?.time ?? 0
        if (daily) {
          label = this.formatDate(stamp)
        } else if (this.opts.showDates) {
          const date = this.formatDate(stamp)
          label = date !== lastLabeledDate ? date.slice(5) : this.formatTime(stamp)
          lastLabeledDate = date
        } else {
          label = this.formatTime(stamp)
        }
      }
      ctx.fillText(label, x, area.bottom + 6)
    }
    void scale
  }

  private drawCrosshair(
    plot: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
  ) {
    if (!this.hover || this.visibleCount === 0) return
    const { x, y } = this.hover
    if (x < plot.left || x > plot.right || y < plot.top || y > plot.bottom) return
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = this.theme.crosshair
    ctx.lineWidth = 1
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(Math.round(x) + 0.5, plot.top)
    ctx.lineTo(Math.round(x) + 0.5, plot.bottom)
    ctx.moveTo(plot.left, Math.round(y) + 0.5)
    ctx.lineTo(plot.right, Math.round(y) + 0.5)
    ctx.stroke()
    ctx.setLineDash([])

    const price = scale.price(y)
    const priceLabel = this.opts.blind ? '•••' : this.formatPrice(price)
    const width = 52
    ctx.fillStyle = this.theme.text
    this.roundRect(plot.right + 2, y - 8, width, 16, 3)
    ctx.fill()
    ctx.fillStyle = this.theme.surface
    ctx.font = `10px ${this.theme.fontMono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(priceLabel, plot.right + 2 + width / 2, y)

    const index = Math.max(0, Math.min(this.visibleCount - 1, Math.round(geo.indexAt(x))))
    const end = Math.min(this.visibleCount - 1, Math.floor(this.viewport.end))
    const timeLabel = this.opts.blind
      ? formatRelativeBars(index - end, this.opts.timeframeMinutes)
      : this.formatDateTime(this.candles[index]?.time ?? 0)
    const timeWidth = ctx.measureText(timeLabel).width + 14
    ctx.fillStyle = this.theme.text
    this.roundRect(x - timeWidth / 2, plot.bottom + 4, timeWidth, 16, 3)
    ctx.fill()
    ctx.fillStyle = this.theme.surface
    ctx.fillText(timeLabel, x, plot.bottom + 12)
    ctx.restore()
  }

  private drawDraft(
    plot: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
  ) {
    if (!this.draft) return
    const ctx = this.ctx
    const [anchor, point] = this.draft.points
    if (!anchor || !point) return
    const x1 = geo.x(anchor.index)
    const y1 = scale.y(anchor.price)
    const x2 = geo.x(point.index)
    const y2 = scale.y(point.price)
    ctx.save()
    ctx.strokeStyle = this.theme.clay
    ctx.fillStyle = this.theme.clay
    ctx.lineWidth = 1.2
    ctx.setLineDash([4, 3])
    if (this.draft.type === 'horizontal') {
      ctx.beginPath()
      ctx.moveTo(plot.left, y1)
      ctx.lineTo(plot.right, y1)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      this.drawPoint(x1, y1, this.theme.clay)
      this.drawPoint(x2, y2, this.theme.clay)
    }
    ctx.restore()
  }

  private drawWatermark(area: Rect) {
    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = 0.045
    ctx.fillStyle = this.theme.text
    ctx.font = `600 ${Math.min(96, Math.max(40, area.height * 0.16))}px ${this.theme.fontSans}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('BLIND', area.left + area.width / 2, area.top + area.height / 2)
    ctx.restore()
  }

  private roundRect(x: number, y: number, width: number, height: number, radius: number) {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.arcTo(x + width, y, x + width, y + height, radius)
    ctx.arcTo(x + width, y + height, x, y + height, radius)
    ctx.arcTo(x, y + height, x, y, radius)
    ctx.arcTo(x, y, x + width, y, radius)
    ctx.closePath()
  }

  private createPriceFormatter() {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: this.opts.pricePrecision,
      maximumFractionDigits: this.opts.pricePrecision,
    })
  }

  private createDateTimeFormatter() {
    try {
      this.effectiveTimeZone = this.opts.timeZone
      return this.buildDateTimeFormatter(this.opts.timeZone)
    } catch {
      this.effectiveTimeZone = 'UTC'
      return this.buildDateTimeFormatter('UTC')
    }
  }

  private buildDateTimeFormatter(timeZone: string) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
  }

  private dateParts(unixSeconds: number): { year: string; month: string; day: string; hour: string; minute: string } {
    const parts = this.dateTimeFormatter.formatToParts(new Date(unixSeconds * 1000))
    let year = ''
    let month = ''
    let day = ''
    let hour = ''
    let minute = ''
    for (const part of parts) {
      if (part.type === 'year') year = part.value
      else if (part.type === 'month') month = part.value
      else if (part.type === 'day') day = part.value
      else if (part.type === 'hour') hour = part.value
      else if (part.type === 'minute') minute = part.value
    }
    return { year, month, day, hour, minute }
  }

  private formatPrice(price: number): string {
    return this.priceFormatter.format(price)
  }

  private formatTime(unixSeconds: number): string {
    const { hour, minute } = this.dateParts(unixSeconds)
    return `${hour}:${minute}`
  }

  private formatDate(unixSeconds: number): string {
    const { year, month, day } = this.dateParts(unixSeconds)
    return `${year}-${month}-${day}`
  }

  /** Full unblinded stamp with an explicit zone so reviewers never guess the session clock. */
  private formatDateTime(unixSeconds: number): string {
    return `${this.formatDate(unixSeconds)} ${this.formatTime(unixSeconds)} ${this.effectiveTimeZone}`
  }

  private cancelDrag() {
    if (this.drag.kind === 'none' && !this.draft) return
    this.drag = { kind: 'none' }
    this.draft = null
    this.draftPoint = null
    this.canvas.style.cursor = 'crosshair'
  }

  private pointerPosition(event: PointerEvent): { x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  private currentLayout() {
    if (!this.frameLayout) this.frameLayout = this.layout()
    return this.frameLayout
  }

  private plotRect(): Rect {
    return this.currentLayout().plot
  }

  private priceScale() {
    return this.currentLayout().scale
  }

  private indexGeometry() {
    return this.currentLayout().geo
  }

  private emitCrosshair(point: { x: number; y: number } | null) {
    this.crosshairDirty = false
    if (!this.callbacks.onCrosshair) return
    const plot = this.plotRect()
    if (!point || point.x < plot.left || point.x > plot.right || point.y < plot.top || point.y > plot.bottom) {
      this.callbacks.onCrosshair(null)
      return
    }
    const geo = this.indexGeometry()
    const index = Math.round(geo.indexAt(point.x))
    const candle = this.candles[index]
    if (!candle || index >= this.visibleCount) {
      this.callbacks.onCrosshair(null)
      return
    }
    const end = Math.min(this.visibleCount - 1, Math.floor(this.viewport.end))
    this.callbacks.onCrosshair({
      index,
      candle,
      x: point.x,
      y: point.y,
      relativeLabel: formatRelativeBars(index - end, this.opts.timeframeMinutes),
      timeLabel: this.opts.blind ? undefined : this.formatDateTime(candle.time),
    })
  }

  private hitOrderLine(y: number): ChartOrderLine | null {
    if (!this.opts.orderDraggable) return null
    const { price, scale } = this.currentLayout()
    if (y < price.top || y > price.bottom) return null
    for (const line of this.orderLines) {
      if (line.draggable === false) continue
      const lineY = scale.y(line.price)
      if (lineY >= price.top && lineY <= price.bottom && Math.abs(lineY - y) <= ORDER_HIT_SLOP) return line
    }
    return null
  }

  private hitOrderCancel(x: number, y: number): ChartOrderLine | null {
    if (!this.canOrderCancel()) return null
    const { price, scale } = this.currentLayout()
    if (y < price.top || y > price.bottom) return null
    for (const line of this.orderLines) {
      if (line.draggable === false) continue
      const lineY = scale.y(line.price)
      if (lineY < price.top || lineY > price.bottom) continue
      const centerY = Math.max(price.top + ORDER_TAG_HEIGHT / 2, Math.min(price.bottom - ORDER_TAG_HEIGHT / 2, lineY))
      const area = this.orderCancelRect(line, price, centerY)
      if (x >= area.left && x <= area.right && y >= area.top && y <= area.bottom) return line
    }
    return null
  }

  private hitOverlay(y: number): keyof ChartOverlayLevels | null {
    if (!this.opts.overlayDraggable) return null
    const scale = this.priceScale()
    const levels: (keyof ChartOverlayLevels)[] = ['entry', 'stop', 'target']
    for (const level of levels) {
      const price = this.overlays[level]
      if (price == null) continue
      if (Math.abs(scale.y(price) - y) <= 6) return level
    }
    return null
  }

  private onPointerDown = (event: PointerEvent) => {
    this.canvas.setPointerCapture(event.pointerId)
    const point = this.pointerPosition(event)
    const plot = this.plotRect()
    if (point.x < plot.left || point.x > plot.right) return

    if (this.tool === 'cursor') {
      // The cancel affordance owns its pixels before the line's y-band does.
      const cancel = this.hitOrderCancel(point.x, point.y)
      if (cancel) {
        this.cancelDrag()
        this.callbacks.onOrderCancel?.(cancel.id)
        this.requestRender()
        return
      }
      // Working orders sit above the legacy plan lines: a click near both must
      // grab the live order rather than move the review overlay.
      const order = this.hitOrderLine(point.y)
      if (order) {
        this.drag = { kind: 'order', id: order.id, price: clampPriceToTick(order.price, this.opts.tickSize) }
        this.canvas.style.cursor = 'grabbing'
        return
      }
      const hit = this.hitOverlay(point.y)
      if (hit) {
        this.drag = { kind: 'overlay', level: hit }
        return
      }
      const { price } = this.currentLayout()
      this.drag = {
        kind: 'pan',
        startX: point.x,
        startY: point.y,
        startEnd: this.viewport.end,
        inside: point.y >= price.top && point.y <= price.bottom,
        distance: 0,
      }
      this.canvas.style.cursor = 'grabbing'
      return
    }

    const geo = this.indexGeometry()
    const scale = this.priceScale()
    const anchor: DrawingPoint = {
      index: Math.round(geo.indexAt(point.x)),
      price: clampPriceToTick(scale.price(point.y), this.opts.tickSize),
    }
    this.drag = { kind: 'draw', anchor }
    this.draft = {
      id: `draw-${Date.now()}`,
      type: this.tool,
      points: [anchor, anchor],
    }
    this.draftPoint = anchor
    this.requestRender()
  }

  private onPointerMove = (event: PointerEvent) => {
    const point = this.pointerPosition(event)
    const plot = this.plotRect()
    const inside = point.x >= plot.left && point.x <= plot.right && point.y >= plot.top && point.y <= plot.bottom
    this.hover = inside ? point : null
    if (this.drag.kind === 'none' && this.tool === 'cursor') {
      this.canvas.style.cursor = this.hitOrderCancel(point.x, point.y) ? 'pointer' : 'crosshair'
    }

    if (this.drag.kind === 'overlay') {
      const scale = this.priceScale()
      const price = clampPriceToTick(scale.price(point.y), this.opts.tickSize)
      this.callbacks.onOverlayDrag?.(this.drag.level, price)
    } else if (this.drag.kind === 'order') {
      const scale = this.priceScale()
      const price = clampPriceToTick(scale.price(point.y), this.opts.tickSize)
      if (Number.isFinite(price) && price !== this.drag.price) {
        this.drag.price = price
        this.callbacks.onOrderDrag?.(this.drag.id, price)
      }
    } else if (this.drag.kind === 'pan') {
      this.drag.distance = Math.max(
        this.drag.distance,
        Math.hypot(point.x - this.drag.startX, point.y - this.drag.startY),
      )
      if (this.drag.distance >= CLICK_SLOP) {
        const geo = this.indexGeometry()
        const delta = (point.x - this.drag.startX) / geo.slot
        const next = clampViewport(
          { end: this.drag.startEnd - delta, span: this.viewport.span },
          Math.max(2, this.visibleCount),
        )
        this.viewport = next
        this.follow = false
        this.emitViewport()
      }
    } else if (this.drag.kind === 'draw' && this.draft) {
      const geo = this.indexGeometry()
      const scale = this.priceScale()
      const point2: DrawingPoint = {
        index: Math.round(geo.indexAt(point.x)),
        price: clampPriceToTick(scale.price(point.y), this.opts.tickSize),
      }
      if (this.draft.type === 'horizontal') {
        this.draft.points = [this.drag.anchor, { ...this.drag.anchor, index: point2.index }]
      } else {
        this.draft.points = [this.drag.anchor, point2]
      }
    }

    this.emitCrosshair(this.hover)
    this.requestRender()
  }

  private onPointerUp = (event: PointerEvent) => {
    const drag = this.drag
    if (drag.kind === 'draw' && this.draft) {
      const [first, second] = this.draft.points
      if (first && second && (Math.abs(second.index - first.index) > 0 || Math.abs(second.price - first.price) > 0)) {
        this.callbacks.onDrawingCommit?.({ ...this.draft, points: [first, second] })
      }
      this.draft = null
    } else if (
      drag.kind === 'pan' &&
      drag.inside &&
      this.opts.pricePickEnabled &&
      !this.opts.blind &&
      this.callbacks.onPricePick
    ) {
      const point = this.pointerPosition(event)
      const { price, scale } = this.currentLayout()
      const distance = Math.max(drag.distance, Math.hypot(point.x - drag.startX, point.y - drag.startY))
      if (
        distance < CLICK_SLOP &&
        point.x >= price.left &&
        point.x <= price.right &&
        point.y >= price.top &&
        point.y <= price.bottom
      ) {
        this.callbacks.onPricePick(clampPriceToTick(scale.price(point.y), this.opts.tickSize))
      }
    }
    this.drag = { kind: 'none' }
    this.canvas.style.cursor = 'crosshair'
    this.requestRender()
  }

  private onPointerCancel = () => {
    this.drag = { kind: 'none' }
    this.draft = null
    this.canvas.style.cursor = 'crosshair'
    this.requestRender()
  }

  private onPointerLeave = () => {
    this.hover = null
    this.emitCrosshair(null)
    this.requestRender()
  }

  private onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const point = this.pointerPosition(event as unknown as PointerEvent)
    const geo = this.indexGeometry()
    const anchor = geo.indexAt(point.x)
    const plot = this.plotRect()
    const ratio = Math.max(0, Math.min(1, (point.x - plot.left) / plot.width))
    const factor = event.deltaY > 0 ? 1.12 : 0.89
    const span = Math.max(28, Math.min(Math.max(2, this.visibleCount), this.viewport.span * factor))
    const start = anchor - ratio * span
    const end = start + span - 1
    this.viewport = clampViewport({ end, span }, Math.max(2, this.visibleCount))
    this.follow = this.viewport.end >= this.visibleCount - 1.5
    this.emitViewport()
    this.requestRender()
  }

  private onDoubleClick = () => {
    this.fit()
  }

  private emitViewport() {
    this.invalidateLayout()
    this.callbacks.onViewportChange?.(this.viewport.end, this.viewport.span)
  }

  private toneColor(tone: ChartTone): string {
    switch (tone) {
      case 'bull':
        return this.theme.bull
      case 'bear':
        return this.theme.bear
      case 'clay':
        return this.theme.clay
      case 'ink':
        return this.theme.text
      case 'warn':
        return this.theme.clay
      default:
        return this.theme.textMuted
    }
  }

  private drawAnalysisProfile(plot: Rect, scale: ReturnType<typeof createPriceScale>) {
    const bars = this.analysis?.profile ?? []
    if (!bars.length) return
    let max = 1
    for (const bar of bars) max = Math.max(max, bar.volume)
    const widthLimit = Math.min(110, plot.width * 0.16)
    const ctx = this.ctx
    ctx.save()
    for (const bar of bars) {
      const y = scale.y(bar.price)
      if (y < plot.top || y > plot.bottom) continue
      const width = Math.max(1, (bar.volume / max) * widthLimit)
      ctx.globalAlpha = bar.isPoc ? 0.38 : bar.inValueArea ? 0.16 : 0.07
      ctx.fillStyle = bar.isPoc ? this.theme.clay : this.theme.textMuted
      ctx.fillRect(plot.right - width, y - 2, width, 4)
    }
    ctx.restore()
  }

  private drawAnalysisZones(
    plot: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
    compact: boolean,
  ) {
    const zones = this.analysis?.zones ?? []
    const ctx = this.ctx
    for (const zone of zones) {
      const x1 = Math.max(plot.left, geo.x(zone.from))
      const x2 = Math.min(plot.right, geo.x(zone.to))
      if (x2 <= plot.left || x1 >= plot.right) continue
      const y1 = scale.y(zone.top)
      const y2 = scale.y(zone.bottom)
      const top = Math.max(plot.top, Math.min(y1, y2))
      const bottom = Math.min(plot.bottom, Math.max(y1, y2))
      if (bottom <= top) continue
      const color = this.toneColor(zone.tone)
      ctx.save()
      ctx.globalAlpha = 0.1
      ctx.fillStyle = color
      ctx.fillRect(x1, top, x2 - x1, bottom - top)
      ctx.globalAlpha = 0.32
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.strokeRect(Math.round(x1) + 0.5, Math.round(top) + 0.5, Math.round(x2 - x1), Math.round(bottom - top))
      ctx.setLineDash([])
      if (zone.label && !compact) {
        ctx.globalAlpha = 0.85
        ctx.fillStyle = color
        ctx.font = `9px ${this.theme.fontMono}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillText(zone.label, x1 + 4, top - 2)
      }
      ctx.restore()
    }
  }

  private drawAnalysisSeries(
    plot: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
  ) {
    const ctx = this.ctx
    for (const series of this.analysis?.series ?? []) {
      this.drawSeriesLine(series, plot, geo, scale)
    }
  }

  private drawSeriesLine(
    series: AnalysisSeries,
    plot: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
  ) {
    const points = series.points
    if (!points.length) return
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = this.toneColor(series.tone)
    ctx.lineWidth = series.width ?? 1.2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.globalAlpha = 0.85
    if (series.dashed) ctx.setLineDash([3, 4])
    ctx.beginPath()
    let drawing = false
    const end = Math.min(points.length - 1, Math.ceil(geo.start + geo.span))
    for (let index = Math.max(0, Math.floor(geo.start)); index <= end; index += 1) {
      const value = points[index]
      if (value == null || !Number.isFinite(value)) {
        drawing = false
        continue
      }
      const x = geo.x(index)
      const y = scale.y(value)
      if (x < plot.left - 4 || x > plot.right + 4) continue
      if (!drawing) {
        ctx.moveTo(x, y)
        drawing = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
    ctx.restore()
  }

  private drawAnalysisLevels(plot: Rect, scale: ReturnType<typeof createPriceScale>, compact: boolean) {
    const ctx = this.ctx
    for (const level of this.analysis?.levels ?? []) {
      const y = Math.round(scale.y(level.price)) + 0.5
      if (y < plot.top || y > plot.bottom) continue
      ctx.save()
      ctx.strokeStyle = this.toneColor(level.tone)
      ctx.globalAlpha = 0.55
      ctx.setLineDash([2, 4])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(plot.left, y)
      ctx.lineTo(plot.right, y)
      ctx.stroke()
      ctx.setLineDash([])
      if (!compact) {
        ctx.font = `9px ${this.theme.fontMono}`
        ctx.fillStyle = this.toneColor(level.tone)
        ctx.globalAlpha = 0.9
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillText(level.label, plot.left + 4, y - 2)
      }
      ctx.restore()
    }
  }

  private drawAnalysisMarkers(
    plot: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
    compact: boolean,
  ) {
    const ctx = this.ctx
    for (const marker of this.analysis?.markers ?? []) {
      const x = geo.x(marker.index)
      const y = scale.y(marker.price)
      if (x < plot.left || x > plot.right || y < plot.top || y > plot.bottom) continue
      const color = this.toneColor(marker.tone)
      const up = marker.tone === 'bull'
      ctx.save()
      ctx.fillStyle = color
      ctx.beginPath()
      if (up) {
        ctx.moveTo(x, y + 9)
        ctx.lineTo(x - 3.5, y + 15)
        ctx.lineTo(x + 3.5, y + 15)
      } else {
        ctx.moveTo(x, y - 9)
        ctx.lineTo(x - 3.5, y - 15)
        ctx.lineTo(x + 3.5, y - 15)
      }
      ctx.closePath()
      ctx.fill()
      if (!compact) {
        ctx.font = `8.5px ${this.theme.fontMono}`
        ctx.globalAlpha = 0.85
        ctx.textAlign = 'center'
        ctx.textBaseline = up ? 'top' : 'bottom'
        ctx.fillText(marker.label, x, up ? y + 17 : y - 17)
      }
      ctx.restore()
    }
  }

  /** Drawings currently on the chart, including the in-progress one. */
  getDrawings(): ChartDrawing[] {
    return [...this.drawings]
  }
}
