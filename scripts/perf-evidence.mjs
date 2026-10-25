import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function manifest(root, files) {
  const entries = [...new Set(files)].sort().map((file) => {
    const path = resolve(root, file)
    const symlink = lstatSync(path).isSymbolicLink()
    const bytes = symlink ? Buffer.from(readlinkSync(path)) : readFileSync(path)
    return { file, kind: symlink ? 'symlink' : 'file', bytes: bytes.length, sha256: sha256(bytes) }
  })
  return { sha256: sha256(JSON.stringify(entries)), files: entries }
}

function walk(root, directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(root, path) : [relative(root, path)]
  })
}

/** Capture outside timed work; PERF_APP_ROOT identifies the server's checkout. */
export function captureEvidence(root, harness, production = false) {
  const appRoot = resolve(process.env.PERF_APP_ROOT ?? root)
  const sourceFiles = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'app',
      'i18n',
      'public/wasm',
      'nuxt.config.ts',
      'package.json',
      'bun.lock',
    ],
    { cwd: appRoot, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
  const source = manifest(appRoot, sourceFiles)
  const buildRoot = join(appRoot, '.output')
  if (production) assert.ok(existsSync(buildRoot), `No production build at ${buildRoot}`)
  return {
    appRoot,
    appCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim(),
    source,
    harness: manifest(root, [harness, 'scripts/perf-evidence.mjs']),
    build: production ? manifest(buildRoot, walk(buildRoot, buildRoot)) : null,
    note: 'File-content hashes captured before and after the run, outside all timed regions. Source-to-build correspondence requires building this checkout before measurement; hashes do not infer it.',
  }
}

export function verifyEvidence(before, after) {
  assert.equal(after.source.sha256, before.source.sha256, 'App source changed during measurement')
  assert.equal(after.harness.sha256, before.harness.sha256, 'Benchmark harness changed during measurement')
  assert.equal(after.build?.sha256, before.build?.sha256, 'Production build changed during measurement')
  return true
}
