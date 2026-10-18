import type { KeyValueStore } from '~/lib/storage'
import type { RoundRecord, SessionRecord, TradeRecord } from '~/domain/stats/types'

export interface HistorySnapshot {
  sessions: SessionRecord[]
  trades: TradeRecord[]
}

export interface HistoryRepository {
  read(): HistorySnapshot
  save(session: SessionRecord): HistorySnapshot
  clear(): void
  exportJson(): string
}

const KEY = 'history'
const MAX_SESSIONS = 80

function emptySnapshot(): HistorySnapshot {
  return { sessions: [], trades: [] }
}

export function createHistoryRepository(store: KeyValueStore): HistoryRepository {
  function read(): HistorySnapshot {
    const snapshot = store.read<HistorySnapshot>(KEY)
    if (!snapshot || !Array.isArray(snapshot.sessions)) return emptySnapshot()
    return snapshot
  }

  function save(session: SessionRecord): HistorySnapshot {
    const snapshot = read()
    const sessions = [session, ...snapshot.sessions.filter((item) => item.id !== session.id)].slice(0, MAX_SESSIONS)
    const trades = sessions.flatMap((item) => item.rounds.flatMap((round: RoundRecord) => round.trades))
    const next = { sessions, trades }
    store.write(KEY, next)
    return next
  }

  function clear() {
    store.remove(KEY)
  }

  function exportJson() {
    return JSON.stringify(read(), null, 2)
  }

  return { read, save, clear, exportJson }
}
