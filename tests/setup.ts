import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createWasmCoreFromInstance, setWasmCore } from '@/domain/wasm/core'

// Exercise the same Rust core the app uses in SSR and the browser. Resolve from
// the project root so the setup also works under non-file DOM environments.
const bytes = readFileSync(resolve(process.cwd(), 'public/wasm/prop_core.wasm'))
const { instance } = await WebAssembly.instantiate(bytes, {})
setWasmCore(createWasmCoreFromInstance(instance))
