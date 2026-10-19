/**
 * Client loader for the Rust compute core.
 *
 * Deliberately non-blocking: the plugin starts the fetch but never awaits it,
 * so hydration and first paint do not depend on the wasm download. Consumers
 * that need the core (the analysis lab) call `ensureWasmCore()` themselves.
 */
import { ensureWasmCore } from '~/domain/wasm/loader'

export default defineNuxtPlugin({
  name: 'wasm-core',
  enforce: 'post',
  setup() {
    const status = useState<'rust' | 'typescript' | 'loading'>('compute-core', () => 'loading')
    const config = useRuntimeConfig()
    const base = config.app.baseURL || '/'

    const start = () => {
      void ensureWasmCore(base).then((core) => {
        status.value = core ? 'rust' : 'typescript'
      })
    }

    // Idle warm-up: the core is ready by the time a user opens the analysis
    // lab, without competing with hydration or the first chart paint.
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(start, { timeout: 2500 })
    } else {
      setTimeout(start, 1200)
    }

    // Route prefetch hint: a hover/tap on Analysis is an early intent signal.
    const router = useRouter()
    router.beforeResolve((to) => {
      if (to.path.startsWith('/analysis')) start()
    })
  },
})
