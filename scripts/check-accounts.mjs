import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
let checks = 0
function check(condition, message) {
  assert.ok(condition, message)
  checks += 1
  console.log(`ok   ${message}`)
}

async function state() {
  return page.evaluate(() => {
    const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('terminal')
    return JSON.parse(
      JSON.stringify({
        id: store.activeAccountId,
        accounts: store.accountList,
        snapshot: store.snapshot,
        cursor: store.cursor,
        ready: store.ready,
        playing: store.playing,
        canTrade: store.canTrade,
        error: store.accountError,
      }),
    )
  })
}

async function records(targetPage) {
  return targetPage.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('propdesk-replay-v1', 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('replay', 'readonly')
          const store = transaction.objectStore('replay')
          const keys = store.getAllKeys()
          const values = store.getAll()
          transaction.oncomplete = () => {
            db.close()
            resolve(Object.fromEntries(keys.result.map((key, index) => [key, values.result[index]])))
          }
          transaction.onabort = () => {
            db.close()
            reject(transaction.error)
          }
        }
      }),
  )
}

async function migrationCheck(legacy, expectedError = null) {
  const isolated = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const target = await isolated.newPage()
  target.on('pageerror', (error) => errors.push(String(error)))
  try {
    await target.goto(`${BASE}/guide`, { waitUntil: 'networkidle' })
    await target.evaluate(
      (rows) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('propdesk-replay-v1', 1)
          request.onupgradeneeded = () => request.result.createObjectStore('replay')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('replay', 'readwrite')
            const store = transaction.objectStore('replay')
            for (const [key, value] of Object.entries(rows)) store.put(value, key)
            transaction.oncomplete = () => {
              db.close()
              resolve()
            }
            transaction.onabort = () => {
              db.close()
              reject(transaction.error)
            }
          }
        }),
      legacy,
    )
    await target.goto(`${BASE}/terminal`, { waitUntil: 'networkidle' })
    await target.waitForFunction(() => {
      const store = document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get('terminal')
      return store && !store.loading && !store.accountBusy && ['saved', 'unavailable'].includes(store.storageStatus)
    })
    const restored = await target.evaluate(() => {
      const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('terminal')
      return {
        id: store.activeAccountId,
        accounts: store.accountList,
        blocked: store.restoreBlocked,
        error: store.storageError,
        tradable: store.canTrade,
      }
    })
    const after = await records(target)
    if (expectedError) {
      check(restored.blocked && restored.error === expectedError, `migration rejects ${expectedError}`)
      assert.deepEqual(after, legacy)
      check(true, 'failed migration atomically preserves all legacy records and adds no metadata')
    } else {
      check(
        restored.id === legacy.active && restored.accounts.length === 2,
        'migration preserves both legacy accounts and the active selection',
      )
      check(
        !restored.tradable && restored.accounts.find((item) => item.id === legacy.active).status === 'breached',
        'legacy breached account remains blown after migration',
      )
      for (const [key, value] of Object.entries(legacy)) assert.deepEqual(after[key], value)
      check(true, 'migration leaves the original tapes, checkpoint ledgers and clocks byte-for-byte equivalent')
      check(after['catalog:initialized'] && after['catalog:migrated'], 'migration persists the catalog markers')
      await target.reload({ waitUntil: 'networkidle' })
      await target.getByTestId('account-header-status').waitFor()
      assert.deepEqual(await records(target), after)
      check(true, 'second load is an idempotent migration without data rewrites')
    }
  } finally {
    await isolated.close()
  }
}

async function settled() {
  await page.waitForFunction(() => {
    const store = document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia?._s.get('terminal')
    return store && !store.loading && !store.accountBusy && store.storageStatus === 'saved'
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function settleDialog() {
  await page.getByRole('dialog', { name: 'Accounts', exact: true }).evaluate(async (element) => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    )
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function openManager() {
  if (!(await page.getByTestId('account-manager').isVisible())) {
    await page.getByTestId('account-open').click()
  }
  await page.getByTestId('account-manager').waitFor()
  await settleDialog()
}

async function closeManager() {
  await page.keyboard.press('Escape')
  await page.getByTestId('account-manager').waitFor({ state: 'hidden' })
}

function row(id) {
  return page.locator(`[data-testid="account-row"][data-account-id="${id}"]`)
}

async function create(name, size) {
  await openManager()
  if (!(await page.getByTestId('account-create').isVisible())) {
    await page.getByTestId('account-create-toggle').click()
  }
  await page.getByTestId('account-create-name').fill(name)
  await page.getByTestId(`account-create-size-${size}`).click()
  await page.getByTestId('account-create-submit').click()
  await settled()
  const next = await state()
  check(
    !next.error && next.accounts.some((item) => item.id === next.id && item.name === name),
    `${name} is persisted and selected`,
  )
  check(next.snapshot.account.startBalance === size, `${name} starts with ${size}`)
  return next.id
}

async function select(id) {
  await openManager()
  await row(id).getByTestId('account-select').click()
  await settled()
  await page.getByTestId('account-manager').waitFor({ state: 'hidden' })
  check((await state()).id === id, 'switch selects the requested account')
}

async function remove(id) {
  await openManager()
  await row(id).getByTestId('account-delete').click()
  await row(id).getByTestId('confirm-delete').click()
  await settled()
  check(!(await state()).accounts.some((item) => item.id === id), 'confirmed delete removes only the requested account')
}

try {
  await page.goto(`${BASE}/terminal`, { waitUntil: 'networkidle' })
  await settled()
  const initial = await state()
  check(initial.ready && initial.accounts.length === 1, 'fresh browser retains the default account workflow')
  const original = initial.id

  const small = await create('Small 25K', 25000)
  await closeManager()
  await page.getByRole('button', { name: 'Step one bar', exact: true }).first().click()
  await settled()
  await page.getByTestId('ticket-submit').first().click()
  await settled()
  const traded = await state()
  check(
    traded.snapshot.positions.length === 1 && traded.snapshot.fills.length === 1,
    'a real ticket fill belongs to the 25K account',
  )

  const medium = await create('Medium 50K', 50000)
  check((await state()).snapshot.fills.length === 0, "new account does not inherit another account's fills")
  const large = await create('Large 100K', 100000)
  const secondSmall = await create('Second 25K', 25000)
  check((await state()).accounts.length === 5, 'multiple accounts of the same size coexist')
  await select(small)
  check(
    JSON.stringify((await state()).snapshot) === JSON.stringify(traded.snapshot),
    'switch restores the exact positions, orders, fees and risk ledger',
  )
  check((await state()).cursor === traded.cursor, 'each account retains its own replay clock')
  await page.reload({ waitUntil: 'networkidle' })
  await settled()
  check(
    (await state()).id === small && JSON.stringify((await state()).snapshot) === JSON.stringify(traded.snapshot),
    'reload restores the active account exactly',
  )

  await openManager()
  const beforeKeys = await state()
  await page.getByRole('dialog', { name: 'Accounts', exact: true }).focus()
  await page.keyboard.press('n')
  await page.keyboard.press('Space')
  check(
    (await state()).cursor === beforeKeys.cursor && !(await state()).playing,
    'account dialog isolates terminal shortcuts and pauses playback',
  )
  await row(small).getByTestId('account-rename').click()
  await row(small).getByTestId('account-rename-input').fill('My 25K')
  await row(small).getByTestId('account-rename-save').click()
  await settled()
  check(
    (await state()).accounts.find((item) => item.id === small).name === 'My 25K',
    'rename persists the account name',
  )
  await row(large).getByTestId('account-delete').click()
  await row(large).getByTestId('cancel-delete').click()
  check(
    (await state()).accounts.some((item) => item.id === large),
    'cancel deletion keeps the account',
  )
  await remove(large)
  check((await state()).id === small, 'deleting an inactive account leaves the selected account unchanged')
  await closeManager()

  // Exercise the real breach latch via an entry fee, not a fabricated status.
  // A tiny explicit test rule keeps the browser test independent of price drift.
  await page.evaluate(async () => {
    const store = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('terminal')
    const template = JSON.parse(JSON.stringify(store.template))
    template.id = 'account-breach-regression'
    template.drawdown = { mode: 'static', amount: 0.1, basis: 'balance', floorCap: null, includeUnrealized: true }
    template.dailyLoss = { amount: 0, action: 'warn' }
    await store.newAttempt({ template, reuseTapes: true, name: 'Blown 25K' })
  })
  await settled()
  const blown = (await state()).id
  await page.getByTestId('ticket-submit').first().click()
  await settled()
  const failed = await state()
  check(failed.snapshot.status === 'breached' && !failed.canTrade, 'real engine breach locks new trading')
  check(
    (await page.getByTestId('account-header-status').innerText()) === 'Blown account',
    'header identifies a blown account with text',
  )
  await select(medium)
  await openManager()
  check(
    (await row(blown).getByTestId('account-status').innerText()) === 'Blown account',
    'inactive blown account retains its label',
  )
  await closeManager()
  await select(blown)
  check(
    (await state()).snapshot.status === 'breached' && !(await state()).canTrade,
    'switching away and back cannot revive a blown account',
  )
  await page.reload({ waitUntil: 'networkidle' })
  await settled()
  check((await state()).id === blown && (await state()).snapshot.status === 'breached', 'breach survives a page reload')

  await mkdir('screenshots', { recursive: true })
  await openManager()
  const paint = await page.getByRole('dialog', { name: 'Accounts', exact: true }).evaluate((element) => {
    const style = getComputedStyle(element)
    return { opacity: style.opacity, background: style.backgroundColor }
  })
  check(
    paint.opacity === '1' && paint.background === 'rgb(255, 255, 255)',
    'light account dialog settles to an opaque surface',
  )
  await page.screenshot({ path: 'screenshots/accounts-light.png', animations: 'disabled' })
  await closeManager()
  await page.getByRole('button', { name: 'Toggle colour theme', exact: true }).first().click()
  await openManager()
  await page.screenshot({ path: 'screenshots/accounts-dark.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await settleDialog()
  check(
    (await page.getByRole('dialog', { name: 'Accounts', exact: true }).count()) === 1 &&
      (await page.getByRole('heading', { name: 'Accounts', exact: true }).count()) === 1 &&
      (await page.getByTestId('account-manager').count()) === 1,
    'resizing to mobile keeps exactly one account dialog and heading',
  )
  const box = await page.getByRole('dialog', { name: 'Accounts', exact: true }).boundingBox()
  check(
    box && box.x >= 16 && box.x + box.width <= 374 && box.y >= 16 && box.y + box.height <= 828,
    'manager fits the mobile viewport with 16px margins',
  )
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'mobile page has no horizontal overflow',
  )
  await page.screenshot({ path: 'screenshots/accounts-mobile.png', animations: 'disabled' })
  await row(blown).getByTestId('account-delete').scrollIntoViewIfNeeded()
  const bottom = await row(blown).getByTestId('account-delete').boundingBox()
  check(
    bottom && bottom.y >= 0 && bottom.y + bottom.height <= 844,
    'mobile dialog scroll reaches the last account action',
  )
  await row(blown).getByTestId('account-delete').click()
  check(
    await row(blown).getByTestId('confirm-delete').isVisible(),
    'last account deletion confirmation is reachable on mobile',
  )
  await row(blown).getByTestId('cancel-delete').click()
  await settleDialog()
  await page.screenshot({ path: 'screenshots/accounts-mobile-scrolled.png', animations: 'disabled' })
  if (!(await page.getByTestId('account-create').isVisible())) {
    await page.getByTestId('account-create-toggle').click()
  }
  await page.getByTestId('account-create-name').fill('Mobile draft')
  await page.getByTestId('account-create-size-100000').click()
  await page.getByTestId('account-create-submit').scrollIntoViewIfNeeded()
  await settleDialog()
  const form = await page.getByTestId('account-create-submit').boundingBox()
  check(form && form.y >= 16 && form.y + form.height <= 828, 'new account submit is reachable below the mobile list')
  check(
    (await page.getByRole('radio', { checked: true }).count()) === 1 &&
      (await page.getByTestId('account-create-size-100000').getAttribute('aria-checked')) === 'true',
    'mobile size selection has exactly one checked choice',
  )
  await page.screenshot({ path: 'screenshots/accounts-mobile-create.png', animations: 'disabled' })
  await page.getByTestId('account-create-cancel').click()
  await closeManager()
  await openManager()
  check(
    (await page.getByRole('dialog', { name: 'Accounts', exact: true }).count()) === 1,
    'reopening on mobile does not duplicate the dialog',
  )
  await closeManager()
  await page.reload({ waitUntil: 'networkidle' })
  await settled()
  await openManager()
  check(
    (await page.getByRole('dialog', { name: 'Accounts', exact: true }).count()) === 1 &&
      (await page.getByRole('heading', { name: 'Accounts', exact: true }).count()) === 1,
    'fresh mobile load has exactly one dialog and heading',
  )
  await closeManager()
  await page.setViewportSize({ width: 1440, height: 1000 })

  const stored = await records(page)
  const legacy = { active: blown }
  for (const id of [small, blown]) {
    legacy[`run:${id}`] = stored[`run:${id}`]
    legacy[`checkpoint:${id}`] = stored[`checkpoint:${id}`]
  }
  await migrationCheck(legacy)
  const wrongIdentity = structuredClone(legacy)
  wrongIdentity[`checkpoint:${blown}`].runId = 'wrong-account'
  await migrationCheck(wrongIdentity, 'Replay checkpoint does not match run')
  const incomplete = structuredClone(legacy)
  delete incomplete[`checkpoint:${blown}`]
  await migrationCheck(incomplete, 'Replay checkpoint is incomplete')

  await remove(blown)
  check(
    (await state()).id === null && !(await state()).ready,
    'deleting the active account leaves an explicit unselected state',
  )
  await closeManager()
  check((await page.locator('canvas').count()) === 0, 'deleted account chart and ticket are removed')
  await page.reload({ waitUntil: 'networkidle' })
  await settled()
  check(
    (await state()).id === null && (await state()).accounts.length === 4,
    'reload does not silently select or create an account',
  )
  await select(small)
  check(
    (await state()).accounts.find((item) => item.id === small).name === 'My 25K',
    'renamed account survives reload and other deletions',
  )
  await remove(small)
  await remove(medium)
  await remove(secondSmall)
  await remove(original)
  check((await state()).accounts.length === 0, 'all accounts can be deleted with confirmation')
  await closeManager()
  await page.reload({ waitUntil: 'networkidle' })
  await settled()
  check(
    (await state()).id === null && (await state()).accounts.length === 0,
    'intentionally empty catalog stays empty after reload',
  )
  await create('Fresh 100K', 100000)
  check((await state()).accounts.length === 1, 'a new account can be created after deleting the last account')
  check(errors.length === 0, `no browser errors: ${errors.join('; ')}`)
  console.log(`\nAccount check passed (${checks} checks).`)
} finally {
  await browser.close()
}
