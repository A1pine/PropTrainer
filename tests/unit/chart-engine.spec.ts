// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Candle } from '@/domain/market/types'
import { ChartEngine } from '@/lib/chart/engine'
import { clampPriceToTick, clampViewport, createIndexGeometry, createPriceScale, rect } from '@/lib/chart/geometry'
import type { ChartCallbacks, ChartExecution, ChartOptions, ChartOrderLine, ChartTheme } from '@/lib/chart/types'

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
type Shape = { points: { x: number; y: number }[]; color: string; alpha: number }
type Stroke = Shape & { dash: number[]; lineWidth: number }
const execution = (overrides: Partial<ChartExecution> = {}): ChartExecution => ({
  id: 'trade-1',
  side: 'long',
  entryBar: 40,
  entryPrice: 100.25,
  exitBar: 60,
  exitPrice: 105.5,
  entryLabel: 'Entry',
  exitLabel: 'Exit',
  ...overrides,
})
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
  const shapes: Shape[] = []
  const strokes: Stroke[] = []
  let path: { x: number; y: number }[] = []
  let dash: number[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    setTransform: vi.fn(),
    clearRect: vi.fn(() => {
      fills.length = 0
      shapes.length = 0
      strokes.length = 0
    }),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(() => {
      path = []
    }),
    closePath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn((x: number, y: number) => {
      path.push({ x, y })
    }),
    lineTo: vi.fn((x: number, y: number) => {
      path.push({ x, y })
    }),
    stroke: vi.fn(() => {
      strokes.push({
        points: [...path],
        color: ctx.strokeStyle,
        alpha: ctx.globalAlpha,
        dash: [...dash],
        lineWidth: ctx.lineWidth,
      })
    }),
    setLineDash: vi.fn((segments: number[]) => {
      dash = [...segments]
    }),
    arc: vi.fn(),
    arcTo: vi.fn(),
    fill: vi.fn(() => {
      shapes.push({ points: [...path], color: ctx.fillStyle, alpha: ctx.globalAlpha })
    }),
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
  return { engine, canvas, ctx, bounds, fills, shapes, strokes, bodies, pointer, wheel }
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

  it('keeps plan lines but hides their tags when overlay labels are off', () => {
    const { engine, ctx, strokes } = setup({ showOverlayLabels: false })
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setOverlays({ entry: 100, stop: 95, target: 110 })
    paint()

    const texts = ctx.fillText.mock.calls.map(([text]) => text as string)
    expect(texts.some((text) => /^(ENTRY|STOP|TARGET)\b/.test(text))).toBe(false)
    expect(strokes.some((stroke) => stroke.dash.length === 2 && stroke.points.length === 2)).toBe(true)
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

describe('chart series identity', () => {
  const hoveredIndex = (onCrosshair: ReturnType<typeof vi.fn>) => onCrosshair.mock.lastCall?.[0]?.index
  const indexAt = (viewport: { end: number; span: number }, x = 400) =>
    Math.round(createIndexGeometry(viewport, priceArea).indexAt(x))

  it('keeps a same-key pan and zoom across an array replacement', () => {
    const onCrosshair = vi.fn()
    const { engine, pointer } = setup({}, { onCrosshair })
    const data = candles(200)
    engine.setCandles(data, 150, 'run:es:5m')
    engine.focusOn(90, 40)
    engine.zoom(0.5)
    paint()

    const appended = [...data, ...candles(50).map((candle, index) => ({ ...candle, time: (200 + index) * 300 }))]
    engine.setCandles(appended, 200, 'run:es:5m')
    paint()
    pointer('pointermove', 400)

    expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 96, span: 28 }))
  })

  it('keeps following the newest bar when a same-key series appends', () => {
    const onCrosshair = vi.fn()
    const { engine, pointer } = setup({}, { onCrosshair })
    const data = candles(200)
    engine.setCandles(data, 150, 'run:es:5m')
    engine.fit()
    paint()

    const appended = [...data, ...candles(50).map((candle, index) => ({ ...candle, time: (200 + index) * 300 }))]
    engine.setCandles(appended, 200, 'run:es:5m')
    paint()
    pointer('pointermove', 400)

    expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 199, span: 150 }))
  })

  it.each([
    ['changes', 'run:es:5m', 'run:es:15m'],
    ['is dropped', 'run:es:5m', undefined],
    ['is introduced', undefined, 'run:es:5m'],
  ] as const)('resets pan, zoom and follow when the series key %s', (_label, initialKey, nextKey) => {
    const onCrosshair = vi.fn()
    const { engine, pointer } = setup({}, { onCrosshair })
    const data = candles(200)
    engine.setCandles(data, 150, initialKey)
    engine.focusOn(90, 40)
    engine.zoom(0.5)
    paint()

    engine.setCandles(data, 150, nextKey)
    paint()
    pointer('pointermove', 400)
    expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 149, span: 72 }))

    engine.setVisibleCount(180)
    paint()
    pointer('pointermove', 400)
    expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 179, span: 72 }))
  })

  it('keeps legacy array-identity resets when no series key is supplied', () => {
    const onCrosshair = vi.fn()
    const { engine, pointer } = setup({}, { onCrosshair })
    const data = candles(200)
    engine.setCandles(data, 150)
    engine.focusOn(90, 40)
    engine.zoom(0.5)
    paint()

    engine.setCandles(data, 150)
    paint()
    pointer('pointermove', 400)
    expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 96, span: 28 }))

    engine.setCandles([...data], 150)
    paint()
    pointer('pointermove', 400)
    expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 149, span: 72 }))
  })

  it('clamps and abandons a pan when a same-key prefix shrinks', () => {
    const onViewportChange = vi.fn()
    const onPricePick = vi.fn()
    const onCrosshair = vi.fn()
    const { engine, pointer } = setup({ pricePickEnabled: true }, { onViewportChange, onPricePick, onCrosshair })
    const data = candles(200)
    engine.setCandles(data, 200, 'run:es:5m')
    engine.focusOn(150, 40)
    paint()
    const geo = createIndexGeometry({ end: 162, span: 40 }, priceArea)
    pointer('pointerdown', 400)
    pointer('pointermove', 400 + geo.slot * 4)
    expect(onViewportChange).toHaveBeenLastCalledWith(158, 40)

    engine.setCandles(data.slice(0, 60), 60, 'run:es:5m')
    onViewportChange.mockClear()
    pointer('pointermove', 400 + geo.slot * 8)
    pointer('pointerup', 400 + geo.slot * 8)

    expect(onViewportChange).not.toHaveBeenCalled()
    expect(onPricePick).not.toHaveBeenCalled()
    expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 59, span: 40 }, 400 + geo.slot * 8))
  })

  it('cancels a pending price pick when a followed same-key prefix shrinks', () => {
    const onPricePick = vi.fn()
    const onViewportChange = vi.fn()
    const { engine, canvas, pointer } = setup({ pricePickEnabled: true }, { onPricePick, onViewportChange })
    const data = candles(200)
    engine.setCandles(data, 200, 'run:es:5m')
    engine.fit()
    paint()
    pointer('pointerdown', 400)
    onViewportChange.mockClear()

    engine.setCandles(data.slice(0, 60), 60, 'run:es:5m')
    expect(canvas.style.cursor).toBe('crosshair')
    pointer('pointerup', 400)

    expect(onPricePick).not.toHaveBeenCalled()
    expect(onViewportChange).not.toHaveBeenCalled()
  })

  it('abandons a drawing anchored outside a shrinking same-key prefix', () => {
    const onDrawingCommit = vi.fn()
    const { engine, pointer } = setup({}, { onDrawingCommit })
    const data = candles(200)
    engine.setCandles(data, 200, 'run:es:5m')
    engine.fit()
    engine.setTool('trend')
    paint()
    pointer('pointerdown', 400)
    pointer('pointermove', 450)

    engine.setCandles(data.slice(0, 60), 60, 'run:es:5m')
    pointer('pointermove', 500)
    pointer('pointerup', 500)

    expect(onDrawingCommit).not.toHaveBeenCalled()
  })

  it('clamps the span when a followed same-key prefix shrinks', () => {
    const onCrosshair = vi.fn()
    const { engine, pointer } = setup({}, { onCrosshair })
    const data = candles(200)
    engine.setCandles(data, 200, 'run:es:5m')
    engine.fit()
    paint()

    engine.setCandles(data.slice(0, 60), 60, 'run:es:5m')
    paint()
    pointer('pointermove', 400)

    expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 59, span: 60 }))
  })

  it('keeps a one-bar rewind anchored to the only revealed candle', () => {
    const onCrosshair = vi.fn()
    const { engine, pointer } = setup({}, { onCrosshair })
    const data = candles(200)
    engine.setCandles(data, 200, 'run:es:5m')
    engine.focusOn(150, 40)
    paint()

    engine.setCandles(data.slice(0, 1), 1, 'run:es:5m')
    pointer('pointermove', 700)
    expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 0, span: 2 }, 700))

    engine.setCandles(data, 200, 'run:es:5m')
    pointer('pointermove', 700)
    expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 0, span: 2 }, 700))
  })

  it.each(['starts empty', 'rewinds to empty'] as const)(
    'restores a followed viewport when a keyed series %s',
    (change) => {
      const onCrosshair = vi.fn()
      const { engine, pointer } = setup({}, { onCrosshair })
      if (change === 'rewinds to empty') {
        engine.setCandles(candles(200), 200, 'run:es:5m')
        engine.focusOn(150, 40)
      }
      engine.setCandles([], 0, 'run:es:5m')
      paint()

      engine.setCandles(candles(20), 10, 'run:es:5m')
      paint()
      pointer('pointermove', 700)

      expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 9, span: 72 }, 700))
      engine.setVisibleCount(20)
      paint()
      pointer('pointermove', 700)
      expect(hoveredIndex(onCrosshair)).toBe(indexAt({ end: 19, span: 72 }, 700))
    },
  )
})

const entryTriangles = (shapes: Shape[]) => shapes.filter((shape) => shape.points.length === 3)
const exitDiamonds = (shapes: Shape[]) => shapes.filter((shape) => shape.points.length === 4)
const connectors = (strokes: Stroke[]) =>
  strokes.filter((stroke) => stroke.color === 'clay' && stroke.points.length === 2 && stroke.dash.length === 2)
const centroid = (points: { x: number; y: number }[]) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
})

describe('chart execution annotations', () => {
  it('anchors entry triangles, exit diamonds and the dashed connector to exact fills', () => {
    const { engine, ctx, shapes, strokes } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setExecutions([execution()])
    paint()

    const geo = createIndexGeometry({ end: 99, span: 100 }, priceArea)
    const scale = createPriceScale(90, 110, priceArea)
    const entry = { x: geo.x(40), y: scale.y(100.25) }
    const exit = { x: geo.x(60), y: scale.y(105.5) }

    const triangles = entryTriangles(shapes)
    expect(triangles).toHaveLength(1)
    expect(centroid(triangles[0]!.points).x).toBeCloseTo(entry.x)
    expect(centroid(triangles[0]!.points).y).toBeCloseTo(entry.y)
    expect(triangles[0]!.color).toBe('bull')

    const diamonds = exitDiamonds(shapes)
    expect(diamonds).toHaveLength(1)
    expect(centroid(diamonds[0]!.points).x).toBeCloseTo(exit.x)
    expect(centroid(diamonds[0]!.points).y).toBeCloseTo(exit.y)
    expect(diamonds[0]!.color).toBe('clay')

    expect(connectors(strokes)).toEqual([expect.objectContaining({ points: [entry, exit], color: 'clay' })])
    const texts = ctx.fillText.mock.calls.map(([text]) => text)
    expect(texts).toContain('Entry 100.25')
    expect(texts).toContain('Exit 105.50')
  })

  it('draws nothing and ignores marker prices while blind, then reveals on demand', () => {
    const onDrawingCommit = vi.fn()
    const { engine, ctx, shapes, strokes, pointer } = setup({ tickSize: 1 }, { onDrawingCommit })
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setBlind(true)
    engine.setExecutions([execution({ entryPrice: 300, exitPrice: 400 })])
    paint()

    expect(entryTriangles(shapes)).toEqual([])
    expect(exitDiamonds(shapes)).toEqual([])
    expect(connectors(strokes)).toEqual([])
    expect(ctx.fillText.mock.calls.some(([text]) => text === 'Entry 300.00')).toBe(false)

    engine.setTool('horizontal')
    pointer('pointerdown', 400)
    pointer('pointermove', 450)
    pointer('pointerup', 450)
    expect(onDrawingCommit.mock.lastCall?.[0].points[0].price).toBe(
      clampPriceToTick(createPriceScale(90, 110, priceArea).price(140), 1),
    )

    engine.setBlind(false)
    paint()
    const revealedScale = createPriceScale(90, 400, priceArea)
    expect(centroid(entryTriangles(shapes)[0]!.points).y).toBeCloseTo(revealedScale.y(300))
  })

  it('renders a visible entry but never the hidden exit, connector or exit price', () => {
    const { engine, ctx, shapes, strokes } = setup()
    engine.setCandles(candles(), 20)
    engine.fit()
    engine.setExecutions([execution({ entryBar: 5, entryPrice: 100, exitBar: 60, exitPrice: 300 })])
    paint()

    const geo = createIndexGeometry({ end: 19, span: 28 }, priceArea)
    const scale = createPriceScale(90, 110, priceArea)
    const triangles = entryTriangles(shapes)
    expect(triangles).toHaveLength(1)
    expect(centroid(triangles[0]!.points)).toEqual({ x: geo.x(5), y: scale.y(100) })
    expect(exitDiamonds(shapes)).toEqual([])
    expect(connectors(strokes)).toEqual([])
    const texts = ctx.fillText.mock.calls.map(([text]) => text)
    expect(texts).toContain('Entry 100.00')
    expect(texts.some((text) => text.startsWith('Exit'))).toBe(false)
  })

  it('keeps scrolled-away endpoint prices out of the visible scale', () => {
    const { engine, shapes, strokes } = setup()
    engine.setCandles(candles(), 100)
    engine.focusOn(10, 40)
    engine.setExecutions([execution({ entryBar: 5, entryPrice: 100, exitBar: 90, exitPrice: 300 })])
    paint()

    const scale = createPriceScale(90, 110, priceArea)
    const triangles = entryTriangles(shapes)
    expect(triangles).toHaveLength(1)
    expect(centroid(triangles[0]!.points).y).toBeCloseTo(scale.y(100))
    expect(exitDiamonds(shapes)).toEqual([])
    expect(connectors(strokes)).toEqual([])
  })

  it('renders multiple and same-bar trades with labels split below and above the exact fill', () => {
    const { engine, ctx, shapes, strokes } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setExecutions([
      execution({
        id: 'shared',
        entryBar: 50,
        entryPrice: 100,
        exitBar: 50,
        exitPrice: 100,
        entryLabel: 'Entry A',
        exitLabel: 'Exit A',
      }),
      execution({
        id: 'second',
        side: 'short',
        entryBar: 70,
        entryPrice: 108,
        exitBar: 80,
        exitPrice: 96,
        entryLabel: 'Entry B',
        exitLabel: 'Exit B',
      }),
    ])
    paint()

    expect(entryTriangles(shapes)).toHaveLength(2)
    expect(exitDiamonds(shapes)).toHaveLength(2)
    expect(connectors(strokes)).toHaveLength(2)
    expect(
      entryTriangles(shapes)
        .map((shape) => shape.color)
        .sort(),
    ).toEqual(['bear', 'bull'])

    const geo = createIndexGeometry({ end: 99, span: 100 }, priceArea)
    const scale = createPriceScale(90, 110, priceArea)
    const fillY = scale.y(100)
    const entryLabel = ctx.fillText.mock.calls.find(([text]) => text === 'Entry A 100.00')
    const exitLabel = ctx.fillText.mock.calls.find(([text]) => text === 'Exit A 100.00')
    expect(entryLabel?.[2]).toBeGreaterThan(fillY)
    expect(exitLabel?.[2]).toBeLessThan(fillY)

    const leaders = strokes.filter(
      (stroke) =>
        stroke.points.length === 2 &&
        stroke.dash.length === 0 &&
        stroke.points[0]!.x === geo.x(50) &&
        stroke.points[0]!.y === fillY,
    )
    expect(leaders.map((stroke) => stroke.color).sort()).toEqual(['bull', 'clay'])
  })

  it('skips invalid executions but accepts zero and negative prices', () => {
    const { engine, ctx, shapes } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setDrawings([{ id: 'floor', type: 'horizontal', points: [{ index: 0, price: -20 }] }])
    engine.setExecutions([
      execution({ id: 'fractional', entryBar: 10.5 }),
      execution({ id: 'negative-bar', exitBar: -2 }),
      execution({ id: 'infinite', entryPrice: Number.POSITIVE_INFINITY }),
      execution({ id: 'nan', exitPrice: Number.NaN }),
      execution({ id: 'out-of-range', entryBar: 200, exitBar: 201 }),
      execution({
        id: 'negative-price',
        entryBar: 20,
        entryPrice: -5,
        exitBar: 30,
        exitPrice: 0,
        entryLabel: 'Neg',
        exitLabel: 'Zero',
      }),
    ])
    paint()

    const geo = createIndexGeometry({ end: 99, span: 100 }, priceArea)
    const scale = createPriceScale(-20, 110, priceArea)
    expect(entryTriangles(shapes)).toHaveLength(1)
    expect(exitDiamonds(shapes)).toHaveLength(1)
    expect(centroid(entryTriangles(shapes)[0]!.points)).toEqual({ x: geo.x(20), y: scale.y(-5) })
    expect(centroid(exitDiamonds(shapes)[0]!.points)).toEqual({ x: geo.x(30), y: scale.y(0) })
    const texts = ctx.fillText.mock.calls.map(([text]) => text)
    expect(texts).toContain('Neg -5.00')
    expect(texts).toContain('Zero 0.00')
  })

  it('clears annotations and skips identical execution array references', () => {
    const { engine, ctx, shapes, strokes } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()

    const executions = [execution()]
    engine.setExecutions(executions)
    expect(frames.size).toBe(1)
    paint()
    expect(entryTriangles(shapes)).toHaveLength(1)

    engine.setExecutions(executions)
    expect(frames.size).toBe(0)

    engine.setExecutions([])
    expect(frames.size).toBe(1)
    ctx.fillText.mockClear()
    paint()
    expect(entryTriangles(shapes)).toEqual([])
    expect(exitDiamonds(shapes)).toEqual([])
    expect(connectors(strokes)).toEqual([])
    expect(ctx.fillText.mock.calls.some(([text]) => text === 'Entry 100.25')).toBe(false)
  })
})

describe('chart focus range', () => {
  it('frames long holds with padding around both endpoints', () => {
    const onViewportChange = vi.fn()
    const { engine } = setup({}, { onViewportChange })
    engine.setCandles(candles(300), 300)
    engine.focusRange(20, 180)

    expect(onViewportChange).toHaveBeenLastCalledWith(210, 211)
    const geo = createIndexGeometry({ end: 210, span: 211 }, priceArea)
    expect(geo.x(20)).toBeGreaterThan(priceArea.left + 20)
    expect(geo.x(180)).toBeLessThan(priceArea.right - 20)
  })

  it('keeps a minimum span for short ranges and clamps to revealed bars', () => {
    const onViewportChange = vi.fn()
    const { engine } = setup({}, { onViewportChange })
    engine.setCandles(candles(300), 300)
    engine.focusRange(100, 110)
    expect(onViewportChange).toHaveBeenLastCalledWith(140.5, 72)

    engine.focusRange(-50, 999)
    expect(onViewportChange).toHaveBeenLastCalledWith(299, 300)
  })
})

const orderLine = (overrides: Partial<ChartOrderLine> = {}): ChartOrderLine => ({
  id: 'order-1',
  side: 'long',
  kind: 'limit',
  price: 100.25,
  label: 'BUY',
  qty: 2,
  ...overrides,
})

const orderStrokes = (strokes: Stroke[]) =>
  strokes.filter(
    (stroke) =>
      (stroke.color === 'bull' || stroke.color === 'bear') &&
      stroke.points.length === 2 &&
      stroke.points[0]!.x === priceArea.left &&
      stroke.points[1]!.x === priceArea.right,
  )

describe('chart order lines', () => {
  it('draws a right-edge tag per order line and clears them with an empty set', () => {
    const { engine, ctx, shapes, strokes } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setOrderLines([
      orderLine({ id: 'buy', price: 100.25, label: 'BUY', qty: 2 }),
      orderLine({ id: 'sell', side: 'short', price: 105.5, label: 'SELL', qty: 3 }),
    ])
    paint()

    const texts = ctx.fillText.mock.calls.map(([text]) => text)
    expect(texts).toContain('BUY 2')
    expect(texts).toContain('SELL 3')
    expect(shapes.filter((shape) => shape.color === 'surface')).toHaveLength(2)

    const lines = orderStrokes(strokes)
    expect(lines.map((line) => line.color)).toEqual(['bull', 'bear'])
    expect(lines.every((line) => line.lineWidth === 1.5)).toBe(true)
    expect(lines.map((line) => line.dash)).toEqual([[], []])
    const scale = createPriceScale(90, 110, priceArea)
    expect(lines.map((line) => line.points)).toEqual(
      [100.25, 105.5].map((price) => [
        { x: priceArea.left, y: Math.round(scale.y(price)) + 0.5 },
        { x: priceArea.right, y: Math.round(scale.y(price)) + 0.5 },
      ]),
    )
    expect(ctx.rect).toHaveBeenCalledWith(priceArea.left, priceArea.top, priceArea.width, priceArea.height)
    expect(ctx.clip).toHaveBeenCalled()

    ctx.fillText.mockClear()
    engine.setOrderLines([])
    paint()
    expect(shapes.filter((shape) => shape.color === 'surface')).toEqual([])
    expect(orderStrokes(strokes)).toEqual([])
    expect(ctx.fillText.mock.calls.some(([text]) => text === 'BUY 2')).toBe(false)
    expect(ctx.fillText.mock.calls.some(([text]) => text === 'SELL 3')).toBe(false)
  })

  it('draws protective legs thinner and translucent while stop entries stay dashed', () => {
    const { engine, ctx, shapes, strokes } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setOrderLines([
      orderLine({ id: 'working', kind: 'stop', price: 100.5, label: 'SELL', qty: 1 }),
      orderLine({ id: 'protect', side: 'short', kind: 'stop', price: 95, label: 'STOP', qty: 1, protective: true }),
    ])
    paint()

    const [working, protective] = orderStrokes(strokes)
    expect(working).toMatchObject({ color: 'bull', dash: [4, 3], alpha: 1, lineWidth: 1.5 })
    expect(protective).toMatchObject({ color: 'bear', dash: [4, 3], alpha: 0.75, lineWidth: 1 })
    expect(shapes.filter((shape) => shape.color === 'surface')).toHaveLength(2)
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual(expect.arrayContaining(['SELL 1', 'STOP 1']))
  })

  it('skips invalid and off-scale orders without expanding the price scale', () => {
    const { engine, ctx, shapes, strokes, bodies } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()
    const before = bodies().map(({ x, y, width, height }) => ({ x, y, width, height }))
    const scale = createPriceScale(90, 110, priceArea)

    engine.setOrderLines([
      orderLine({ id: 'off', price: 300, label: 'OFF' }),
      orderLine({ id: 'nan', price: Number.NaN }),
      orderLine({ id: 'infinite-price', price: Number.POSITIVE_INFINITY }),
      orderLine({ id: 'infinite-qty', qty: Number.POSITIVE_INFINITY }),
      orderLine({ id: 'nan-qty', qty: Number.NaN }),
      orderLine({ id: 'zero', qty: 0 }),
      orderLine({ id: 'negative', qty: -1 }),
      orderLine({ id: 'side', side: 'buy' as never }),
      orderLine({ id: 'kind', kind: 'market' as never }),
      orderLine({ id: 'ok', price: 101, label: 'BUY', qty: 2 }),
    ])
    paint()

    expect(bodies().map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual(before)
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual(expect.arrayContaining(['BUY 2']))
    expect(ctx.fillText.mock.calls.some(([text]) => String(text).startsWith('OFF'))).toBe(false)
    expect(shapes.filter((shape) => shape.color === 'surface')).toHaveLength(1)
    expect(orderStrokes(strokes)).toHaveLength(1)
    const [line] = orderStrokes(strokes)
    expect(line?.points[0]!.y).toBe(Math.round(scale.y(101)) + 0.5)
  })

  it('does not repaint for the same array reference or an equivalent snapshot', () => {
    const { engine } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()

    const orders = [orderLine()]
    engine.setOrderLines(orders)
    expect(frames.size).toBe(1)
    paint()

    engine.setOrderLines(orders)
    expect(frames.size).toBe(0)
    engine.setOrderLines([{ ...orders[0]! }])
    expect(frames.size).toBe(0)
    engine.setOrderLines([orderLine({ price: 101 })])
    expect(frames.size).toBe(1)
  })

  it.each([0, 2] as const)('picks a tick-clamped price with %s px of movement without panning', (movement) => {
    const onPricePick = vi.fn()
    const onViewportChange = vi.fn()
    const { engine, pointer } = setup({ tickSize: 1, pricePickEnabled: true }, { onPricePick, onViewportChange })
    engine.setCandles(candles(), 100)
    engine.focusOn(50, 40)
    paint()
    onViewportChange.mockClear()

    pointer('pointerdown', 400, 140)
    pointer('pointermove', 400 + movement, 140 + movement)
    pointer('pointerup', 400 + movement, 140 + movement)

    expect(onPricePick).toHaveBeenCalledTimes(1)
    expect(onPricePick).toHaveBeenCalledWith(
      clampPriceToTick(createPriceScale(90, 110, priceArea).price(140 + movement), 1),
    )
    expect(onViewportChange).not.toHaveBeenCalled()
  })

  it('pans beyond the click slop and never picks even after returning to the start', () => {
    const onPricePick = vi.fn()
    const onViewportChange = vi.fn()
    const { engine, pointer } = setup({ pricePickEnabled: true }, { onPricePick, onViewportChange })
    engine.setCandles(candles(), 150)
    engine.focusOn(90, 40)
    paint()
    onViewportChange.mockClear()

    const slot = createIndexGeometry({ end: 102, span: 40 }, priceArea).slot
    pointer('pointerdown', 400, 140)
    pointer('pointermove', 400 + slot * 2, 140)
    expect(onViewportChange).toHaveBeenLastCalledWith(100, 40)
    pointer('pointermove', 400, 140)
    pointer('pointerup', 400, 140)
    expect(onViewportChange).toHaveBeenLastCalledWith(102, 40)
    expect(onPricePick).not.toHaveBeenCalled()
  })

  it('checks the release position and excludes the volume pane, axes, and cancelled gestures from picks', () => {
    const onPricePick = vi.fn()
    const { engine, pointer } = setup({ showVolume: true, pricePickEnabled: true }, { onPricePick })
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()

    for (const [x, y, upX, upY] of [
      [400, 140, 404, 140],
      [400, 140, 403, 143],
      [400, 350, 400, 350],
      [750, 140, 750, 140],
      [7, 140, 9, 140],
      [9, 140, 7, 140],
      [400, 311, 400, 313],
    ] as const) {
      pointer('pointerdown', x, y)
      pointer('pointerup', upX, upY)
    }
    pointer('pointerdown', 400, 140)
    pointer('pointercancel', 400, 140)
    pointer('pointerup', 400, 140)
    expect(onPricePick).not.toHaveBeenCalled()
  })

  it('does not report a price after a real pan, an outside start, or while drawing', () => {
    const onPricePick = vi.fn()
    const { engine, pointer } = setup({ tickSize: 1, pricePickEnabled: true }, { onPricePick })
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()

    const slot = createIndexGeometry({ end: 99, span: 100 }, priceArea).slot
    pointer('pointerdown', 400, 140)
    pointer('pointermove', 400 + slot * 2, 140)
    pointer('pointerup', 400 + slot * 2, 140)
    expect(onPricePick).not.toHaveBeenCalled()

    pointer('pointerdown', 400, 390)
    pointer('pointerup', 400, 390)
    expect(onPricePick).not.toHaveBeenCalled()

    engine.setTool('horizontal')
    pointer('pointerdown', 400, 140)
    pointer('pointermove', 420, 140)
    pointer('pointerup', 420, 140)
    expect(onPricePick).not.toHaveBeenCalled()
  })

  it('drags orders with a tick-clamped price and prefers them over overlays', () => {
    const onOrderDrag = vi.fn()
    const onOverlayDrag = vi.fn()
    const onPricePick = vi.fn()
    const { engine, pointer } = setup(
      { orderDraggable: true, overlayDraggable: true, tickSize: 1, pricePickEnabled: true },
      { onOrderDrag, onOverlayDrag, onPricePick },
    )
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setOverlays({ entry: 100, stop: null, target: null })
    engine.setOrderLines([orderLine({ id: 'live', price: 100.25 })])
    paint()

    const scale = createPriceScale(90, 110, priceArea)
    pointer('pointerdown', 400, scale.y(100.25))
    pointer('pointermove', 400, scale.y(98.4))
    pointer('pointermove', 400, scale.y(98.2))
    pointer('pointermove', 400, scale.y(98.4))
    expect(onOrderDrag).toHaveBeenCalledTimes(1)
    expect(onOrderDrag).toHaveBeenLastCalledWith('live', 98)
    pointer('pointermove', 400, scale.y(97.2))
    expect(onOrderDrag).toHaveBeenCalledTimes(2)
    expect(onOrderDrag).toHaveBeenLastCalledWith('live', 97)
    expect(onOverlayDrag).not.toHaveBeenCalled()

    pointer('pointerup', 400, scale.y(98.4))
    expect(onPricePick).not.toHaveBeenCalled()
  })

  it.each([
    [true, -6, true],
    [true, 6, true],
    [true, 6.1, false],
    [false, 0, false],
  ] as const)('hit-tests with orderDraggable=%s and a %s px offset', (orderDraggable, offset, hit) => {
    const onOrderDrag = vi.fn()
    const onViewportChange = vi.fn()
    const { engine, pointer } = setup({ orderDraggable }, { onOrderDrag, onViewportChange })
    engine.setCandles(candles(), 150)
    engine.focusOn(90, 40)
    engine.setOrderLines([orderLine()])
    paint()
    onViewportChange.mockClear()

    const scale = createPriceScale(90, 110, priceArea)
    pointer('pointerdown', 400, scale.y(100.25) + offset)
    pointer('pointermove', 420, scale.y(98.25))
    pointer('pointerup', 420, scale.y(98.25))
    if (hit) {
      expect(onOrderDrag).toHaveBeenCalledExactlyOnceWith('order-1', 98.25)
      expect(onViewportChange).not.toHaveBeenCalled()
    } else {
      expect(onOrderDrag).not.toHaveBeenCalled()
      expect(onViewportChange).toHaveBeenCalledTimes(1)
    }
  })

  it.each(['removed', 'invalid', 'disabled', 'cancelled'] as const)('stops an active order drag when %s', (change) => {
    const onOrderDrag = vi.fn()
    const onPricePick = vi.fn()
    const { engine, canvas, pointer } = setup(
      { orderDraggable: true, pricePickEnabled: true },
      { onOrderDrag, onPricePick },
    )
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setOrderLines([orderLine()])
    paint()

    const scale = createPriceScale(90, 110, priceArea)
    pointer('pointerdown', 400, scale.y(100.25))
    pointer('pointermove', 400, scale.y(99))
    expect(onOrderDrag).toHaveBeenCalledExactlyOnceWith('order-1', 99)
    if (change === 'removed') engine.setOrderLines([orderLine({ id: 'other', price: 98 })])
    else if (change === 'invalid') engine.setOrderLines([orderLine({ qty: 0 })])
    else if (change === 'disabled') engine.setOptions({ orderDraggable: false })
    else pointer('pointercancel', 400, scale.y(99))

    pointer('pointermove', 400, scale.y(98))
    pointer('pointerup', 400, scale.y(98))
    expect(onOrderDrag).toHaveBeenCalledTimes(1)
    expect(onPricePick).not.toHaveBeenCalled()
    expect(canvas.style.cursor).toBe('crosshair')
  })

  it('keeps an order drag active through immutable price updates of the same id', () => {
    const onOrderDrag = vi.fn()
    const { engine, pointer } = setup({ orderDraggable: true }, { onOrderDrag })
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setOrderLines([orderLine()])
    paint()

    const scale = createPriceScale(90, 110, priceArea)
    pointer('pointerdown', 400, scale.y(100.25))
    pointer('pointermove', 400, scale.y(99))
    engine.setOrderLines([orderLine({ price: 99 })])
    pointer('pointermove', 400, scale.y(98))
    expect(onOrderDrag.mock.calls).toEqual([
      ['order-1', 99],
      ['order-1', 98],
    ])
  })

  it('clips to the price pane and never hit-tests orders in the volume pane or outside the x bounds', () => {
    const onOrderDrag = vi.fn()
    const { engine, ctx, strokes, pointer } = setup({ orderDraggable: true, showVolume: true }, { onOrderDrag })
    engine.setCandles(candles(), 100)
    engine.fit()
    const area = rect(8, 12, 728, 300)
    const scale = createPriceScale(90, 110, area)
    engine.setOrderLines([
      orderLine(),
      orderLine({ id: 'volume', label: 'VOLUME', price: scale.price(350) }),
      orderLine({ id: 'edge', label: 'EDGE', price: scale.price(area.bottom + 1) }),
    ])
    paint()

    expect(orderStrokes(strokes)).toHaveLength(1)
    expect(ctx.fillText.mock.calls.some(([text]) => /^(VOLUME|EDGE)/.test(String(text)))).toBe(false)
    expect(ctx.rect).toHaveBeenCalledWith(area.left, area.top, area.width, area.height)
    for (const [x, y] of [
      [400, 350],
      [400, area.bottom - 1],
      [750, scale.y(100.25)],
    ] as const) {
      pointer('pointerdown', x, y)
      pointer('pointermove', x, y - 20)
      pointer('pointerup', x, y - 20)
    }
    expect(onOrderDrag).not.toHaveBeenCalled()
  })

  it('renders orders safely with no candles and accepts zero or negative prices', () => {
    const { engine, ctx, strokes } = setup()
    engine.setOrderLines([
      orderLine({ id: 'zero', label: 'ZERO', price: 0 }),
      orderLine({ id: 'negative', label: 'NEG', price: -0.02 }),
      orderLine({ id: 'off', price: 100 }),
    ])
    expect(() => paint()).not.toThrow()
    expect(orderStrokes(strokes)).toHaveLength(2)
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual(expect.arrayContaining(['ZERO 2', 'NEG 2']))
  })

  it('does not retain caller mutations when comparing order snapshots', () => {
    const { engine, ctx } = setup()
    engine.setCandles(candles(), 100)
    const orders = [orderLine()]
    engine.setOrderLines(orders)
    paint()
    orders[0]!.qty = 3
    engine.render()
    expect(ctx.fillText.mock.calls.some(([text]) => text === 'BUY 3')).toBe(false)
    engine.setOrderLines(orders)
    expect(frames.size).toBe(1)
    paint()
    expect(ctx.fillText.mock.calls.some(([text]) => text === 'BUY 3')).toBe(true)
  })

  it('renders orders for the terminal while blind still hides execution markers', () => {
    const { engine, ctx, shapes } = setup({ blind: false })
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setOrderLines([orderLine({ label: 'BUY', qty: 2 })])
    engine.setExecutions([execution()])
    paint()

    expect(ctx.fillText.mock.calls.map(([text]) => text)).toContain('BUY 2')
    expect(entryTriangles(shapes)).toHaveLength(1)

    ctx.fillText.mockClear()
    engine.setBlind(true)
    paint()
    const texts = ctx.fillText.mock.calls.map(([text]) => text)
    expect(texts).toContain('BUY 2')
    expect(entryTriangles(shapes)).toEqual([])
    expect(texts.some((text) => String(text).startsWith('Entry'))).toBe(false)
  })
})

describe('chart style options', () => {
  it('defaults to candle bodies and keeps every style on the same theme colors', () => {
    const { engine, bodies, strokes } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()
    const candleBodies = bodies().length
    expect(candleBodies).toBeGreaterThan(0)
    expect(bodies().every((fill) => fill.color === 'bull' || fill.color === 'bear')).toBe(true)

    engine.setOptions({ chartStyle: 'ohlc' })
    paint()
    expect(bodies()).toEqual([])
    expect(strokes.some((stroke) => stroke.color === 'bull' || stroke.color === 'bear')).toBe(true)

    engine.setOptions({ chartStyle: 'line' })
    paint()
    expect(bodies()).toEqual([])
    expect(strokes.some((stroke) => stroke.color === 'text')).toBe(true)
  })

  it('draws OHLC ticks around the open and close instead of a filled body', () => {
    const { engine, strokes } = setup({ chartStyle: 'ohlc' })
    engine.setCandles(candles(5), 5)
    engine.fit()
    paint()
    const priceStrokes = strokes.filter((stroke) => stroke.color === 'bull' || stroke.color === 'bear')
    expect(priceStrokes.some((stroke) => stroke.points.length === 2)).toBe(true)
    expect(priceStrokes.some((stroke) => stroke.points.length === 4)).toBe(true)
  })

  it('derives heikin-ashi bodies from the revealed prefix while hover stays raw', () => {
    const onCrosshair = vi.fn()
    const { engine, bodies, pointer, ctx } = setup({ chartStyle: 'heikin-ashi', reducedMotion: true }, { onCrosshair })
    const data = candles()
    engine.setCandles(data, 100)
    engine.fit()
    paint()
    const first = bodies()[0]!
    expect(first.height).not.toBe(
      Math.max(1, Math.abs(createPriceScale(90, 110, priceArea).y(106) - createPriceScale(90, 110, priceArea).y(100))),
    )

    const geo = createIndexGeometry({ end: 99, span: 100 }, priceArea)
    pointer('pointermove', geo.x(98))
    paint()
    expect(onCrosshair.mock.lastCall?.[0]?.candle).toBe(data[98])
    expect(ctx.fillText.mock.calls.some(([text]) => text === '106.00')).toBe(true)

    const prefix = bodies()
      .slice(0, 4)
      .map((fill) => [fill.y, fill.height])

    // Rebuilding from a shorter revealed prefix must reproduce the same bodies a
    // prefix-only series would produce, never values that peeked at hidden bars.
    const truncated = setup({ chartStyle: 'heikin-ashi', reducedMotion: true })
    truncated.engine.setCandles(data.slice(0, 4), 4)
    truncated.engine.fit()
    paint()
    expect(truncated.bodies().map((fill) => [fill.y, fill.height])).toEqual(prefix)

    engine.setVisibleCount(4)
    engine.fit()
    paint()
    expect(bodies()).toHaveLength(4)
    engine.setVisibleCount(100)
    engine.fit()
    paint()
    expect(bodies()).toHaveLength(100)
  })

  it.each(['array replacement', 'tail replacement', 'tail mutation'] as const)(
    'rebuilds heikin-ashi after a same-key forming %s',
    (change) => {
      const options = { chartStyle: 'heikin-ashi', reducedMotion: true } as const
      const { engine, bodies } = setup(options)
      const data = candles(8)
      engine.setCandles(data, 8, 'run:es:5m')
      engine.fit()
      paint()
      const before = bodies().at(-1)!

      const tail = { ...data[7]!, high: 200, open: 100, low: 90, close: 180 }
      let next = data
      if (change === 'array replacement') next = [...data.slice(0, 7), tail]
      else if (change === 'tail replacement') data[7] = tail
      else Object.assign(data[7]!, tail)
      engine.setCandles(next, 8, 'run:es:5m')
      const fresh = setup(options)
      fresh.engine.setCandles(next, 8, 'run:es:5m')
      fresh.engine.fit()
      paint()

      expect(bodies().at(-1)!.height).toBeGreaterThan(before.height)
      expect(bodies()).toEqual(fresh.bodies())
    },
  )
})

describe('chart time axis and hover stamps', () => {
  it('defaults to UTC clock labels and hides dates unless asked', () => {
    const { engine, ctx } = setup({ timeframeMinutes: 5 })
    engine.setCandles(candles(40), 40)
    engine.fit()
    paint()
    const texts = ctx.fillText.mock.calls.map(([text]) => String(text))
    expect(texts).toContain('00:00')
    expect(texts.some((text) => text.includes('1970-01-01'))).toBe(false)
  })

  it('labels the first bar of each new day with its date when showDates is on', () => {
    const { engine, ctx } = setup({ showDates: true })
    engine.setCandles(
      candles(40).map((candle, index) => ({ ...candle, time: index * 3600 })),
      40,
    )
    engine.fit()
    paint()
    const texts = ctx.fillText.mock.calls.map(([text]) => String(text))
    // The session opens on a date, later bars in the same day keep the clock.
    expect(texts).toContain('01-01')
    expect(texts).toContain('01-02')
    expect(texts).toContain('06:00')
    expect(texts).not.toContain('1970-01-01')

    // The day boundary gets its own tick even though 24 is not one of the
    // evenly spaced labels, so reviewers always see when the session date rolls.
    const geo = createIndexGeometry({ end: 39, span: 40 }, priceArea)
    const boundary = ctx.fillText.mock.calls.find(([text]) => text === '01-02')
    expect(boundary?.[1]).toBeCloseTo(geo.x(24), 5)
    // A neighbouring clock tick is dropped so the date never collides with it.
    const neighbour = ctx.fillText.mock.calls.find(([text]) => text === '01:00')
    expect(neighbour).toBeUndefined()
  })

  it('uses full dates for daily bars and the configured time zone', () => {
    const { engine, ctx } = setup({ timeframeMinutes: 1441, timeZone: 'America/Chicago' })
    engine.setCandles(candles(40), 40)
    engine.fit()
    paint()
    const texts = ctx.fillText.mock.calls.map(([text]) => String(text))
    expect(texts).toContain('1969-12-31')
    expect(texts).not.toContain('1970-01-01')
  })

  it('falls back to UTC for an invalid zone and rebuilds only when options change', () => {
    const formatter = vi.spyOn(Intl, 'DateTimeFormat')
    const { engine, ctx } = setup({ timeframeMinutes: 1441, timeZone: 'Not/AZone' })
    const built = formatter.mock.calls.length
    engine.setCandles(candles(40), 40)
    engine.fit()
    paint()
    expect(ctx.fillText.mock.calls.map(([text]) => String(text))).toContain('1970-01-01')

    // Repainting and unrelated option updates must reuse the cached formatter.
    paint()
    engine.setOptions({ showDates: true, timeframeMinutes: 1441 })
    paint()
    expect(formatter.mock.calls.length).toBe(built)

    // Changing the zone rebuilds it exactly once, and the new zone takes effect.
    engine.setOptions({ timeZone: 'America/Chicago' })
    expect(formatter.mock.calls.length).toBe(built + 1)
    ctx.fillText.mockClear()
    paint()
    expect(ctx.fillText.mock.calls.map(([text]) => String(text))).toContain('1969-12-31')
  })

  it('unblinds hover with a full stamped time while blind keeps relative labels only', () => {
    const onCrosshair = vi.fn()
    const { engine, ctx, pointer } = setup({ reducedMotion: true }, { onCrosshair })
    engine.setCandles(candles(40), 40)
    engine.fit()
    paint()
    const geo = createIndexGeometry({ end: 39, span: 40 }, priceArea)
    pointer('pointermove', geo.x(10))
    paint()
    expect(onCrosshair.mock.lastCall?.[0]).toMatchObject({ relativeLabel: '−2.4h', timeLabel: '1970-01-01 00:50 UTC' })
    expect(ctx.fillText.mock.calls.map(([text]) => String(text))).toContain('00:50')

    engine.setBlind(true)
    ctx.fillText.mockClear()
    paint()
    const payload = onCrosshair.mock.lastCall?.[0]
    expect(payload.timeLabel).toBeUndefined()
    expect(payload.relativeLabel).toBe('−2.4h')
    const texts = ctx.fillText.mock.calls.map(([text]) => String(text))
    expect(texts.some((text) => text.includes('1970-01-01'))).toBe(false)
    expect(texts.some((text) => text.includes('00:50'))).toBe(false)
  })
})

describe('chart interaction gating', () => {
  it('never picks unless the caller opts in, even when onPricePick is present', () => {
    const onPricePick = vi.fn()
    const { engine, pointer } = setup({}, { onPricePick })
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()

    pointer('pointerdown', 400, 140)
    pointer('pointerup', 400, 140)
    expect(onPricePick).not.toHaveBeenCalled()

    engine.setOptions({ pricePickEnabled: true })
    pointer('pointerdown', 400, 140)
    pointer('pointerup', 400, 140)
    expect(onPricePick).toHaveBeenCalledTimes(1)

    engine.setOptions({ pricePickEnabled: false })
    pointer('pointerdown', 400, 140)
    pointer('pointerup', 400, 140)
    expect(onPricePick).toHaveBeenCalledTimes(1)

    engine.setOptions({ pricePickEnabled: true })
    engine.setBlind(true)
    pointer('pointerdown', 400, 140)
    pointer('pointerup', 400, 140)
    expect(onPricePick).toHaveBeenCalledTimes(1)
  })

  it('stays inert for exam charts that never supply onPricePick', () => {
    const { engine, pointer } = setup()
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()
    pointer('pointerdown', 400, 140)
    pointer('pointerup', 400, 140)
    // Nothing to assert on a callback that does not exist: the guarantee is that no
    // viewport change, drawing, or drag is triggered by a bare tap.
    expect(engine.getDrawings()).toHaveLength(0)
  })

  it('abandons a price tap when the viewport is replaced mid-gesture', () => {
    const onPricePick = vi.fn()
    const { engine, pointer } = setup({ pricePickEnabled: true, tickSize: 1 }, { onPricePick })
    engine.setCandles(candles(), 100)
    engine.fit()
    paint()

    pointer('pointerdown', 400, 140)
    engine.setCandles(
      candles().map((candle) => ({ ...candle, high: 300 })),
      100,
    )
    pointer('pointerup', 400, 140)
    expect(onPricePick).not.toHaveBeenCalled()

    engine.setVisibleCount(40)
    pointer('pointerdown', 400, 140)
    engine.setVisibleCount(90)
    pointer('pointerup', 400, 140)
    expect(onPricePick).not.toHaveBeenCalled()
  })

  it('leaves display-only order lines undraggable without disturbing neighbours', () => {
    const onOrderDrag = vi.fn()
    const onViewportChange = vi.fn()
    const { engine, pointer } = setup({ orderDraggable: true }, { onOrderDrag, onViewportChange })
    engine.setCandles(candles(), 150)
    engine.focusOn(90, 40)
    engine.setOrderLines([orderLine({ id: 'avg', price: 100.25, draggable: false })])
    paint()
    onViewportChange.mockClear()

    const scale = createPriceScale(90, 110, priceArea)
    pointer('pointerdown', 400, scale.y(100.25))
    pointer('pointermove', 420, scale.y(98.25))
    pointer('pointerup', 420, scale.y(98.25))
    expect(onOrderDrag).not.toHaveBeenCalled()
    expect(onViewportChange).toHaveBeenCalledTimes(1)
  })

  it('cancels the exact order from its chip and never starts a drag or pick', () => {
    const onOrderCancel = vi.fn()
    const onOrderDrag = vi.fn()
    const onPricePick = vi.fn()
    const { engine, pointer } = setup(
      { orderDraggable: true, pricePickEnabled: true },
      { onOrderCancel, onOrderDrag, onPricePick },
    )
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setOrderLines([orderLine({ id: 'live' }), orderLine({ id: 'other', price: 102 })])
    paint()

    const scale = createPriceScale(90, 110, priceArea)
    const y = scale.y(100.25)
    pointer('pointerdown', 685, y)
    pointer('pointermove', 685, scale.y(99))
    pointer('pointerup', 685, scale.y(99))
    expect(onOrderCancel).toHaveBeenCalledExactlyOnceWith('live')
    expect(onOrderDrag).not.toHaveBeenCalled()
    expect(onPricePick).not.toHaveBeenCalled()
  })

  it.each([
    ['blind', { orderDraggable: true, blind: true }, 'cursor'],
    ['read-only', { orderDraggable: false }, 'cursor'],
    ['drawing tool', { orderDraggable: true }, 'horizontal'],
  ] as const)('hides the cancel affordance while %s', (_label, options, tool) => {
    const onOrderCancel = vi.fn()
    const { engine, pointer } = setup(options, { onOrderCancel })
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setOrderLines([orderLine()])
    engine.setTool(tool)
    paint()

    const scale = createPriceScale(90, 110, priceArea)
    pointer('pointerdown', 685, scale.y(100.25))
    pointer('pointerup', 685, scale.y(100.25))
    expect(onOrderCancel).not.toHaveBeenCalled()
  })

  it('offers no cancel chip for a display-only order line', () => {
    const onOrderCancel = vi.fn()
    const onOrderDrag = vi.fn()
    const { engine, pointer } = setup({ orderDraggable: true }, { onOrderCancel, onOrderDrag })
    engine.setCandles(candles(), 100)
    engine.fit()
    engine.setOrderLines([orderLine({ draggable: false })])
    paint()

    const scale = createPriceScale(90, 110, priceArea)
    pointer('pointerdown', 685, scale.y(100.25))
    pointer('pointerup', 685, scale.y(100.25))
    expect(onOrderCancel).not.toHaveBeenCalled()
    expect(onOrderDrag).not.toHaveBeenCalled()
  })
})
