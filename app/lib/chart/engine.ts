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
  ChartOverlayLevels,
  ChartTheme,
  ChartTool,
  DrawingPoint,
  DrawingType,
  CrosshairPayload,
} from './types'

const AXIS_WIDTH = 64
const TIME_AXIS = 22
const PAD_TOP = 12
const PAD_LEFT = 8

type DragState =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startEnd: number }
  | { kind: 'overlay'; level: keyof ChartOverlayLevels }
  | { kind: 'draw'; anchor: DrawingPoint }

export class ChartEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private callbacks: ChartCallbacks
  private theme: ChartTheme
  private candles: Candle[] = []
  private visibleCount = 0
  private viewport: Viewport = { end: 0, span: 72 }
  private follow = true
  private overlays: ChartOverlayLevels = { entry: null, stop: null, target: null }
  private drawings: ChartDrawing[] = []
  private draft: ChartDrawing | null = null
  private draftPoint: DrawingPoint | null = null
  private tool: ChartTool = 'cursor'
  private drag: DragState = { kind: 'none' }
  private hover: { x: number; y: number } | null = null
  private themeDirty = true
  private frame = 0
  private lastPaintAt = 0
  private animateFrom = -1
  private opts: Required<ChartOptions> & { pricePrecision: number; tickSize: number }
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
      pricePrecision: 2,
      tickSize: 0.25,
    }
    this.attach()
    this.measure()
  }

  setCandles(candles: Candle[], visibleCount: number) {
    const isNewSeries = candles !== this.candles
    this.candles = candles
    this.visibleCount = Math.max(0, Math.min(visibleCount, candles.length))
    if (isNewSeries || this.viewport.end === 0) {
      this.follow = true
      this.viewport = { end: Math.max(0, this.visibleCount - 1), span: 72 }
    }
    this.viewport.end = Math.min(this.viewport.end, Math.max(0, this.visibleCount - 1))
    this.requestRender()
  }

  setVisibleCount(count: number) {
    const next = Math.max(0, Math.min(count, this.candles.length))
    if (next === this.visibleCount) return
    const grew = next > this.visibleCount
    this.visibleCount = next
    if (this.follow) this.viewport.end = Math.max(0, next - 1)
    if (grew) {
      this.lastPaintAt = performance.now()
      this.animateFrom = next - 1
    }
    this.requestRender()
  }

  setBlind(blind: boolean) {
    this.opts.blind = blind
    this.requestRender()
  }

  setPrecision(pricePrecision: number, tickSize: number) {
    this.opts.pricePrecision = pricePrecision
    this.opts.tickSize = tickSize
    this.requestRender()
  }

  setOverlays(overlays: ChartOverlayLevels) {
    this.overlays = { ...overlays }
    this.requestRender()
  }

  setDrawings(drawings: ChartDrawing[]) {
    this.drawings = drawings
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
    this.opts = { ...this.opts, ...options }
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
    this.viewport = {
      end: Math.max(nextSpan - 1, Math.min(this.visibleCount - 1, index + nextSpan * 0.3)),
      span: nextSpan,
    }
    this.emitViewport()
    this.requestRender()
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.resizeObserver?.disconnect()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('dblclick', this.onDoubleClick)
    window.removeEventListener('resize', this.measure)
  }

  private attach() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
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
    this.requestRender()
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
    const end = Math.max(0, Math.min(this.visibleCount - 1, Math.floor(this.viewport.end)))
    const start = Math.max(0, Math.floor(geo.start) - 1)
    const window = this.candles.slice(start, end + 1)
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const candle of window) {
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

  render() {
    if (!this.width || !this.height) return
    const ctx = this.ctx
    const layout = this.layout()
    this.frameLayout = layout
    const { price, volume, plot, geo, scale } = layout
    const end = Math.max(0, Math.min(this.visibleCount - 1, Math.floor(this.viewport.end)))
    const start = Math.max(0, Math.floor(geo.start) - 1)

    ctx.clearRect(0, 0, this.width, this.height)
    this.drawGrid(price, geo, scale)

    ctx.save()
    ctx.beginPath()
    ctx.rect(plot.left, plot.top, plot.width, plot.height)
    ctx.clip()
    if (this.opts.showVolume && volume.height > 0) this.drawVolume(volume, geo, scale, start, end)
    this.drawCandles(price, geo, scale, start, end)
    this.drawOverlays(plot, scale)
    this.drawDrawings(plot, geo, scale)
    if (this.opts.blind && this.opts.showWatermark) this.drawWatermark(price)
    ctx.restore()

    this.drawAxes(price, geo, scale)
    this.drawLastPrice(price, geo, scale, end)
    this.drawCrosshair(plot, geo, scale)
    if (this.draft) this.drawDraft(plot, geo, scale)

    const animating = this.animateFrom >= 0 && performance.now() - this.lastPaintAt < 200 && this.animateFrom <= end
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
    const ctx = this.ctx
    const slot = geo.slot
    const width = Math.max(1, Math.min(14, slot * 0.62))
    const now = performance.now()
    const animate = this.animateFrom >= 0 && now - this.lastPaintAt < 190
    const progress = animate ? Math.min(1, (now - this.lastPaintAt) / 190) : 1
    const eased = 1 - Math.pow(1 - progress, 3)

    for (let index = start; index <= end; index += 1) {
      const candle = this.candles[index]
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

      if (isLast && animate && eased < 1) {
        const openPixel = openY
        closeY = openPixel + (closeY - openPixel) * eased
        highY = openPixel + (highY - openPixel) * eased
        lowY = openPixel + (lowY - openPixel) * eased
      }

      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      const xCenter = Math.round(x) + 0.5
      ctx.moveTo(xCenter, highY)
      ctx.lineTo(xCenter, lowY)
      ctx.stroke()

      const top = Math.min(openY, closeY)
      const height = Math.max(1, Math.abs(closeY - openY))
      ctx.globalAlpha = up ? 0.92 : 0.92
      ctx.fillRect(Math.round(x - width / 2), Math.round(top), Math.round(width), Math.round(height))
      ctx.globalAlpha = 1

      if (isLast) {
        ctx.fillStyle = this.theme.clay
        ctx.globalAlpha = 0.16
        ctx.fillRect(Math.round(x - width / 2) - 2, highY - 2, Math.round(width) + 4, Math.max(4, lowY - highY + 4))
        ctx.globalAlpha = 1
      }
    }
    void area
  }

  private drawVolume(
    area: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    _scale: ReturnType<typeof createPriceScale>,
    start: number,
    end: number,
  ) {
    const ctx = this.ctx
    const window = this.candles.slice(start, end + 1)
    const maxVolume = Math.max(1, ...window.map((candle) => candle.volume))
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
    ctx.fillStyle = '#fff'
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
    const first = Math.ceil(geo.start / step) * step
    for (let index = first; index <= geo.start + geo.span; index += step) {
      if (index < 0 || index > end) continue
      const x = geo.x(index)
      const offset = index - end
      const label = this.opts.blind
        ? formatRelativeBars(offset, this.opts.timeframeMinutes)
        : this.formatTime(this.candles[index]?.time ?? 0)
      ctx.fillText(label, x, area.bottom + 6)
    }
    void scale
  }

  private drawCrosshair(
    plot: Rect,
    geo: ReturnType<typeof createIndexGeometry>,
    scale: ReturnType<typeof createPriceScale>,
  ) {
    if (!this.hover) return
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
      : this.formatTime(this.candles[index]?.time ?? 0)
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

  private formatPrice(price: number): string {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: this.opts.pricePrecision,
      maximumFractionDigits: this.opts.pricePrecision,
    })
  }

  private formatTime(unixSeconds: number): string {
    const date = new Date(unixSeconds * 1000)
    return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`
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
    if (!this.callbacks.onCrosshair) return
    if (!point) {
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
    })
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
      const hit = this.hitOverlay(point.y)
      if (hit) {
        this.drag = { kind: 'overlay', level: hit }
        return
      }
      this.drag = { kind: 'pan', startX: point.x, startEnd: this.viewport.end }
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

    if (this.drag.kind === 'overlay') {
      const scale = this.priceScale()
      const price = clampPriceToTick(scale.price(point.y), this.opts.tickSize)
      this.callbacks.onOverlayDrag?.(this.drag.level, price)
    } else if (this.drag.kind === 'pan') {
      const geo = this.indexGeometry()
      const delta = (point.x - this.drag.startX) / geo.slot
      const next = clampViewport(
        { end: this.drag.startEnd - delta, span: this.viewport.span },
        Math.max(2, this.visibleCount),
      )
      this.viewport = next
      this.follow = false
      this.emitViewport()
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

  private onPointerUp = () => {
    if (this.drag.kind === 'draw' && this.draft) {
      const [first, second] = this.draft.points
      if (first && second && (Math.abs(second.index - first.index) > 0 || Math.abs(second.price - first.price) > 0)) {
        this.callbacks.onDrawingCommit?.({ ...this.draft, points: [first, second] })
      }
      this.draft = null
    }
    this.drag = { kind: 'none' }
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
    this.callbacks.onViewportChange?.(this.viewport.end, this.viewport.span)
  }

  /** Drawings currently on the chart, including the in-progress one. */
  getDrawings(): ChartDrawing[] {
    return [...this.drawings]
  }
}
