import type { InstrumentSpec } from '~/domain/instruments/types'
import type { SimEngineState } from '~/domain/sim/types'
import type { ReplayTape } from './tape'

export interface ReplayRun {
  schemaVersion: 1
  id: string
  seed: string
  createdAt: string
  instruments: InstrumentSpec[]
  tapes: ReplayTape[]
  startIndex: number
}

export interface ReplayCheckpoint {
  runId: string
  cursor: number
  engine: SimEngineState
}

export interface SavedReplay {
  run: ReplayRun
  checkpoint: ReplayCheckpoint
}

export interface ReplayRepository {
  load(): Promise<SavedReplay | null>
  create(run: ReplayRun, checkpoint: ReplayCheckpoint): Promise<void>
  save(checkpoint: ReplayCheckpoint): Promise<void>
}

const DB_NAME = 'propdesk-replay-v1'
const STORE = 'replay'

/** Pin tapes once per attempt; stepping writes only the accounting checkpoint. */
export function createReplayRepository(factory: IDBFactory = indexedDB): ReplayRepository {
  let pending: Promise<IDBDatabase> | null = null
  function database(): Promise<IDBDatabase> {
    if (pending) return pending
    pending = new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close()
          pending = null
        }
        resolve(request.result)
      }
      request.onerror = () => {
        pending = null
        reject(request.error ?? new Error('Replay storage unavailable'))
      }
      request.onblocked = () => {
        pending = null
        reject(new Error('Replay storage blocked by another tab'))
      }
    })
    return pending
  }

  async function write(callback: (store: IDBObjectStore) => void): Promise<void> {
    const db = await database()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('Replay checkpoint not saved'))
      transaction.onerror = () => reject(transaction.error ?? new Error('Replay checkpoint not saved'))
      try {
        callback(transaction.objectStore(STORE))
      } catch (error) {
        transaction.abort()
        reject(error)
      }
    })
  }

  return {
    async load() {
      const db = await database()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readonly')
        const store = transaction.objectStore(STORE)
        let result: SavedReplay | null = null
        const head = store.get('active')
        head.onsuccess = () => {
          if (head.result == null) return
          if (typeof head.result !== 'string') {
            transaction.abort()
            return
          }
          const run = store.get(`run:${head.result}`)
          const checkpoint = store.get(`checkpoint:${head.result}`)
          const collect = () => {
            if (run.readyState === 'done' && checkpoint.readyState === 'done') {
              if (!run.result || !checkpoint.result) transaction.abort()
              else result = { run: run.result, checkpoint: checkpoint.result }
            }
          }
          run.onsuccess = collect
          checkpoint.onsuccess = collect
        }
        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () => reject(transaction.error ?? new Error('Replay restore failed'))
        transaction.onabort = () => reject(transaction.error ?? new Error('Replay checkpoint is incomplete'))
      })
    },
    create: (run, checkpoint) =>
      write((store) => {
        store.add(run, `run:${run.id}`)
        store.add(checkpoint, `checkpoint:${run.id}`)
        store.put(run.id, 'active')
      }),
    save: (checkpoint) => write((store) => store.put(checkpoint, `checkpoint:${checkpoint.runId}`)),
  }
}

export function createMemoryReplayRepository(): ReplayRepository {
  let active: string | null = null
  const runs = new Map<string, ReplayRun>()
  const checkpoints = new Map<string, ReplayCheckpoint>()
  return {
    async load() {
      if (active === null) return null
      const run = runs.get(active)
      const checkpoint = checkpoints.get(active)
      if (!run || !checkpoint) throw new Error('Replay checkpoint is incomplete')
      return structuredClone({ run, checkpoint })
    },
    async create(run, checkpoint) {
      if (runs.has(run.id)) throw new Error('Replay attempt already exists')
      runs.set(run.id, structuredClone(run))
      checkpoints.set(run.id, structuredClone(checkpoint))
      active = run.id
    },
    async save(checkpoint) {
      if (!runs.has(checkpoint.runId)) throw new Error('Replay attempt not found')
      checkpoints.set(checkpoint.runId, structuredClone(checkpoint))
    },
  }
}
