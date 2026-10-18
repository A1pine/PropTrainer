/**
 * Key-value persistence contract.
 *
 * Repositories depend on this interface, not on `localStorage`, so the same
 * domain and store logic can run in tests, on the server, or in a future
 * backend-backed implementation.
 */
export interface KeyValueStore {
  read<T>(key: string): T | null
  write<T>(key: string, value: T): void
  remove(key: string): void
  clear(): void
}

const memory = new Map<string, string>()

/** In-memory store for SSR and unit tests. */
export function createMemoryStore(): KeyValueStore {
  return {
    read<T>(key: string): T | null {
      const raw = memory.get(key)
      if (raw == null) return null
      try {
        return JSON.parse(raw) as T
      } catch {
        return null
      }
    },
    write<T>(key: string, value: T) {
      memory.set(key, JSON.stringify(value))
    },
    remove(key: string) {
      memory.delete(key)
    },
    clear() {
      memory.clear()
    },
  }
}

/**
 * Factory for namespaced JSON repositories over Web Storage.
 * Falls back to an in-memory map when storage is unavailable (SSR, private mode).
 */
export function createWebStore(namespace: string, storage?: Storage): KeyValueStore {
  const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
  const prefix = `${namespace}:`

  if (!target) {
    const local = createMemoryStore()
    return {
      read: (key) => local.read(`${prefix}${key}`),
      write: (key, value) => local.write(`${prefix}${key}`, value),
      remove: (key) => local.remove(`${prefix}${key}`),
      clear: () => local.clear(),
    }
  }

  return {
    read<T>(key: string): T | null {
      try {
        const raw = target.getItem(`${prefix}${key}`)
        return raw == null ? null : (JSON.parse(raw) as T)
      } catch {
        return null
      }
    },
    write<T>(key: string, value: T) {
      try {
        target.setItem(`${prefix}${key}`, JSON.stringify(value))
      } catch {
        // Quota or privacy mode: training must keep working without persistence.
      }
    },
    remove(key: string) {
      try {
        target.removeItem(`${prefix}${key}`)
      } catch {
        // ignore
      }
    },
    clear() {
      try {
        const keys = Array.from({ length: target.length }, (_, index) => target.key(index)).filter(
          (key): key is string => key != null && key.startsWith(prefix),
        )
        keys.forEach((key) => target.removeItem(key))
      } catch {
        // ignore
      }
    },
  }
}
