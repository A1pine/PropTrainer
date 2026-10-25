import type { PropTemplate } from './types'

/**
 * Versioned, generic examples — not certified copies of any firm's contract.
 *
 * The numbers below are illustrative values in the range published by prop firms
 * in 2026. A template is data: the UI can add, edit or reset one without touching
 * the risk engine.
 */
export const PROP_TEMPLATES: readonly PropTemplate[] = [
  {
    id: 'eval-50k',
    label: '50K Evaluation',
    accountSize: 50_000,
    profitTarget: 3_000,
    drawdown: {
      mode: 'trailing-eod',
      amount: 2_000,
      basis: 'balance',
      floorCap: 50_000,
      includeUnrealized: true,
    },
    dailyLoss: { amount: 1_000, action: 'flatten-lock' },
    maxContracts: 50,
    maxTradesPerDay: 0,
    minTradingDays: 5,
    consistency: { maxBestDayRatio: 0.55, gate: 'pass' },
    source: 'Generic 50K evaluation example, retrieved 2026-10',
  },
  {
    id: 'eval-100k',
    label: '100K Evaluation',
    accountSize: 100_000,
    profitTarget: 6_000,
    drawdown: {
      mode: 'trailing-eod',
      amount: 3_000,
      basis: 'balance',
      floorCap: 100_000,
      includeUnrealized: true,
    },
    dailyLoss: { amount: 2_000, action: 'flatten-lock' },
    maxContracts: 100,
    maxTradesPerDay: 0,
    minTradingDays: 5,
    consistency: { maxBestDayRatio: 0.55, gate: 'pass' },
    source: 'Generic 100K evaluation example, retrieved 2026-10',
  },
  {
    id: 'eval-25k',
    label: '25K Evaluation',
    accountSize: 25_000,
    profitTarget: 1_500,
    drawdown: {
      mode: 'trailing-eod',
      amount: 1_500,
      basis: 'balance',
      floorCap: 25_000,
      includeUnrealized: true,
    },
    dailyLoss: { amount: 500, action: 'flatten-lock' },
    maxContracts: 25,
    maxTradesPerDay: 0,
    minTradingDays: 5,
    consistency: { maxBestDayRatio: 0.55, gate: 'pass' },
    source: 'Generic 25K evaluation example — Prop Desk simulator preset',
  },
  {
    id: 'funded-50k',
    label: '50K Funded',
    accountSize: 50_000,
    profitTarget: 0,
    drawdown: {
      mode: 'trailing-eod',
      amount: 2_000,
      basis: 'balance',
      floorCap: 50_000,
      includeUnrealized: true,
    },
    dailyLoss: { amount: 1_000, action: 'flatten-lock' },
    maxContracts: 50,
    maxTradesPerDay: 0,
    minTradingDays: 5,
    consistency: { maxBestDayRatio: 0.4, gate: 'payout' },
    source: 'Generic funded-account example, retrieved 2026-10',
  },
  {
    id: 'practice',
    label: 'Practice (no limits)',
    accountSize: 50_000,
    profitTarget: 0,
    drawdown: {
      mode: 'static',
      amount: 1_000_000,
      basis: 'equity',
      floorCap: null,
      includeUnrealized: true,
    },
    dailyLoss: { amount: 0, action: 'warn' },
    maxContracts: 1_000,
    maxTradesPerDay: 0,
    minTradingDays: 0,
    consistency: null,
    source: 'Prop Desk simulator preset',
  },
]

export const ACCOUNT_SIZES = [25_000, 50_000, 100_000] as const
export type AccountSize = (typeof ACCOUNT_SIZES)[number]

export function accountTemplate(size: AccountSize): PropTemplate {
  const template = templateById(`eval-${size / 1_000}k`)
  if (!template || !ACCOUNT_SIZES.includes(size)) throw new Error('Unsupported account size')
  return cloneTemplate(template)
}

export const DEFAULT_TEMPLATE_ID = 'eval-50k'

export function templateById(id: string): PropTemplate | undefined {
  return PROP_TEMPLATES.find((template) => template.id === id)
}

export function cloneTemplate(template: PropTemplate): PropTemplate {
  return {
    ...template,
    drawdown: { ...template.drawdown },
    dailyLoss: { ...template.dailyLoss },
    consistency: template.consistency ? { ...template.consistency } : null,
  }
}
