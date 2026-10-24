// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { computed, reactive, ref, useAttrs, watch } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TerminalHistory from '@/components/terminal/TerminalHistory.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { formatMoney, formatPrice } from '@/utils/format'
import type { SimDayLedger, SimEvent, SimTrade } from '@/domain/sim/types'
import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh-CN.json'
import ja from '../../i18n/locales/ja.json'

enableAutoUnmount(afterEach)

const translations = { en, 'zh-CN': zh, ja }

beforeEach(() => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useAttrs', useAttrs)
  vi.stubGlobal('formatPrice', formatPrice)
  vi.stubGlobal('formatMoney', formatMoney)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function globalOptions(locale = 'en') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, 'zh-CN': zh, ja } })
  return {
    plugins: [i18n],
    components: { Badge, Button, SegmentedControl },
  }
}

function captureDownloads() {
  const blobs: Blob[] = []
  const clicks: { filename: string; href: string }[] = []
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      blobs.push(blob)
      return `blob:history-${blobs.length}`
    },
    revokeObjectURL: () => {},
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ filename: this.download, href: this.href })
  })
  return { blobs, clicks }
}

const baseTime = Date.UTC(2026, 0, 2, 13, 0, 0) / 1000

function trade(overrides: Partial<SimTrade> = {}): SimTrade {
  return {
    id: 'trade-1',
    positionId: 'position-1',
    symbol: 'MES',
    side: 'long',
    qty: 2,
    entryPrice: 100,
    exitPrice: 103,
    entryBar: 1,
    exitBar: 5,
    entryTime: baseTime,
    exitTime: baseTime + 300,
    exitReason: 'target',
    grossPnl: 30,
    fees: 1.24,
    pnl: 28.76,
    rMultiple: 2,
    mae: 0,
    mfe: 30,
    tag: '',
    ...overrides,
  }
}

function event(overrides: Partial<SimEvent> = {}): SimEvent {
  return {
    id: 1,
    bar: 1,
    time: baseTime,
    type: 'filled',
    symbol: 'MES',
    orderId: 'order-1',
    message: 'Filled 2 at 100',
    ...overrides,
  }
}

function day(overrides: Partial<SimDayLedger> = {}): SimDayLedger {
  return {
    key: '2026-01-02',
    realizedPnl: 28.76,
    trades: 1,
    fills: 2,
    startEquity: 50000,
    finalized: true,
    ...overrides,
  }
}

describe('terminal history', () => {
  it('shows empty states for trades, events and days with zeroed stats', async () => {
    const view = mount(TerminalHistory, {
      props: { trades: [], events: [], days: [], currentDay: '2026-01-02' },
      global: globalOptions(),
    })
    expect(view.get('[data-testid="terminal-history"]').attributes('aria-label')).toBe(
      translations.en.terminal.history.title,
    )
    expect(view.get('[data-testid="history-net"]').text()).toBe('$0.00')
    expect(view.get('[data-testid="history-win-rate"]').text()).toBe('—')
    expect(view.get('[data-testid="history-fees"]').text()).toBe('$0.00')
    expect(view.get('[data-testid="history-empty-trades"]').text()).toBe(translations.en.terminal.history.emptyTrades)
    expect(view.find('[data-testid="history-export-trades"]').exists()).toBe(false)
    await view.findAll('[data-testid="history-tabs"] [role="tab"]')[1]!.trigger('click')
    expect(view.get('[data-testid="history-empty-events"]').text()).toBe(translations.en.terminal.history.emptyEvents)
    await view.findAll('[data-testid="history-tabs"] [role="tab"]')[2]!.trigger('click')
    expect(view.get('[data-testid="history-empty-days"]').text()).toBe(translations.en.terminal.history.emptyDays)
  })

  it('sorts closed trades newest first and computes net, win rate and fees', async () => {
    const older = trade({ id: 'older', exitTime: baseTime - 60, pnl: -10, fees: 2, exitPrice: 99 })
    const newer = trade({ id: 'newer', exitTime: baseTime + 60, pnl: 28.76, fees: 1.24 })
    const view = mount(TerminalHistory, {
      props: { trades: [older, newer], events: [], days: [], currentDay: '2026-01-02' },
      global: globalOptions(),
    })
    expect(view.get('[data-testid="history-net"]').text()).toBe('+$18.76')
    expect(view.get('[data-testid="history-net"]').classes()).toContain('text-bull-strong')
    expect(view.get('[data-testid="history-win-rate"]').text()).toBe('50%')
    expect(view.get('[data-testid="history-fees"]').text()).toBe('$3.24')
    const rows = view.findAll('[data-testid="history-trade"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.get('[data-testid="history-trade-pnl"]').text()).toBe('+$28.76')
    expect(rows[0]!.get('[data-testid="history-trade-pnl"]').classes()).toContain('text-bull-strong')
    expect(rows[1]!.get('[data-testid="history-trade-pnl"]').text()).toBe('-$10.00')
    expect(rows[1]!.get('[data-testid="history-trade-pnl"]').classes()).toContain('text-bear-strong')
    await rows[0]!.get('[data-testid="history-trade-focus"]').trigger('click')
    expect(view.emitted('focus')).toEqual([['MES', newer.entryTime, newer.exitTime]])
  })

  it('uses per-symbol precision and supports negative trade prices', () => {
    const view = mount(TerminalHistory, {
      props: {
        trades: [
          trade({ symbol: 'MES', entryPrice: -0.5, exitPrice: -0.25 }),
          trade({ id: 'nq', symbol: 'NQ', entryPrice: 20000.4, exitPrice: 20001.6, exitTime: baseTime + 240 }),
        ],
        events: [],
        days: [],
        currentDay: '2026-01-02',
        precision: 2,
        precisions: { MES: 2, NQ: 0 },
      },
      global: globalOptions(),
    })
    const rows = view.findAll('[data-testid="history-trade"]')
    expect(rows[0]!.get('[data-testid="history-entry-price"]').text()).toBe('-0.50')
    expect(rows[0]!.get('[data-testid="history-exit-price"]').text()).toBe('-0.25')
    expect(rows[1]!.get('[data-testid="history-entry-price"]').text()).toBe('20,000')
    expect(rows[1]!.get('[data-testid="history-exit-price"]').text()).toBe('20,002')
  })

  it('lists every event reason newest first with localized types', async () => {
    const older = event({ id: 1, time: baseTime, message: 'Filled 2 at 100' })
    const newer = event({
      id: 2,
      time: baseTime + 10,
      type: 'breach',
      symbol: null,
      orderId: null,
      message: 'Daily loss breached',
    })
    const view = mount(TerminalHistory, {
      props: { trades: [], events: [older, newer], days: [], currentDay: '2026-01-02' },
      global: globalOptions(),
    })
    await view.findAll('[data-testid="history-tabs"] [role="tab"]')[1]!.trigger('click')
    const rows = view.findAll('[data-testid="history-event"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain(translations.en.terminal.ledger.events.breach)
    expect(rows[0]!.get('[data-testid="history-event-reason"]').text()).toContain('Daily loss breached')
    expect(rows[1]!.text()).toContain(translations.en.terminal.ledger.events.filled)
    expect(rows[1]!.get('[data-testid="history-event-reason"]').text()).toContain('Filled 2 at 100')
    expect(rows[1]!.text()).toContain('order-1')
  })

  it('sorts day performance, marks the current day and shows finalized state', async () => {
    const view = mount(TerminalHistory, {
      props: {
        trades: [],
        events: [],
        days: [
          day({ key: '2026-01-02', realizedPnl: -5, trades: 2, fills: 4 }),
          day({ key: '2026-01-03', realizedPnl: 10, trades: 1, fills: 1, finalized: false }),
        ],
        currentDay: '2026-01-03',
      },
      global: globalOptions(),
    })
    await view.findAll('[data-testid="history-tabs"] [role="tab"]')[2]!.trigger('click')
    const rows = view.findAll('[data-testid="history-day"]')
    expect(rows[0]!.text()).toContain('2026-01-03')
    expect(rows[0]!.attributes('aria-current')).toBe('date')
    expect(rows[0]!.text()).toContain(translations.en.terminal.history.currentDay)
    expect(rows[0]!.text()).toContain(translations.en.terminal.history.provisional)
    expect(rows[0]!.get('[data-testid="history-day-pnl"]').text()).toBe('+$10.00')
    expect(rows[1]!.text()).toContain('2026-01-02')
    expect(rows[1]!.text()).toContain(translations.en.terminal.history.finalized)
    expect(rows[1]!.get('[data-testid="history-day-pnl"]').text()).toBe('-$5.00')
    expect(rows.some((row) => row.attributes('aria-current') === 'date')).toBe(true)
  })

  it('exports trades and the event log with safe cells and numeric P&L', async () => {
    const capture = captureDownloads()
    const view = mount(TerminalHistory, {
      props: {
        trades: [trade({ id: 'trade=1', tag: '=HYPERLINK("http://example")', pnl: -4.5 })],
        events: [event({ id: 3, message: '@SUM(1,1)' })],
        days: [],
        currentDay: '2026-01-02',
      },
      global: globalOptions(),
    })
    await view.get('[data-testid="history-export-trades"]').trigger('click')
    expect(capture.clicks[0]!.filename).toBe('terminal-trades.csv')
    const tradesCsv = await capture.blobs[0]!.text()
    expect(tradesCsv.startsWith('\uFEFF')).toBe(true)
    expect(tradesCsv).toContain(`"${translations.en.terminal.history.net}"`)
    expect(tradesCsv).toContain('"trade=1"')
    expect(tradesCsv).toContain('"\'=HYPERLINK(""http://example"")"')
    expect(tradesCsv).toContain(',-4.5,')

    await view.findAll('[data-testid="history-tabs"] [role="tab"]')[1]!.trigger('click')
    await view.get('[data-testid="history-export-events"]').trigger('click')
    expect(capture.clicks[1]!.filename).toBe('terminal-events.csv')
    const eventsCsv = await capture.blobs[1]!.text()
    expect(eventsCsv).toContain('"\'@SUM(1,1)"')
    expect(eventsCsv).toContain(`"${translations.en.terminal.ledger.events.filled}"`)
  })

  it('localizes the history shell, sides and event labels', async () => {
    const view = mount(TerminalHistory, {
      props: {
        trades: [trade({ side: 'short' })],
        events: [event({ type: 'trade' })],
        days: [day({ finalized: false })],
        currentDay: '2026-01-02',
      },
      global: globalOptions('zh-CN'),
    })
    const messages = translations['zh-CN']
    expect(view.text()).toContain(messages.terminal.history.title)
    expect(view.text()).toContain(messages.terminal.ledger.sides.short)
    expect(view.text()).toContain(messages.terminal.history.trades)
    await view.findAll('[data-testid="history-tabs"] [role="tab"]')[1]!.trigger('click')
    expect(view.text()).toContain(messages.terminal.ledger.events.trade)
    await view.findAll('[data-testid="history-tabs"] [role="tab"]')[2]!.trigger('click')
    expect(view.text()).toContain(messages.terminal.history.provisional)
  })
})
