// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Candle } from '@/domain/market/types'
import { ChartEngine } from '@/lib/chart/engine'
import { clampPriceToTick, clampViewport, createIndexGeometry, createPriceScale, rect } from '@/lib/chart/geometry'
import type { ChartCallbacks, ChartOptions, ChartTheme } from '@/lib/chart/types'

const theme: ChartTheme = {
  surface: 'surface',
  grid: 'grid',
  axis: 'axis',
  axisText: 'axisText',
  text: 'text',
  textMuted: 'textMuted',
  bull: 'bull',
  bear: 'bear',
  bullSoft: 'bullSoft',
  bearSoft: 'bearSoft',
  crosshair: 'crosshair',
  clay: 'clay',
  onClay: 'onClay',
  volume: 'volume',
  priceLine: 'priceLine',
  fontSans: 'sans-serif',
  fontMono: 'monospace',
}
const priceArea = rect(8, 12, 728, 366)
const candles = (count = 200): Candle[] =>
  Array.from({ length: count }, (_, index) => ({
    time: index * 300,
    open: 100,
    high: 110,
    low: 90,
    close: 106,
    volume: (index + 1) * 10,
  }))

type Fill = { x: number; y: number; width: number; height: number; color: string; alpha: number }
let now = 0
let nextFrame = 0
let frames: Map<number, FrameRequestCallback>
let engines: ChartEngine[]

beforeEach(() => {
  now = 0
  nextFrame = 0
  frames = new Map()
  engines = []
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  for (const engine of engines) engine.destroy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function paint(time = now) {
  now = time
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(time)
}

function setup(options: ChartOptions = {}, callbacks: ChartCallbacks = {}) {
  const fills: Fill[] = []
  const ctx = {
    fillStyle: '',
    globalAlpha: 1,
    setTransform: vi.fn(),
    clearRect: vi.fn(() => {
      fills.length = 0
    }),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    fill: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    fillRect: vi.fn((x: number, y: number, width: number, height: number) => {
      fills.push({ x, y, width, height, color: ctx.fillStyle, alpha: ctx.globalAlpha })
    }),
  }
  const canvas = document.createElement('canvas')
  canvas.setPointerCapture = vi.fn()
  const bounds = vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 400))
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  const engine = new ChartEngine(canvas, callbacks, theme, {
    blind: false,
    showVolume: false,
    showWatermark: false,
    ...options,
  })
  engines.push(engine)
  const pointer = (type: string, x: number, y = 140) =>
    canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1 }))
  const wheel = (x: number, deltaY: number) => {
    // Happy DOM's WheelEvent lacks the MouseEvent coordinates supplied by browsers.
    const event = Object.assign(new WheelEvent('wheel', { deltaY, cancelable: true }), {
      clientX: x,
      clientY: 140,
    })
    canvas.dispatchEvent(event)
    return event
  }
  const bodies = () => fills.filter((fill) => fill.alpha === 0.92)
  return { engine, canvas, ctx, bounds, fills, bodies, pointer, wheel }
}

describe('chart engine rendering', () => {
  it('honors constructor precision and tick size in labels and drawing prices', () => {
    const onDrawingCommit = vi.fn()
    const { engine, ctx, pointer } = setup({ pricePrecision: 3, tickSize: 0.01 }, { onDrawingCommit })
    const data = candles(40).map((candle) => ({ ...candle, open: 78.2, low: 77, high: 79, close: 78.414 }))
    engine.setCandles(data, data.length)
    engine.fit()
    paint()
    expect(ctx.fillText.mock.calls.some(([text]) => text === '78.414')).toBe(true)

    engine.setTool('horizontal')
    const y = createPriceScale(77, 79, priceArea).y(78.414)
    pointer('pointerdown', 400, y)
    pointer('pointermove', 450, y)
    pointer('pointerup', 450, y)
    expect(onDrawingCommit.mock.lastCall?.[0].points[0].price).toBe(78.41)
  })

  it('reuses the price formatter until precision changes, including setOptions', () => {
    const formatter = vi.spyOn(Intl, 'NumberFormat')
    const { engine, ctx, pointer } = setup({ pricePrecision: 3 })
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()
    pointer('pointermove', 400)
    paint()
    engine.setPrecision(3, 0.01)
    paint()
    expect(formatter).toHaveBeenCalledTimes(1)
    engine.setPrecision(4, 0.01)
    paint()
    expect(formatter).toHaveBeenCalledTimes(2)
    expect(ctx.fillText.mock.calls.some(([text]) => text === '106.0000')).toBe(true)
    engine.setOptions({ pricePrecision: 1 })
    paint()
    expect(formatter).toHaveBeenCalledTimes(3)
    expect(ctx.fillText.mock.calls.some(([text]) => text === '106.0')).toBe(true)
  })

  it('coalesces redraws and skips equal overlay updates without retaining caller mutation', () => {
    const { engine, ctx } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setDrawings([])
    expect(frames.size).toBe(1)
    paint()
    expect(ctx.clearRect).toHaveBeenCalledTimes(1)
    engine.setOverlays({ entry: null, stop: null, target: null })
    expect(frames.size).toBe(0)

    const overlays = { entry: 100, stop: 95, target: 110 }
    engine.setOverlays(overlays)
    engine.setOverlays({ ...overlays })
    engine.setBlind(true)
    engine.setPrecision(3, 0.01)
    expect(frames.size).toBe(1)
    paint()
    expect(ctx.clearRect).toHaveBeenCalledTimes(2)
    engine.setOverlays({ ...overlays })
    expect(frames.size).toBe(0)
    overlays.target = 120
    engine.setOverlays(overlays)
    expect(frames.size).toBe(1)
    paint()
    expect(ctx.clearRect).toHaveBeenCalledTimes(3)
  })

  it('normalizes volume using only visible bars without slicing the candle array', () => {
    const { engine, fills } = setup({ showVolume: true })
    const data = candles(6)
    data[3]!.volume = 100_000
    const slice = vi.spyOn(data, 'slice')
    engine.setCandles(data, 3)
    engine.fit()
    paint()
    const volumes = fills.filter((fill) => fill.alpha === 0.18)
    expect(volumes).toHaveLength(3)
    expect(volumes.map((fill) => fill.height)).toEqual([58 / 3, (58 * 2) / 3, 58])
    expect(slice).not.toHaveBeenCalled()
  })

  it('does not flatten the last historical candle when the new bar is offscreen', () => {
    const { engine, bodies } = setup()
    engine.setCandles(candles(), 100)
    engine.focusOn(50, 40)
    paint()
    const before = bodies()
    engine.setVisibleCount(101)
    paint()
    expect(bodies()).toEqual(before)
    expect(frames.size).toBe(0)
  })

  it('animates only the newly revealed bar and stops scheduling after it completes', () => {
    const { engine, bodies } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()
    const fullHeight = bodies().at(-1)!.height
    engine.setVisibleCount(101)
    paint()
    expect(bodies().at(-1)!.height).toBe(1)
    expect(
      bodies()
        .slice(0, -1)
        .every((fill) => fill.height === fullHeight),
    ).toBe(true)
    expect(frames.size).toBe(1)
    paint(95)
    expect(bodies().at(-1)!.height).toBeGreaterThan(1)
    expect(bodies().at(-1)!.height).toBeLessThan(fullHeight)
    paint(210)
    expect(bodies().at(-1)!.height).toBe(fullHeight)
    expect(frames.size).toBe(0)
  })

  it('honors reduced motion at construction and cancels an in-flight reveal when enabled', () => {
    const { engine, bodies } = setup({ reducedMotion: true })
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()
    const fullHeight = bodies().at(-1)!.height
    engine.setVisibleCount(101)
    paint()
    expect(bodies().at(-1)!.height).toBe(fullHeight)
    expect(frames.size).toBe(0)
    engine.setOptions({ reducedMotion: false })
    engine.setVisibleCount(102)
    paint()
    expect(bodies().at(-1)!.height).toBe(1)
    expect(frames.size).toBe(1)
    engine.setOptions({ reducedMotion: true })
    paint()
    expect(bodies().at(-1)!.height).toBe(fullHeight)
    expect(frames.size).toBe(0)
  })

  it('cancels pending animation frames and detaches inputs on destruction', () => {
    const onCrosshair = vi.fn()
    const { engine, pointer } = setup({}, { onCrosshair })
    expect(frames.size).toBe(1)
    engine.destroy()
    expect(frames.size).toBe(0)
    pointer('pointermove', 400)
    expect(onCrosshair).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })
})

describe('chart engine input and layout invalidation', () => {
  it.each([
    ['focus', (engine: ChartEngine) => engine.focusOn(55, 40), { end: 67, span: 40 }],
    ['zoom', (engine: ChartEngine) => engine.zoom(0.5), { end: 109, span: 40 }],
    ['fit', (engine: ChartEngine) => engine.fit(), { end: 149, span: 150 }],
    ['latest', (engine: ChartEngine) => engine.scrollToLatest(), { end: 149, span: 80 }],
  ] as const)('uses the new %s geometry for pointer input before paint', (_name, change, viewport) => {
    const onCrosshair = vi.fn()
    const { engine, pointer } = setup({}, { onCrosshair })
    engine.setCandles(candles(), 150)
    engine.focusOn(105, 80)
    paint()
    change(engine)
    pointer('pointermove', 400)
    const index = Math.round(createIndexGeometry(viewport, priceArea).indexAt(400))
    expect(onCrosshair.mock.lastCall?.[0]?.index).toBe(index)
  })

  it.each(['overlays', 'drawings', 'candles', 'volume', 'resize'] as const)(
    'uses the updated %s price scale for drawing before paint',
    (change) => {
      const onDrawingCommit = vi.fn()
      const { engine, pointer, bounds } = setup({ tickSize: 1 }, { onDrawingCommit })
      engine.setCandles(candles(), 100)
      engine.fit()
      paint()
      let area = priceArea
      let max = 110
      if (change === 'overlays') {
        engine.setOverlays({ entry: 300, stop: null, target: null })
        max = 300
      } else if (change === 'drawings') {
        engine.setDrawings([{ id: 'level', type: 'horizontal', points: [{ index: 50, price: 300 }] }])
        max = 300
      } else if (change === 'candles') {
        engine.setCandles(
          candles().map((candle) => ({ ...candle, high: 300 })),
          100,
        )
        max = 300
      } else if (change === 'volume') {
        engine.setOptions({ showVolume: true })
        area = rect(8, 12, 728, 300)
      } else {
        bounds.mockReturnValue(new DOMRect(0, 0, 800, 600))
        window.dispatchEvent(new Event('resize'))
        area = rect(8, 12, 728, 566)
      }
      engine.setTool('horizontal')
      pointer('pointerdown', 400)
      pointer('pointermove', 450)
      pointer('pointerup', 450)
      const expectedPrice = clampPriceToTick(createPriceScale(90, max, area).price(140), 1)
      expect(onDrawingCommit.mock.lastCall?.[0].points[0].price).toBe(expectedPrice)
    },
  )

  it('hit-tests overlays against the current scale before paint and stops dragging when disabled', () => {
    const onOverlayDrag = vi.fn()
    const { engine, pointer } = setup({ overlayDraggable: true, tickSize: 1 }, { onOverlayDrag })
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()
    engine.setOverlays({ entry: 300, stop: null, target: null })
    const scale = createPriceScale(90, 300, priceArea)
    pointer('pointerdown', 400, scale.y(300))
    pointer('pointermove', 400, scale.y(280))
    expect(onOverlayDrag).toHaveBeenLastCalledWith('entry', 280)
    engine.setOptions({ overlayDraggable: false })
    pointer('pointermove', 400, scale.y(270))
    expect(onOverlayDrag).toHaveBeenCalledTimes(1)
  })

  it('preserves pan deltas and reports the current hovered bar across moves before paint', () => {
    const onViewportChange = vi.fn()
    const onCrosshair = vi.fn()
    const { engine, pointer } = setup({}, { onViewportChange, onCrosshair })
    engine.setCandles(candles(), 150)
    engine.focusOn(90, 40)
    paint()
    const geo = createIndexGeometry({ end: 102, span: 40 }, priceArea)
    const index = Math.round(geo.indexAt(400))
    pointer('pointerdown', 400)
    pointer('pointermove', 400 + geo.slot * 2)
    expect(onViewportChange).toHaveBeenLastCalledWith(100, 40)
    expect(onCrosshair.mock.lastCall?.[0]?.index).toBe(index)
    pointer('pointermove', 400 + geo.slot * 4)
    expect(onViewportChange).toHaveBeenLastCalledWith(98, 40)
    expect(onCrosshair.mock.lastCall?.[0]?.index).toBe(index)
    expect(frames.size).toBe(1)
  })

  it('uses each wheel result as the next anchor even when no paint occurs between events', () => {
    const onViewportChange = vi.fn()
    const { engine, wheel } = setup({}, { onViewportChange })
    engine.setCandles(candles(), 150)
    engine.focusOn(90, 40)
    paint()
    let viewport = { end: 102, span: 40 }
    for (const deltaY of [1, 1, -1]) {
      const x = 200
      const anchor = createIndexGeometry(viewport, priceArea).indexAt(x)
      const span = viewport.span * (deltaY > 0 ? 1.12 : 0.89)
      const end = anchor - ((x - priceArea.left) / priceArea.width) * span + span - 1
      viewport = clampViewport({ end, span }, 150)
      expect(wheel(x, deltaY).defaultPrevented).toBe(true)
      const [actualEnd, actualSpan] = onViewportChange.mock.lastCall!
      expect(actualEnd).toBeCloseTo(viewport.end)
      expect(actualSpan).toBeCloseTo(viewport.span)
    }
    expect(frames.size).toBe(1)
  })

  it.each(['count', 'same-array'] as const)('clamps a non-following viewport on %s shrink', (change) => {
    const onCrosshair = vi.fn()
    const { engine, pointer } = setup({}, { onCrosshair })
    const data = candles()
    engine.setCandles(data, 150)
    engine.focusOn(90, 40)
    paint()
    if (change === 'count') engine.setVisibleCount(20)
    else engine.setCandles(data, 20)
    pointer('pointermove', 400)
    const index = Math.round(createIndexGeometry({ end: 19, span: 20 }, priceArea).indexAt(400))
    expect(onCrosshair.mock.lastCall?.[0]?.index).toBe(index)
  })

  it('refreshes stationary hover after count, timeframe and data changes, and clears it at zero bars', () => {
    const onCrosshair = vi.fn()
    const { engine, pointer, bodies } = setup({ reducedMotion: true }, { onCrosshair })
    const data = candles()
    engine.setCandles(data, 100)
    engine.fit()
    paint()
    pointer('pointermove', createIndexGeometry({ end: 99, span: 100 }, priceArea).x(98))
    paint()
    expect(onCrosshair.mock.lastCall?.[0]).toMatchObject({ index: 98, relativeLabel: '−5m' })
    engine.setOptions({ timeframeMinutes: 15 })
    paint()
    expect(onCrosshair.mock.lastCall?.[0]).toMatchObject({ index: 98, relativeLabel: '−15m' })
    engine.setVisibleCount(101)
    paint()
    expect(onCrosshair.mock.lastCall?.[0]).toMatchObject({ index: 99, candle: data[99] })
    const replacement = candles(50).map((candle) => ({ ...candle, close: 101 }))
    engine.setCandles(replacement, 50)
    paint()
    expect(onCrosshair.mock.lastCall?.[0]?.candle.close).toBe(101)
    engine.setVisibleCount(0)
    paint()
    expect(onCrosshair).toHaveBeenLastCalledWith(null)
    expect(bodies()).toEqual([])
    expect(frames.size).toBe(0)
  })
})
