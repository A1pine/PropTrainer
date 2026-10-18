/** Reactive status of the Rust/WebAssembly compute core. */
export function useComputeCoreStatus() {
  return useState<'rust' | 'typescript'>('compute-core', () => 'typescript')
}
