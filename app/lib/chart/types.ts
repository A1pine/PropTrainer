import type { Candle } from '~/domain/market/types'

export interface ChartOverlayLevels {
  entry: number | null
  stop: number | null
  target: number | null
}

export type ChartTool = 'cursor' | 'trend' | 'horizontal' | 'fib'
export type DrawingType = 'trend' | 'horizontal' | 'fib'

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
  candle: Candle
  x: number
  y: number
  relativeLabel: string
}

export interface ChartCallbacks {
  onCrosshair?: (payload: CrosshairPayload | null) => void
  onOverlayDrag?: (kind: keyof ChartOverlayLevels, price: number) => void
  onDrawingCommit?: (drawing: ChartDrawing) => void
  onViewportChange?: (end: number, span: number) => void
}

export interface ChartOptions {
  timeframeMinutes?: number
  blind?: boolean
  showVolume?: boolean
  showWatermark?: boolean
  overlayDraggable?: boolean
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
