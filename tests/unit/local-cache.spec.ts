import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATASET_WINDOW } from '@/domain/market/dataset'
import {
  LOCAL_NEGATIVE_CACHE_TTL_MS,
  clearLocalMarketCache,
  getCachedDataset,
  loadLocalDataset,
  loadLocalManifest,
  prepareLocalScenarioInput,
} from '@/lib/market/local-data'

interface ManifestEntry {
  symbol: string
  bars: number
  timeframe: string
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function manifestPayload(entries: ManifestEntry[] = [{ symbol: 'MNQ', bars: 1200, timeframe: '5m' }]) {
  return {
    version: 1,
    generatedAt: '2026-10-20T00:00:00.000Z',
    interval: '5m',
    range: '60d',
    timezone: 'UTC',
    datasets: entries.map((entry) => ({
      source: 'yahoo',
      sourceSymbol: `${entry.symbol}=F`,
      timezone: 'UTC',
      license: 'test only',
      fetchedAt: '2026-10-20T00:00:00.000Z',
      ...entry,
    })),
  }
}

function datasetPayload(bars: number, firstClose: number, symbol = 'MNQ', timeframe = '5m') {
  const t: number[] = []
  const o: number[] = []
  const h: number[] = []
  const l: number[] = []
  const c: number[] = []
  const v: number[] = []
  for (let index = 0; index < bars; index += 1) {
    const open = firstClose + index * 0.25
    t.push(1_760_000_000 + index * (timeframe === '1h' ? 3600 : 300))
    o.push(open)
    h.push(open + 0.5)
    l.push(open - 0.5)
    c.push(open + 0.25)
    v.push(100 + (index % 10))
  }
  return {
    symbol,
    source: 'yahoo',
    sourceSymbol: `${symbol}=F`,
    timeframe,
    timezone: 'UTC',
    license: 'test only',
    fetchedAt: '2026-10-20T00:00:00.000Z',
    bars,
    t,
    o,
    h,
    l,
    c,
    v,
  }
}

const base = 'https://packs.test/one'

beforeEach(() => {
  clearLocalMarketCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clearLocalMarketCache()
})

describe('local pack cache invalidation', () => {
  it('force-refreshing the manifest invalidates datasets and stale requests cannot repopulate', async () => {
    const oldManifest = deferred<Response>()
    const oldDataset = deferred<Response>()
    let manifestCalls = 0
    let datasetCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/manifest.json')) {
          manifestCalls += 1
          return manifestCalls === 1
            ? oldManifest.promise
            : Promise.resolve(jsonResponse(manifestPayload([{ symbol: 'MNQ', bars: 1500, timeframe: '5m' }])))
        }
        if (url.endsWith('/MNQ.json')) {
          datasetCalls += 1
          return datasetCalls === 1 ? oldDataset.promise : Promise.resolve(jsonResponse(datasetPayload(1500, 200)))
        }
        return Promise.resolve(jsonResponse(null, 404))
      }),
    )

    const staleManifest = loadLocalManifest(base)
    const staleDataset = loadLocalDataset(base, 'MNQ')
    const refreshedManifest = loadLocalManifest(base, true)
    const refreshedDataset = loadLocalDataset(base, 'MNQ')
    expect(manifestCalls).toBe(2)
    expect(datasetCalls).toBe(2)

    const joinedManifest = loadLocalManifest(base)
    const joinedDataset = loadLocalDataset(base, 'MNQ')
    expect(await joinedManifest).toBe(await refreshedManifest)
    expect(await joinedDataset).toBe(await refreshedDataset)
    expect((await refreshedManifest)?.datasets[0]?.bars).toBe(1500)
    expect((await refreshedDataset)?.bars).toBe(1500)

    oldManifest.resolve(jsonResponse(manifestPayload([{ symbol: 'MNQ', bars: 1200, timeframe: '5m' }])))
    oldDataset.resolve(jsonResponse(datasetPayload(1200, 100)))
    expect((await staleManifest)?.datasets[0]?.bars).toBe(1200)
    expect((await staleDataset)?.bars).toBe(1200)

    expect((await loadLocalManifest(base))?.datasets[0]?.bars).toBe(1500)
    expect(getCachedDataset(base, 'MNQ')?.bars).toBe(1500)
    expect(manifestCalls).toBe(2)
    expect(datasetCalls).toBe(2)
  })

  it('force-refreshing the manifest drops an already cached dataset', async () => {
    let datasetCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/manifest.json')) return Promise.resolve(jsonResponse(manifestPayload()))
        if (url.endsWith('/MNQ.json')) {
          datasetCalls += 1
          return Promise.resolve(
            jsonResponse(datasetCalls === 1 ? datasetPayload(1200, 100) : datasetPayload(1500, 200)),
          )
        }
        return Promise.resolve(jsonResponse(null, 404))
      }),
    )

    expect((await loadLocalDataset(base, 'MNQ'))?.bars).toBe(1200)
    expect(getCachedDataset(base, 'MNQ')?.bars).toBe(1200)

    await loadLocalManifest(base, true)
    expect(getCachedDataset(base, 'MNQ')).toBeNull()

    expect((await loadLocalDataset(base, 'MNQ'))?.bars).toBe(1500)
    expect(datasetCalls).toBe(2)
  })

  it.each([base, undefined])('clearing %s guards pending loads and their cleanup', async (clearedBase) => {
    const oldManifest = deferred<Response>()
    const oldDataset = deferred<Response>()
    const freshManifest = deferred<Response>()
    const freshDataset = deferred<Response>()
    let manifestCalls = 0
    let datasetCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/manifest.json')) {
          manifestCalls += 1
          return manifestCalls === 1 ? oldManifest.promise : freshManifest.promise
        }
        datasetCalls += 1
        return datasetCalls === 1 ? oldDataset.promise : freshDataset.promise
      }),
    )

    const staleManifest = loadLocalManifest(base)
    const staleDataset = loadLocalDataset(base, 'MNQ')
    clearLocalMarketCache(clearedBase)
    const refreshedManifest = loadLocalManifest(base)
    const refreshedDataset = loadLocalDataset(base, 'MNQ')

    oldManifest.resolve(jsonResponse(manifestPayload()))
    oldDataset.resolve(jsonResponse(datasetPayload(1200, 100)))
    expect((await staleManifest)?.datasets[0]?.bars).toBe(1200)
    expect((await staleDataset)?.bars).toBe(1200)
    expect(getCachedDataset(base, 'MNQ')).toBeNull()

    const joinedManifest = loadLocalManifest(base)
    const joinedDataset = loadLocalDataset(base, 'MNQ')
    expect(manifestCalls).toBe(2)
    expect(datasetCalls).toBe(2)

    freshManifest.resolve(jsonResponse(manifestPayload([{ symbol: 'MNQ', bars: 1500, timeframe: '5m' }])))
    freshDataset.resolve(jsonResponse(datasetPayload(1500, 200)))
    expect((await refreshedManifest)?.datasets[0]?.bars).toBe(1500)
    expect((await refreshedDataset)?.bars).toBe(1500)
    expect(await joinedManifest).toBe(await refreshedManifest)
    expect(await joinedDataset).toBe(await refreshedDataset)
  })

  it('joins asset paths without damaging absolute URL protocols', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(manifestPayload()))
    vi.stubGlobal('fetch', fetchMock)
    for (const [baseURL, expected] of [
      ['/', '/data/market/manifest.json'],
      ['/nested/app///', '/nested/app/data/market/manifest.json'],
      [`${base}/`, `${base}/data/market/manifest.json`],
    ] as const) {
      await loadLocalManifest(baseURL)
      expect(fetchMock).toHaveBeenLastCalledWith(expected, expect.any(Object))
    }
  })

  it('coalesces identical in-flight requests', async () => {
    const pendingManifest = deferred<Response>()
    const pendingDataset = deferred<Response>()
    let manifestCalls = 0
    let datasetCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/manifest.json')) {
          manifestCalls += 1
          return pendingManifest.promise
        }
        if (url.endsWith('/MNQ.json')) {
          datasetCalls += 1
          return pendingDataset.promise
        }
        return Promise.resolve(jsonResponse(null, 404))
      }),
    )

    const manifests = [loadLocalManifest(base), loadLocalManifest(`${base}/`)]
    const datasets = [loadLocalDataset(base, 'MNQ'), loadLocalDataset(`${base}/`, 'MNQ')]
    expect(manifestCalls).toBe(1)
    expect(datasetCalls).toBe(1)

    pendingManifest.resolve(jsonResponse(manifestPayload()))
    pendingDataset.resolve(jsonResponse(datasetPayload(1200, 100)))
    const resolved = await Promise.all([...manifests, ...datasets])
    expect(resolved[0]).toBe(resolved[1])
    expect(resolved[2]).toBe(resolved[3])
    expect(manifestCalls).toBe(1)
    expect(datasetCalls).toBe(1)
  })

  it.each(['clear', 'refresh'])('isolates base caches during %s', async (action) => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        calls.push(url)
        const bars = url.startsWith('/pack-a/') ? 1200 : 1500
        const payload = url.endsWith('/manifest.json')
          ? manifestPayload([{ symbol: 'MNQ', bars, timeframe: '5m' }])
          : datasetPayload(bars, 100)
        return Promise.resolve(jsonResponse(payload))
      }),
    )

    expect((await loadLocalManifest('/pack-a'))?.datasets[0]?.bars).toBe(1200)
    expect((await loadLocalManifest('/pack-b'))?.datasets[0]?.bars).toBe(1500)
    expect((await loadLocalDataset('/pack-a', 'MNQ'))?.bars).toBe(1200)
    expect((await loadLocalDataset('/pack-b/', 'MNQ'))?.bars).toBe(1500)
    expect(getCachedDataset('/pack-a/', 'MNQ')?.bars).toBe(1200)
    expect(getCachedDataset('/pack-b', 'MNQ')?.bars).toBe(1500)

    if (action === 'clear') clearLocalMarketCache('/pack-a/')
    else await loadLocalManifest('/pack-a/', true)
    expect(getCachedDataset('/pack-a', 'MNQ')).toBeNull()
    expect(getCachedDataset('/pack-b', 'MNQ')?.bars).toBe(1500)

    await loadLocalManifest('/pack-a')
    await loadLocalManifest('/pack-b/')
    await loadLocalDataset('/pack-a', 'MNQ')
    await loadLocalDataset('/pack-b', 'MNQ')
    expect(calls.filter((url) => url.startsWith('/pack-a/'))).toHaveLength(4)
    expect(calls.filter((url) => url.startsWith('/pack-b/'))).toHaveLength(2)
  })
})

describe('local pack negative cache', () => {
  it('retries a missing manifest only after the negative TTL', async () => {
    let manifestCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        manifestCalls += 1
        return Promise.resolve(jsonResponse(null, 404))
      }),
    )
    const startedAt = 1_700_000_000_000
    const now = vi.spyOn(Date, 'now').mockReturnValue(startedAt)

    try {
      expect(await loadLocalManifest(base)).toBeNull()
      expect(await loadLocalManifest(base)).toBeNull()
      expect(manifestCalls).toBe(1)

      now.mockReturnValue(startedAt + LOCAL_NEGATIVE_CACHE_TTL_MS - 1)
      expect(await loadLocalManifest(base)).toBeNull()
      expect(manifestCalls).toBe(1)

      now.mockReturnValue(startedAt + LOCAL_NEGATIVE_CACHE_TTL_MS)
      expect(await loadLocalManifest(base)).toBeNull()
      expect(manifestCalls).toBe(2)
    } finally {
      now.mockRestore()
    }
  })

  it('keeps a successful manifest cached past the negative TTL', async () => {
    let manifestCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        manifestCalls += 1
        return Promise.resolve(jsonResponse(manifestPayload()))
      }),
    )
    const startedAt = 1_700_000_000_000
    const now = vi.spyOn(Date, 'now').mockReturnValue(startedAt)

    try {
      expect((await loadLocalManifest(base))?.datasets[0]?.symbol).toBe('MNQ')
      now.mockReturnValue(startedAt + LOCAL_NEGATIVE_CACHE_TTL_MS * 10)
      expect((await loadLocalManifest(base))?.datasets[0]?.symbol).toBe('MNQ')
      expect(manifestCalls).toBe(1)
    } finally {
      now.mockRestore()
    }
  })

  it.each(['missing', 'corrupt'])(
    'retries a %s dataset after the negative TTL and caches recovery',
    async (failure) => {
      let datasetCalls = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          datasetCalls += 1
          if (datasetCalls > 1) return Promise.resolve(jsonResponse(datasetPayload(1200, 100)))
          return Promise.resolve(failure === 'missing' ? jsonResponse(null, 404) : jsonResponse({ symbol: 'MNQ' }))
        }),
      )
      const startedAt = 1_700_000_000_000
      const now = vi.spyOn(Date, 'now').mockReturnValue(startedAt)

      try {
        expect(await loadLocalDataset(base, 'MNQ')).toBeNull()
        expect(await loadLocalDataset(base, 'MNQ')).toBeNull()
        expect(datasetCalls).toBe(1)

        now.mockReturnValue(startedAt + LOCAL_NEGATIVE_CACHE_TTL_MS - 1)
        expect(await loadLocalDataset(base, 'MNQ')).toBeNull()
        expect(datasetCalls).toBe(1)

        now.mockReturnValue(startedAt + LOCAL_NEGATIVE_CACHE_TTL_MS)
        const recovered = await loadLocalDataset(base, 'MNQ')
        expect(recovered?.bars).toBe(1200)
        expect(datasetCalls).toBe(2)

        now.mockReturnValue(startedAt + LOCAL_NEGATIVE_CACHE_TTL_MS * 10)
        expect(await loadLocalDataset(base, 'MNQ')).toBe(recovered)
        expect(datasetCalls).toBe(2)
      } finally {
        now.mockRestore()
      }
    },
  )
})

describe('local pack candidate selection', () => {
  it('rejects a mismatched timeframe and too few bars before fetching datasets', async () => {
    let datasetCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/manifest.json')) {
          return Promise.resolve(
            jsonResponse(
              manifestPayload([
                { symbol: 'MNQ', bars: 2000, timeframe: '1h' },
                { symbol: 'MES', bars: 709, timeframe: '5m' },
              ]),
            ),
          )
        }
        datasetCalls += 1
        return Promise.resolve(jsonResponse(null, 404))
      }),
    )

    const prepared = await prepareLocalScenarioInput({ baseURL: base, symbols: ['MNQ', 'MES'], seed: 'filtered' })
    expect(prepared).toBeNull()
    expect(datasetCalls).toBe(0)
  })

  it('falls back to null when the manifest overstates a short pack', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/manifest.json')) {
          return Promise.resolve(jsonResponse(manifestPayload([{ symbol: 'MNQ', bars: 2000, timeframe: '5m' }])))
        }
        if (url.endsWith('/MNQ.json')) return Promise.resolve(jsonResponse(datasetPayload(200, 100)))
        return Promise.resolve(jsonResponse(null, 404))
      }),
    )

    await expect(prepareLocalScenarioInput({ baseURL: base, symbols: ['MNQ'], seed: 'short-pack' })).resolves.toBeNull()
  })

  it.each(['short', 'timeframe', 'corrupt'])(
    'tries the next candidate when the selected dataset is %s',
    async (failure) => {
      let datasetCalls = 0
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/manifest.json')) {
          return Promise.resolve(
            jsonResponse(
              manifestPayload([
                { symbol: 'MNQ', bars: 1200, timeframe: '5m' },
                { symbol: 'MES', bars: 1200, timeframe: '5m' },
              ]),
            ),
          )
        }
        datasetCalls += 1
        const symbol = url.endsWith('/MNQ.json') ? 'MNQ' : 'MES'
        const payload = datasetPayload(1200, 100, symbol)
        if (datasetCalls === 1) {
          if (failure === 'short') return Promise.resolve(jsonResponse(datasetPayload(200, 100, symbol)))
          if (failure === 'timeframe') return Promise.resolve(jsonResponse(datasetPayload(1200, 100, symbol, '1h')))
          payload.h[0] = 0
        }
        return Promise.resolve(jsonResponse(payload))
      })
      vi.stubGlobal('fetch', fetchMock)

      const options = { baseURL: base, symbols: ['MNQ', 'MES'], seed: 'bad-first-pick' }
      const prepared = await prepareLocalScenarioInput(options)
      expect(prepared?.dataset.bars).toBe(1200)
      expect(prepared?.dataset.timeframe).toBe('5m')
      expect(datasetCalls).toBe(2)
      expect(await prepareLocalScenarioInput(options)).toEqual(prepared)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    },
  )

  it('accepts an exactly-one-window pack', async () => {
    const bars = DATASET_WINDOW.warmup + DATASET_WINDOW.future + DATASET_WINDOW.reveal
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/manifest.json')) {
          return Promise.resolve(jsonResponse(manifestPayload([{ symbol: 'MNQ', bars, timeframe: '5m' }])))
        }
        if (url.endsWith('/MNQ.json')) return Promise.resolve(jsonResponse(datasetPayload(bars, 100)))
        return Promise.resolve(jsonResponse(null, 404))
      }),
    )

    const prepared = await prepareLocalScenarioInput({ baseURL: base, symbols: ['MNQ'], seed: 'exact-pack' })
    expect(prepared?.symbol).toBe('MNQ')
    expect(prepared?.dataset.bars).toBe(bars)
  })

  it('uses the requested timeframe instead of assuming five minutes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/manifest.json')) {
          return Promise.resolve(
            jsonResponse(
              manifestPayload([
                { symbol: 'MNQ', bars: 1200, timeframe: '5m' },
                { symbol: 'MES', bars: 1200, timeframe: '1h' },
              ]),
            ),
          )
        }
        if (url.endsWith('/MES.json')) return Promise.resolve(jsonResponse(datasetPayload(1200, 100, 'MES', '1h')))
        return Promise.resolve(jsonResponse(null, 404))
      }),
    )

    const prepared = await prepareLocalScenarioInput({
      baseURL: base,
      symbols: ['MNQ', 'MES'],
      seed: 'hourly-pack',
      timeframeMinutes: 60,
    })
    expect(prepared?.symbol).toBe('MES')
    expect(prepared?.dataset.timeframe).toBe('1h')
  })
})
