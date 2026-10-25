import type { SimAccountStatus, SimBreach } from '~/domain/sim/types'
import type { ReplayCheckpoint, ReplayRun } from './persistence'

export interface ReplayAccount {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  accountSize: number
  balance: number
  equity: number
  status: SimAccountStatus
  breach: SimBreach | null
  cursor: number
}

export interface ReplayCatalog {
  accounts: ReplayAccount[]
  initialized: boolean
}

export interface ReplayAccountMetadata extends ReplayAccount {
  schemaVersion: 1
}

export type ReplayAccountSummary = Pick<
  ReplayAccount,
  'accountSize' | 'balance' | 'equity' | 'status' | 'breach' | 'cursor'
>

const STATUSES: readonly string[] = ['active', 'daily-lock', 'breached', 'target']

export function accountName(name: string): string {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60) {
    throw new Error('Replay account name must be 1-60 characters')
  }
  return name.trim()
}

export function accountSizeLabel(size: number): string {
  return size > 0 && size % 1_000 === 0 ? `${size / 1_000}K` : String(size)
}

export function defaultAccountName(id: string, accountSize: number): string {
  return `${accountSizeLabel(accountSize)} · ${id.slice(0, 8)}`
}

function validSummary(value: Record<string, unknown>): boolean {
  const breach = value.breach as Record<string, unknown> | null
  return (
    [value.accountSize, value.balance, value.equity, value.cursor].every(
      (number) => typeof number === 'number' && Number.isFinite(number),
    ) &&
    typeof value.status === 'string' &&
    STATUSES.includes(value.status) &&
    (breach === null ||
      (typeof breach === 'object' &&
        typeof breach?.rule === 'string' &&
        typeof breach.message === 'string' &&
        [breach.bar, breach.time, breach.equity, breach.floor].every(
          (number) => typeof number === 'number' && Number.isFinite(number),
        )))
  )
}

export function assertReplayIdentity(run: ReplayRun, checkpoint: ReplayCheckpoint): void {
  if (run.id !== checkpoint.runId) throw new Error('Replay checkpoint does not match run')
}

/** Only project pinned accounting fields; ReplaySession.restore validates the simulation. */
export function accountSummary(checkpoint: ReplayCheckpoint): ReplayAccountSummary {
  const risk = checkpoint?.engine?.risk
  if (!risk) throw new Error('Replay account summary is corrupt')
  const summary = {
    accountSize: risk.startBalance,
    balance: checkpoint.engine.balance,
    equity: risk.lastEquity,
    status: risk.status,
    breach: risk.breach,
    cursor: checkpoint.cursor,
  }
  if (!validSummary(summary)) throw new Error('Replay account summary is corrupt')
  return { ...summary, breach: structuredClone(summary.breach) }
}

export function createAccountMetadata(
  run: ReplayRun,
  checkpoint: ReplayCheckpoint,
  name?: string,
  updatedAt = run.createdAt,
): ReplayAccountMetadata {
  assertReplayIdentity(run, checkpoint)
  const summary = accountSummary(checkpoint)
  const metadata: ReplayAccountMetadata = {
    schemaVersion: 1,
    id: run.id,
    name: accountName(name === undefined ? defaultAccountName(run.id, summary.accountSize) : name),
    createdAt: run.createdAt,
    updatedAt,
    ...summary,
  }
  if (!isReplayAccountMetadata(metadata)) throw new Error('Replay account metadata is corrupt')
  return metadata
}

export function isReplayAccountMetadata(value: unknown): value is ReplayAccountMetadata {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === 1 &&
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.name === 'string' &&
    record.name === record.name.trim() &&
    record.name.length > 0 &&
    record.name.length <= 60 &&
    typeof record.createdAt === 'string' &&
    Number.isFinite(Date.parse(record.createdAt)) &&
    typeof record.updatedAt === 'string' &&
    Number.isFinite(Date.parse(record.updatedAt)) &&
    validSummary(record)
  )
}
