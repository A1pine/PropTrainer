/**
 * CME Globex session calendar.
 *
 * Everything in the terminal is driven by the replay timestamps, never by the
 * wall clock. A trading day starts at 17:00 America/Chicago and ends at 16:00
 * the next calendar day, so the evening session belongs to the next trade date.
 *
 * The calendar is weekly, not an exchange holiday calendar. There is no holiday
 * feed in this project: a weekday holiday is still a trade date here and simply
 * has no bars in the tape. Session helpers never invent a holiday or a bar.
 */

const TIMEZONE = 'America/Chicago'
const DAY_SECONDS = 86_400
const HOUR_SECONDS = 3_600
// Four-digit calendar years, with headroom for session boundaries.
const MIN_TIMESTAMP = Date.parse('0001-01-02T00:00:00Z') / 1_000
const MAX_TIMESTAMP = Date.parse('9999-12-30T00:00:00Z') / 1_000
/** The trade date flips at the 16:00 close, which is the end of the session. */
const SESSION_KEY_HOUR = 16
/**
 * Cache bound. A terminal session sees a few thousand bars per symbol, so this
 * is plenty; clearing wholesale keeps the maps bounded without an LRU's cost.
 */
const CACHE_LIMIT = 65_536

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  timeZoneName: 'longOffset',
})

const offsetCache = new Map<number, number>()
const dayKeyCache = new Map<number, string>()
const openCache = new Map<string, number>()
const closeCache = new Map<string, number>()
const tradeDateCache = new Map<string, boolean>()
const marketOpenCache = new Map<number, boolean>()

function remember<K, V>(cache: Map<K, V>, key: K, value: V): V {
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, value)
  return value
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

function utcDay(year: number, month: number, day: number): Date {
  const date = new Date(0)
  // setUTCFullYear avoids Date.UTC's mapping of years 0–99 onto 1900–1999.
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

function formatDay(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`
}

/**
 * Chicago's UTC offset changes on whole UTC hours. Caching by UTC hour is
 * therefore exact for this zone while avoiding an Intl call for every bar.
 *
 * Pre-1970 local-mean-time offsets can change at arbitrary minutes, so those
 * timestamps are keyed exactly instead of by hour. Replay data is modern; this
 * only keeps historical inputs correct.
 */
function offsetSeconds(timestamp: number): number {
  const cacheKey = timestamp >= 0 ? Math.floor(timestamp / HOUR_SECONDS) : timestamp
  const cached = offsetCache.get(cacheKey)
  if (cached !== undefined) return cached
  const name = offsetFormatter.formatToParts(new Date(timestamp * 1_000)).find((part) => part.type === 'timeZoneName')
  const match = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(name?.value ?? '')
  if (!match) throw new Error('Unable to resolve America/Chicago UTC offset')
  const sign = match[1] === '-' ? -1 : 1
  const value = sign * (Number(match[2]) * HOUR_SECONDS + Number(match[3]) * 60 + Number(match[4] ?? 0))
  return remember(offsetCache, cacheKey, value)
}

/** True when `timestamp` is inside the representable four-digit-year calendar. */
export function isSessionTimestamp(timestamp: number): boolean {
  return Number.isFinite(timestamp) && timestamp >= MIN_TIMESTAMP && timestamp <= MAX_TIMESTAMP
}

/** Local Chicago wall-clock components, computed from the actual offset. */
function wallClock(timestamp: number): WallClock {
  if (!isSessionTimestamp(timestamp)) throw new Error(`Invalid timestamp: ${timestamp}`)
  const local = new Date((timestamp + offsetSeconds(timestamp)) * 1_000)
  if (Number.isNaN(local.getTime())) throw new Error(`Invalid timestamp: ${timestamp}`)
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: local.getUTCDay(),
  }
}

/** Convert a Chicago wall-clock time to a Unix timestamp, DST-safe. */
export function chicagoToUnix(year: number, month: number, day: number, hour: number, minute = 0): number {
  const daysInMonth = utcDay(year, month + 1, 0).getUTCDate()
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > 9_999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > daysInMonth ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Invalid Chicago time: ${year}-${month}-${day} ${hour}:${minute}`)
  }
  const guessDate = utcDay(year, month, day)
  guessDate.setUTCHours(hour, minute, 0, 0)
  const guess = guessDate.getTime() / 1_000
  // The offset at the guess can be stale across a DST boundary; iterating a few
  // times converges for real Chicago wall times (nonexistent times settle on the
  // later side rather than looping forever).
  let result = guess - offsetSeconds(guess)
  for (let step = 0; step < 3; step += 1) {
    const next = guess - offsetSeconds(result)
    if (next === result) break
    result = next
  }
  return Math.round(result)
}

/** `YYYY-MM-DD` of the CME trading day that contains `timestamp`. */
export function tradingDayKey(timestamp: number): string {
  const cached = dayKeyCache.get(timestamp)
  if (cached !== undefined) return cached
  const local = wallClock(timestamp)
  // 16:00–23:59 local belongs to the next trade date; the evening session has
  // already started by then. This matches the old +8h-date behaviour exactly.
  const key = formatDay(utcDay(local.year, local.month, local.day + (local.hour >= SESSION_KEY_HOUR ? 1 : 0)))
  return remember(dayKeyCache, timestamp, key)
}

export function parseDayKey(key: string): { year: number; month: number; day: number } {
  if (typeof key !== 'string') throw new Error(`Invalid trading day key: ${key}`)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) throw new Error(`Invalid trading day key: ${key}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || year > 9_999 || month < 1 || month > 12 || day < 1 || day > utcDay(year, month + 1, 0).getUTCDate()) {
    throw new Error(`Invalid trading day key: ${key}`)
  }
  return { year, month, day }
}

export function shiftDayKey(key: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new Error(`Invalid day shift: ${days}`)
  const { year, month, day } = parseDayKey(key)
  const shifted = utcDay(year, month, day + days)
  if (Number.isNaN(shifted.getTime())) throw new Error(`Invalid day shift: ${days}`)
  return formatDay(shifted)
}

/** Unix seconds when the session for `key` opened (previous day at 17:00). */
export function sessionOpen(key: string): number {
  const cached = openCache.get(key)
  if (cached !== undefined) return cached
  const { year, month, day } = parseDayKey(key)
  const previous = utcDay(year, month, day - 1)
  const value = chicagoToUnix(previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate(), 17)
  return remember(openCache, key, value)
}

/** Unix seconds when the session for `key` closes (16:00 on the trade date). */
export function sessionClose(key: string): number {
  const cached = closeCache.get(key)
  if (cached !== undefined) return cached
  const { year, month, day } = parseDayKey(key)
  const value = chicagoToUnix(year, month, day, 16)
  return remember(closeCache, key, value)
}

/** Trade dates are Monday–Friday; Sunday's evening belongs to Monday. */
export function isTradeDate(key: string): boolean {
  const cached = tradeDateCache.get(key)
  if (cached !== undefined) return cached
  const { year, month, day } = parseDayKey(key)
  const weekday = utcDay(year, month, day).getUTCDay()
  return remember(tradeDateCache, key, weekday >= 1 && weekday <= 5)
}

/** True when `timestamp` is inside a live Globex session. */
export function isMarketOpen(timestamp: number): boolean {
  if (!isSessionTimestamp(timestamp)) return false
  const cached = marketOpenCache.get(timestamp)
  if (cached !== undefined) return cached
  const key = tradingDayKey(timestamp)
  const open = isTradeDate(key) && timestamp >= sessionOpen(key) && timestamp < sessionClose(key)
  return remember(marketOpenCache, timestamp, open)
}

/** Next session open strictly after `timestamp`. */
export function nextSessionOpen(timestamp: number): number {
  if (!isSessionTimestamp(timestamp)) throw new Error(`Invalid timestamp: ${timestamp}`)
  let key = tradingDayKey(timestamp)
  if (isTradeDate(key) && timestamp < sessionOpen(key)) return sessionOpen(key)
  for (let step = 1; step <= 8; step += 1) {
    key = shiftDayKey(key, 1)
    if (isTradeDate(key)) return sessionOpen(key)
  }
  // The weekly calendar above always finds a weekday within eight days.
  return sessionOpen(shiftDayKey(tradingDayKey(timestamp), 1))
}

/** Session progress in `[0, 1]` for the trading day containing `timestamp`. */
export function sessionProgress(timestamp: number): number {
  const key = tradingDayKey(timestamp)
  const open = sessionOpen(key)
  const close = sessionClose(key)
  if (timestamp <= open) return 0
  if (timestamp >= close) return 1
  return (timestamp - open) / (close - open)
}

/** True when the market is closed (maintenance break or weekend). */
export function isSessionBreak(timestamp: number): boolean {
  return !isMarketOpen(timestamp)
}

export const SESSION_TIMEZONE = TIMEZONE
export const SESSION_SECONDS = DAY_SECONDS
