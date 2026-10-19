/** Reactive status of the Rust/WebAssembly compute core. */
export function useComputeCoreStatus() {
  return useState<'rust' | 'typescript' | 'loading'>('compute-core', () => 'loading')
}
