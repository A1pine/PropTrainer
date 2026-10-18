import { createWebStore } from '~/lib/storage'
import { createHistoryRepository } from '~/lib/repositories/history'
import { aggregateTrades } from '~/domain/stats/aggregate'
import type { SessionRecord } from '~/domain/stats/types'

export const useHistoryStore = defineStore('history', () => {
  const repository = createHistoryRepository(createWebStore('propdesk.v1'))
  const snapshot = ref<ReturnType<typeof repository.read>>({ sessions: [], trades: [] })
  const hydrated = ref(false)

  const trades = computed(() => snapshot.value.trades)
  const sessions = computed(() => snapshot.value.sessions)
  const stats = computed(() => aggregateTrades(snapshot.value.trades))

  function hydrate() {
    if (import.meta.server || hydrated.value) return
    snapshot.value = repository.read()
    hydrated.value = true
  }

  function saveSession(session: SessionRecord) {
    snapshot.value = repository.save(session)
    hydrated.value = true
  }

  function clear() {
    repository.clear()
    snapshot.value = { sessions: [], trades: [] }
  }

  function exportJson() {
    return repository.exportJson()
  }

  return { sessions, trades, stats, hydrated, hydrate, saveSession, clear, exportJson }
})
