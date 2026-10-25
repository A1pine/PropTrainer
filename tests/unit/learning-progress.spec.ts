import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia, storeToRefs } from 'pinia'
import { computed, isRef } from 'vue'
import { findLesson } from '~/domain/learning/catalog'
import {
  LEARNING_NOTE_LIMIT,
  type LearningCourse,
  type LearningLesson,
  type LearningState,
} from '~/domain/learning/types'
import {
  LEARNING_STORAGE_KEY,
  createBrowserLearningStorage,
  createLearningRepository,
  createMemoryLearningStorage,
  emptyLearningState,
  parseLearningState,
  validateLearningState,
  type LearningStorage,
} from '~/lib/learning/repository'

vi.mock('~/domain/learning/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/domain/learning/catalog')>()
  const extra: LearningCourse = {
    id: 'extra-course',
    title: { en: 'Extra course' },
    summary: { en: 'Synthetic catalog used only by learning isolation tests.' },
    chapters: [
      {
        id: 'extra-chapter',
        kind: 'curriculum',
        title: { en: 'Extra chapter' },
        lessons: [
          {
            id: 'extra-lesson',
            revision: 1,
            title: { en: 'Extra lesson' },
            summary: { en: 'A published lesson with required and optional checks.' },
            status: 'published',
            blocks: [
              {
                id: 'extra-checklist',
                type: 'checklist',
                title: { en: 'Extra checklist' },
                items: [
                  { id: 'extra-required', text: { en: 'Required item' }, required: true },
                  { id: 'extra-optional', text: { en: 'Optional item' }, required: false },
                ],
              },
            ],
          },
          {
            id: 'extra-draft',
            revision: 1,
            title: { en: 'Draft lesson' },
            summary: { en: 'A draft that must remain non-completable.' },
            status: 'draft',
            blocks: [
              { id: 'draft-text', type: 'text', paragraphs: [{ en: 'Awaiting content.' }] },
              {
                id: 'draft-checklist',
                type: 'checklist',
                title: { en: 'Draft checklist' },
                items: [{ id: 'draft-check', text: { en: 'Not official yet' }, required: true }],
              },
            ],
          },
          {
            id: 'revision-lesson',
            revision: 1,
            title: { en: 'Revision lesson' },
            summary: { en: 'Used to prove revision normalization.' },
            status: 'published',
            blocks: [
              {
                id: 'revision-checklist',
                type: 'checklist',
                title: { en: 'Revision checklist' },
                items: [
                  { id: 'revision-required', text: { en: 'Required' }, required: true },
                  { id: 'revision-optional', text: { en: 'Optional' }, required: false },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  const extraRegistry = actual.createCourseRegistry([extra])

  return {
    ...actual,
    findCourse: (courseId: string) => extraRegistry.findCourse(courseId) ?? actual.findCourse(courseId),
    findLesson: (courseId: string, lessonId: string) =>
      extraRegistry.findLesson(courseId, lessonId) ?? actual.findLesson(courseId, lessonId),
  }
})

const { useLearningStore } = await import('~/stores/learning')

const COURSE_ID = 'ict-2022-concept'
const GUIDE_ID = 'workspace-guide'
const OTHER_COURSE_ID = 'extra-course'
const OTHER_LESSON_ID = 'extra-lesson'
const DRAFT_ID = 'extra-draft'
const REVISION_LESSON_ID = 'revision-lesson'
const SETTINGS_KEY = 'propdesk.v1:settings'

function courseLesson(courseId: string, lessonId: string): LearningLesson {
  const entry = findLesson(courseId, lessonId)
  if (!entry) throw new Error(`Missing test lesson ${courseId}/${lessonId}`)
  return entry.lesson
}

const guide = courseLesson(COURSE_ID, GUIDE_ID)
const otherLesson = courseLesson(OTHER_COURSE_ID, OTHER_LESSON_ID)
const draftLesson = courseLesson(OTHER_COURSE_ID, DRAFT_ID)
const revisionLesson = courseLesson(OTHER_COURSE_ID, REVISION_LESSON_ID)

function rawProgress(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    courses: {
      [COURSE_ID]: {
        lastLessonId: GUIDE_ID,
        lessons: {
          [GUIDE_ID]: {
            revision: 1,
            note: '',
            checked: [],
            visitedAt: null,
            completedAt: null,
            ...overrides,
          },
        },
      },
    },
  }
}

function storedState(storage: LearningStorage): LearningState | null {
  const raw = storage.getItem(LEARNING_STORAGE_KEY)
  return raw === null ? null : parseLearningState(raw)
}

interface ControlledStorage {
  storage: LearningStorage
  inner: LearningStorage
  controls: {
    failRead: boolean
    failWrite: boolean
    failRemove: boolean
    reads: number
    writes: number
    removes: number
  }
}

function controlledStorage(initial: Record<string, string> = {}): ControlledStorage {
  const inner = createMemoryLearningStorage(initial)
  const controls = {
    failRead: false,
    failWrite: false,
    failRemove: false,
    reads: 0,
    writes: 0,
    removes: 0,
  }
  const storage: LearningStorage = {
    getItem(key) {
      controls.reads += 1
      if (controls.failRead) throw new Error('read blocked')
      return inner.getItem(key)
    },
    setItem(key, value) {
      controls.writes += 1
      if (controls.failWrite) throw new Error('quota exceeded')
      inner.setItem(key, value)
    },
    removeItem(key) {
      controls.removes += 1
      if (controls.failRemove) throw new Error('remove blocked')
      inner.removeItem(key)
    },
  }
  return { storage, inner, controls }
}

describe('learning repository', () => {
  it('loads an absent key as empty and round-trips a save', () => {
    const storage = createMemoryLearningStorage()
    const repository = createLearningRepository(storage)

    expect(repository.load()).toEqual({ ok: true, status: 'success', state: emptyLearningState() })
    expect(repository.save(rawProgress() as LearningState)).toEqual({ ok: true, status: 'success' })
    expect(storedState(storage)).toEqual(rawProgress())
  })

  it('reports unavailable storage instead of pretending a write succeeded', () => {
    expect(createLearningRepository(null).load().status).toBe('unavailable')
    expect(createLearningRepository(null).save(emptyLearningState()).status).toBe('unavailable')

    const storage = createMemoryLearningStorage()
    const failing: LearningStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(createLearningRepository(failing).load()).toMatchObject({ ok: false, status: 'unavailable' })
    expect(createLearningRepository(storage).save(emptyLearningState())).toEqual({ ok: true, status: 'success' })
    expect(createLearningRepository(failing).save(emptyLearningState())).toMatchObject({
      ok: false,
      status: 'unavailable',
    })
  })

  it('protects original corrupt bytes until an explicit clear', () => {
    const raw = '{"schemaVersion":2,"courses":{}}'
    const storage = createMemoryLearningStorage({ [LEARNING_STORAGE_KEY]: raw, [SETTINGS_KEY]: '{"theme":"dark"}' })
    const repository = createLearningRepository(storage)

    expect(repository.load()).toMatchObject({ ok: false, status: 'corrupt' })
    expect(repository.save(emptyLearningState())).toMatchObject({ ok: false, status: 'corrupt' })
    expect(storage.getItem(LEARNING_STORAGE_KEY)).toBe(raw)
    expect(storage.getItem(SETTINGS_KEY)).toBe('{"theme":"dark"}')

    expect(repository.clear()).toEqual({ ok: true, status: 'success' })
    expect(storage.getItem(LEARNING_STORAGE_KEY)).toBeNull()
    expect(storage.getItem(SETTINGS_KEY)).toBe('{"theme":"dark"}')
    expect(repository.save(rawProgress() as LearningState)).toEqual({ ok: true, status: 'success' })
  })

  it('keeps memory storage instances isolated', () => {
    const first = createMemoryLearningStorage()
    const second = createMemoryLearningStorage()
    first.setItem('key', 'first only')
    expect(second.getItem('key')).toBeNull()
    expect(createBrowserLearningStorage()).toBeNull()
  })

  const invalidPayloads: Array<[string, unknown]> = [
    ['malformed JSON', '{"schemaVersion":1,'],
    ['JSON null', 'null'],
    ['JSON array', '[]'],
    ['missing version', { courses: {} }],
    ['string version', { schemaVersion: '1', courses: {} }],
    ['unknown version', { schemaVersion: 2, courses: {} }],
    ['courses array', { schemaVersion: 1, courses: [] }],
    ['extra top-level field', { schemaVersion: 1, courses: {}, extra: true }],
    ['missing course field', { schemaVersion: 1, courses: { [COURSE_ID]: { lessons: {} } } }],
    ['bad last lesson', { schemaVersion: 1, courses: { [COURSE_ID]: { lastLessonId: 7, lessons: {} } } }],
    ['lessons array', { schemaVersion: 1, courses: { [COURSE_ID]: { lastLessonId: null, lessons: [] } } }],
    ['zero revision', rawProgress({ revision: 0 })],
    ['fractional revision', rawProgress({ revision: 1.5 })],
    ['unsafe integer revision', rawProgress({ revision: Number.MAX_SAFE_INTEGER + 1 })],
    ['non-string note', rawProgress({ note: null })],
    ['oversized note', rawProgress({ note: 'x'.repeat(LEARNING_NOTE_LIMIT + 1) })],
    ['too many checks', rawProgress({ checked: Array.from({ length: 501 }, (_, index) => `item-${index}`) })],
    ['non-string check', rawProgress({ checked: [2] })],
    ['blank check id', rawProgress({ checked: [' '] })],
    ['oversized check id', rawProgress({ checked: ['x'.repeat(201)] })],
    ['control character check id', rawProgress({ checked: ['check\nitem'] })],
    ['duplicate checks', rawProgress({ checked: ['read-boundary', 'read-boundary'] })],
    ['non-array checks', rawProgress({ checked: 'read-boundary' })],
    ['unsafe check id', rawProgress({ checked: ['__proto__'] })],
    ['invalid visit timestamp', rawProgress({ visitedAt: 'yesterday' })],
    ['impossible calendar date', rawProgress({ visitedAt: '2026-02-30T10:00:00.000Z' })],
    ['invalid clock time', rawProgress({ visitedAt: '2026-10-25T24:00:00.000Z' })],
    ['invalid completion timestamp', rawProgress({ completedAt: 123 })],
    ['extra progress field', rawProgress({ grade: 'A' })],
    ['prototype course key', '{"schemaVersion":1,"courses":{"__proto__":{"lastLessonId":null,"lessons":{}}}}'],
    ['prototype top-level key', '{"schemaVersion":1,"courses":{},"__proto__":{}}'],
    [
      'prototype lesson key',
      '{"schemaVersion":1,"courses":{"course":{"lastLessonId":null,"lessons":{"constructor":{"revision":1,"note":"","checked":[],"visitedAt":null,"completedAt":null}}}}}',
    ],
    [
      'prototype last lesson',
      { schemaVersion: 1, courses: { [COURSE_ID]: { lastLessonId: '__proto__', lessons: {} } } },
    ],
    [
      'too many courses',
      {
        schemaVersion: 1,
        courses: Object.fromEntries(
          Array.from({ length: 201 }, (_, index) => [`course-${index}`, { lastLessonId: null, lessons: {} }]),
        ),
      },
    ],
    [
      'too many lessons',
      {
        schemaVersion: 1,
        courses: {
          [COURSE_ID]: {
            lastLessonId: null,
            lessons: Object.fromEntries(
              Array.from({ length: 5_001 }, (_, index) => [
                `lesson-${index}`,
                rawProgress().courses[COURSE_ID].lessons[GUIDE_ID],
              ]),
            ),
          },
        },
      },
    ],
  ]

  it.each(invalidPayloads)('rejects %s', (_name, payload) => {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)
    expect(() => parseLearningState(raw)).toThrow()
    const repository = createLearningRepository(createMemoryLearningStorage({ [LEARNING_STORAGE_KEY]: raw }))
    expect(repository.load()).toMatchObject({ ok: false, status: 'corrupt' })
  })

  it('rejects malformed outgoing state without overwriting valid data', () => {
    const raw = JSON.stringify(rawProgress({ note: 'untouched' }))
    const storage = createMemoryLearningStorage({ [LEARNING_STORAGE_KEY]: raw })
    const repository = createLearningRepository(storage)
    expect(repository.load().ok).toBe(true)
    // A rejected outgoing value is not corrupt storage: the bytes on disk are
    // readable, so the caller keeps its edit and can retry after fixing it.
    expect(repository.save(rawProgress({ checked: ['prototype'] }) as LearningState)).toMatchObject({
      ok: false,
      status: 'invalid',
    })
    expect(storage.getItem(LEARNING_STORAGE_KEY)).toBe(raw)
    expect(() => validateLearningState(Object.create({ schemaVersion: 1, courses: {} }))).toThrow()
  })

  it('protects corrupt bytes before the first load and after a blocked re-read', () => {
    const raw = '{bad json'
    const { storage, inner, controls } = controlledStorage({ [LEARNING_STORAGE_KEY]: raw })
    const repository = createLearningRepository(storage)
    expect(repository.save(emptyLearningState()).status).toBe('corrupt')
    controls.failRead = true
    expect(repository.load().status).toBe('unavailable')
    expect(repository.save(emptyLearningState()).status).toBe('corrupt')
    expect(controls.writes).toBe(0)
    expect(inner.getItem(LEARNING_STORAGE_KEY)).toBe(raw)
  })

  it('accepts exact boundary values', () => {
    const state = rawProgress({
      revision: Number.MAX_SAFE_INTEGER,
      note: 'x'.repeat(LEARNING_NOTE_LIMIT),
      checked: Array.from({ length: 500 }, (_, index) => `item-${index}`),
      visitedAt: '2024-02-29T00:00:00Z',
      completedAt: '2026-10-25T10:00:00.12Z',
    })
    expect(parseLearningState(JSON.stringify(state))).toEqual(state)
  })

  it('accepts the full valid shape and copies arrays', () => {
    const raw = rawProgress({
      checked: ['read-boundary', 'try-notes'],
      visitedAt: '2026-10-25T10:00:00.000Z',
      completedAt: '2026-10-25T10:05:00.000Z',
    })
    const parsed = parseLearningState(JSON.stringify(raw))
    expect(parsed).toEqual(raw)
    const checked = parsed.courses[COURSE_ID]?.lessons[GUIDE_ID]?.checked
    checked?.push('mutated')
    expect(raw.courses[COURSE_ID].lessons[GUIDE_ID].checked).toEqual(['read-boundary', 'try-notes'])
  })
})

let pinia: ReturnType<typeof createPinia>

function openStore(storage: LearningStorage) {
  const store = useLearningStore()
  store.initialize(storage)
  return store
}

function reloadStore(storage: LearningStorage) {
  disposePinia(pinia)
  pinia = createPinia()
  setActivePinia(pinia)
  return openStore(storage)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-25T10:00:00.000Z'))
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  disposePinia(pinia)
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('learning store', () => {
  it('invalidates progress computeds when a course is first created', () => {
    const { storage } = controlledStorage()
    const store = openStore(storage)
    const progress = computed(() => store.getProgress(COURSE_ID, guide))

    expect(progress.value.checked).toEqual([])

    store.setChecked(COURSE_ID, guide, 'read-boundary', true)

    expect(progress.value.checked).toEqual(['read-boundary'])
  })

  it('exposes empty reactive SSR state and never resolves storage before client initialization', () => {
    const browserLookup = vi.fn(() => {
      throw new Error('unexpected SSR access')
    })
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('localStorage', new Proxy({}, { get: browserLookup }))
    const store = useLearningStore()
    expect(store.state).toEqual({ schemaVersion: 1, courses: {} })
    expect(isRef(storeToRefs(store).state)).toBe(true)
    expect(store.ready).toBe(false)
    store.initialize()
    store.getProgress(COURSE_ID, guide)
    store.visit(COURSE_ID, guide)
    store.setNote(COURSE_ID, guide, 'not initialized')
    expect(browserLookup).not.toHaveBeenCalled()
    expect(store.state).toEqual({ schemaVersion: 1, courses: {} })
    expect(store.ready).toBe(false)

    const { storage, controls } = controlledStorage()
    vi.stubGlobal('window', { localStorage: storage })
    store.initialize()
    store.initialize()
    expect(store.ready).toBe(true)
    expect(controls.reads).toBe(1)
    expect(controls.writes).toBe(0)
    expect(store.storageStatus).toBe('idle')
  })

  it('retries a blocked localStorage getter and saves the latest in-memory note', () => {
    const { storage, controls } = controlledStorage()
    const browserWindow = Object.defineProperty({}, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked getter')
      },
    })
    vi.stubGlobal('window', browserWindow)
    const store = useLearningStore()
    expect(store.ready).toBe(false)
    store.initialize()
    expect(store.storageStatus).toBe('unavailable')
    store.setNote(COURSE_ID, guide, 'memory note')
    store.retry()
    expect(store.storageStatus).toBe('unavailable')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('memory note')
    Object.defineProperty(browserWindow, 'localStorage', { value: storage })
    store.retry()
    expect(store.storageStatus).toBe('saved')
    expect(controls.writes).toBe(1)
    expect(storedState(storage)?.courses[COURSE_ID]?.lessons[GUIDE_ID]?.note).toBe('memory note')
  })

  it('starts empty, idle and only reports saved after a successful write', () => {
    const { storage, controls } = controlledStorage()
    const store = openStore(storage)

    expect(store.ready).toBe(true)
    expect(store.storageStatus).toBe('idle')
    expect(controls.writes).toBe(0)
    expect(store.getProgress(COURSE_ID, guide)).toEqual({
      revision: 1,
      note: '',
      checked: [],
      visitedAt: null,
      completedAt: null,
    })
    expect(store.lastLesson(COURSE_ID)).toBeNull()

    store.visit(COURSE_ID, guide)
    expect(store.storageStatus).toBe('saved')
    expect(controls.writes).toBe(1)
    expect(store.lastLesson(COURSE_ID)).toBe(GUIDE_ID)
    expect(store.getProgress(COURSE_ID, guide).completedAt).toBeNull()
  })

  it('reloads visits, notes, checks and completion from isolated course/lesson keys', () => {
    const storage = createMemoryLearningStorage()
    let store = openStore(storage)

    store.visit(COURSE_ID, guide)
    store.setNote(COURSE_ID, guide, 'guide note')
    store.setChecked(COURSE_ID, guide, 'read-boundary', true)
    store.setChecked(COURSE_ID, guide, 'try-notes', true)
    store.setCompleted(COURSE_ID, guide, true)

    store.visit(OTHER_COURSE_ID, otherLesson)
    store.setNote(OTHER_COURSE_ID, otherLesson, 'other note')
    store.setChecked(OTHER_COURSE_ID, otherLesson, 'extra-optional', true)

    expect(store.getProgress(COURSE_ID, guide).note).toBe('guide note')
    expect(store.getProgress(OTHER_COURSE_ID, otherLesson).note).toBe('other note')
    expect(store.lastLesson(COURSE_ID)).toBe(GUIDE_ID)
    expect(store.lastLesson(OTHER_COURSE_ID)).toBe(OTHER_LESSON_ID)

    store = reloadStore(storage)
    expect(store.storageStatus).toBe('idle')
    expect(store.getProgress(COURSE_ID, guide)).toMatchObject({
      note: 'guide note',
      checked: ['read-boundary', 'try-notes'],
      completedAt: '2026-10-25T10:00:00.000Z',
    })
    expect(store.getProgress(OTHER_COURSE_ID, otherLesson)).toMatchObject({
      note: 'other note',
      checked: ['extra-optional'],
      completedAt: null,
    })
    expect(store.lastLesson(COURSE_ID)).toBe(GUIDE_ID)
    expect(store.lastLesson(OTHER_COURSE_ID)).toBe(OTHER_LESSON_ID)

    const snapshot = storedState(storage)!
    expect(snapshot.courses[COURSE_ID]?.lessons[GUIDE_ID]?.note).toBe('guide note')
    expect(snapshot.courses[OTHER_COURSE_ID]?.lessons[OTHER_LESSON_ID]?.note).toBe('other note')
  })

  it('normalizes a revision change on read without mutating storage', () => {
    const storage = createMemoryLearningStorage()
    const store = openStore(storage)

    store.visit(OTHER_COURSE_ID, revisionLesson)
    store.setNote(OTHER_COURSE_ID, revisionLesson, 'survives revision')
    store.setChecked(OTHER_COURSE_ID, revisionLesson, 'revision-required', true)
    store.setChecked(OTHER_COURSE_ID, revisionLesson, 'revision-optional', true)
    store.setCompleted(OTHER_COURSE_ID, revisionLesson, true)
    const before = storage.getItem(LEARNING_STORAGE_KEY)

    const originalRevision = revisionLesson.revision
    try {
      revisionLesson.revision = originalRevision + 1
      const normalized = store.getProgress(OTHER_COURSE_ID, revisionLesson)
      expect(normalized).toMatchObject({
        revision: originalRevision + 1,
        note: 'survives revision',
        checked: [],
        completedAt: null,
        visitedAt: '2026-10-25T10:00:00.000Z',
      })
      expect(storage.getItem(LEARNING_STORAGE_KEY)).toBe(before)
      expect(store.state.courses[OTHER_COURSE_ID]?.lessons[REVISION_LESSON_ID]?.revision).toBe(originalRevision)
      normalized.note = 'mutating a returned value must not change state'
      normalized.checked.push('revision-required')
      const derived = computed(() => store.getProgress(OTHER_COURSE_ID, revisionLesson))
      expect(derived.value).toMatchObject({ note: 'survives revision', checked: [] })
      expect(storage.getItem(LEARNING_STORAGE_KEY)).toBe(before)

      store.visit(OTHER_COURSE_ID, revisionLesson)
      const persisted = storedState(storage)!.courses[OTHER_COURSE_ID]?.lessons[REVISION_LESSON_ID]
      expect(persisted).toMatchObject({
        revision: originalRevision + 1,
        note: 'survives revision',
        checked: [],
        completedAt: null,
      })
    } finally {
      revisionLesson.revision = originalRevision
    }
  })

  it('requires published content and every required check for manual completion', () => {
    const store = openStore(createMemoryLearningStorage())

    store.setChecked(COURSE_ID, guide, 'read-boundary', true)
    store.setCompleted(COURSE_ID, guide, true)
    expect(store.getProgress(COURSE_ID, guide).completedAt).toBeNull()

    store.setChecked(COURSE_ID, guide, 'try-notes', true)
    store.setCompleted(COURSE_ID, guide, true)
    expect(store.getProgress(COURSE_ID, guide).completedAt).toBe('2026-10-25T10:00:00.000Z')

    store.setChecked(COURSE_ID, guide, 'read-boundary', false)
    expect(store.getProgress(COURSE_ID, guide)).toMatchObject({
      checked: ['try-notes'],
      completedAt: null,
    })

    store.setChecked(COURSE_ID, guide, 'read-boundary', true)
    expect(store.getProgress(COURSE_ID, guide).completedAt).toBeNull()
    store.setCompleted(COURSE_ID, guide, true)
    expect(store.getProgress(COURSE_ID, guide).completedAt).not.toBeNull()
    store.setCompleted(COURSE_ID, guide, false)
    expect(store.getProgress(COURSE_ID, guide).completedAt).toBeNull()
    expect(store.getProgress(COURSE_ID, guide).checked).toEqual(['read-boundary', 'try-notes'])
  })

  it('keeps completion when only an optional check is removed', () => {
    const store = openStore(createMemoryLearningStorage())

    store.setChecked(OTHER_COURSE_ID, otherLesson, 'extra-required', true)
    store.setCompleted(OTHER_COURSE_ID, otherLesson, true)
    expect(store.getProgress(OTHER_COURSE_ID, otherLesson).completedAt).not.toBeNull()

    store.setChecked(OTHER_COURSE_ID, otherLesson, 'extra-optional', true)
    store.setChecked(OTHER_COURSE_ID, otherLesson, 'extra-optional', false)
    expect(store.getProgress(OTHER_COURSE_ID, otherLesson)).toMatchObject({
      checked: ['extra-required'],
      completedAt: '2026-10-25T10:00:00.000Z',
    })

    store.setChecked(OTHER_COURSE_ID, otherLesson, 'extra-required', false)
    expect(store.getProgress(OTHER_COURSE_ID, otherLesson).completedAt).toBeNull()
  })

  it('allows notes on drafts but never checks or completion', () => {
    const store = openStore(createMemoryLearningStorage())

    store.setNote(OTHER_COURSE_ID, draftLesson, 'draft observation')
    store.setChecked(OTHER_COURSE_ID, draftLesson, 'draft-check', true)
    store.setCompleted(OTHER_COURSE_ID, draftLesson, true)
    store.visit(OTHER_COURSE_ID, draftLesson)

    expect(store.getProgress(OTHER_COURSE_ID, draftLesson)).toMatchObject({
      note: 'draft observation',
      checked: [],
      completedAt: null,
    })
    expect(store.lastLesson(OTHER_COURSE_ID)).toBe(DRAFT_ID)
  })

  it('isolates notes by lesson within the same course and ignores caller-supplied status', () => {
    const store = openStore(createMemoryLearningStorage())
    store.setNote(OTHER_COURSE_ID, otherLesson, 'published note')
    store.setNote(OTHER_COURSE_ID, draftLesson, 'draft note')
    store.visit(OTHER_COURSE_ID, otherLesson)
    store.visit(OTHER_COURSE_ID, draftLesson)
    store.setChecked(OTHER_COURSE_ID, { ...draftLesson, status: 'published' }, 'draft-check', true)
    store.setCompleted(OTHER_COURSE_ID, { ...draftLesson, status: 'published', blocks: [] }, true)

    expect(store.getProgress(OTHER_COURSE_ID, otherLesson).note).toBe('published note')
    expect(store.getProgress(OTHER_COURSE_ID, draftLesson)).toMatchObject({
      note: 'draft note',
      checked: [],
      completedAt: null,
    })
    expect(store.lastLesson(OTHER_COURSE_ID)).toBe(DRAFT_ID)
  })

  it('does not trust stored draft completion or unknown checklist IDs', () => {
    const state = emptyLearningState()
    state.courses[OTHER_COURSE_ID] = {
      lastLessonId: DRAFT_ID,
      lessons: {
        [DRAFT_ID]: {
          revision: 1,
          note: 'keep draft note',
          checked: ['draft-check'],
          visitedAt: null,
          completedAt: '2026-10-25T10:00:00.000Z',
        },
        [OTHER_LESSON_ID]: {
          revision: 1,
          note: 'keep published note',
          checked: ['removed-check'],
          visitedAt: null,
          completedAt: '2026-10-25T10:00:00.000Z',
        },
      },
    }
    const raw = JSON.stringify(state)
    const storage = createMemoryLearningStorage({ [LEARNING_STORAGE_KEY]: raw })
    const store = openStore(storage)
    expect(store.getProgress(OTHER_COURSE_ID, draftLesson)).toMatchObject({
      note: 'keep draft note',
      checked: [],
      completedAt: null,
    })
    expect(store.getProgress(OTHER_COURSE_ID, otherLesson)).toMatchObject({
      note: 'keep published note',
      checked: [],
      completedAt: null,
    })
    expect(storage.getItem(LEARNING_STORAGE_KEY)).toBe(raw)
  })

  it('ignores unknown courses, lessons and checklist items without writing', () => {
    const { storage, controls } = controlledStorage()
    const store = openStore(storage)
    const writes = controls.writes

    store.visit('missing-course', guide)
    store.visit(COURSE_ID, { ...guide, id: 'missing-lesson' })
    store.setNote('missing-course', guide, 'ignored')
    store.setNote(COURSE_ID, { ...guide, id: 'missing-lesson' }, 'ignored')
    store.setChecked(COURSE_ID, guide, 'missing-check', true)
    store.setChecked(COURSE_ID, guide, 'constructor', true)
    store.setCompleted(COURSE_ID, guide, true)

    expect(controls.writes).toBe(writes)
    expect(store.lastLesson('missing-course')).toBeNull()
    expect(store.getProgress('missing-course', guide)).toEqual({
      revision: 1,
      note: '',
      checked: [],
      visitedAt: null,
      completedAt: null,
    })

    const ghostState = emptyLearningState()
    ghostState.courses[COURSE_ID] = {
      lastLessonId: 'removed-lesson',
      lessons: {
        'removed-lesson': { revision: 1, note: 'orphan note', checked: [], visitedAt: null, completedAt: null },
      },
    }
    const orphanStorage = createMemoryLearningStorage({ [LEARNING_STORAGE_KEY]: JSON.stringify(ghostState) })
    const ghost = reloadStore(orphanStorage)
    expect(ghost.lastLesson(COURSE_ID)).toBeNull()
    expect(ghost.getProgress(COURSE_ID, guide).note).toBe('')
    ghost.setNote(COURSE_ID, guide, 'new guide note')
    expect(storedState(orphanStorage)?.courses[COURSE_ID]?.lessons['removed-lesson']?.note).toBe('orphan note')
  })

  it('keeps notes in memory across quota failures and persists the latest on retry', () => {
    const { storage, controls } = controlledStorage()
    const store = openStore(storage)
    expect(store.storageStatus).toBe('idle')

    controls.failWrite = true
    store.setNote(COURSE_ID, guide, 'first draft')
    expect(store.storageStatus).toBe('unavailable')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('first draft')
    store.setNote(COURSE_ID, guide, 'latest draft')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('latest draft')
    expect(storage.getItem(LEARNING_STORAGE_KEY)).toBeNull()

    store.retry()
    expect(store.storageStatus).toBe('unavailable')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('latest draft')

    controls.failWrite = false
    store.retry()
    expect(store.storageStatus).toBe('saved')
    expect(storedState(storage)!.courses[COURSE_ID]?.lessons[GUIDE_ID]?.note).toBe('latest draft')
  })

  it('re-reads storage after a read failure without writing over unknown data', () => {
    const seeded = rawProgress({ note: 'already on disk' })
    const { storage, controls } = controlledStorage({
      [LEARNING_STORAGE_KEY]: JSON.stringify(seeded),
    })
    controls.failRead = true

    const store = openStore(storage)
    expect(store.ready).toBe(true)
    expect(store.storageStatus).toBe('unavailable')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('')

    store.visit(COURSE_ID, guide)
    expect(controls.writes).toBe(0)
    expect(store.storageStatus).toBe('unavailable')

    controls.failRead = false
    store.retry()
    expect(store.storageStatus).toBe('saved')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('already on disk')
    expect(store.getProgress(COURSE_ID, guide).visitedAt).toBe('2026-10-25T10:00:00.000Z')
  })

  it('merges edits after a blocked read without losing other persisted lessons', () => {
    const state = rawProgress({ note: 'old guide note', checked: ['read-boundary', 'try-notes'] }) as LearningState
    state.courses[OTHER_COURSE_ID] = {
      lastLessonId: OTHER_LESSON_ID,
      lessons: {
        [OTHER_LESSON_ID]: { revision: 1, note: 'unrelated note', checked: [], visitedAt: null, completedAt: null },
      },
    }
    const { storage, inner, controls } = controlledStorage({ [LEARNING_STORAGE_KEY]: JSON.stringify(state) })
    controls.failRead = true
    const store = openStore(storage)
    store.setNote(COURSE_ID, guide, 'new guide note')
    store.setChecked(COURSE_ID, guide, 'read-boundary', false)
    store.retry()
    expect(store.getProgress(COURSE_ID, guide).note).toBe('new guide note')
    expect(controls.writes).toBe(0)
    controls.failRead = false
    store.retry()
    expect(store.storageStatus).toBe('saved')
    expect(store.getProgress(COURSE_ID, guide)).toMatchObject({ note: 'new guide note', checked: ['try-notes'] })
    expect(store.getProgress(OTHER_COURSE_ID, otherLesson).note).toBe('unrelated note')
    expect(storedState(inner)?.courses[OTHER_COURSE_ID]?.lessons[OTHER_LESSON_ID]?.note).toBe('unrelated note')
  })

  it('does not restore pending checks after the catalog revision changes during read failure', () => {
    const { storage, controls } = controlledStorage()
    controls.failRead = true
    const store = openStore(storage)
    store.setNote(OTHER_COURSE_ID, revisionLesson, 'pending note')
    store.setChecked(OTHER_COURSE_ID, revisionLesson, 'revision-required', true)
    store.setCompleted(OTHER_COURSE_ID, revisionLesson, true)
    const originalRevision = revisionLesson.revision
    try {
      revisionLesson.revision += 1
      controls.failRead = false
      store.retry()
      expect(store.getProgress(OTHER_COURSE_ID, revisionLesson)).toMatchObject({
        revision: originalRevision + 1,
        note: 'pending note',
        checked: [],
        completedAt: null,
      })
    } finally {
      revisionLesson.revision = originalRevision
    }
  })

  it('never auto-writes corrupt bytes and re-reads them only when retry succeeds', () => {
    const corrupt = '{"schemaVersion":1,"courses":'
    const { storage, controls } = controlledStorage({ [LEARNING_STORAGE_KEY]: corrupt })
    const store = openStore(storage)

    expect(store.storageStatus).toBe('corrupt')
    store.visit(COURSE_ID, guide)
    store.setNote(COURSE_ID, guide, 'memory only')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('memory only')
    expect(controls.writes).toBe(0)
    expect(storage.getItem(LEARNING_STORAGE_KEY)).toBe(corrupt)

    store.retry()
    expect(store.storageStatus).toBe('corrupt')
    expect(storage.getItem(LEARNING_STORAGE_KEY)).toBe(corrupt)

    const recovered = rawProgress({ note: 'recovered from disk' })
    storage.setItem(LEARNING_STORAGE_KEY, JSON.stringify(recovered))
    store.retry()
    expect(store.storageStatus).toBe('idle')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('recovered from disk')
  })

  it('resets only learning data after confirmation-level reset', () => {
    const state = rawProgress({ note: 'to be removed' })
    const storage = createMemoryLearningStorage({
      [LEARNING_STORAGE_KEY]: JSON.stringify(state),
      [SETTINGS_KEY]: '{"theme":"light"}',
      'propdesk.v1:accounts': '{"accounts":[]}',
    })
    const store = openStore(storage)
    expect(store.storageStatus).toBe('idle')

    store.reset()
    expect(store.storageStatus).toBe('idle')
    expect(store.ready).toBe(true)
    expect(store.getProgress(COURSE_ID, guide).note).toBe('')
    expect(store.lastLesson(COURSE_ID)).toBeNull()
    expect(storage.getItem(LEARNING_STORAGE_KEY)).toBeNull()
    expect(storage.getItem(SETTINGS_KEY)).toBe('{"theme":"light"}')
    expect(storage.getItem('propdesk.v1:accounts')).toBe('{"accounts":[]}')
  })

  it('reports reset failures and retries the removal without touching other keys', () => {
    const raw = JSON.stringify(rawProgress({ note: 'keep until removal works' }))
    const { storage, inner, controls } = controlledStorage({
      [LEARNING_STORAGE_KEY]: raw,
      [SETTINGS_KEY]: '{"theme":"dark"}',
    })
    const store = openStore(storage)
    controls.failRemove = true

    store.reset()
    expect(store.storageStatus).toBe('unavailable')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('')
    expect(inner.getItem(LEARNING_STORAGE_KEY)).toBe(raw)

    controls.failRemove = false
    store.retry()
    expect(store.storageStatus).toBe('idle')
    expect(inner.getItem(LEARNING_STORAGE_KEY)).toBeNull()
    expect(inner.getItem(SETTINGS_KEY)).toBe('{"theme":"dark"}')
  })

  it('preserves corrupt bytes through reset errors and saves edits made after reset', () => {
    const corrupt = '{"schemaVersion":99}'
    const { storage, inner, controls } = controlledStorage({
      [LEARNING_STORAGE_KEY]: corrupt,
      [SETTINGS_KEY]: 'untouched',
    })
    const store = openStore(storage)
    expect(store.storageStatus).toBe('corrupt')
    controls.failRemove = true
    store.reset()
    store.setNote(COURSE_ID, guide, 'after confirmed reset')
    store.retry()
    expect(inner.getItem(LEARNING_STORAGE_KEY)).toBe(corrupt)
    expect(store.storageStatus).toBe('unavailable')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('after confirmed reset')
    controls.failRemove = false
    controls.failWrite = true
    store.retry()
    expect(inner.getItem(LEARNING_STORAGE_KEY)).toBeNull()
    expect(store.storageStatus).toBe('unavailable')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('after confirmed reset')
    controls.failWrite = false
    store.retry()
    expect(store.storageStatus).toBe('saved')
    expect(storedState(inner)?.courses[COURSE_ID]?.lessons[GUIDE_ID]?.note).toBe('after confirmed reset')
    expect(inner.getItem(SETTINGS_KEY)).toBe('untouched')
  })

  it('clamps notes to the shared limit', () => {
    const storage = createMemoryLearningStorage()
    const store = openStore(storage)
    const huge = 'x'.repeat(LEARNING_NOTE_LIMIT + 50)

    store.setNote(COURSE_ID, guide, huge)
    expect(store.getProgress(COURSE_ID, guide).note).toHaveLength(LEARNING_NOTE_LIMIT)
    expect(storedState(storage)!.courses[COURSE_ID]?.lessons[GUIDE_ID]?.note).toHaveLength(LEARNING_NOTE_LIMIT)
  })

  it('does not write or change status for repeated idle retries', () => {
    const { storage, controls } = controlledStorage()
    const store = openStore(storage)
    store.retry()
    store.retry()
    expect(store.storageStatus).toBe('idle')
    expect(controls.writes).toBe(0)
    expect(controls.reads).toBe(1)
  })

  it('does not share module-level memory between stores', () => {
    const first = openStore(createMemoryLearningStorage())
    first.setNote(COURSE_ID, guide, 'first store')
    const secondPinia = createPinia()
    try {
      const second = useLearningStore(secondPinia)
      second.initialize(createMemoryLearningStorage())

      expect(first.getProgress(COURSE_ID, guide).note).toBe('first store')
      expect(second.getProgress(COURSE_ID, guide).note).toBe('')
      expect(second.state).toEqual({ schemaVersion: 1, courses: {} })
    } finally {
      disposePinia(secondPinia)
      setActivePinia(pinia)
    }
  })

  it('keeps an edit in memory when the outgoing state is rejected', () => {
    const { storage, controls } = controlledStorage()
    const store = openStore(storage)

    // Simulate state that validation rejects (a reserved course key) without
    // going through the catalog, which now blocks such IDs at registration.
    store.state.courses.constructor = {
      lastLessonId: null,
      lessons: { [GUIDE_ID]: { revision: 1, note: 'x', checked: [], visitedAt: null, completedAt: null } },
    }

    store.setNote(COURSE_ID, guide, 'must survive retry')
    expect(store.storageStatus).toBe('invalid')
    expect(store.getProgress(COURSE_ID, guide).note).toBe('must survive retry')
    // Nothing was written: the repository rejected the state before touching
    // storage, so the previous value is still intact.
    expect(controls.writes).toBe(0)

    // Retry must not reload disk state and discard the pending edit.
    store.retry()
    expect(store.getProgress(COURSE_ID, guide).note).toBe('must survive retry')
    expect(store.storageStatus).toBe('invalid')

    // Removing the offending key lets the next write succeed normally.
    delete store.state.courses.constructor
    store.retry()
    expect(store.storageStatus).toBe('saved')
    expect(storedState(storage)!.courses[COURSE_ID]?.lessons[GUIDE_ID]?.note).toBe('must survive retry')
  })
})
