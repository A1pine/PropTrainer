import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '@/lib/storage'
import { createHistoryRepository } from '@/lib/repositories/history'
import type { RoundRecord, SessionRecord, TradeRecord } from '@/domain/stats/types'

const trade: TradeRecord = {
  id: 't1',
  sessionId: 's1',
  roundIndex: 1,
  mode: 'trainer',
  symbol: 'MNQ',
  side: 'long',
  qty: 1,
  entryPrice: 100,
  exitPrice: 102,
  entryBar: 1,
  exitBar: 3,
  entryTime: 1_700_000_000,
  exitTime: 1_700_000_600,
  pnl: 24,
  fees: 1.24,
  rMultiple: 1.2,
  mae: 8,
  mfe: 40,
  exitReason: 'target',
  regime: 'uptrend',
  followedPlan: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const round: RoundRecord = {
  id: 's1-r1',
  sessionId: 's1',
  index: 1,
  mode: 'trainer',
  symbol: 'MNQ',
  sessionDate: '2026-01-02T13:30:00.000Z',
  regime: 'uptrend',
  timeframeMinutes: 5,
  startBalance: 50_000,
  endBalance: 50_024,
  netPnl: 24,
  fees: 1.24,
  rMultiple: 1.2,
  trades: [trade],
  grade: 'B',
  processScore: 78,
  status: 'ended',
  startedAt: '2026-01-02T13:30:00.000Z',
  endedAt: '2026-01-02T14:00:00.000Z',
  reveal: true,
}

const session: SessionRecord = {
  id: 's1',
  mode: 'trainer',
  startedAt: '2026-01-02T13:30:00.000Z',
  endedAt: '2026-01-02T14:00:00.000Z',
  rounds: [round],
  startBalance: 50_000,
  endBalance: 50_024,
  netPnl: 24,
  fees: 1.24,
  ruleStatus: 'ended',
  targetRounds: 1,
  completed: true,
}

describe('history repository', () => {
  it('persists sessions and flattens trades', () => {
    const repo = createHistoryRepository(createMemoryStore())
    expect(repo.read()).toEqual({ sessions: [], trades: [] })
    const snapshot = repo.save(session)
    expect(snapshot.sessions).toHaveLength(1)
    expect(snapshot.trades).toHaveLength(1)
    expect(snapshot.trades[0]?.pnl).toBe(24)
  })

  it('replaces a session with the same id instead of duplicating it', () => {
    const repo = createHistoryRepository(createMemoryStore())
    repo.save(session)
    const updated = { ...session, netPnl: 99, rounds: [{ ...round, netPnl: 99 }] }
    const snapshot = repo.save(updated)
    expect(snapshot.sessions).toHaveLength(1)
    expect(snapshot.sessions[0]?.netPnl).toBe(99)
  })

  it('exports readable JSON and clears the namespace', () => {
    const repo = createHistoryRepository(createMemoryStore())
    repo.save(session)
    const parsed = JSON.parse(repo.exportJson()) as { sessions: unknown[] }
    expect(parsed.sessions).toHaveLength(1)
    repo.clear()
    expect(repo.read().sessions).toHaveLength(0)
  })

  it('survives malformed storage payloads', () => {
    const store = createMemoryStore()
    store.write('history', { nope: true })
    const repo = createHistoryRepository(store)
    expect(repo.read()).toEqual({ sessions: [], trades: [] })
  })
})
