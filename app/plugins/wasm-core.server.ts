/**
 * Load the Rust compute core before rendering on the server.
 * The artifact is read from public/ so the same bytes are served to clients.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createWasmCoreFromInstance, recordWasmError, setWasmCore } from '~/domain/wasm/core'

export default defineNuxtPlugin({
  name: 'wasm-core',
  enforce: 'pre',
  async setup() {
    const status = useState<'rust' | 'typescript'>('compute-core', () => 'typescript')
    try {
      const candidates = [
        join(process.cwd(), 'public/wasm/prop_core.wasm'),
        join(process.cwd(), '.output/public/wasm/prop_core.wasm'),
        join(process.cwd(), '../public/wasm/prop_core.wasm'),
      ]
      const path = candidates.find((candidate) => existsSync(candidate))
      if (!path) throw new Error('wasm artifact not found; run bun run wasm:build')
      const bytes = await readFile(path)
      const { instance } = await WebAssembly.instantiate(bytes, {})
      setWasmCore(createWasmCoreFromInstance(instance))
      status.value = 'rust'
    } catch (error) {
      recordWasmError(error)
      status.value = 'typescript'
    }
  },
})
