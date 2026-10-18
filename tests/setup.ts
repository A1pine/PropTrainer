import { readFileSync } from 'node:fs'
import { createWasmCoreFromInstance, setWasmCore } from '@/domain/wasm/core'

// Exercise the same Rust core the app uses in SSR and the browser.
const bytes = readFileSync(new URL('../public/wasm/prop_core.wasm', import.meta.url))
const { instance } = await WebAssembly.instantiate(bytes, {})
setWasmCore(createWasmCoreFromInstance(instance))
