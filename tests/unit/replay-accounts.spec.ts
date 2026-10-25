import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { instruments } from '~/domain/instruments/catalog'
import { cloneTemplate, templateById } from '~/domain/sim/presets'
import type { SimAccountStatus, SimBreach } from '~/domain/sim/types'
import { accountName, accountSummary } from '~/lib/sim/accounts'
import {
  createMemoryReplayRepository,
  type ReplayRepository,
  type ReplayRun,
  type SavedReplay,
} from '~/lib/sim/persistence'
import { ReplaySession } from '~/lib/sim/replay'
import { buildReplayMarket, syntheticReplayTape } from '~/lib/sim/tape'

const NOW = '2026-10-25T12:00:00.000Z'
const LATER = '2026-10-25T13:00:00.000Z'
const CREATED = '2026-10-19T00:00:00.000Z'

function fixture(id = 'first-account', size = 50_000): SavedReplay {
  const spec = instruments.require('MES')
  const tapes = [syntheticReplayTape(spec, id, 300)]
  const run: ReplayRun = {
    schemaVersion: 1,
    id,
    seed: id,
    createdAt: CREATED,
    instruments: [spec],
    tapes,
    startIndex: buildReplayMarket(tapes).startIndex,
  }
  const template = cloneTemplate(templateById('practice')!)
  template.accountSize = size
  const replay = new ReplaySession(run, template)
  return { run: replay.run, checkpoint: replay.checkpoint() }
}

function breach(): SimBreach {
  return { rule: 'drawdown', bar: 265, time: 1_792_401_000, equity: 47_500, floor: 48_000, message: 'Drawdown' }
}

let repository: ReplayRepository

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  repository = createMemoryReplayRepository()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('multi-account replay repository', () => {
  it('distinguishes a never-initialized catalog from missing named accounts', async () => {
    expect(await repository.catalog()).toEqual({ accounts: [], initialized: false })
    expect(await repository.load()).toBeNull()
    expect(await repository.load('unknown')).toBeNull()
    await expect(repository.activate('unknown')).rejects.toThrow('Replay account not found')
    await expect(repository.rename('unknown', 'Unknown')).rejects.toThrow('Replay account not found')
    await expect(repository.remove('unknown')).rejects.toThrow('Replay account not found')
    await expect(repository.save(fixture().checkpoint)).rejects.toThrow('Replay attempt not found')
    expect(await repository.catalog()).toEqual({ accounts: [], initialized: false })
    expect(await repository.load()).toBeNull()
  })

  it('catalogs different sizes with stable default names and trimmed custom names', async () => {
    const first = fixture('small-account', 25_000)
    const second = fixture('middle-account', 50_000)
    const third = fixture('large-account', 100_000)
    await repository.create(first.run, first.checkpoint)
    await repository.create(second.run, second.checkpoint)
    await repository.create(third.run, third.checkpoint, '  Large evaluation  ')

    const catalog = await repository.catalog()
    expect(catalog.initialized).toBe(true)
    expect(catalog.accounts).toHaveLength(3)
    for (const [saved, name] of [
      [first, '25K · small-ac'],
      [second, '50K · middle-a'],
      [third, 'Large evaluation'],
    ] as const) {
      expect(catalog.accounts.find((account) => account.id === saved.run.id)).toEqual({
        id: saved.run.id,
        name,
        createdAt: CREATED,
        updatedAt: NOW,
        accountSize: saved.checkpoint.engine.risk.startBalance,
        balance: saved.checkpoint.engine.balance,
        equity: saved.checkpoint.engine.risk.lastEquity,
        status: 'active',
        breach: null,
        cursor: saved.checkpoint.cursor,
      })
    }
    expect(await repository.catalog()).toEqual(catalog)
    expect(await repository.load()).toEqual(third)
  })

  it('loads a named account without changing the active pointer and durably activates an existing account', async () => {
    const first = fixture('first')
    const second = fixture('second')
    await repository.create(first.run, first.checkpoint)
    await repository.create(second.run, second.checkpoint)
    expect(await repository.load(first.run.id)).toEqual(first)
    expect(await repository.load('unknown')).toBeNull()
    expect(await repository.load()).toEqual(second)

    await repository.activate(first.run.id)
    expect(await repository.load()).toEqual(first)
    await repository.catalog()
    await repository.load(second.run.id)
    await repository.rename(second.run.id, 'Renamed second')
    expect(await repository.load()).toEqual(first)
    await expect(repository.activate('unknown')).rejects.toThrow('Replay account not found')
    expect(await repository.load()).toEqual(first)
  })

  it.each<SimAccountStatus>(['active', 'daily-lock', 'breached', 'target'])(
    'projects pinned balances and %s state instead of recomputing simulation or consulting templates',
    async (status) => {
      const saved = fixture()
      const { engine } = saved.checkpoint
      engine.template.accountSize = 100_000
      engine.risk.template.accountSize = 100_000
      engine.balance = 49_900
      engine.risk.lastBalance = 49_800
      engine.risk.lastEquity = 49_750
      engine.risk.status = status
      engine.risk.breach = status === 'breached' ? breach() : null
      await repository.create(saved.run, saved.checkpoint)

      expect((await repository.catalog()).accounts[0]).toMatchObject({
        accountSize: 50_000,
        name: '50K · first-ac',
        balance: 49_900,
        equity: 49_750,
        status,
        breach: engine.risk.breach,
      })
      expect(await repository.load()).toEqual(saved)
    },
  )

  it('updates an inactive checkpoint and its summary together without switching the current account', async () => {
    const first = fixture('first', 25_000)
    const second = fixture('second', 100_000)
    await repository.create(first.run, first.checkpoint, 'Keep this name')
    await repository.create(second.run, second.checkpoint)
    const secondSummary = (await repository.catalog()).accounts.find((account) => account.id === second.run.id)
    const pinnedRun = structuredClone(first.run)
    vi.setSystemTime(LATER)
    first.checkpoint.cursor += 5
    first.checkpoint.engine.balance = 24_200
    first.checkpoint.engine.risk.lastEquity = 24_100
    first.checkpoint.engine.risk.status = 'daily-lock'
    first.run.seed = 'caller changes must not replace the run'
    await repository.save(first.checkpoint)

    expect(await repository.load()).toEqual(second)
    expect(await repository.load(first.run.id)).toEqual({ run: pinnedRun, checkpoint: first.checkpoint })
    const accounts = (await repository.catalog()).accounts
    expect(accounts.find((account) => account.id === first.run.id)).toEqual({
      id: first.run.id,
      name: 'Keep this name',
      createdAt: CREATED,
      updatedAt: LATER,
      accountSize: 25_000,
      balance: 24_200,
      equity: 24_100,
      status: 'daily-lock',
      breach: null,
      cursor: first.checkpoint.cursor,
    })
    expect(accounts.find((account) => account.id === second.run.id)).toEqual(secondSummary)
  })

  it('normalizes names and accepts the 1- and 60-character boundaries without changing replay data', async () => {
    const saved = fixture()
    await repository.create(saved.run, saved.checkpoint, ' A ')
    expect((await repository.catalog()).accounts[0]!.name).toBe('A')
    vi.setSystemTime(LATER)
    await repository.rename(saved.run.id, `  ${'n'.repeat(60)}  `)
    expect((await repository.catalog()).accounts[0]).toMatchObject({
      name: 'n'.repeat(60),
      createdAt: CREATED,
      updatedAt: LATER,
    })
    expect(await repository.load()).toEqual(saved)
    expect(accountName('  trimmed  ')).toBe('trimmed')
  })

  it.each(['', ' \t\n ', 'n'.repeat(61)])('rejects an invalid name (%j) without partial changes', async (name) => {
    const saved = fixture()
    await expect(repository.create(saved.run, saved.checkpoint, name)).rejects.toThrow(
      'Replay account name must be 1-60 characters',
    )
    expect(await repository.catalog()).toEqual({ accounts: [], initialized: false })
    expect(await repository.load()).toBeNull()

    await repository.create(saved.run, saved.checkpoint, 'Original')
    const original = await repository.catalog()
    await expect(repository.rename(saved.run.id, name)).rejects.toThrow('Replay account name must be 1-60 characters')
    const next = fixture('next')
    await expect(repository.create(next.run, next.checkpoint, name)).rejects.toThrow(
      'Replay account name must be 1-60 characters',
    )
    expect(await repository.catalog()).toEqual(original)
    expect(await repository.load()).toEqual(saved)
    expect(await repository.load(next.run.id)).toBeNull()
  })

  it('rejects duplicates and unknown mutations without replacing the current pointer or existing metadata', async () => {
    const first = fixture('first')
    const second = fixture('second')
    await repository.create(first.run, first.checkpoint, 'Original')
    await repository.create(second.run, second.checkpoint)
    const original = structuredClone(first)
    const catalog = await repository.catalog()
    first.checkpoint.cursor += 1
    first.run.seed = 'changed'
    await expect(repository.create(first.run, first.checkpoint, 'Replacement')).rejects.toThrow(
      'Replay attempt already exists',
    )
    await expect(repository.rename('unknown', 'Unknown')).rejects.toThrow('Replay account not found')
    await expect(repository.activate('unknown')).rejects.toThrow('Replay account not found')
    await expect(repository.remove('unknown')).rejects.toThrow('Replay account not found')
    expect(await repository.load()).toEqual(second)
    expect(await repository.load(first.run.id)).toEqual(original)
    expect(await repository.catalog()).toEqual(catalog)
  })

  it('deletes inactive accounts without switching, and clears the active pointer without selecting a replacement', async () => {
    const first = fixture('first')
    const second = fixture('second')
    const third = fixture('third')
    for (const saved of [first, second, third]) await repository.create(saved.run, saved.checkpoint)
    await repository.remove(second.run.id)
    expect(await repository.load()).toEqual(third)
    expect(await repository.load(second.run.id)).toBeNull()

    await repository.remove(third.run.id)
    expect(await repository.load()).toBeNull()
    expect(await repository.load(third.run.id)).toBeNull()
    expect((await repository.catalog()).accounts.map((account) => account.id)).toEqual([first.run.id])
    await repository.save(first.checkpoint)
    expect(await repository.load()).toBeNull()
    await repository.activate(first.run.id)
    expect(await repository.load()).toEqual(first)

    await repository.remove(first.run.id)
    expect(await repository.catalog()).toEqual({ accounts: [], initialized: true })
    expect(await repository.load()).toBeNull()
    await expect(repository.activate(first.run.id)).rejects.toThrow('Replay account not found')
    await repository.create(second.run, second.checkpoint)
    expect((await repository.catalog()).initialized).toBe(true)
    expect(await repository.load()).toEqual(second)
  })

  it('rejects stale saves after deletion and never resurrects removed checkpoints or summaries', async () => {
    const saved = fixture()
    await repository.create(saved.run, saved.checkpoint)
    const stale = structuredClone(saved.checkpoint)
    const removal = repository.remove(saved.run.id)
    const lateSave = repository.save(stale)
    await removal
    await expect(lateSave).rejects.toThrow('Replay attempt not found')
    await expect(repository.save(stale)).rejects.toThrow('Replay attempt not found')
    expect(await repository.load(saved.run.id)).toBeNull()
    expect(await repository.load()).toBeNull()
    expect(await repository.catalog()).toEqual({ accounts: [], initialized: true })
  })

  it('snapshots inputs at invocation and deeply isolates loads, catalogs, and the summary helper', async () => {
    const saved = fixture()
    saved.checkpoint.engine.risk.status = 'breached'
    saved.checkpoint.engine.risk.breach = breach()
    const expected = structuredClone(saved)
    const creation = repository.create(saved.run, saved.checkpoint, 'Isolated')
    saved.run.tapes[0]!.candles[0]!.close = -1
    saved.checkpoint.engine.risk.breach.message = 'caller edit'
    saved.checkpoint.engine.balance = 1
    await creation
    expect(await repository.load()).toEqual(expected)

    const loaded = (await repository.load())!
    const catalog = await repository.catalog()
    loaded.run.instruments[0]!.tickSize = 1
    loaded.checkpoint.engine.risk.breach!.message = 'loaded edit'
    catalog.accounts[0]!.name = 'catalog edit'
    catalog.accounts[0]!.breach!.message = 'catalog breach edit'
    catalog.accounts.length = 0
    expect(await repository.load()).toEqual(expected)
    expect((await repository.catalog()).accounts[0]).toMatchObject({ name: 'Isolated', breach: breach() })

    const checkpoint = structuredClone(expected.checkpoint)
    checkpoint.cursor += 1
    const summary = accountSummary(checkpoint)
    summary.breach!.message = 'helper edit'
    expect(checkpoint.engine.risk.breach).toEqual(breach())
    const expectedCheckpoint = structuredClone(checkpoint)
    const saving = repository.save(checkpoint)
    checkpoint.engine.risk.breach!.message = 'edit during save'
    checkpoint.engine.balance = -1
    await saving
    expect(await repository.load()).toEqual({ run: expected.run, checkpoint: expectedCheckpoint })
    expect((await repository.catalog()).accounts[0]!.breach).toEqual(breach())
  })

  it('rejects mismatched checkpoint identities without initializing or replacing the active account', async () => {
    const saved = fixture()
    saved.checkpoint.runId = 'wrong-run'
    await expect(repository.create(saved.run, saved.checkpoint)).rejects.toThrow('Replay checkpoint does not match run')
    expect(await repository.catalog()).toEqual({ accounts: [], initialized: false })
    expect(await repository.load()).toBeNull()
    expect(await repository.load(saved.run.id)).toBeNull()

    const active = fixture('active')
    await repository.create(active.run, active.checkpoint)
    const catalog = await repository.catalog()
    await expect(repository.create(saved.run, saved.checkpoint)).rejects.toThrow('Replay checkpoint does not match run')
    expect(await repository.catalog()).toEqual(catalog)
    expect(await repository.load()).toEqual(active)
    expect(await repository.load(saved.run.id)).toBeNull()
  })

  it('leaves full simulation validation to restore without changing stored replay data', async () => {
    const saved = fixture()
    saved.checkpoint.cursor += 1
    await repository.create(saved.run, saved.checkpoint)
    expect(await repository.load()).toEqual(saved)
    expect((await repository.catalog()).accounts[0]!.cursor).toBe(saved.checkpoint.cursor)
    expect(() => ReplaySession.restore(saved)).toThrow()
  })

  it('keeps the last complete checkpoint and summary when concurrent saves are requested in order', async () => {
    const saved = fixture()
    await repository.create(saved.run, saved.checkpoint)
    const earlier = structuredClone(saved.checkpoint)
    const later = structuredClone(saved.checkpoint)
    earlier.cursor += 1
    earlier.engine.balance = 50_100
    later.cursor += 2
    later.engine.balance = 50_200
    later.engine.risk.lastEquity = 50_250
    await Promise.all([repository.save(earlier), repository.save(later)])
    expect(await repository.load()).toEqual({ run: saved.run, checkpoint: later })
    expect((await repository.catalog()).accounts[0]).toMatchObject({
      cursor: later.cursor,
      balance: 50_200,
      equity: 50_250,
    })
  })

  it('does not partially save a checkpoint whose summary cannot be represented', async () => {
    const saved = fixture()
    await repository.create(saved.run, saved.checkpoint)
    const original = await repository.catalog()
    const invalid = structuredClone(saved.checkpoint)
    invalid.engine.risk.lastEquity = Number.NaN
    await expect(repository.save(invalid)).rejects.toThrow('Replay account summary is corrupt')
    expect(await repository.load()).toEqual(saved)
    expect(await repository.catalog()).toEqual(original)
  })
})
