import { isReservedId } from '~/domain/learning/ids'
import { MAX_CHECKED_ITEMS, MAX_COURSES, MAX_ID_LENGTH, MAX_LESSONS_PER_COURSE } from '~/domain/learning/limits'
import {
  LEARNING_NOTE_LIMIT,
  type CourseProgress,
  type LearningState,
  type LessonProgress,
} from '~/domain/learning/types'

export const LEARNING_STORAGE_KEY = 'propdesk.learning.v1'
export const LEARNING_SCHEMA_VERSION = 1 as const

const MAX_TIMESTAMP_LENGTH = 40

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/** The small part of Web Storage the learning repository needs. */
export interface LearningStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type LearningPersistenceStatus = 'success' | 'corrupt' | 'unavailable'

export type LearningLoadResult =
  | { ok: true; status: 'success'; state: LearningState }
  | { ok: false; status: 'corrupt' | 'unavailable'; error: string }

export type LearningWriteResult =
  | { ok: true; status: 'success' }
  /**
   * `corrupt` means the stored bytes cannot be read. `invalid` means the state
   * we were asked to write is rejected by validation — the stored bytes are
   * fine, so callers must keep their in-memory edit instead of reloading.
   */
  | { ok: false; status: 'corrupt' | 'invalid' | 'unavailable'; error: string }

export interface LearningRepository {
  load(): LearningLoadResult
  save(state: LearningState): LearningWriteResult
  clear(): LearningWriteResult
}

class LearningDataError extends Error {}

function fail(message: string): never {
  throw new LearningDataError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertRecord(value: unknown, context: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(`${context} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail(`${context} must be a plain object`)
}

function assertExactFields(value: Record<string, unknown>, expected: readonly string[], context: string): void {
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) {
      fail(`${context} has an unexpected field: ${key}`)
    }
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(`${context} is missing the field: ${key}`)
    }
  }
}

function isSafeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    value.length <= MAX_ID_LENGTH &&
    !isReservedId(value) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function assertSafeId(value: unknown, context: string): asserts value is string {
  if (!isSafeId(value)) fail(`${context} is not a safe identifier`)
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_TIMESTAMP_LENGTH || !TIMESTAMP_PATTERN.test(value)) {
    return false
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return false
  const canonical = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`,
  )
  return new Date(timestamp).toISOString() === canonical
}

function assertTimestampOrNull(value: unknown, context: string): asserts value is string | null {
  if (value !== null && !isTimestamp(value)) fail(`${context} must be an ISO timestamp or null`)
}

function parseLessonProgress(value: unknown, context: string): LessonProgress {
  assertRecord(value, context)
  assertExactFields(value, ['revision', 'note', 'checked', 'visitedAt', 'completedAt'], context)

  const { revision, note, checked, visitedAt, completedAt } = value
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
    fail(`${context}.revision must be a positive integer`)
  }
  if (typeof note !== 'string' || note.length > LEARNING_NOTE_LIMIT) {
    fail(`${context}.note must be a bounded string`)
  }
  if (!Array.isArray(checked) || checked.length > MAX_CHECKED_ITEMS) {
    fail(`${context}.checked must be a bounded array`)
  }

  const seen = new Set<string>()
  const normalizedChecked: string[] = []
  for (const [index, itemId] of checked.entries()) {
    assertSafeId(itemId, `${context}.checked[${index}]`)
    if (seen.has(itemId)) fail(`${context}.checked contains a duplicate identifier`)
    seen.add(itemId)
    normalizedChecked.push(itemId)
  }

  assertTimestampOrNull(visitedAt, `${context}.visitedAt`)
  assertTimestampOrNull(completedAt, `${context}.completedAt`)

  return {
    revision,
    note,
    checked: normalizedChecked,
    visitedAt,
    completedAt,
  }
}

function parseCourseProgress(value: unknown, context: string): CourseProgress {
  assertRecord(value, context)
  assertExactFields(value, ['lastLessonId', 'lessons'], context)

  const { lastLessonId, lessons } = value
  if (lastLessonId !== null) assertSafeId(lastLessonId, `${context}.lastLessonId`)
  assertRecord(lessons, `${context}.lessons`)

  const lessonIds = Object.keys(lessons)
  if (lessonIds.length > MAX_LESSONS_PER_COURSE) fail(`${context}.lessons exceeds the lesson limit`)

  const normalizedLessons: Record<string, LessonProgress> = {}
  for (const lessonId of lessonIds) {
    assertSafeId(lessonId, `${context}.lessons key`)
    normalizedLessons[lessonId] = parseLessonProgress(
      lessons[lessonId],
      `${context}.lessons[${JSON.stringify(lessonId)}]`,
    )
  }

  return { lastLessonId, lessons: normalizedLessons }
}

/** Validate and copy an arbitrary value into the schemaVersion 1 shape. */
export function validateLearningState(value: unknown): LearningState {
  assertRecord(value, 'learning state')
  assertExactFields(value, ['schemaVersion', 'courses'], 'learning state')

  if (value.schemaVersion !== LEARNING_SCHEMA_VERSION) {
    fail(`unsupported learning schemaVersion: ${String(value.schemaVersion)}`)
  }

  const { courses } = value
  assertRecord(courses, 'learning state.courses')

  const courseIds = Object.keys(courses)
  if (courseIds.length > MAX_COURSES) fail('learning state.courses exceeds the course limit')

  const normalizedCourses: Record<string, CourseProgress> = {}
  for (const courseId of courseIds) {
    assertSafeId(courseId, 'learning state.courses key')
    normalizedCourses[courseId] = parseCourseProgress(
      courses[courseId],
      `learning state.courses[${JSON.stringify(courseId)}]`,
    )
  }

  return { schemaVersion: LEARNING_SCHEMA_VERSION, courses: normalizedCourses }
}

/** Parse a stored string, rejecting malformed JSON, unknown versions and malformed fields. */
export function parseLearningState(raw: string): LearningState {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail('learning storage is not valid JSON')
  }
  return validateLearningState(parsed)
}

export function emptyLearningState(): LearningState {
  return { schemaVersion: LEARNING_SCHEMA_VERSION, courses: {} }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Create one repository over a Storage-like object. Pass `null` when storage is
 * not available (for example during SSR) so reads report `unavailable` instead
 * of silently pretending the data was saved.
 */
export function createLearningRepository(storage: LearningStorage | null = null): LearningRepository {
  // An unread or corrupt payload cannot be overwritten by an automatic save.
  let corrupt = false
  let writable = false

  function load(): LearningLoadResult {
    writable = false
    if (!storage) return { ok: false, status: 'unavailable', error: 'learning storage is unavailable' }

    let raw: string | null
    try {
      raw = storage.getItem(LEARNING_STORAGE_KEY)
    } catch (error) {
      return { ok: false, status: 'unavailable', error: errorMessage(error) }
    }

    try {
      const state = raw === null ? emptyLearningState() : parseLearningState(raw)
      corrupt = false
      writable = true
      return { ok: true, status: 'success', state }
    } catch (error) {
      corrupt = true
      return { ok: false, status: 'corrupt', error: errorMessage(error) }
    }
  }

  function save(state: LearningState): LearningWriteResult {
    if (!storage) return { ok: false, status: 'unavailable', error: 'learning storage is unavailable' }
    if (corrupt) {
      return {
        ok: false,
        status: 'corrupt',
        error: 'learning storage is corrupt; reset it before saving',
      }
    }

    if (!writable) {
      const result = load()
      if (!result.ok) return result
    }

    let serialized: string
    try {
      serialized = JSON.stringify(validateLearningState(state))
    } catch (error) {
      return { ok: false, status: 'invalid', error: errorMessage(error) }
    }

    try {
      storage.setItem(LEARNING_STORAGE_KEY, serialized)
    } catch (error) {
      return { ok: false, status: 'unavailable', error: errorMessage(error) }
    }

    return { ok: true, status: 'success' }
  }

  function clear(): LearningWriteResult {
    if (!storage) return { ok: false, status: 'unavailable', error: 'learning storage is unavailable' }
    try {
      storage.removeItem(LEARNING_STORAGE_KEY)
      corrupt = false
      writable = true
      return { ok: true, status: 'success' }
    } catch (error) {
      return { ok: false, status: 'unavailable', error: errorMessage(error) }
    }
  }

  return { load, save, clear }
}

/**
 * Isolated in-memory storage for tests and non-browser runtimes. Every call
 * returns a new map; no module-level cache is shared between callers.
 */
export function createMemoryLearningStorage(initial: Record<string, string> = {}): LearningStorage {
  const values = new Map<string, string>(Object.entries(initial))

  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  }
}

/** Resolve localStorage only when a client window exists; this never touches it during SSR. */
export function createBrowserLearningStorage(): LearningStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}
