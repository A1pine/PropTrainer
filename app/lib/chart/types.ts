import type { Candle } from '~/domain/market/types'

export interface ChartOverlayLevels {
  entry: number | null
  stop: number | null
  target: number | null
}

export type ChartTool = 'cursor' | 'trend' | 'horizontal' | 'fib'
export type DrawingType = 'trend' | 'horizontal' | 'fib'
/** Presentation-only rendering style. Underlying candles stay raw. */
export type ChartStyle = 'candles' | 'ohlc' | 'line' | 'heikin-ashi'

export interface DrawingPoint {
  index: number
  price: number
}

export interface ChartDrawing {
  id: string
  type: DrawingType
  color?: string
  points: DrawingPoint[]
}

/** A filled round trip revealed on the review chart. Bars are absolute candle indexes. */
export interface ChartExecution {
  id: string
  side: 'long' | 'short'
  entryBar: number
  entryPrice: number
  exitBar: number
  exitPrice: number
  entryLabel: string
  exitLabel: string
}

export interface ChartTheme {
  surface: string
  grid: string
  axis: string
  axisText: string
  text: string
  textMuted: string
  bull: string
  bear: string
  bullSoft: string
  bearSoft: string
  crosshair: string
  clay: string
  onClay: string
  volume: string
  priceLine: string
  fontSans: string
  fontMono: string
}

export interface CrosshairPayload {
  index: number
  /** Always the raw revealed candle, never a chart-style derivative. */
  candle: Candle
  x: number
  y: number
  relativeLabel: string
  /** Non-blind wall-clock stamp (YYYY-MM-DD HH:mm TZ). Absent while blind. */
  timeLabel?: string
}

export interface ChartOrderLine {
  id: string
  /** long = buy-side order, short = sell-side order */
  side: 'long' | 'short'
  kind: 'limit' | 'stop'
  price: number
  label: string
  qty: number
  /** Protective stop/target lines draw thinner and dashed */
  protective?: boolean
  /** Whether the price line can be dragged. Defaults to true. */
  draggable?: boolean
}

export interface ChartCallbacks {
  onCrosshair?: (payload: CrosshairPayload | null) => void
  onOverlayDrag?: (kind: keyof ChartOverlayLevels, price: number) => void
  onOrderDrag?: (id: string, price: number) => void
  onOrderCancel?: (id: string) => void
  onPricePick?: (price: number) => void
  onDrawingCommit?: (drawing: ChartDrawing) => void
  onViewportChange?: (end: number, span: number) => void
}

export interface ChartOptions {
  timeframeMinutes?: number
  blind?: boolean
  showVolume?: boolean
  showWatermark?: boolean
  overlayDraggable?: boolean
  orderDraggable?: boolean
  /** Arm click-to-pick. Off by default so read-only exam charts stay inert. */
  pricePickEnabled?: boolean
  /** Presentation style. Never changes the underlying candle data. */
  chartStyle?: ChartStyle
  /** IANA time zone used by date/time labels. Defaults to UTC. */
  timeZone?: string
  /** Show date labels at the first bar of each new day (intraday charts). */
  showDates?: boolean
  /** Hide the right-edge ENTRY/STOP/TARGET tags while keeping their lines. */
  showOverlayLabels?: boolean
  reducedMotion?: boolean
  pricePrecision?: number
  tickSize?: number
}

export type ChartTone = 'bull' | 'bear' | 'clay' | 'ink' | 'muted' | 'warn'

export interface AnalysisSeries {
  id: string
  tone: ChartTone
  width?: number
  dashed?: boolean
  points: (number | null)[]
}

export interface AnalysisZone {
  id: string
  from: number
  to: number
  top: number
  bottom: number
  tone: ChartTone
  label?: string
}

export interface AnalysisLevelLine {
  id: string
  price: number
  tone: ChartTone
  label: string
}

export interface AnalysisMarker {
  id: string
  index: number
  price: number
  tone: ChartTone
  label: string
}

export interface AnalysisProfileBar {
  price: number
  volume: number
  inValueArea: boolean
  isPoc: boolean
}

export interface ChartAnalysis {
  series: AnalysisSeries[]
  zones: AnalysisZone[]
  levels: AnalysisLevelLine[]
  markers: AnalysisMarker[]
  profile: AnalysisProfileBar[]
}
