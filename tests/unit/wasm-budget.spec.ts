import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { wasmArtifactVersion } from '@/wasm/artifact'
import { createWasmCoreFromInstance } from '@/domain/wasm/core'

const root = resolve(process.cwd())
const artifact = readFileSync(resolve(root, 'public/wasm/prop_core.wasm'))
const generated = readFileSync(resolve(root, 'app/wasm/artifact.ts'), 'utf8')

const KIB = 1024
/** Transfer budgets. Raise deliberately, never silently. */
const BUDGET = {
  rawKib: 160,
  brotliKib: 60,
  gzipKib: 70,
}

describe('wasm artifact budget', () => {
  const brotli = brotliCompressSync(artifact, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: artifact.length },
  })
  const gzip = gzipSync(artifact, { level: 9 })

  it('stays inside the raw size budget', () => {
    expect(artifact.length / KIB).toBeLessThanOrEqual(BUDGET.rawKib)
  })

  it('stays inside the brotli transfer budget', () => {
    expect(brotli.length / KIB).toBeLessThanOrEqual(BUDGET.brotliKib)
  })

  it('stays inside the gzip transfer budget', () => {
    expect(gzip.length / KIB).toBeLessThanOrEqual(BUDGET.gzipKib)
  })

  it('compresses at least 2× with brotli', () => {
    expect(artifact.length / brotli.length).toBeGreaterThanOrEqual(2)
  })

  it('is a valid module with every export the app calls', async () => {
    const { instance } = await WebAssembly.instantiate(artifact, {})
    const core = createWasmCoreFromInstance(instance)
    expect(typeof core.generate).toBe('function')
    expect(typeof core.findSwings).toBe('function')
    expect(typeof core.simulatePlan).toBe('function')
    expect(typeof core.analyze).toBe('function')
  })

  it('keeps the committed version hash in sync with the artifact', () => {
    // The hash is a cache-busting key, so a stale value would serve an old
    // module after a rebuild. It is a short content hash, not the full digest.
    expect(generated).toContain(`wasmArtifactVersion = '${wasmArtifactVersion}'`)
    expect(wasmArtifactVersion).toMatch(/^[0-9a-f]{16}$/)
    expect(generated).not.toMatch(/wasmArtifactVersion = ''/)
  })
})
