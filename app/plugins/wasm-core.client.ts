/**
 * Load the Rust compute core before hydration so the first scenario a client
 * generates matches the server exactly.
 */
import { createWasmCoreFromInstance, recordWasmError, setWasmCore } from '~/domain/wasm/core'

export default defineNuxtPlugin({
  name: 'wasm-core',
  enforce: 'pre',
  async setup() {
    const status = useState<'rust' | 'typescript'>('compute-core', () => 'typescript')
    try {
      const base = useRuntimeConfig().app.baseURL || '/'
      const url = `${base.replace(/\/$/, '')}/wasm/prop_core.wasm`
      const response = await fetch(url, { cache: 'force-cache' })
      if (!response.ok) throw new Error(`wasm fetch failed: ${response.status}`)
      const bytes = await response.arrayBuffer()
      const { instance } = await WebAssembly.instantiate(bytes, {})
      setWasmCore(createWasmCoreFromInstance(instance))
      status.value = 'rust'
    } catch (error) {
      recordWasmError(error)
      status.value = 'typescript'
    }
  },
})
