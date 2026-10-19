import type { ChartTheme } from './types'

export function readChartTheme(element: HTMLElement): ChartTheme {
  const styles = getComputedStyle(element)
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  const mono = read('--font-mono-stack', 'ui-monospace, monospace')
  const sans = read('--font-sans-stack', 'system-ui, sans-serif')
  return {
    surface: read('--surface-2', '#ffffff'),
    grid: read('--chart-grid', 'rgba(20,20,20,.055)'),
    axis: read('--line', 'rgba(20,20,20,.1)'),
    axisText: read('--chart-axis', '#8a8a8a'),
    text: read('--ink', '#151515'),
    textMuted: read('--ink-3', '#8a8a8a'),
    bull: read('--bull', '#5b7f6b'),
    bear: read('--bear', '#b5533d'),
    bullSoft: read('--bull-soft', 'rgba(91,127,107,.12)'),
    bearSoft: read('--bear-soft', 'rgba(181,83,61,.12)'),
    crosshair: read('--chart-crosshair', 'rgba(20,20,20,.34)'),
    clay: read('--clay', '#c6613f'),
    onClay: read('--on-clay', '#ffffff'),
    volume: read('--chart-volume', 'rgba(20,20,20,.16)'),
    priceLine: read('--chart-price-line', 'rgba(198,97,63,.65)'),
    fontSans: sans,
    fontMono: mono,
  }
}
