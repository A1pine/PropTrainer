/**
 * Build the Rust compute core and copy the wasm artifact into public/.
 * The artifact is committed so the app runs without a Rust toolchain.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const crate = resolve(root, 'wasm')
const wasm = resolve(crate, 'target/wasm32-unknown-unknown/release/prop_core.wasm')
const target = resolve(root, 'public/wasm/prop_core.wasm')

execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], {
  cwd: crate,
  stdio: 'inherit',
})

mkdirSync(resolve(root, 'public/wasm'), { recursive: true })
copyFileSync(wasm, target)
const size = statSync(target).size
console.log(`prop_core.wasm copied (${(size / 1024).toFixed(1)} KiB) -> public/wasm/prop_core.wasm`)
