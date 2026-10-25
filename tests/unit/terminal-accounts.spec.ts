import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, markRaw, nextTick, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { createPinia, defineStore, disposePinia, setActivePinia } from 'pinia'
import { instruments } from '~/domain/instruments/catalog'
import type { Candle } from '~/domain/market/types'
import { ACCOUNT_SIZES, accountTemplate, cloneTemplate, templateById } from '~/domain/sim/presets'
import { isMarketOpen, nextSessionOpen, sessionOpen } from '~/domain/sim/session'
import * as persistence from '~/lib/sim/persistence'
import type { ReplayCheckpoint, ReplayRepository, ReplayRun, SavedReplay } from '~/lib/sim/persistence'
import { ReplaySession } from '~/lib/sim/replay'
import { buildReplayMarket, REPLAY_BASE_SECONDS, validReplayCandle, type ReplayTape } from '~/lib/sim/tape'

vi.stubGlobal('defineStore', defineStore)
const { useTerminalStore } = await import('~/stores/terminal')

function fixture(id = 'terminal-accounts', startIndex?: number, templateId = 'practice'): ReplaySession {
  const tapes: ReplayTape[] = ['MES', 'MNQ'].map((symbol) => {
    let time = sessionOpen('2026-10-19')
    const candles: Candle[] = Array.from({ length: 320 }, (_, index) => {
      if (!isMarketOpen(time)) time = nextSessionOpen(time)
      const open = (symbol === 'MNQ' ? 1_000 : 2_000) + index * 0.25
      const candle = { time, open, high: open + 0.5, low: open - 0.5, close: open + 0.25, volume: 100 + index }
      time += REPLAY_BASE_SECONDS
      return candle
    })
    expect(candles.every(validReplayCandle)).toBe(true)
    return {
      symbol,
      source: 'synthetic',
      sourceSymbol: symbol,
      provenance: 'Terminal accounts regression fixture',
      fetchedAt: null,
      candles,
    }
  })
  const run: ReplayRun = {
    schemaVersion: 1,
    id,
    seed: 'terminal-accounts-seed',
    createdAt: '2026-10-19T00:00:00.000Z',
    instruments: tapes.map((tape) => instruments.require(tape.symbol)),
    tapes,
    startIndex: startIndex ?? buildReplayMarket(tapes).startIndex,
  }
  const template = templateById(templateId)
  if (!template) throw new Error(`Unknown template: ${templateId}`)
  return new ReplaySession(run, cloneTemplate(template))
}

function terminalSession(id: string, status: 'breached' | 'daily-lock'): ReplaySession {
  const replay = fixture(id, undefined, 'eval-50k')
  const run = structuredClone(replay.run)
  const tape = run.tapes.find((item) => item.symbol === 'MES')!
  // A gap crosses either the 2K drawdown floor or only the 1K daily limit.
  const gap = status === 'breached' ? 500 : 250
  for (const candle of tape.candles.slice(replay.cursor)) {
    candle.open -= gap
    candle.high -= gap
    candle.low -= gap
    candle.close -= gap
  }
  const session = new ReplaySession(run, accountTemplate(50_000))
  expect(session.engine.submit({ side: 'long', type: 'market', qty: 1 }, 'MES').ok).toBe(true)
  session.step()
  expect(session.engine.status).toBe(status)
  expect(session.engine.snapshot().trades).toHaveLength(1)
  return ReplaySession.restore({ run: session.run, checkpoint: session.checkpoint() })
}

let pinia: ReturnType<typeof createPinia>
let repository: ReplayRepository

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
  for (const [name, value] of Object.entries({
    defineStore,
    ref,
    shallowRef,
    computed,
    markRaw,
    watch,
    onScopeDispose,
  })) {
    vi.stubGlobal(name, value)
  }
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { baseURL: '/test-market/' } }))
  vi.stubGlobal('useSettingsStore', () => ({ settings: { dataSource: 'synthetic' } }))
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() })
  pinia = createPinia()
  setActivePinia(pinia)
  repository = persistence.createMemoryReplayRepository()
  vi.spyOn(persistence, 'createReplayRepository').mockReturnValue(repository)
})

afterEach(() => {
  disposePinia(pinia)
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function initializeStore(replay = fixture()) {
  await repository.create(replay.run, replay.checkpoint())
  const store = useTerminalStore()
  await store.initialize()
  expect(store.ready).toBe(true)
  expect(store.restoreBlocked).toBe(false)
  return store
}

async function restartStore() {
  const previous = useTerminalStore()
  previous.pause()
  await previous.flush()
  disposePinia(pinia)
  pinia = createPinia()
  setActivePinia(pinia)
  const store = useTerminalStore()
  expect(store).not.toBe(previous)
  await store.initialize()
  return store
}

function accounting(store: ReturnType<typeof useTerminalStore>) {
  return structuredClone({
    cursor: store.cursor,
    replayTime: store.replayTime,
    knownTime: store.knownTime,
    snapshot: store.snapshot,
  })
}

function savedReplay(saved: SavedReplay | null): SavedReplay {
  if (!saved) throw new Error('Expected a saved replay')
  return saved
}

function accountRow(store: ReturnType<typeof useTerminalStore>, id: string) {
  const row = store.accountList.find((item) => item.id === id)
  if (!row) throw new Error(`Missing account ${id}`)
  return row
}

/** Prefer microtask/timer progress; fake timers stay installed so flush proves idle. */
async function settle() {
  for (let turn = 0; turn < 12; turn += 1) {
    await nextTick()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
  }
}

interface GatedSave {
  checkpoint: ReplayCheckpoint
  resolve: () => void
  reject: (cause: Error) => void
}

/** Queue every save behind its own promise so completion order is ours to choose. */
function gateSaves(): GatedSave[] {
  const gates: GatedSave[] = []
  const write = repository.save.bind(repository)
  vi.spyOn(repository, 'save').mockImplementation(
    (checkpoint) =>
      new Promise<void>((resolve, reject) => {
        const saved = structuredClone(checkpoint)
        gates.push({
          checkpoint: saved,
          resolve: () => {
            write(saved).then(resolve, reject)
          },
          reject: (cause) => reject(cause),
        })
      }),
  )
  return gates
}

function restoreAccounting(saved: SavedReplay) {
  const restored = ReplaySession.restore(saved)
  return {
    cursor: restored.cursor,
    replayTime: restored.time,
    knownTime: restored.time + REPLAY_BASE_SECONDS,
    snapshot: restored.engine.snapshot(),
  }
}

describe('generic account templates', () => {
  it('defines isolated 25K, 50K and 100K templates', () => {
    expect(ACCOUNT_SIZES).toEqual([25_000, 50_000, 100_000])
    for (const size of ACCOUNT_SIZES) {
      const template = accountTemplate(size)
      expect(template.id).toBe(`eval-${size / 1_000}k`)
      expect(template.accountSize).toBe(size)
      expect(template.dailyLoss.action).toBe('flatten-lock')
    }

    const mutated = accountTemplate(25_000)
    mutated.label = 'Mutated'
    mutated.drawdown.amount = 1
    mutated.dailyLoss.amount = 1
    expect(accountTemplate(25_000).label).toBe('25K Evaluation')
    expect(accountTemplate(25_000).drawdown.amount).toBe(1_500)
    expect(accountTemplate(25_000).dailyLoss.amount).toBe(500)
  })
})

describe('account creation', () => {
  it('bootstraps one default 50K account only for a fresh repository', async () => {
    const store = useTerminalStore()
    await store.initialize()

    expect(store.restoreBlocked).toBe(false)
    expect(store.ready).toBe(true)
    const id = store.activeAccountId
    expect(id).not.toBeNull()
    expect(store.accountList).toHaveLength(1)
    expect(store.accountList[0]).toMatchObject({
      id,
      accountSize: 50_000,
      balance: 50_000,
      equity: 50_000,
      status: 'active',
    })
    expect(store.accountList[0]!.name).toMatch(/^50K · /)
    expect(store.accountList[0]!.cursor).toBe(store.cursor)

    const catalog = await repository.catalog()
    expect(catalog.initialized).toBe(true)
    expect(catalog.accounts).toHaveLength(1)
    expect(catalog.accounts[0]!.id).toBe(id)

    const create = vi.spyOn(repository, 'create')
    const restarted = await restartStore()
    expect(create).not.toHaveBeenCalled()
    expect(restarted.activeAccountId).toBe(id)
    expect(restarted.accountList).toHaveLength(1)
  })

  it('creates each size and keeps same-size multiples as separate accounts', async () => {
    const store = await initializeStore()
    const firstId = store.activeAccountId!
    const ids = new Set<string>([firstId])

    for (const size of ACCOUNT_SIZES) {
      const previousIds = [...ids]
      await store.createAccount({ name: `Size ${size}`, size })

      expect(store.accountError).toBeNull()
      const id = store.activeAccountId!
      expect(ids.has(id)).toBe(false)
      ids.add(id)
      expect(store.account!.startBalance).toBe(size)
      expect(store.template.accountSize).toBe(size)
      expect(store.templateId).toBe(`eval-${size / 1_000}k`)
      expect(accountRow(store, id)).toMatchObject({
        id,
        name: `Size ${size}`,
        accountSize: size,
        balance: size,
        equity: size,
        status: 'active',
      })
      for (const previousId of previousIds) {
        expect(await repository.load(previousId)).not.toBeNull()
      }
    }

    await store.createAccount({ name: 'Second 50K', size: 50_000 })
    const duplicateFiftyId = store.activeAccountId!
    const fiftyKAccounts = store.accountList.filter((item) => item.accountSize === 50_000)
    expect(fiftyKAccounts).toHaveLength(3)
    expect(fiftyKAccounts.map((item) => item.id)).toEqual(expect.arrayContaining([firstId, duplicateFiftyId]))
    expect(fiftyKAccounts.map((item) => item.name)).toEqual(expect.arrayContaining(['Size 50000', 'Second 50K']))
    expect((await repository.catalog()).accounts).toHaveLength(5)
  })

  it('trims names and enforces the 1-60 character boundary', async () => {
    const store = await initializeStore()

    await store.createAccount({ name: '  Trimmed  ', size: 25_000 })
    expect(store.accountError).toBeNull()
    const trimmedId = store.activeAccountId!
    expect(accountRow(store, trimmedId).name).toBe('Trimmed')
    const countAfterTrim = store.accountList.length
    const activeAfterTrim = trimmedId

    for (const name of ['', '   ', 'x'.repeat(61)]) {
      await store.createAccount({ name, size: 50_000 })
      expect(store.accountError).toBe('Account name must be between 1 and 60 characters.')
      expect(store.activeAccountId).toBe(activeAfterTrim)
      expect(store.accountList).toHaveLength(countAfterTrim)
    }

    await store.createAccount({ name: 'Z', size: 25_000 })
    expect(store.accountError).toBeNull()
    expect(accountRow(store, store.activeAccountId!).name).toBe('Z')

    const sixty = 'L'.repeat(60)
    await store.createAccount({ name: sixty, size: 50_000 })
    expect(store.accountError).toBeNull()
    expect(accountRow(store, store.activeAccountId!).name).toBe(sixty)
    expect(store.accountList).toHaveLength(countAfterTrim + 2)
  })

  it('adds an account through newAttempt without deleting the current one', async () => {
    const store = await initializeStore()
    const oldId = store.activeAccountId!
    expect(store.submit({ side: 'long', type: 'market', qty: 1 }).ok).toBe(true)
    store.stepBars(2)
    await store.flush()
    const oldState = accounting(store)

    await store.newAttempt()
    expect(store.accountError).toBeNull()
    const newId = store.activeAccountId!
    expect(newId).not.toBe(oldId)
    expect(store.accountList).toHaveLength(2)
    expect(await repository.load(oldId)).not.toBeNull()

    await store.switchAccount(oldId)
    expect(accounting(store)).toEqual(oldState)
  })

  it('keeps the current session when a new account cannot be persisted', async () => {
    const store = await initializeStore()
    const currentId = store.activeAccountId!
    store.stepBars(1)
    await store.flush()
    const before = accounting(store)
    const catalogBefore = await repository.catalog()
    vi.spyOn(repository, 'create').mockRejectedValueOnce(new Error('Replay account not created'))

    await store.createAccount({ name: 'Not persisted', size: 25_000 })

    expect(store.accountError).toBe('Replay account not created')
    expect(store.activeAccountId).toBe(currentId)
    expect(accounting(store)).toEqual(before)
    expect(store.accountBusy).toBe(false)
    expect(store.loading).toBe(false)
    expect(await repository.catalog()).toEqual(catalogBefore)
  })
})

describe('account switching', () => {
  it('keeps replay clock, orders, fills, trades, positions and risk independent per account', async () => {
    const second = fixture('second-account', 270, 'eval-25k')
    await repository.create(second.run, second.checkpoint(), '25K swing')
    const secondId = second.run.id
    const store = await initializeStore()
    const firstId = store.activeAccountId!
    expect(store.submit({ side: 'long', type: 'market', qty: 1 }).ok).toBe(true)
    store.stepBars(2)
    expect(store.flatten().ok).toBe(true)
    expect(store.submit({ side: 'long', type: 'market', qty: 1 }).ok).toBe(true)
    expect(store.submit({ side: 'long', type: 'limit', qty: 1, limitPrice: 1_500, tif: 'gtc' }, 'MES').ok).toBe(true)
    store.stepBars(2)
    await store.flush()

    const firstState = accounting(store)
    const firstFills = structuredClone(store.fills)
    const firstOrders = structuredClone(store.workingOrders)
    const firstTrades = structuredClone(store.trades)
    expect(firstFills).toHaveLength(3)
    expect(firstOrders).toHaveLength(1)
    expect(firstTrades).toHaveLength(1)
    expect(store.position?.side).toBe('long')

    await store.switchAccount(secondId)
    expect(store.account!.startBalance).toBe(25_000)
    expect(store.fills).toHaveLength(0)
    expect(store.trades).toHaveLength(0)
    expect(store.workingOrders).toHaveLength(0)
    expect(store.position).toBeNull()
    const secondInitial = accounting(store)
    expect(secondInitial.cursor).not.toBe(firstState.cursor)
    expect(secondInitial.replayTime).not.toBe(firstState.replayTime)

    expect(store.submit({ side: 'short', type: 'market', qty: 2 }).ok).toBe(true)
    store.stepBars(1)
    expect(store.flatten().ok).toBe(true)
    expect(store.submit({ side: 'short', type: 'market', qty: 2 }).ok).toBe(true)
    store.stepBars(3)
    await store.flush()
    const secondState = accounting(store)
    expect(secondState.cursor).toBeGreaterThan(secondInitial.cursor)
    expect(store.fills).toHaveLength(3)
    expect(store.fills[0]!.side).toBe('short')
    expect(store.trades).toHaveLength(1)
    expect(store.trades).not.toEqual(firstTrades)
    expect(store.workingOrders).toHaveLength(0)
    expect(store.position).toMatchObject({ side: 'short', qty: 2 })
    expect(store.risk?.floor).not.toBe(firstState.snapshot!.risk.floor)
    expect(restoreAccounting(savedReplay(await repository.load(firstId)))).toEqual(firstState)
    expect(restoreAccounting(savedReplay(await repository.load(secondId)))).toEqual(secondState)

    await store.switchAccount(firstId)
    expect(accounting(store)).toEqual(firstState)
    expect(store.fills).toEqual(firstFills)
    expect(store.workingOrders).toEqual(firstOrders)
    expect(store.trades).toEqual(firstTrades)
    expect(store.position).toMatchObject({ side: 'long', qty: 1 })
    expect(store.account!.startBalance).toBe(50_000)

    await store.switchAccount(secondId)
    expect(accounting(store)).toEqual(secondState)
    expect(store.position).toMatchObject({ side: 'short', qty: 2 })
    expect(store.account!.startBalance).toBe(25_000)

    const restarted = await restartStore()
    expect(restarted.activeAccountId).toBe(secondId)
    expect(accounting(restarted)).toEqual(secondState)
    expect(restarted.accountList).toHaveLength(2)
    expect(accountRow(restarted, firstId)).toMatchObject({
      accountSize: 50_000,
      balance: firstState.snapshot!.account.balance,
      equity: firstState.snapshot!.account.equity,
      cursor: firstState.cursor,
    })
    expect(accountRow(restarted, secondId)).toMatchObject({
      accountSize: 25_000,
      balance: secondState.snapshot!.account.balance,
      equity: secondState.snapshot!.account.equity,
      cursor: secondState.cursor,
    })
  })

  it('pauses playback and flushes the source before installing the destination', async () => {
    const store = await initializeStore()
    const sourceId = store.activeAccountId!
    await store.createAccount({ name: 'Destination', size: 25_000 })
    const destinationId = store.activeAccountId!
    await store.switchAccount(sourceId)
    const destinationState = restoreAccounting(savedReplay(await repository.load(destinationId)))

    const gates = gateSaves()
    const load = vi.spyOn(repository, 'load')
    const activate = vi.spyOn(repository, 'activate')
    store.play()
    expect(store.playing).toBe(true)
    vi.advanceTimersByTime(500)
    await settle()
    expect(gates).toHaveLength(1)
    expect(store.playing).toBe(true)
    const cursorAfterTick = store.cursor

    const switching = store.switchAccount(destinationId)
    expect(store.playing).toBe(false)
    expect(store.accountBusy).toBe(true)
    await settle()

    expect(gates).toHaveLength(1)
    expect(load).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
    expect(store.activeAccountId).toBe(sourceId)
    expect(gates[0]!.checkpoint.runId).toBe(sourceId)
    expect(gates[0]!.checkpoint.cursor).toBe(cursorAfterTick)

    gates[0]!.resolve()
    await switching
    await store.flush()

    expect(load).toHaveBeenCalledWith(destinationId)
    expect(activate).toHaveBeenCalledWith(destinationId)
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(activate.mock.invocationCallOrder[0]!)
    expect(store.activeAccountId).toBe(destinationId)
    expect(store.accountBusy).toBe(false)
    expect(store.playing).toBe(false)
    expect(restoreAccounting(savedReplay(await repository.load(sourceId))).cursor).toBe(cursorAfterTick)
    expect(accounting(store)).toEqual(destinationState)
  })

  it('drains the latest queued source checkpoint before switching without leaking writes into the destination', async () => {
    const destination = fixture('queued-destination', 268, 'eval-25k')
    await repository.create(destination.run, destination.checkpoint())
    const store = await initializeStore()
    const sourceId = store.activeAccountId!
    const destinationSaved = savedReplay(await repository.load(destination.run.id))
    const gates = gateSaves()
    const load = vi.spyOn(repository, 'load')
    const activate = vi.spyOn(repository, 'activate')

    store.stepBars(1)
    await settle()
    expect(gates).toHaveLength(1)
    store.stepBars(3)
    const sourceState = accounting(store)
    const switching = store.switchAccount(destination.run.id)
    await settle()
    expect(store.accountBusy).toBe(true)
    expect(gates).toHaveLength(1)
    expect(load).not.toHaveBeenCalled()

    gates[0]!.resolve()
    await settle()
    expect(gates).toHaveLength(2)
    expect(gates[1]!.checkpoint.runId).toBe(sourceId)
    expect(gates[1]!.checkpoint.cursor).toBe(sourceState.cursor)
    expect(gates[1]!.checkpoint.cursor).toBe(gates[0]!.checkpoint.cursor + 3)
    expect(store.activeAccountId).toBe(sourceId)
    expect(store.accountBusy).toBe(true)
    expect(load).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()

    gates[1]!.resolve()
    await switching
    await store.flush()

    expect(store.accountError).toBeNull()
    expect(store.accountBusy).toBe(false)
    expect(store.activeAccountId).toBe(destination.run.id)
    expect(accounting(store)).toEqual(restoreAccounting(destinationSaved))
    expect(restoreAccounting(savedReplay(await repository.load(sourceId)))).toEqual(sourceState)
    expect(await repository.load()).toEqual(destinationSaved)
    expect(gates).toHaveLength(2)
  })

  it('ignores concurrent transition requests while an account change is busy', async () => {
    const store = await initializeStore()
    const firstId = store.activeAccountId!
    await store.createAccount({ name: 'Second', size: 25_000 })
    const secondId = store.activeAccountId!
    await store.createAccount({ name: 'Third', size: 100_000 })
    const currentId = store.activeAccountId!
    await store.flush()
    const catalogBefore = await repository.catalog()

    const baseLoad = repository.load.bind(repository)
    let releaseLoad: (() => void) | undefined
    const load = vi.spyOn(repository, 'load').mockImplementationOnce(
      (id?: string) =>
        new Promise<SavedReplay | null>((resolve, reject) => {
          releaseLoad = () => {
            baseLoad(id).then(resolve, reject)
          }
        }),
    )
    const create = vi.spyOn(repository, 'create')
    const rename = vi.spyOn(repository, 'rename')
    const remove = vi.spyOn(repository, 'remove')
    const activate = vi.spyOn(repository, 'activate')

    const switching = store.switchAccount(firstId)
    await settle()
    expect(store.accountBusy).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(firstId)
    expect(store.activeAccountId).toBe(currentId)

    const stateWhileBusy = accounting(store)
    expect(store.canTrade).toBe(false)
    expect(store.canPlay).toBe(false)
    expect(store.submit({ side: 'long', type: 'market', qty: 1 }).ok).toBe(false)
    store.stepBars(2)
    store.play()
    expect(store.playing).toBe(false)
    expect(accounting(store)).toEqual(stateWhileBusy)

    await store.switchAccount(secondId)
    await store.createAccount({ name: 'Should not exist', size: 25_000 })
    await store.newAttempt()
    await store.renameAccount(firstId, 'Should not rename')
    await store.deleteAccount(secondId)

    expect(store.activeAccountId).toBe(currentId)
    expect(store.accountBusy).toBe(true)
    expect(create).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
    expect(await repository.catalog()).toEqual(catalogBefore)

    if (!releaseLoad) throw new Error('Expected the load to be waiting')
    releaseLoad()
    await switching

    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledWith(firstId)
    expect(store.activeAccountId).toBe(firstId)
    expect(store.accountBusy).toBe(false)
    expect(accountRow(store, secondId).name).toBe('Second')
    expect((await repository.catalog()).accounts.some((item) => item.name === 'Should not exist')).toBe(false)
  })
})

describe('account switching failures', () => {
  it.each(['switch', 'create', 'newAttempt', 'rename', 'delete', 'retry'] as const)(
    'blocks %s while a save retry waits for a failing drain and retains unsaved progress',
    async (transition) => {
      const destination = fixture('retry-destination', undefined, 'eval-25k')
      await repository.create(destination.run, destination.checkpoint())
      const store = await initializeStore()
      const sourceId = store.activeAccountId!
      const persisted = savedReplay(await repository.load(sourceId))
      const catalog = await repository.catalog()
      const gates = gateSaves()

      store.stepBars(1)
      await settle()
      store.stepBars(1)
      const latest = accounting(store)
      gates[0]!.reject(new Error('First save failed'))
      await settle()
      expect(gates).toHaveLength(2)
      expect(store.storageStatus).toBe('unavailable')

      const retry = store.retrySave()
      const competing =
        transition === 'switch'
          ? store.switchAccount(destination.run.id)
          : transition === 'create'
            ? store.createAccount({ name: 'Not created', size: 100_000 })
            : transition === 'newAttempt'
              ? store.newAttempt()
              : transition === 'rename'
                ? store.renameAccount(sourceId, 'Not renamed')
                : transition === 'delete'
                  ? store.deleteAccount(sourceId)
                  : store.retrySave()
      gates[1]!.reject(new Error('Second save failed'))
      await settle()

      expect(gates).toHaveLength(3)
      expect(gates[2]!.checkpoint.runId).toBe(sourceId)
      expect(gates[2]!.checkpoint.cursor).toBe(latest.cursor)
      expect(store.accountBusy).toBe(true)
      expect(store.canTrade).toBe(false)
      expect(store.activeAccountId).toBe(sourceId)
      store.stepBars(1)
      store.play()
      expect(store.playing).toBe(false)
      expect(accounting(store)).toEqual(latest)
      expect(await repository.catalog()).toEqual(catalog)

      gates[2]!.reject(new Error('Retry save failed'))
      await Promise.all([retry, competing])
      expect(store.accountBusy).toBe(false)
      expect(store.storageStatus).toBe('unavailable')
      expect(store.storageError).toBe('Retry save failed')
      expect(accounting(store)).toEqual(latest)
      expect(await repository.load()).toEqual(persisted)

      const recovered = store.retrySave()
      await settle()
      expect(gates).toHaveLength(4)
      gates[3]!.resolve()
      await recovered
      await store.switchAccount(destination.run.id)
      await store.switchAccount(sourceId)
      expect(accounting(store)).toEqual(latest)
      expect(store.storageStatus).toBe('saved')
    },
  )

  it('blocks switching and creation after a failed save, then recovers with retrySave', async () => {
    const store = await initializeStore()
    const firstId = store.activeAccountId!
    await store.createAccount({ name: 'Second', size: 25_000 })
    const activeId = store.activeAccountId!
    await store.flush()
    const catalogBefore = await repository.catalog()

    const load = vi.spyOn(repository, 'load')
    const activate = vi.spyOn(repository, 'activate')
    const create = vi.spyOn(repository, 'create')
    vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('Replay checkpoint not saved'))
    store.stepBars(1)
    await store.flush()
    expect(store.storageStatus).toBe('unavailable')
    expect(store.storageError).toBe('Replay checkpoint not saved')
    const failedState = accounting(store)

    await store.switchAccount(firstId)
    expect(store.accountError).toBe('Save the current account before changing accounts.')
    expect(store.activeAccountId).toBe(activeId)
    expect(accounting(store)).toEqual(failedState)
    expect(load).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(await repository.catalog()).toEqual(catalogBefore)

    await store.createAccount({ name: 'Blocked', size: 100_000 })
    expect(store.accountError).toBe('Save the current account before changing accounts.')
    expect(store.activeAccountId).toBe(activeId)
    expect(accounting(store)).toEqual(failedState)
    expect(create).not.toHaveBeenCalled()
    expect(await repository.catalog()).toEqual(catalogBefore)

    await store.retrySave()
    await store.flush()
    expect(store.storageStatus).toBe('saved')
    expect(store.storageError).toBeNull()

    await store.switchAccount(firstId)
    expect(store.accountError).toBeNull()
    expect(store.activeAccountId).toBe(firstId)
  })

  it.each(['switch', 'create', 'newAttempt'] as const)(
    'blocks %s when its in-flight source save fails',
    async (transition) => {
      const destination = fixture('destination', undefined, 'eval-25k')
      await repository.create(destination.run, destination.checkpoint(), 'Destination')
      const destinationId = destination.run.id
      const store = await initializeStore()
      const sourceId = store.activeAccountId!
      const beforeTick = accounting(store)
      const sourcePersistedBeforeTick = savedReplay(await repository.load(sourceId))
      const catalogBefore = await repository.catalog()

      const gates = gateSaves()
      const load = vi.spyOn(repository, 'load')
      const activate = vi.spyOn(repository, 'activate')
      const create = vi.spyOn(repository, 'create')
      store.stepBars(1)
      await settle()
      expect(gates).toHaveLength(1)
      const tickState = accounting(store)

      const changing =
        transition === 'switch'
          ? store.switchAccount(destinationId)
          : transition === 'create'
            ? store.createAccount({ name: 'Blocked', size: 100_000 })
            : store.newAttempt()
      await settle()
      expect(store.accountBusy).toBe(true)
      expect(load).not.toHaveBeenCalled()
      expect(activate).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
      expect(store.activeAccountId).toBe(sourceId)

      gates[0]!.reject(new Error('Replay checkpoint not saved'))
      await changing

      expect(store.accountError).toBe('Save the current account before changing accounts.')
      expect(store.storageStatus).toBe('unavailable')
      expect(store.storageError).toBe('Replay checkpoint not saved')
      expect(store.activeAccountId).toBe(sourceId)
      expect(accounting(store)).toEqual(tickState)
      expect(accounting(store)).not.toEqual(beforeTick)
      expect(store.accountBusy).toBe(false)
      expect(store.loading).toBe(false)
      expect(load).not.toHaveBeenCalled()
      expect(activate).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
      expect(await repository.load()).toEqual(sourcePersistedBeforeTick)
      expect(await repository.load(sourceId)).toEqual(sourcePersistedBeforeTick)
      expect(await repository.load(destinationId)).not.toBeNull()
      expect(await repository.catalog()).toEqual(catalogBefore)
    },
  )

  it('preserves the current account when the destination is unknown', async () => {
    const store = await initializeStore(fixture('known-account'))
    const before = accounting(store)
    const persisted = savedReplay(await repository.load())
    const activate = vi.spyOn(repository, 'activate')

    await store.switchAccount('missing-account')

    expect(store.accountError).toBe('Replay attempt not found')
    expect(store.activeAccountId).toBe('known-account')
    expect(accounting(store)).toEqual(before)
    expect(await repository.load()).toEqual(persisted)
    expect(activate).not.toHaveBeenCalled()
    expect(store.restoreBlocked).toBe(false)
  })

  it('preserves the current account when the destination checkpoint is corrupt', async () => {
    const corrupt = fixture('corrupt-account', undefined, 'eval-50k')
    await repository.create(corrupt.run, { ...corrupt.checkpoint(), cursor: corrupt.run.startIndex })
    const healthy = fixture('healthy-account')
    await repository.create(healthy.run, healthy.checkpoint())

    const store = useTerminalStore()
    await store.initialize()
    expect(store.activeAccountId).toBe('healthy-account')
    const before = accounting(store)
    const healthySaved = savedReplay(await repository.load())
    const corruptSaved = savedReplay(await repository.load('corrupt-account'))
    const activate = vi.spyOn(repository, 'activate')
    const remove = vi.spyOn(repository, 'remove')
    const create = vi.spyOn(repository, 'create')

    await store.switchAccount('corrupt-account')

    expect(store.accountError).toBe('Invalid replay cursor')
    expect(store.activeAccountId).toBe('healthy-account')
    expect(accounting(store)).toEqual(before)
    expect(await repository.load()).toEqual(healthySaved)
    expect(await repository.load('corrupt-account')).toEqual(corruptSaved)
    expect(activate).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(store.accountBusy).toBe(false)
    expect(store.accountList).toHaveLength(2)
    expect(store.restoreBlocked).toBe(false)
  })

  it('preserves the current account when loading the destination fails', async () => {
    const destination = fixture('unreadable-account', 270, 'eval-25k')
    await repository.create(destination.run, destination.checkpoint())
    const store = await initializeStore(fixture('current-account'))
    expect(store.submit({ side: 'long', type: 'market', qty: 1 }).ok).toBe(true)
    store.stepBars(1)
    await store.flush()
    const before = accounting(store)
    const currentSaved = savedReplay(await repository.load())
    const catalogBefore = await repository.catalog()
    const load = vi.spyOn(repository, 'load').mockRejectedValueOnce(new Error('Replay account unreadable'))
    const activate = vi.spyOn(repository, 'activate')
    const create = vi.spyOn(repository, 'create')

    await store.switchAccount(destination.run.id)

    expect(load).toHaveBeenCalledWith(destination.run.id)
    expect(store.accountError).toBe('Replay account unreadable')
    expect(store.activeAccountId).toBe('current-account')
    expect(accounting(store)).toEqual(before)
    expect(store.accountBusy).toBe(false)
    expect(store.restoreBlocked).toBe(false)
    expect(activate).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(await repository.load()).toEqual(currentSaved)
    expect(await repository.catalog()).toEqual(catalogBefore)

    await store.switchAccount(destination.run.id)
    expect(store.accountError).toBeNull()
    expect(store.activeAccountId).toBe(destination.run.id)
    expect(store.accountBusy).toBe(false)
  })

  it('preserves the current account when activation fails', async () => {
    const first = fixture('first-account')
    const second = fixture('second-account')
    await repository.create(first.run, first.checkpoint())
    await repository.create(second.run, second.checkpoint())

    const store = useTerminalStore()
    await store.initialize()
    expect(store.activeAccountId).toBe('second-account')
    const before = accounting(store)
    const secondSaved = savedReplay(await repository.load())
    const firstSaved = savedReplay(await repository.load('first-account'))
    vi.spyOn(repository, 'activate').mockRejectedValueOnce(new Error('Replay account not selected'))

    await store.switchAccount('first-account')

    expect(store.accountError).toBe('Replay account not selected')
    expect(store.activeAccountId).toBe('second-account')
    expect(accounting(store)).toEqual(before)
    expect(await repository.load()).toEqual(secondSaved)
    expect(await repository.load('first-account')).toEqual(firstSaved)
    expect(store.restoreBlocked).toBe(false)
  })
})

describe('account rename', () => {
  it('renames active and inactive accounts persistently without changing their state', async () => {
    const store = await initializeStore()
    const firstId = store.activeAccountId!
    await store.createAccount({ name: 'Second', size: 25_000 })
    const secondId = store.activeAccountId!
    store.stepBars(1)
    await store.flush()
    const before = accounting(store)

    await store.renameAccount(firstId, '  Archived  ')
    expect(store.accountError).toBeNull()
    expect(accountRow(store, firstId).name).toBe('Archived')
    expect(store.activeAccountId).toBe(secondId)
    expect(accounting(store)).toEqual(before)

    await store.renameAccount(secondId, 'Primary')
    expect(store.accountError).toBeNull()
    expect(accountRow(store, secondId).name).toBe('Primary')
    expect(accounting(store)).toEqual(before)

    const sixty = 'N'.repeat(60)
    await store.renameAccount(firstId, sixty)
    expect(accountRow(store, firstId).name).toBe(sixty)
    const catalogBeforeInvalid = await repository.catalog()

    for (const name of ['', '  ', 'x'.repeat(61)]) {
      await store.renameAccount(firstId, name)
      expect(store.accountError).toBe('Replay account name must be 1-60 characters')
      expect(accountRow(store, firstId).name).toBe(sixty)
      expect(store.activeAccountId).toBe(secondId)
    }
    expect(await repository.catalog()).toEqual(catalogBeforeInvalid)

    const restarted = await restartStore()
    expect(restarted.activeAccountId).toBe(secondId)
    expect(accountRow(restarted, firstId).name).toBe(sixty)
    expect(accountRow(restarted, secondId).name).toBe('Primary')
    expect(accounting(restarted)).toEqual(before)
  })
})

describe('account deletion', () => {
  it('deletes an inactive account after a quota failure without abandoning the active progress', async () => {
    const inactive = fixture('quota-inactive')
    await repository.create(inactive.run, inactive.checkpoint())
    const store = await initializeStore()
    const currentId = store.activeAccountId!
    const persisted = savedReplay(await repository.load(currentId))
    vi.spyOn(repository, 'save').mockRejectedValueOnce(new DOMException('Storage full', 'QuotaExceededError'))
    store.stepBars(1)
    await store.flush()
    const latest = accounting(store)
    expect(store.storageStatus).toBe('unavailable')

    await store.deleteAccount(inactive.run.id)

    expect(store.accountError).toBeNull()
    expect(store.activeAccountId).toBe(currentId)
    expect(accounting(store)).toEqual(latest)
    expect(store.storageStatus).toBe('unavailable')
    expect(store.storageError).toBe('Storage full')
    expect(await repository.load()).toEqual(persisted)
    expect(await repository.load(inactive.run.id)).toBeNull()
    expect(store.accountList.map((item) => item.id)).toEqual([currentId])

    await store.retrySave()
    expect(store.storageStatus).toBe('saved')
    expect(restoreAccounting(savedReplay(await repository.load(currentId)))).toEqual(latest)
  })

  it('allows confirmed deletion of the active account after its save fails', async () => {
    const remaining = fixture('quota-remaining')
    await repository.create(remaining.run, remaining.checkpoint())
    const store = await initializeStore()
    const currentId = store.activeAccountId!
    const remainingSaved = savedReplay(await repository.load(remaining.run.id))
    vi.spyOn(repository, 'save').mockRejectedValueOnce(new DOMException('Storage full', 'QuotaExceededError'))
    store.stepBars(1)
    await store.flush()
    expect(store.storageStatus).toBe('unavailable')

    await store.deleteAccount(currentId)
    await store.retrySave()
    await store.flush()

    expect(store.accountError).toBeNull()
    expect(store.run).toBeNull()
    expect(store.snapshot).toBeNull()
    expect(store.storageStatus).toBe('saved')
    expect(await repository.load()).toBeNull()
    expect(await repository.load(currentId)).toBeNull()
    expect(await repository.load(remaining.run.id)).toEqual(remainingSaved)
    expect(store.accountList.map((item) => item.id)).toEqual([remaining.run.id])
    const restarted = await restartStore()
    expect(restarted.activeAccountId).toBeNull()
    expect(restarted.accountList.map((item) => item.id)).toEqual([remaining.run.id])
  })

  it.each(['active', 'inactive'] as const)(
    'settles all queued writes before deleting the %s account even if the drain fails',
    async (target) => {
      const inactive = fixture('drain-inactive')
      await repository.create(inactive.run, inactive.checkpoint())
      const store = await initializeStore()
      const currentId = store.activeAccountId!
      const targetId = target === 'active' ? currentId : inactive.run.id
      const save = repository.save.bind(repository)
      const gates = gateSaves()
      const remove = vi.spyOn(repository, 'remove')
      store.stepBars(1)
      await settle()
      store.stepBars(1)
      const latest = accounting(store)
      const deletion = store.deleteAccount(targetId)
      await settle()
      expect(store.accountBusy).toBe(true)
      expect(remove).not.toHaveBeenCalled()
      expect(gates).toHaveLength(1)

      gates[0]!.resolve()
      await settle()
      expect(gates).toHaveLength(2)
      expect(remove).not.toHaveBeenCalled()
      expect(gates[1]!.checkpoint.cursor).toBe(latest.cursor)
      gates[1]!.reject(new DOMException('Storage full', 'QuotaExceededError'))
      await deletion
      await store.flush()

      expect(remove).toHaveBeenCalledExactlyOnceWith(targetId)
      expect(store.accountError).toBeNull()
      expect(store.accountBusy).toBe(false)
      expect(await repository.load(targetId)).toBeNull()
      // Only the active run owned these writes; deletion must never recreate it.
      if (target === 'active') {
        expect(store.run).toBeNull()
        await expect(save(gates[1]!.checkpoint)).rejects.toThrow('Replay attempt not found')
        expect(await repository.load(currentId)).toBeNull()
      } else {
        expect(accounting(store)).toEqual(latest)
        expect(store.storageStatus).toBe('unavailable')
      }
    },
  )

  it('deletes an inactive account without selecting it or changing the current state', async () => {
    const store = await initializeStore()
    const inactiveId = store.activeAccountId!
    await store.createAccount({ name: 'Current', size: 25_000 })
    const currentId = store.activeAccountId!
    store.stepBars(1)
    await store.flush()
    const before = accounting(store)
    const currentSaved = savedReplay(await repository.load(currentId))

    await store.deleteAccount(inactiveId)

    expect(store.accountError).toBeNull()
    expect(store.activeAccountId).toBe(currentId)
    expect(accounting(store)).toEqual(before)
    expect(await repository.load()).toEqual(currentSaved)
    expect(await repository.load(currentId)).toEqual(currentSaved)
    expect(await repository.load(inactiveId)).toBeNull()
    expect(store.accountList.map((item) => item.id)).toEqual([currentId])
    expect((await repository.catalog()).accounts.map((item) => item.id)).toEqual([currentId])
  })

  it('clears the active selection when the active account is deleted and keeps the rest', async () => {
    const store = await initializeStore()
    const remainingId = store.activeAccountId!
    await store.createAccount({ name: 'Delete me', size: 100_000 })
    const activeId = store.activeAccountId!
    store.stepBars(1)
    await store.flush()

    await store.deleteAccount(activeId)

    expect(store.activeAccountId).toBeNull()
    expect(store.run).toBeNull()
    expect(store.snapshot).toBeNull()
    expect(store.cursor).toBe(0)
    expect(store.ready).toBe(false)
    expect(store.accountList.map((item) => item.id)).toEqual([remainingId])
    expect(await repository.load()).toBeNull()
    expect(await repository.load(remainingId)).not.toBeNull()
    expect((await repository.catalog()).accounts.map((item) => item.id)).toEqual([remainingId])

    const create = vi.spyOn(repository, 'create')
    const restarted = await restartStore()
    expect(create).not.toHaveBeenCalled()
    expect(restarted.activeAccountId).toBeNull()
    expect(restarted.snapshot).toBeNull()
    expect(restarted.accountList.map((item) => item.id)).toEqual([remainingId])

    await restarted.switchAccount(remainingId)
    expect(restarted.activeAccountId).toBe(remainingId)
    expect(restarted.ready).toBe(true)
    expect(restarted.accountList).toHaveLength(1)
  })

  it('leaves an intentionally empty catalog after deleting the last account and reloading', async () => {
    const store = await initializeStore()
    const onlyId = store.activeAccountId!
    store.stepBars(2)
    await store.flush()

    await store.deleteAccount(onlyId)

    expect(store.accountList).toEqual([])
    expect(store.activeAccountId).toBeNull()
    expect(store.run).toBeNull()
    expect(await repository.catalog()).toEqual({ accounts: [], initialized: true })
    expect(await repository.load()).toBeNull()

    const create = vi.spyOn(repository, 'create')
    const restarted = await restartStore()
    expect(create).not.toHaveBeenCalled()
    expect(restarted.activeAccountId).toBeNull()
    expect(restarted.run).toBeNull()
    expect(restarted.snapshot).toBeNull()
    expect(restarted.accountList).toEqual([])
    expect(restarted.restoreBlocked).toBe(false)
    expect(restarted.storageStatus).toBe('saved')
    expect(await repository.catalog()).toEqual({ accounts: [], initialized: true })

    await restarted.load()
    expect(create).not.toHaveBeenCalled()
    expect(restarted.accountList).toEqual([])
  })
})

describe('account terminal states', () => {
  it('keeps breached and daily-lock accounts selectable and independent across switches and reloads', async () => {
    const breached = terminalSession('breached-account', 'breached')
    const locked = terminalSession('locked-account', 'daily-lock')
    const normal = fixture('normal-account')
    await repository.create(breached.run, breached.checkpoint())
    await repository.create(locked.run, locked.checkpoint())
    await repository.create(normal.run, normal.checkpoint())

    const store = useTerminalStore()
    await store.initialize()
    expect(store.activeAccountId).toBe('normal-account')
    expect(accountRow(store, 'breached-account').status).toBe('breached')
    expect(accountRow(store, 'breached-account').breach).not.toBeNull()
    expect(accountRow(store, 'locked-account').status).toBe('daily-lock')
    expect(accountRow(store, 'locked-account').breach).toBeNull()

    await store.switchAccount('breached-account')
    expect(store.snapshot?.status).toBe('breached')
    expect(store.risk?.status).toBe('breached')
    expect(store.risk?.breach).not.toBeNull()
    expect(store.canTrade).toBe(false)
    expect(store.submit({ side: 'long', type: 'market', qty: 1 }).ok).toBe(false)
    const breachedState = accounting(store)
    const breachRecord = structuredClone(store.risk!.breach)
    expect(accountRow(store, 'breached-account').status).toBe('breached')

    await store.switchAccount('locked-account')
    expect(store.snapshot?.status).toBe('daily-lock')
    expect(store.risk?.status).toBe('daily-lock')
    expect(store.risk?.dailyTriggered).toBe(true)
    expect(store.risk?.breach).toBeNull()
    expect(store.canTrade).toBe(false)
    expect(store.submit({ side: 'long', type: 'market', qty: 1 }).ok).toBe(false)
    const lockedState = accounting(store)
    expect(accountRow(store, 'locked-account').status).toBe('daily-lock')

    await store.switchAccount('normal-account')
    expect(store.snapshot?.status).toBe('active')
    expect(store.canTrade).toBe(true)
    expect(store.submit({ side: 'long', type: 'market', qty: 1 }).ok).toBe(true)
    store.stepBars(1)
    await store.flush()

    await store.switchAccount('breached-account')
    expect(accounting(store)).toEqual(breachedState)
    expect(store.risk?.breach).toEqual(breachRecord)

    await store.switchAccount('locked-account')
    expect(accounting(store)).toEqual(lockedState)

    await store.switchAccount('breached-account')
    const restarted = await restartStore()
    expect(restarted.activeAccountId).toBe('breached-account')
    expect(restarted.snapshot?.status).toBe('breached')
    expect(restarted.risk?.status).toBe('breached')
    expect(accounting(restarted)).toEqual(breachedState)
    expect(restarted.canTrade).toBe(false)

    const catalog = await repository.catalog()
    expect(catalog.accounts.find((item) => item.id === 'breached-account')!.status).toBe('breached')
    expect(catalog.accounts.find((item) => item.id === 'locked-account')!.status).toBe('daily-lock')
    expect(catalog.accounts.find((item) => item.id === 'normal-account')!.status).toBe('active')

    await restarted.switchAccount('locked-account')
    const lockedReloaded = await restartStore()
    expect(lockedReloaded.activeAccountId).toBe('locked-account')
    expect(accounting(lockedReloaded)).toEqual(lockedState)
    expect(lockedReloaded.risk?.dailyTriggered).toBe(true)
    expect(lockedReloaded.canTrade).toBe(false)
    expect(lockedReloaded.canPlay).toBe(true)
  })
})
