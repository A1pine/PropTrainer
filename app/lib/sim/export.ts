export type CsvCell = string | number | boolean | null | undefined

function csvCell(value: CsvCell): string {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  const text = String(value)
  const safe = /^[=+\-@\t\r\n]/.test(text) || /^\s+[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function serializeCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function utcTimestamp(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return ''
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().replace(/\.000Z$/, 'Z')
}

export function downloadCsv(
  filename: string,
  headers: readonly string[],
  rows: readonly (readonly CsvCell[])[],
): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false
  let url: string | undefined
  let link: HTMLAnchorElement | undefined
  try {
    const blob = new Blob(['\uFEFF', serializeCsv(headers, rows)], { type: 'text/csv;charset=utf-8' })
    url = URL.createObjectURL(blob)
    link = document.createElement('a')
    link.href = url
    link.download = filename
    link.hidden = true
    document.body.append(link)
    link.click()
    return true
  } catch {
    return false
  } finally {
    link?.remove()
    if (url != null) {
      const objectUrl = url
      // Give the browser time to start the download before releasing its URL.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    }
  }
}
