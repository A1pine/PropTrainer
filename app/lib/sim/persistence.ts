import type { InstrumentSpec } from '~/domain/instruments/types'
import type { SimEngineState } from '~/domain/sim/types'
import {
  accountName,
  accountSummary,
  createAccountMetadata,
  isReplayAccountMetadata,
  type ReplayAccount,
  type ReplayAccountMetadata,
  type ReplayCatalog,
} from './accounts'
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
  load(id?: string): Promise<SavedReplay | null>
  create(run: ReplayRun, checkpoint: ReplayCheckpoint, name?: string): Promise<void>
  save(checkpoint: ReplayCheckpoint): Promise<void>
  catalog(): Promise<ReplayCatalog>
  activate(id: string): Promise<void>
  rename(id: string, name: string): Promise<void>
  remove(id: string): Promise<void>
}

const DB_NAME = 'propdesk-replay-v1'
const STORE = 'replay'
const ACTIVE = 'active'
const INITIALIZED = 'catalog:initialized'
const MIGRATED = 'catalog:migrated'
const runKey = (id: string) => `run:${id}`
const checkpointKey = (id: string) => `checkpoint:${id}`
const metadataKey = (id: string) => `meta:${id}`

function requireMetadata(value: unknown, id?: string): ReplayAccountMetadata {
  if (!isReplayAccountMetadata(value) || (id !== undefined && value.id !== id)) {
    throw new Error('Replay account metadata is corrupt')
  }
  return value
}

function catalogResult(records: ReplayAccountMetadata[], initialized: boolean): ReplayCatalog {
  const accounts: ReplayAccount[] = records.map((record) => ({
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    accountSize: record.accountSize,
    balance: record.balance,
    equity: record.equity,
    status: record.status,
    breach: record.breach,
    cursor: record.cursor,
  }))
  accounts.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return structuredClone({ accounts, initialized })
}

interface ReplayTransaction<T> {
  store: IDBObjectStore
  collect<V>(requests: IDBRequest<V>[], callback: (values: V[]) => void): void
  result(value: T): void
}

/** Pin tapes once per attempt; stepping writes only the checkpoint and its small catalog summary. */
export function createReplayRepository(factory: IDBFactory = indexedDB): ReplayRepository {
  let pending: Promise<IDBDatabase> | null = null
  let migration: Promise<void> | null = null

  function database(): Promise<IDBDatabase> {
    if (pending) return pending
    pending = new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close()
          pending = null
          migration = null
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

  async function transact<T>(
    mode: IDBTransactionMode,
    fallback: string,
    body: (context: ReplayTransaction<T>) => void,
  ): Promise<T> {
    const db = await database()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      let result!: T
      let failure: unknown
      const guard = (callback: () => void) => {
        if (failure !== undefined) return
        try {
          callback()
        } catch (error) {
          failure = error
          transaction.abort()
        }
      }
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error(fallback))
      guard(() =>
        body({
          store: transaction.objectStore(STORE),
          result: (value) => (result = value),
          collect: (requests, callback) => {
            let remaining = requests.length
            for (const request of requests) {
              request.onsuccess = () =>
                guard(() => {
                  remaining -= 1
                  if (remaining === 0) callback(requests.map((item) => item.result))
                })
            }
          },
        }),
      )
    })
  }

  function ensureMigrated(): Promise<void> {
    if (migration) return migration
    migration = transact<void>('readwrite', 'Replay catalog migration failed', ({ store, collect }) => {
      collect([store.get(MIGRATED), store.get(INITIALIZED), store.get(ACTIVE)], ([marker, initialized, active]) => {
        if (
          (marker !== undefined && marker !== true) ||
          (initialized !== undefined && typeof initialized !== 'boolean') ||
          (marker === true && initialized === undefined)
        ) {
          throw new Error('Replay catalog metadata is corrupt')
        }
        if (marker === true) return
        collect([store.getAllKeys()], ([keys]) => {
          const existing = new Set(keys)
          const ids = new Set<string>()
          for (const key of keys!) {
            if (typeof key !== 'string') continue
            const match = /^(?:run|checkpoint|meta):(.*)$/.exec(key)
            if (match) ids.add(match[1]!)
          }
          for (const id of ids) {
            if (!id || !existing.has(runKey(id)) || !existing.has(checkpointKey(id))) {
              throw new Error('Replay checkpoint is incomplete')
            }
          }
          if (active != null && (typeof active !== 'string' || !ids.has(active))) {
            throw new Error('Replay checkpoint is incomplete')
          }

          // Keep at most one legacy tape/checkpoint pair in memory. No run or
          // ledger values are read on subsequent catalog calls or hot saves.
          const remaining = ids.values()
          const next = () => {
            const entry = remaining.next()
            if (entry.done) {
              store.put(initialized === true || ids.size > 0, INITIALIZED)
              store.put(true, MIGRATED)
              return
            }
            const id = entry.value
            collect(
              [store.get(metadataKey(id)), store.get(runKey(id)), store.get(checkpointKey(id))],
              ([metadata, run, checkpoint]) => {
                if (!run || !checkpoint) throw new Error('Replay checkpoint is incomplete')
                const record = createAccountMetadata(run as ReplayRun, checkpoint as ReplayCheckpoint)
                requireMetadata(record, id)
                if (metadata === undefined) store.add(record, metadataKey(id))
                else requireMetadata(metadata, id)
                next()
              },
            )
          }
          next()
        })
      })
    }).catch((error) => {
      migration = null
      throw error
    })
    return migration
  }

  return {
    async load(id) {
      await ensureMigrated()
      return transact<SavedReplay | null>('readonly', 'Replay restore failed', ({ store, collect, result }) => {
        const pair = (target: string, explicit: boolean) => {
          collect([store.get(runKey(target)), store.get(checkpointKey(target))], ([run, checkpoint]) => {
            if (explicit && run === undefined && checkpoint === undefined) {
              result(null)
              return
            }
            if (!run || !checkpoint) throw new Error('Replay checkpoint is incomplete')
            result({ run: run as ReplayRun, checkpoint: checkpoint as ReplayCheckpoint })
          })
        }
        if (id !== undefined) pair(id, true)
        else {
          collect([store.get(ACTIVE)], ([active]) => {
            if (active == null) result(null)
            else if (typeof active === 'string') pair(active, false)
            else throw new Error('Replay checkpoint is incomplete')
          })
        }
      })
    },

    async create(run, checkpoint, name) {
      const pinned = structuredClone({ run, checkpoint })
      const metadata = createAccountMetadata(pinned.run, pinned.checkpoint, name, new Date().toISOString())
      await ensureMigrated()
      await transact<void>('readwrite', 'Replay attempt not saved', ({ store, collect }) => {
        const keys = [runKey(pinned.run.id), checkpointKey(pinned.run.id), metadataKey(pinned.run.id)]
        collect(
          keys.map((key) => store.getKey(key)),
          (found) => {
            if (found.some((key) => key !== undefined)) throw new Error('Replay attempt already exists')
            store.add(pinned.run, keys[0]!)
            store.add(pinned.checkpoint, keys[1]!)
            store.add(metadata, keys[2]!)
            store.put(true, INITIALIZED)
            store.put(pinned.run.id, ACTIVE)
          },
        )
      })
    },

    async save(checkpoint) {
      const pinned = structuredClone(checkpoint)
      const summary = accountSummary(pinned)
      const updatedAt = new Date().toISOString()
      await ensureMigrated()
      await transact<void>('readwrite', 'Replay checkpoint not saved', ({ store, collect }) => {
        collect([store.getKey(runKey(pinned.runId)), store.get(metadataKey(pinned.runId))], ([key, value]) => {
          if (key === undefined) throw new Error('Replay attempt not found')
          const metadata = requireMetadata(value, pinned.runId)
          store.put(pinned, checkpointKey(pinned.runId))
          store.put({ ...metadata, ...summary, updatedAt }, metadataKey(pinned.runId))
        })
      })
    },

    async catalog() {
      await ensureMigrated()
      return transact<ReplayCatalog>('readonly', 'Replay catalog unavailable', ({ store, collect, result }) => {
        const range = IDBKeyRange.bound('meta:', 'meta;', false, true)
        collect([store.get(INITIALIZED), store.getAll(range)], ([initialized, records]) => {
          if (typeof initialized !== 'boolean') throw new Error('Replay catalog metadata is corrupt')
          result(
            catalogResult(
              (records as unknown[]).map((value) => requireMetadata(value)),
              initialized,
            ),
          )
        })
      })
    },

    async activate(id) {
      await ensureMigrated()
      await transact<void>('readwrite', 'Replay account not selected', ({ store, collect }) => {
        collect([store.getKey(runKey(id)), store.getKey(checkpointKey(id))], ([run, checkpoint]) => {
          if (run === undefined) throw new Error('Replay account not found')
          if (checkpoint === undefined) throw new Error('Replay checkpoint is incomplete')
          store.put(id, ACTIVE)
        })
      })
    },

    async rename(id, name) {
      const nextName = accountName(name)
      const updatedAt = new Date().toISOString()
      await ensureMigrated()
      await transact<void>('readwrite', 'Replay account not renamed', ({ store, collect }) => {
        collect([store.getKey(runKey(id)), store.get(metadataKey(id))], ([key, value]) => {
          if (key === undefined) throw new Error('Replay account not found')
          store.put({ ...requireMetadata(value, id), name: nextName, updatedAt }, metadataKey(id))
        })
      })
    },

    async remove(id) {
      await ensureMigrated()
      await transact<void>('readwrite', 'Replay account not removed', ({ store, collect }) => {
        collect([store.getKey(runKey(id)), store.get(ACTIVE)], ([key, active]) => {
          if (key === undefined) throw new Error('Replay account not found')
          store.delete(runKey(id))
          store.delete(checkpointKey(id))
          store.delete(metadataKey(id))
          if (active === id) store.delete(ACTIVE)
        })
      })
    },
  }
}

export function createMemoryReplayRepository(): ReplayRepository {
  let active: string | null = null
  let initialized = false
  const runs = new Map<string, ReplayRun>()
  const checkpoints = new Map<string, ReplayCheckpoint>()
  const metadata = new Map<string, ReplayAccountMetadata>()

  return {
    async load(id) {
      const target = id ?? active
      if (target === null) return null
      const run = runs.get(target)
      const checkpoint = checkpoints.get(target)
      if (id !== undefined && !run && !checkpoint) return null
      if (!run || !checkpoint) throw new Error('Replay checkpoint is incomplete')
      return structuredClone({ run, checkpoint })
    },

    async create(run, checkpoint, name) {
      const pinned = structuredClone({ run, checkpoint })
      const record = createAccountMetadata(pinned.run, pinned.checkpoint, name, new Date().toISOString())
      const id = pinned.run.id
      if (runs.has(id) || checkpoints.has(id) || metadata.has(id)) throw new Error('Replay attempt already exists')
      runs.set(id, pinned.run)
      checkpoints.set(id, pinned.checkpoint)
      metadata.set(id, record)
      active = id
      initialized = true
    },

    async save(checkpoint) {
      const pinned = structuredClone(checkpoint)
      const summary = accountSummary(pinned)
      if (!runs.has(pinned.runId)) throw new Error('Replay attempt not found')
      const record = requireMetadata(metadata.get(pinned.runId), pinned.runId)
      const updated = { ...record, ...summary, updatedAt: new Date().toISOString() }
      checkpoints.set(pinned.runId, pinned)
      metadata.set(pinned.runId, updated)
    },

    async catalog() {
      return catalogResult([...metadata.values()], initialized)
    },

    async activate(id) {
      if (!runs.has(id)) throw new Error('Replay account not found')
      if (!checkpoints.has(id)) throw new Error('Replay checkpoint is incomplete')
      active = id
    },

    async rename(id, name) {
      const nextName = accountName(name)
      if (!runs.has(id)) throw new Error('Replay account not found')
      const record = requireMetadata(metadata.get(id), id)
      metadata.set(id, { ...record, name: nextName, updatedAt: new Date().toISOString() })
    },

    async remove(id) {
      if (!runs.has(id)) throw new Error('Replay account not found')
      runs.delete(id)
      checkpoints.delete(id)
      metadata.delete(id)
      if (active === id) active = null
    },
  }
}
