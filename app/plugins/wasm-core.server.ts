/**
 * Load the Rust compute core on the server before rendering.
 * The artifact is read from public/ so the same bytes are served to clients.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createWasmCoreFromInstance, recordWasmError, setWasmCore } from '~/domain/wasm/core'

let serverModule: Promise<WebAssembly.Module | null> | null = null

async function loadModule(): Promise<WebAssembly.Module | null> {
  if (!serverModule) {
    serverModule = (async () => {
      const candidates = [
        join(process.cwd(), 'public/wasm/prop_core.wasm'),
        join(process.cwd(), '.output/public/wasm/prop_core.wasm'),
        join(process.cwd(), '../public/wasm/prop_core.wasm'),
      ]
      const path = candidates.find((candidate) => existsSync(candidate))
      if (!path) throw new Error('wasm artifact not found; run bun run wasm:build')
      return WebAssembly.compile(await readFile(path))
    })().catch((error) => {
      serverModule = null
      throw error
    })
  }
  return serverModule
}

export default defineNuxtPlugin({
  name: 'wasm-core',
  enforce: 'pre',
  async setup() {
    const status = useState<'rust' | 'typescript' | 'loading'>('compute-core', () => 'loading')
    try {
      const module = await loadModule()
      if (!module) throw new Error('wasm module unavailable')
      const instance = await WebAssembly.instantiate(module, {})
      setWasmCore(createWasmCoreFromInstance(instance))
      status.value = 'rust'
    } catch (error) {
      recordWasmError(error)
      status.value = 'typescript'
    }
  },
})
