import { createWasmCoreFromInstance, getWasmCore, recordWasmError, setWasmCore, type WasmCore } from './core'
import { wasmArtifactVersion } from '~/wasm/artifact'

let pending: Promise<WasmCore | null> | null = null
let compiled: Promise<WebAssembly.Module> | null = null

export function wasmUrl(baseURL = '/'): string {
  const base = baseURL.replace(/\/$/, '')
  return `${base}/wasm/prop_core.wasm?v=${wasmArtifactVersion}`
}

async function compile(url: string): Promise<WebAssembly.Module> {
  if (!compiled) {
    compiled = (async () => {
      if (typeof WebAssembly.compileStreaming === 'function') {
        try {
          const response = await fetch(url, { cache: 'force-cache' })
          if (!response.ok) throw new Error(`wasm fetch failed: ${response.status}`)
          return await WebAssembly.compileStreaming(response)
        } catch (error) {
          // Streaming needs a correct MIME type and HTTP/2-friendly response;
          // fall through to a buffered compile rather than failing the app.
          recordWasmError(error)
        }
      }
      const response = await fetch(url, { cache: 'force-cache' })
      if (!response.ok) throw new Error(`wasm fetch failed: ${response.status}`)
      return WebAssembly.compile(await response.arrayBuffer())
    })().catch((error) => {
      compiled = null
      throw error
    })
  }
  return compiled
}

/**
 * Resolve the compute core, loading and instantiating it at most once.
 *
 * Callers that can wait (the analysis lab) await this. Everything else keeps
 * using the synchronous `getWasmCore()` and the TypeScript fallback, so wasm
 * never gates first paint or hydration.
 */
export function ensureWasmCore(baseURL = '/'): Promise<WasmCore | null> {
  const ready = getWasmCore()
  if (ready) return Promise.resolve(ready)
  if (import.meta.server) return Promise.resolve(null)
  if (pending) return pending

  pending = (async () => {
    try {
      const module = await compile(wasmUrl(baseURL))
      const instance = await WebAssembly.instantiate(module, {})
      const core = createWasmCoreFromInstance(instance)
      setWasmCore(core)
      return core
    } catch (error) {
      recordWasmError(error)
      return null
    } finally {
      pending = null
    }
  })()

  return pending
}

/** Warm the core without awaiting it; safe to call from idle callbacks. */
export function warmWasmCore(baseURL = '/'): void {
  if (getWasmCore() || pending || import.meta.server) return
  void ensureWasmCore(baseURL)
}
