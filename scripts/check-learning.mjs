import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const OUT = 'screenshots/learning'
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
let checks = 0
const errors = []
function check(condition, message) {
  assert.ok(condition, message)
  checks += 1
  console.log(`ok   ${message}`)
}
function track(page) {
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
}

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
const page = await context.newPage()
track(page)

await page.goto(`${BASE}/learn`, { waitUntil: 'networkidle' })
check((await page.getByRole('main').locator('h1').innerText()) === 'Learning', 'library has one truthful page title')
check((await page.getByTestId('open-course').count()) === 1, 'library lists exactly one course')
check(
  (await page.locator('body').innerText()).includes('0 of 14 published chapters complete'),
  'library reports the supplied curriculum without inventing progress',
)
await page.getByTestId('open-course').click()
await page.waitForURL(`${BASE}/learn/ict-2022-concept`)
await page.getByRole('main').getByRole('heading', { name: 'ICT 2022 Concept', level: 1 }).waitFor()
await page.locator('[data-lesson-link="workspace-guide"]').waitFor()
check((await page.getByRole('main').locator('h1').innerText()) === 'ICT 2022 Concept', 'course overview opens')
check((await page.locator('[data-lesson-link="workspace-guide"]').count()) === 1, 'overview lists the guide once')
check((await page.locator('[data-lesson-link^="chapter-"]').count()) === 14, 'overview lists all 14 supplied chapters')
check(
  (await page.locator('body').innerText()).includes('0 of 14 published chapters complete'),
  'overview starts with zero completed chapters',
)

await page.locator('[data-lesson-link="workspace-guide"]').click()
await page.waitForURL(`${BASE}/learn/ict-2022-concept/workspace-guide`)
await page.getByText('A platform guide, not an ICT lesson').waitFor()
await page.waitForTimeout(400)
check(
  (await page.getByText('A platform guide, not an ICT lesson').count()) === 1,
  'workspace guide is explicitly not course teaching',
)
check(
  (await page.locator('[data-lesson-link="workspace-guide"]').count()) === 2,
  'lesson page exposes the outline on desktop and mobile',
)
check(await page.getByTestId('learning-complete').isDisabled(), 'completion is gated before required checks')

const note = page.getByTestId('learning-note')
await note.fill('Watched the open, then the retracement. Check the 15m close next time.')
await page.locator('[data-check-id="read-boundary"]').check()
await page.waitForTimeout(60)
await page.locator('[data-check-id="try-notes"]').check()
await page.waitForTimeout(60)
await page.waitForFunction(() => {
  const button = document.querySelector('[data-testid="learning-complete"]')
  return button instanceof HTMLButtonElement && !button.disabled
})
check(!(await page.getByTestId('learning-complete').isDisabled()), 'required checks enable completion')
await page.getByTestId('learning-complete').click()
await page.getByTestId('learning-reopen').waitFor()
await page.reload({ waitUntil: 'networkidle' })
check(
  (await page.getByTestId('learning-reopen').innerText()).includes('Reopen lesson'),
  'completed state survives reload',
)
check(await page.locator('[data-check-id="read-boundary"]').isChecked(), 'checked state survives reload')
check((await page.getByTestId('learning-note').inputValue()).includes('retracement'), 'note persists across reload')

const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('propdesk.learning.v1') ?? '{}'))
check(
  stored.schemaVersion === 1 && stored.courses['ict-2022-concept'].lessons['workspace-guide'].note.length > 0,
  'learning state is stored under its own versioned key',
)
await page.goto(`${BASE}/learn/ict-2022-concept`, { waitUntil: 'networkidle' })
check(
  (await page.locator('body').innerText()).includes('0 of 14 published chapters complete'),
  'guide completion does not create curriculum progress',
)

await page.locator('[data-lesson-link="chapter-01"]').click()
await page.waitForURL(`${BASE}/learn/ict-2022-concept/chapter-01`)
await page
  .getByRole('main')
  .getByRole('heading', { name: 'Chapter 1: Course framework and trading basics', level: 1 })
  .waitFor()
check((await page.locator('[data-check-id]').count()) === 2, 'a supplied chapter exposes its self-check items')
check(
  (await page.locator('body').innerText()).includes('Practice is not configured yet'),
  'a supplied chapter keeps practice explicitly pending',
)
check(await page.getByTestId('learning-complete').isDisabled(), 'chapter completion stays gated before checks')
await page.locator('[data-check-id="explain"]').check()
await page.waitForTimeout(60)
await page.locator('[data-check-id="review-example"]').check()
await page.waitForTimeout(60)
await page.getByTestId('learning-complete').click()
await page.getByTestId('learning-reopen').waitFor()
await page.reload({ waitUntil: 'networkidle' })
check(
  (await page.getByTestId('learning-reopen').innerText()).includes('Reopen lesson'),
  'chapter completion survives reload',
)
await page.goto(`${BASE}/learn/ict-2022-concept`, { waitUntil: 'networkidle' })
check(
  (await page.locator('body').innerText()).includes('1 of 14 published chapters complete'),
  'completed chapter counts toward curriculum progress',
)
await page.goto(`${BASE}/learn/ict-2022-concept/chapter-03`, { waitUntil: 'networkidle' })
await page
  .getByRole('main')
  .getByRole('heading', { name: 'Chapter 3: Identifying and locating liquidity', level: 1 })
  .waitFor()
check((await page.locator('iframe').count()) === 0, 'supplied video stays unloaded until requested')
check(
  (await page.getByRole('button', { name: 'Load video' }).count()) === 1,
  'supplied video offers an explicit load action',
)
await page.getByTestId('learning-note').fill('Questions for the owner: which session, which example set?')
await page.reload({ waitUntil: 'networkidle' })
check((await page.getByTestId('learning-note').inputValue()).includes('which session'), 'chapter notes persist')

await page.goto(`${BASE}/learn/ict-2022-concept/not-a-lesson`, { waitUntil: 'networkidle' })
await page.getByRole('main').getByRole('heading', { name: 'Course not found', level: 1 }).waitFor()
check(
  (await page.getByRole('main').locator('h1').innerText()) === 'Course not found',
  'unknown lesson has a recoverable not-found view',
)

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
const small = await mobile.newPage()
track(small)
await small.goto(`${BASE}/learn/ict-2022-concept/workspace-guide`, { waitUntil: 'networkidle' })
check(
  (await small.evaluate(() => document.documentElement.classList.contains('dark'))) === true,
  'learning page follows dark mode',
)
check(
  await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  'mobile learning page has no horizontal overflow',
)
const disclosure = small.locator('.academy-outline-disclosure')
check(await disclosure.isVisible(), 'mobile course outline is a disclosure')
await disclosure.locator('summary').click()
check(
  await disclosure.locator('[data-lesson-link="chapter-01"]').isVisible(),
  'mobile disclosure reaches the supplied chapters',
)
await small.screenshot({ path: `${OUT}/lesson-mobile-dark.png`, fullPage: true })

const narrow = await browser.newContext({ viewport: { width: 320, height: 640 } })
const tiny = await narrow.newPage()
track(tiny)
await tiny.goto(`${BASE}/learn/ict-2022-concept/workspace-guide`, { waitUntil: 'networkidle' })
check(
  await tiny.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  '320px lesson has no horizontal overflow',
)
await tiny.getByTestId('learning-complete').scrollIntoViewIfNeeded()
const button = await tiny.getByTestId('learning-complete').boundingBox()
check(
  button !== null && button.y + button.height <= 640,
  '320px completion action stays inside the viewport after scrolling',
)
await tiny.screenshot({ path: `${OUT}/lesson-320.png`, fullPage: false })

const desktopDark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })
const dark = await desktopDark.newPage()
track(dark)
await dark.goto(`${BASE}/learn/ict-2022-concept`, { waitUntil: 'networkidle' })
await dark.screenshot({ path: `${OUT}/overview-dark.png`, fullPage: true })
check(
  (await dark.getByRole('main').getByRole('heading', { name: 'ICT 2022 Concept', level: 1 }).count()) === 1,
  'dark overview stays readable',
)

const corrupt = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const broken = await corrupt.newPage()
track(broken)
await broken.addInitScript(() => localStorage.setItem('propdesk.learning.v1', '{not-json'))
await broken.goto(`${BASE}/learn/ict-2022-concept/workspace-guide`, { waitUntil: 'networkidle' })
check(
  await broken.getByTestId('learning-storage-warning').isVisible(),
  'corrupt learning storage is reported, not overwritten',
)
check(
  (await broken.getByTestId('learning-note').getAttribute('readonly')) !== null,
  'corrupt storage disables editing rather than pretending to save',
)
const corruptBytes = await broken.evaluate(() => localStorage.getItem('propdesk.learning.v1'))
check(corruptBytes === '{not-json', 'corrupt bytes are preserved for recovery')
broken.on('dialog', (dialog) => dialog.accept())
await broken.getByRole('button', { name: 'Reset learning data' }).click()
check((await broken.getByTestId('learning-storage-warning').count()) === 0, 'explicit reset clears the blocked state')
check(
  (await broken.evaluate(() => localStorage.getItem('propdesk.learning.v1'))) === null,
  'reset removes only the learning key',
)

check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
await browser.close()
console.log(`\nLearning check passed (${checks} checks).`)
