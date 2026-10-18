import { createWebStore } from '~/lib/storage'
import type { GradeLetter } from '~/domain/drill/grade'
import type { Regime } from '~/domain/market/types'

export interface PkResult {
  score: number
  grade: GradeLetter
  rMultiple: number | null
  symbol: string
  sessionDate: string
  regime: Regime
  playedAt: string
}

export interface PkRoom {
  seed: string
  player1: string
  player2: string
  createdAt: string
  results: { 1: PkResult | null; 2: PkResult | null }
}

export const usePkStore = defineStore('pk', () => {
  const storage = createWebStore('propdesk.v1')
  const room = ref<PkRoom | null>(storage.read<PkRoom>('pk-room'))
  const hydrated = ref(false)

  function hydrate() {
    if (import.meta.server || hydrated.value) return
    room.value = storage.read<PkRoom>('pk-room')
    hydrated.value = true
  }

  function persist() {
    if (import.meta.client) storage.write('pk-room', room.value)
  }

  watch(room, persist, { deep: true })

  function createRoom(player1: string, player2: string, seed: string) {
    room.value = {
      seed,
      player1: player1.trim() || 'Player 1',
      player2: player2.trim() || 'Player 2',
      createdAt: new Date().toISOString(),
      results: { 1: null, 2: null },
    }
    persist()
  }

  function record(slot: 1 | 2, result: PkResult, seed?: string) {
    const current = room.value
    if (!current) return
    if (seed && current.seed !== seed) return
    // One committed attempt per player per room; rematch resets both slots.
    if (current.results[slot]) return
    room.value = { ...current, results: { ...current.results, [slot]: result } }
    persist()
  }

  function rematch(seed: string) {
    const current = room.value
    if (!current) return
    room.value = { ...current, seed, createdAt: new Date().toISOString(), results: { 1: null, 2: null } }
    persist()
  }

  function clear() {
    room.value = null
    if (import.meta.client) storage.remove('pk-room')
  }

  const winner = computed(() => {
    const current = room.value
    if (!current?.results[1] || !current?.results[2]) return null
    if (current.results[1].score === current.results[2].score) {
      const r1 = current.results[1].rMultiple ?? 0
      const r2 = current.results[2].rMultiple ?? 0
      if (r1 === r2) return 0
      return r1 > r2 ? 1 : 2
    }
    return current.results[1].score > current.results[2].score ? 1 : 2
  })

  return { room, winner, hydrated, hydrate, createRoom, record, rematch, clear }
})
