// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { computed, reactive, ref, useAttrs, watch } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OrdersTable from '@/components/terminal/OrdersTable.vue'
import PositionsTable from '@/components/terminal/PositionsTable.vue'
import FillsTable from '@/components/terminal/FillsTable.vue'
import DomLadder from '@/components/terminal/DomLadder.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { formatMoney, formatPrice } from '@/utils/format'
import { serializeCsv } from '@/lib/sim/export'
import translations from '../../profile_output/terminal-ledger-translations.json'
import type { SimFill, SimOrder, SimPosition } from '@/domain/sim/types'
import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh-CN.json'
import ja from '../../i18n/locales/ja.json'

enableAutoUnmount(afterEach)

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
  for (const key of ['en', 'zh-CN', 'ja'] as const) i18n.global.mergeLocaleMessage(key, translations[key])
  return {
    plugins: [i18n],
    components: { Badge, Button, Input, SegmentedControl },
  }
}

function captureDownloads() {
  const blobs: Blob[] = []
  const clicks: { filename: string; href: string }[] = []
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      blobs.push(blob)
      return `blob:terminal-${blobs.length}`
    },
    revokeObjectURL: () => {},
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ filename: this.download, href: this.href })
  })
  return { blobs, clicks }
}

function requestError(container: Element): HTMLElement {
  const alert = container.querySelector<HTMLElement>('[role="alert"]')
  if (!alert) throw new Error('expected an error alert')
  return alert
}

function order(overrides: Partial<SimOrder> = {}): SimOrder {
  return {
    id: 'order-1',
    symbol: 'MES',
    side: 'long',
    type: 'limit',
    qty: 4,
    limitPrice: 100,
    stopPrice: null,
    trailTicks: null,
    limitOffsetTicks: null,
    trailAnchor: null,
    triggered: false,
    tif: 'gtc',
    expiresAt: null,
    releaseAt: null,
    status: 'working',
    role: 'entry',
    reduceOnly: false,
    parentId: null,
    ocoId: null,
    bracket: null,
    createdBar: 0,
    createdTime: 0,
    filledBar: null,
    filledTime: null,
    filledPrice: null,
    filledQty: 0,
    cancelledBar: null,
    reason: null,
    tag: '',
    ...overrides,
  }
}

function position(overrides: Partial<SimPosition> = {}): SimPosition {
  return {
    id: 'position-1',
    symbol: 'MES',
    side: 'long',
    qty: 2,
    avgPrice: 100,
    entryBar: 0,
    entryTime: 0,
    stopLoss: null,
    targets: [],
    initialRisk: 100,
    entryFee: 1.24,
    mae: 0,
    mfe: 0,
    bestPrice: 100,
    atm: null,
    breakEvenDone: false,
    tag: '',
    ...overrides,
  }
}

function fill(overrides: Partial<SimFill> = {}): SimFill {
  return {
    id: 'fill-1',
    orderId: 'order-1',
    symbol: 'MES',
    side: 'long',
    qty: 2,
    price: 100,
    bar: 0,
    time: Date.UTC(2026, 0, 2, 13, 14, 15) / 1000,
    role: 'entry',
    fee: 1.24,
    cashDelta: -1.24,
    reason: null,
    ...overrides,
  }
}

describe('terminal orders', () => {
  it('shows an empty state without cancellation controls', () => {
    const view = mount(OrdersTable, { props: { orders: [], precision: 2 }, global: globalOptions() })
    expect(view.get('[data-testid="orders-empty"]').text()).toBe(translations.en.terminal.orders.empty)
    expect(view.findAll('[data-testid="order-row"]')).toHaveLength(0)
    expect(view.find('[data-testid="orders-cancel-all"]').exists()).toBe(false)
  })

  it('shows the symbol, order details, partial quantity, and status', () => {
    const view = mount(OrdersTable, {
      props: { orders: [order({ filledQty: 1 })], precision: 2 },
      global: globalOptions(),
    })
    const row = view.get('[data-testid="order-row"]')
    expect(row.text()).toContain('MES')
    expect(row.text()).toContain('Buy')
    expect(row.text()).toContain('Limit')
    expect(row.text()).toContain('GTC')
    expect(row.text()).toContain('Working')
    expect(row.get('[data-testid="order-qty"]').text()).toBe('1/4')
    expect(row.get('[data-testid="order-price"]').text()).toBe('100.00')
  })

  it('cancels working and suspended orders and emits cancelAll only on request', async () => {
    const view = mount(OrdersTable, {
      props: {
        orders: [
          order(),
          order({ id: 'suspended', status: 'suspended', side: 'short' }),
          order({ id: 'filled', status: 'filled', filledQty: 4 }),
          order({ id: 'cancelled', status: 'cancelled' }),
          order({ id: 'rejected', status: 'rejected' }),
          order({ id: 'expired', status: 'expired' }),
        ],
        precision: 2,
      },
      global: globalOptions(),
    })
    const cancels = view.findAll('[data-testid="order-cancel"]')
    expect(cancels).toHaveLength(2)
    expect(view.text()).toContain('Sell')
    expect(view.text()).toContain('Suspended')
    await cancels[0]!.trigger('click')
    await cancels[1]!.trigger('click')
    expect(view.emitted('cancel')).toEqual([['order-1'], ['suspended']])
    expect(view.emitted('cancelAll')).toBeUndefined()
    await view.get('[data-testid="orders-cancel-all"]').trigger('click')
    expect(view.emitted('cancelAll')).toEqual([[]])
    await view.setProps({ orders: [order({ status: 'filled', filledQty: 4 })] })
    expect(view.find('[data-testid="orders-cancel-all"]').exists()).toBe(false)
    expect(view.get('[data-testid="order-qty"]').text()).toBe('4/4')
  })

  it('formats limit, stop, trailing and market prices without treating zero as missing', () => {
    const view = mount(OrdersTable, {
      props: {
        orders: [
          order({ id: 'zero', limitPrice: 0 }),
          order({ id: 'stop', type: 'stop', limitPrice: null, stopPrice: -0.25 }),
          order({ id: 'trail', type: 'trailing-stop', limitPrice: null, trailTicks: 8 }),
          order({ id: 'market', type: 'market', limitPrice: null }),
        ],
        precision: 2,
      },
      global: globalOptions(),
    })
    expect(view.findAll('[data-testid="order-price"]').map((row) => row.text())).toEqual([
      '0.00',
      '-0.25',
      '8 ticks',
      '—',
    ])
  })

  it('filters by status and symbol without mutating the order list', async () => {
    const orders = [
      order({ id: 'working', symbol: 'MES' }),
      order({ id: 'suspended', symbol: 'MES', status: 'suspended' }),
      order({ id: 'filled', symbol: 'NQ', status: 'filled', filledQty: 4 }),
      order({ id: 'cancelled', symbol: 'MES', status: 'cancelled' }),
      order({ id: 'rejected', symbol: 'NQ', status: 'rejected' }),
      order({ id: 'expired', symbol: 'MES', status: 'expired' }),
    ]
    const snapshot = orders.map((item) => ({ ...item }))
    const view = mount(OrdersTable, { props: { orders, precision: 2 }, global: globalOptions() })
    expect(view.findAll('[data-testid="order-row"]')).toHaveLength(6)

    const tab = (label: string) =>
      view.findAll('[data-testid="orders-scope"] [role="tab"]').find((candidate) => candidate.text() === label)!
    await tab(translations.en.terminal.orders.scopes.working).trigger('click')
    expect(view.findAll('[data-testid="order-row"]')).toHaveLength(2)
    expect(view.get('[data-testid="orders-count"]').text()).toBe('2')
    expect(view.findAll('[data-testid="order-cancel"]')).toHaveLength(2)

    await tab(translations.en.terminal.orders.scopes.filled).trigger('click')
    expect(view.findAll('[data-testid="order-row"]')).toHaveLength(1)
    expect(view.get('[data-testid="order-qty"]').text()).toBe('4/4')
    expect(view.find('[data-testid="order-cancel"]').exists()).toBe(false)

    await tab(translations.en.terminal.orders.scopes.cancelled).trigger('click')
    expect(view.findAll('[data-testid="order-row"]')).toHaveLength(1)
    expect(view.text()).toContain(translations.en.terminal.orders.cancelled)

    await view.setProps({ symbolFilter: 'NQ' })
    expect(view.findAll('[data-testid="order-row"]')).toHaveLength(0)
    await view.setProps({ symbolFilter: null })
    expect(view.findAll('[data-testid="order-row"]')).toHaveLength(1)
    expect(orders).toEqual(snapshot)
  })

  it('localizes terminal statuses and exposes reasons, UTC timestamps, OCO and parent details', () => {
    const view = mount(OrdersTable, {
      props: {
        orders: [
          order({
            id: 'stop-limit',
            type: 'stop-limit',
            limitPrice: 101,
            stopPrice: 99,
            reason: 'Protective stop',
            parentId: 'parent-1',
            ocoId: 'oco-1',
            role: 'target',
            reduceOnly: true,
            createdTime: Date.UTC(2026, 0, 2, 13, 14, 15) / 1000,
            releaseAt: Date.UTC(2026, 0, 2, 13, 15, 0) / 1000,
            expiresAt: Date.UTC(2026, 0, 2, 20, 0, 0) / 1000,
          }),
          order({ id: 'cancelled', status: 'cancelled' }),
          order({ id: 'rejected', status: 'rejected' }),
          order({ id: 'expired', status: 'expired' }),
        ],
        precision: 2,
      },
      global: globalOptions(),
    })
    const first = view.findAll('[data-testid="order-row"]')[0]!
    expect(first.get('[data-testid="order-price"]').text()).toContain('Stop price 99.00')
    expect(first.get('[data-testid="order-price"]').text()).toContain('Limit price 101.00')
    expect(first.get('[data-testid="order-reason"]').text()).toContain('Protective stop')
    const details = first.get('[data-testid="order-details"]').text()
    expect(details).toContain('2026-01-02T13:14:15Z')
    expect(details).toContain('2026-01-02T13:15:00Z')
    expect(details).toContain('2026-01-02T20:00:00Z')
    expect(details).toContain('parent-1')
    expect(details).toContain('oco-1')
    expect(details).toContain(translations.en.terminal.ledger.roles.target)
    expect(details).toContain(translations.en.terminal.orders.reduceOnly)
    expect(view.text()).toContain(translations.en.terminal.orders.cancelled)
    expect(view.text()).toContain(translations.en.terminal.orders.rejected)
    expect(view.text()).toContain(translations.en.terminal.orders.expired)
    expect(view.findAll('[data-testid="order-edit"]')).toHaveLength(1)
  })

  it('edits quantity, limit and stop of a working stop-limit order without rounding or mutating props', async () => {
    const original = order({ type: 'stop-limit', qty: 4, filledQty: 1, limitPrice: 100, stopPrice: 99.5 })
    const view = mount(OrdersTable, { props: { orders: [original], precision: 2 }, global: globalOptions() })
    await view.get('[data-testid="order-edit"]').trigger('click')
    expect(view.find('[data-testid="order-edit-stop"]').exists()).toBe(true)
    await view.get('[data-testid="order-edit-qty"]').setValue('6')
    await view.get('[data-testid="order-edit-limit"]').setValue('100.005')
    await view.get('[data-testid="order-edit-stop"]').setValue('99.25')
    await view.get('[data-testid="order-editor"]').trigger('submit')
    expect(view.emitted('modify')).toEqual([['order-1', { qty: 6, limitPrice: 100.005, stopPrice: 99.25 }]])
    expect(original.qty).toBe(4)
    expect(original.limitPrice).toBe(100)
    expect(original.stopPrice).toBe(99.5)
  })

  it('only shows relevant fields and rejects a missing required protection price', async () => {
    const view = mount(OrdersTable, {
      props: { orders: [order({ id: 'stop', type: 'stop', limitPrice: null, stopPrice: 99 })], precision: 2 },
      global: globalOptions(),
    })
    await view.get('[data-testid="order-edit"]').trigger('click')
    expect(view.find('[data-testid="order-edit-limit"]').exists()).toBe(false)
    expect(view.find('[data-testid="order-edit-stop"]').exists()).toBe(true)
    await view.get('[data-testid="order-edit-stop"]').setValue('')
    await view.get('[data-testid="order-editor"]').trigger('submit')
    expect(view.emitted('modify')).toBeUndefined()
    expect(view.get('[role="alert"]').text()).toBe(translations.en.terminal.orders.invalidPrice)
  })

  it('rejects fractional, below-filled and non-finite edits instead of silently rounding', async () => {
    const view = mount(OrdersTable, {
      props: { orders: [order({ qty: 4, filledQty: 2, limitPrice: 100 })], precision: 2 },
      global: globalOptions(),
    })
    await view.get('[data-testid="order-edit"]').trigger('click')
    const qty = view.get('[data-testid="order-edit-qty"]')
    for (const invalid of ['2.5', '1', '0', 'abc']) {
      await qty.setValue(invalid)
      await view.get('[data-testid="order-editor"]').trigger('submit')
      expect(requestError(view.element).textContent).toContain(
        translations.en.terminal.orders.invalidQty.replace('{min}', '2'),
      )
    }
    expect(view.emitted('modify')).toBeUndefined()
    await qty.setValue('2')
    await view.get('[data-testid="order-edit-limit"]').setValue('Infinity')
    await view.get('[data-testid="order-editor"]').trigger('submit')
    expect(requestError(view.element).textContent).toBe(translations.en.terminal.orders.invalidPrice)
    expect(view.emitted('modify')).toBeUndefined()
    await qty.setValue('4')
    await view.get('[data-testid="order-edit-limit"]').setValue('100')
    await view.get('[data-testid="order-editor"]').trigger('submit')
    expect(view.emitted('modify')).toBeUndefined()
    await view.get('[data-testid="order-edit-limit"]').setValue('100.125')
    await view.get('[data-testid="order-editor"]').trigger('submit')
    expect(view.emitted('modify')).toEqual([['order-1', { limitPrice: 100.125 }]])
  })

  it('allows clearing the derived limit price of a trailing stop-limit with a tick offset', async () => {
    const view = mount(OrdersTable, {
      props: {
        orders: [
          order({
            type: 'trailing-stop-limit',
            limitPrice: 99,
            limitOffsetTicks: 4,
            stopPrice: 100,
            trailTicks: 8,
          }),
        ],
        precision: 2,
      },
      global: globalOptions(),
    })
    await view.get('[data-testid="order-edit"]').trigger('click')
    await view.get('[data-testid="order-edit-limit"]').setValue('')
    await view.get('[data-testid="order-editor"]').trigger('submit')
    expect(view.emitted('modify')).toEqual([['order-1', { limitPrice: null }]])
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })

  it('closes the editor when the order leaves the working state', async () => {
    const view = mount(OrdersTable, { props: { orders: [order()], precision: 2 }, global: globalOptions() })
    await view.get('[data-testid="order-edit"]').trigger('click')
    expect(view.find('[data-testid="order-editor"]').exists()).toBe(true)
    await view.setProps({ orders: [order({ status: 'filled', filledQty: 4 })] })
    expect(view.find('[data-testid="order-editor"]').exists()).toBe(false)
  })

  it('cancels only the requested side', async () => {
    const view = mount(OrdersTable, {
      props: {
        orders: [order({ id: 'buy', side: 'long' }), order({ id: 'sell', side: 'short' })],
        precision: 2,
      },
      global: globalOptions(),
    })
    await view.get('[data-testid="orders-cancel-buy"]').trigger('click')
    await view.get('[data-testid="orders-cancel-sell"]').trigger('click')
    expect(view.emitted('cancelSide')).toEqual([['long'], ['short']])
    await view.setProps({ orders: [order({ side: 'long' })] })
    expect(view.find('[data-testid="orders-cancel-sell"]').exists()).toBe(false)
  })

  it('uses per-symbol precision for prices', () => {
    const view = mount(OrdersTable, {
      props: {
        orders: [
          order({ id: 'mes', symbol: 'MES', limitPrice: 100.126 }),
          order({ id: 'nq', symbol: 'NQ', limitPrice: 20000.5 }),
        ],
        precision: 2,
        precisions: { MES: 2, NQ: 0 },
      },
      global: globalOptions(),
    })
    expect(view.findAll('[data-testid="order-price"]').map((row) => row.text())).toEqual(['100.13', '20,001'])
  })
})

describe('terminal positions', () => {
  it('shows a flat account empty state', () => {
    const view = mount(PositionsTable, {
      props: { positions: [], marks: {}, precision: 2, pointValues: {} },
      global: globalOptions(),
    })
    expect(view.get('[data-testid="positions-empty"]').text()).toBe(en.terminal.positions.empty)
    expect(view.findAll('button')).toHaveLength(0)
  })

  it('uses marks, quantity, point value and direction for signed open P&L', async () => {
    const view = mount(PositionsTable, {
      props: {
        positions: [position(), position({ id: 'short', symbol: 'MNQ', side: 'short' })],
        marks: { MES: { price: 103, time: 1, bar: 1 }, MNQ: { price: 102, time: 1, bar: 1 } },
        precision: 2,
        pointValues: { MES: 5, MNQ: 2 },
      },
      global: globalOptions(),
    })
    const rows = view.findAll('[data-testid="position-row"]')
    expect(rows[0]!.text()).toContain('Long')
    expect(rows[1]!.text()).toContain('Short')
    expect(rows[0]!.get('[data-testid="position-avg"]').text()).toBe('100.00')
    expect(rows[0]!.get('[data-testid="position-mark"]').text()).toBe('103.00')
    expect(rows[0]!.get('[data-testid="position-pnl"]').text()).toBe('+$30.00')
    expect(rows[0]!.get('[data-testid="position-pnl"]').classes()).toContain('text-bull-strong')
    expect(rows[1]!.get('[data-testid="position-pnl"]').text()).toBe('-$8.00')
    expect(rows[1]!.get('[data-testid="position-pnl"]').classes()).toContain('text-bear-strong')
    await view.setProps({ marks: { MES: { price: 100, time: 2, bar: 2 }, MNQ: { price: 99, time: 2, bar: 2 } } })
    expect(rows[0]!.get('[data-testid="position-pnl"]').text()).toBe('$0.00')
    expect(rows[0]!.get('[data-testid="position-pnl"]').classes()).toContain('text-ink-2')
    expect(rows[1]!.get('[data-testid="position-pnl"]').text()).toBe('+$4.00')
    await view.setProps({ pointValues: { MES: 5, MNQ: 20 } })
    expect(rows[1]!.get('[data-testid="position-pnl"]').text()).toBe('+$40.00')
  })

  it('does not invent a mark or a point value when either is absent', async () => {
    const view = mount(PositionsTable, {
      props: { positions: [position()], marks: {}, precision: 2, pointValues: { MES: 5 } },
      global: globalOptions(),
    })
    expect(view.get('[data-testid="position-mark"]').text()).toBe('—')
    expect(view.get('[data-testid="position-pnl"]').text()).toBe('—')
    await view.setProps({ marks: { MES: { price: 101, time: 1, bar: 1 } }, pointValues: {} })
    expect(view.get('[data-testid="position-mark"]').text()).toBe('101.00')
    expect(view.get('[data-testid="position-pnl"]').text()).toBe('—')
    await view.setProps({ marks: { MES: { price: 0, time: 1, bar: 1 } }, pointValues: { MES: 5 } })
    expect(view.get('[data-testid="position-mark"]').text()).toBe('0.00')
    expect(view.get('[data-testid="position-pnl"]').text()).toBe('-$1,000.00')
  })

  it('emits the selected symbol for each row action', async () => {
    const view = mount(PositionsTable, {
      props: { positions: [position({ symbol: 'MNQ' })], marks: {}, precision: 2, pointValues: {} },
      global: globalOptions(),
    })
    await view.get('[data-testid="position-flatten"]').trigger('click')
    await view.get('[data-testid="position-reverse"]').trigger('click')
    await view.get('[data-testid="position-focus"]').trigger('click')
    expect(view.emitted('flatten')).toEqual([['MNQ']])
    expect(view.emitted('reverse')).toEqual([['MNQ']])
    expect(view.emitted('focus')).toEqual([['MNQ']])
  })

  it('reduces a whole quantity within the position and rejects out-of-range input', async () => {
    const view = mount(PositionsTable, {
      props: {
        positions: [position({ qty: 2 })],
        marks: { MES: { price: 103, time: 1, bar: 1 } },
        precision: 2,
        pointValues: { MES: 5 },
        replayTime: 1,
      },
      global: globalOptions(),
    })
    const qty = view.get('[data-testid="position-reduce-qty"]')
    const form = view.get('[data-testid="position-reduce-form"]')
    for (const invalid of ['0', '3', '1.5', 'abc', '']) {
      await qty.setValue(invalid)
      await form.trigger('submit')
      expect(requestError(view.element).textContent).toContain(
        translations.en.terminal.positions.invalidReduce.replace('{max}', '2'),
      )
    }
    expect(view.emitted('reduce')).toBeUndefined()
    await qty.setValue('2')
    await form.trigger('submit')
    expect(view.emitted('reduce')).toEqual([['MES', 2]])
    await qty.setValue('1')
    await form.trigger('submit')
    expect(view.emitted('reduce')).toEqual([
      ['MES', 2],
      ['MES', 1],
    ])
  })

  it('marks a quote stale and exposes its UTC time without disabling reduce', async () => {
    const view = mount(PositionsTable, {
      props: {
        positions: [position()],
        marks: { MES: { price: 103, time: 100, bar: 1 } },
        precision: 2,
        pointValues: { MES: 5 },
        replayTime: 100,
      },
      global: globalOptions(),
    })
    expect(view.find('[data-testid="position-stale"]').exists()).toBe(false)
    expect(view.get('[data-testid="position-mark-time"]').text()).toContain('1970-01-01T00:01:40Z')
    await view.setProps({ replayTime: 101 })
    expect(view.get('[data-testid="position-stale"]').text()).toBe(translations.en.terminal.positions.stale)
    await view.get('[data-testid="position-reduce-qty"]').setValue('1')
    await view.get('[data-testid="position-reduce-form"]').trigger('submit')
    expect(view.emitted('reduce')).toEqual([['MES', 1]])
  })

  it('supports per-symbol precision, negative prices and localized sides', () => {
    const view = mount(PositionsTable, {
      props: {
        positions: [position({ avgPrice: -0.5, qty: 1, side: 'short' })],
        marks: { MES: { price: -1, time: 1, bar: 1 } },
        precision: 2,
        precisions: { MES: 2 },
        pointValues: { MES: 5 },
      },
      global: globalOptions('zh-CN'),
    })
    const row = view.get('[data-testid="position-row"]')
    expect(row.text()).toContain(translations['zh-CN'].terminal.ledger.sides.short)
    expect(row.get('[data-testid="position-avg"]').text()).toBe('-0.50')
    expect(row.get('[data-testid="position-mark"]').text()).toBe('-1.00')
    expect(row.get('[data-testid="position-pnl"]').text()).toBe('+$2.50')

    const rounded = mount(PositionsTable, {
      props: {
        positions: [position({ avgPrice: 100.4 })],
        marks: { MES: { price: 103.6, time: 1, bar: 1 } },
        precision: 2,
        precisions: { MES: 0 },
        pointValues: { MES: 5 },
      },
      global: globalOptions(),
    })
    expect(rounded.get('[data-testid="position-avg"]').text()).toBe('100')
    expect(rounded.get('[data-testid="position-mark"]').text()).toBe('104')
  })
})

describe('terminal fills', () => {
  it('shows an empty state', () => {
    const view = mount(FillsTable, { props: { fills: [], precision: 2 }, global: globalOptions() })
    expect(view.get('[data-testid="fills-empty"]').text()).toBe(en.terminal.fills.empty)
  })

  it('shows newest fills first, UTC seconds, sides, sizes, prices, roles and fees', () => {
    const first = fill()
    const last = fill({ id: 'fill-2', time: first.time + 61, side: 'short', role: 'exit', price: 101.25, qty: 1 })
    const fills = [first, last]
    const view = mount(FillsTable, { props: { fills, precision: 2 }, global: globalOptions() })
    const rows = view.findAll('[data-testid="fill-row"]')
    expect(rows[0]!.get('time').text()).toBe('13:15:16 UTC')
    expect(rows[0]!.get('time').attributes('datetime')).toBe('2026-01-02T13:15:16Z')
    expect(rows[1]!.get('time').text()).toBe('13:14:15 UTC')
    expect(rows[0]!.text()).toContain('Sell')
    expect(rows[1]!.text()).toContain('Buy')
    expect(rows[0]!.get('[data-testid="fill-qty"]').text()).toBe('1')
    expect(rows[0]!.get('[data-testid="fill-price"]').text()).toBe('101.25')
    expect(rows[0]!.get('[data-testid="fill-role"]').text()).toBe('Exit')
    expect(rows[0]!.get('[data-testid="fill-fee"]').text()).toBe('$1.24')
    expect(fills).toEqual([first, last])
  })

  it('places later appended fills first when timestamps share a replay bar', () => {
    const view = mount(FillsTable, {
      props: { fills: [fill(), fill({ id: 'second', price: 102 })], precision: 2 },
      global: globalOptions(),
    })
    expect(view.findAll('[data-testid="fill-price"]').map((row) => row.text())).toEqual(['102.00', '100.00'])
  })

  it('uses per-symbol precision without inventing decimals', () => {
    const view = mount(FillsTable, {
      props: {
        fills: [
          fill({ id: 'mes', symbol: 'MES', price: 100.126, time: 2 }),
          fill({ id: 'nq', symbol: 'NQ', price: 20000.5, time: 1 }),
        ],
        precision: 2,
        precisions: { MES: 2, NQ: 4 },
      },
      global: globalOptions(),
    })
    expect(view.findAll('[data-testid="fill-price"]').map((row) => row.text())).toEqual(['100.13', '20,000.5000'])
  })

  it('exports CSV on click with localized labels and formula-injection-safe cells', async () => {
    const capture = captureDownloads()
    const view = mount(FillsTable, {
      props: {
        fills: [
          fill({
            id: '=1+1',
            orderId: '+cmd',
            symbol: 'MES',
            side: 'short',
            price: 100.5,
            qty: 2,
            role: 'exit',
            fee: -2.5,
            cashDelta: -2.5,
            reason: 'stop',
          }),
        ],
        precision: 2,
      },
      global: globalOptions(),
    })
    await view.get('[data-testid="fills-export"]').trigger('click')
    expect(capture.clicks).toEqual([{ filename: 'terminal-fills.csv', href: 'blob:terminal-1' }])
    const csv = await capture.blobs[0]!.text()
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"\'=1+1"')
    expect(csv).toContain('"\'+cmd"')
    expect(csv).toContain(`,"${en.terminal.fills.time}"`)
    expect(csv).toContain(',-2.5,')
    expect(csv).toContain(`"${en.terminal.ledger.reasons.stop}"`)
  })

  it('reports a failed download instead of claiming success', async () => {
    vi.stubGlobal('URL', {})
    const view = mount(FillsTable, { props: { fills: [fill()], precision: 2 }, global: globalOptions() })
    await view.get('[data-testid="fills-export"]').trigger('click')
    expect(view.get('[role="alert"]').text()).toBe(translations.en.terminal.ledger.exportFailed)
  })
})

describe('terminal DOM ladder', () => {
  it('renders 21 ticks around the highlighted mark with no fabricated depth', () => {
    const view = mount(DomLadder, { props: { price: 100, precision: 2, tickSize: 0.25 }, global: globalOptions() })
    const rows = view.findAll('[data-testid="dom-row"]')
    expect(rows).toHaveLength(21)
    expect(rows[0]!.get('[data-testid="dom-price"]').text()).toContain('102.50')
    expect(rows[20]!.get('[data-testid="dom-price"]').text()).toContain('97.50')
    expect(rows[0]!.classes()).toContain('bg-bear-soft')
    expect(rows[20]!.classes()).toContain('bg-bull-soft')
    expect(view.findAll('[data-mark="true"]')).toHaveLength(1)
    expect(rows[10]!.attributes('data-mark')).toBe('true')
    expect(rows[10]!.classes()).toContain('bg-clay-soft')
    expect(rows[10]!.get('[data-testid="dom-price"]').attributes('aria-current')).toBe('true')
    expect(view.findAll('[data-testid="dom-depth"]').map((depth) => depth.text())).toEqual(Array(21).fill('—'))
    expect(view.get('[data-testid="dom-no-depth"]').text()).toBe(en.terminal.dom.noDepth)
    expect(view.text()).toContain(translations.en.terminal.dom.tradeHint)
  })

  it('respects custom counts, tick rounding, zero and changing marks', async () => {
    const view = mount(DomLadder, {
      props: { price: 0.3, precision: 2, tickSize: 0.1, rows: 5 },
      global: globalOptions(),
    })
    expect(view.findAll('[data-testid="dom-row"]')).toHaveLength(5)
    expect(view.get('[data-mark="true"]').text()).toContain('0.30')
    await view.get('[data-mark="true"] [data-testid="dom-price"]').trigger('click')
    expect(view.emitted('pick')).toEqual([[0.3]])
    await view.setProps({ price: 0, rows: 4 })
    expect(view.findAll('[data-testid="dom-row"]')).toHaveLength(4)
    expect(view.get('[data-mark="true"]').text()).toContain('0.00')
    await view.setProps({ price: -0.13, rows: 3 })
    expect(view.get('[data-mark="true"]').text()).toContain('-0.10')
  })

  it('uses accessible buttons and differentiates pick from shift-click rest', async () => {
    const view = mount(DomLadder, {
      props: { price: 100, precision: 2, tickSize: 0.25, rows: 3 },
      global: globalOptions(),
    })
    const button = view.get('[data-mark="true"] [data-testid="dom-price"]')
    expect(button.element.tagName).toBe('BUTTON')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-label')).toContain('Use 100.00 in the ticket')
    expect(button.attributes('aria-label')).toContain('Rest a limit at 100.00')
    await button.trigger('click')
    expect(view.emitted('pick')).toEqual([[100]])
    expect(view.emitted('rest')).toBeUndefined()
    await button.trigger('click', { shiftKey: true })
    expect(view.emitted('rest')).toEqual([[100]])
    expect(view.emitted('pick')).toEqual([[100]])
  })

  it('shows matching limit and stop chips and cancels without picking or resting', async () => {
    const view = mount(DomLadder, {
      props: {
        price: 100,
        precision: 2,
        tickSize: 0.25,
        rows: 3,
        workingOrders: [
          order({ filledQty: 1 }),
          order({ id: 'stop', type: 'stop', side: 'short', limitPrice: null, stopPrice: 99.75 }),
          order({ id: 'suspended', status: 'suspended', limitPrice: 100.25 }),
          order({ id: 'offscreen', limitPrice: 110 }),
          order({ id: 'finished', status: 'filled', filledQty: 4 }),
        ],
      },
      global: globalOptions(),
    })
    const rows = view.findAll('[data-testid="dom-row"]')
    expect(view.findAll('[data-testid="dom-order"]')).toHaveLength(3)
    expect(rows[1]!.get('[data-testid="dom-order"]').text()).toBe('Buy 3')
    expect(rows[2]!.get('[data-testid="dom-order"]').text()).toBe('Sell 4')
    expect(view.find('button button').exists()).toBe(false)
    const cancel = rows[2]!.get('[data-testid="dom-cancel"]')
    expect(cancel.attributes('aria-label')).toBe('Cancel order at 99.75')
    await cancel.trigger('click', { shiftKey: true })
    expect(view.emitted('cancel')).toEqual([['stop']])
    expect(view.emitted('pick')).toBeUndefined()
    expect(view.emitted('rest')).toBeUndefined()
  })

  it('places buy and sell limit orders from the side controls and stops from context or shift', async () => {
    const view = mount(DomLadder, {
      props: { price: 100, precision: 2, tickSize: 0.25, rows: 3 },
      global: globalOptions(),
    })
    const buy = view.findAll('[data-testid="dom-buy"]')[1]!
    const sell = view.findAll('[data-testid="dom-sell"]')[1]!
    expect(buy.attributes('type')).toBe('button')
    expect(buy.attributes('aria-label')).toContain('Buy limit at 100.00')
    expect(sell.attributes('aria-label')).toContain('Sell limit at 100.00')
    await buy.trigger('click')
    await sell.trigger('click')
    await buy.trigger('click', { shiftKey: true })
    await sell.trigger('contextmenu')
    await buy.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(view.emitted('place')).toEqual([
      ['long', 100, 'limit'],
      ['short', 100, 'limit'],
      ['long', 100, 'stop'],
      ['short', 100, 'stop'],
      ['long', 100, 'stop'],
    ])
    expect(view.emitted('pick')).toBeUndefined()
    expect(view.emitted('rest')).toBeUndefined()
  })

  it('groups own working quantity per side and price without fabricating depth', () => {
    const view = mount(DomLadder, {
      props: {
        price: 100,
        precision: 2,
        tickSize: 0.25,
        rows: 1,
        workingOrders: [
          order({ id: 'a', qty: 4, filledQty: 1 }),
          order({ id: 'b', qty: 2 }),
          order({ id: 'c', side: 'short', qty: 3 }),
        ],
      },
      global: globalOptions(),
    })
    const buy = view.get('[data-testid="dom-buy"]')
    const sell = view.get('[data-testid="dom-sell"]')
    expect(buy.get('[data-testid="dom-own-qty"]').text()).toBe(
      translations.en.terminal.dom.ownQty.replace('{qty}', '5'),
    )
    expect(sell.get('[data-testid="dom-own-qty"]').text()).toBe(
      translations.en.terminal.dom.ownQty.replace('{qty}', '3'),
    )
    expect(view.findAll('[data-testid="dom-order"]')).toHaveLength(3)
    expect(view.get('[data-testid="dom-depth"]').text()).toBe('—')
  })

  it.each([
    { price: null, tickSize: 0.25 },
    { price: Number.NaN, tickSize: 0.25 },
    { price: 100, tickSize: 0 },
    { price: 100, tickSize: -0.25 },
    { price: 100, tickSize: Number.NaN },
  ])('shows no invented price ladder for an unavailable mark or invalid tick: %j', (props) => {
    const view = mount(DomLadder, { props: { ...props, precision: 2 }, global: globalOptions() })
    expect(view.findAll('[data-testid="dom-row"]')).toHaveLength(0)
    expect(view.get('[data-testid="dom-empty"]').text()).toBe('—')
    expect(view.text()).toContain(en.terminal.dom.noDepth)
  })
})

describe('terminal table translations', () => {
  it.each([
    ['zh-CN', zh],
    ['ja', ja],
  ] as const)('uses the existing %s labels', (locale, messages) => {
    const orders = mount(OrdersTable, { props: { orders: [order()], precision: 2 }, global: globalOptions(locale) })
    const positions = mount(PositionsTable, {
      props: { positions: [], marks: {}, precision: 2, pointValues: {} },
      global: globalOptions(locale),
    })
    const fills = mount(FillsTable, { props: { fills: [], precision: 2 }, global: globalOptions(locale) })
    const dom = mount(DomLadder, { props: { price: 100, precision: 2, tickSize: 0.25 }, global: globalOptions(locale) })
    expect(orders.text()).toContain(translations[locale].terminal.orders.title)
    expect(orders.text()).toContain(messages.terminal.ticket.buy)
    expect(positions.text()).toContain(messages.terminal.positions.empty)
    expect(fills.text()).toContain(messages.terminal.fills.empty)
    expect(dom.text()).toContain(messages.terminal.dom.noDepth)
  })

  it.each([
    ['zh-CN', zh],
    ['ja', ja],
  ] as const)('localizes terminal statuses and sides in %s', (locale, messages) => {
    const orders = mount(OrdersTable, {
      props: {
        orders: [
          order({ id: 'cancelled', status: 'cancelled' }),
          order({ id: 'rejected', status: 'rejected' }),
          order({ id: 'expired', status: 'expired' }),
        ],
        precision: 2,
      },
      global: globalOptions(locale),
    })
    expect(orders.text()).toContain(translations[locale].terminal.orders.cancelled)
    expect(orders.text()).toContain(translations[locale].terminal.orders.rejected)
    expect(orders.text()).toContain(translations[locale].terminal.orders.expired)
    const positions = mount(PositionsTable, {
      props: {
        positions: [position({ side: 'short' })],
        marks: { MES: { price: 99, time: 1, bar: 1 } },
        precision: 2,
        pointValues: { MES: 5 },
      },
      global: globalOptions(locale),
    })
    expect(positions.text()).toContain(translations[locale].terminal.ledger.sides.short)
    expect(positions.text()).toContain(translations[locale].terminal.positions.reduce)
  })
})

describe('CSV export safety', () => {
  it('quotes text, neutralizes formula prefixes and leaves numbers numeric', () => {
    const csv = serializeCsv(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      [['=1+1', '+cmd', '-danger', '@SUM', '\tTab', '\rCR', 'safe', -12.5]],
    )
    expect(csv).toContain('"\'=1+1"')
    expect(csv).toContain('"\'+cmd"')
    expect(csv).toContain('"\'-danger"')
    expect(csv).toContain('"\'@SUM"')
    expect(csv).toContain('"\'\tTab"')
    expect(csv).toContain('"\'\rCR"')
    expect(csv).toContain(',-12.5')
    expect(csv.endsWith(',-12.5\r\n')).toBe(true)
  })
})
