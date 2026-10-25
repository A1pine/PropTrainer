import type { SimOrder } from './types'

type Scalar = string | number | boolean | null | undefined

// Ledger rows contain only scalar fields. Keep fresh, caller-owned rows without
// the serialization overhead of structuredClone; nested fields fail this bound.
export function copyRows<T extends { [K in keyof T]: Scalar }>(rows: readonly T[]): T[] {
  return rows.map((row) => ({ ...row }))
}

type ScalarFields<T extends { [K in keyof T]: Scalar }> = T
type CopyableOrder = ScalarFields<Omit<SimOrder, 'bracket'>> & Pick<SimOrder, 'bracket'>

export function copyOrders(orders: Iterable<CopyableOrder>): SimOrder[] {
  return Array.from(orders, (order) => ({
    ...order,
    bracket: order.bracket === null ? null : structuredClone(order.bracket),
  }))
}
