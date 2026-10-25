import { ref } from 'vue'
import { defineStore } from 'pinia'
import { findCourse, findLesson } from '~/domain/learning/catalog'
import {
  LEARNING_NOTE_LIMIT,
  type LearningLesson,
  type LearningLessonEntry,
  type LearningState,
  type LessonProgress,
} from '~/domain/learning/types'
import {
  createBrowserLearningStorage,
  createLearningRepository,
  emptyLearningState,
  type LearningRepository,
  type LearningStorage,
} from '~/lib/learning/repository'

export type LearningStorageStatus = 'idle' | 'saved' | 'unavailable' | 'corrupt' | 'invalid'

interface ChecklistItem {
  required: boolean
  order: number
}

interface PendingEdit {
  revision: number
  note?: string
  visitedAt?: string
  checks?: Record<string, boolean>
  completedAt?: string | null
}

function emptyProgress(revision: number): LessonProgress {
  return {
    revision,
    note: '',
    checked: [],
    visitedAt: null,
    completedAt: null,
  }
}

function checklistItems(lesson: LearningLesson): Map<string, ChecklistItem> {
  const items = new Map<string, ChecklistItem>()
  let order = 0

  for (const block of lesson.blocks) {
    if (block.type !== 'checklist') continue
    for (const item of block.items) {
      if (!items.has(item.id)) items.set(item.id, { required: item.required, order })
      order += 1
    }
  }

  return items
}

function allRequiredChecked(lesson: LearningLesson, checked: string[]): boolean {
  const items = checklistItems(lesson)
  const checkedIds = new Set(checked)
  for (const [itemId, item] of items) {
    if (item.required && !checkedIds.has(itemId)) return false
  }
  return true
}

function normalizeProgress(stored: LessonProgress | undefined, lesson: LearningLesson): LessonProgress {
  if (!stored) return emptyProgress(lesson.revision)

  if (stored.revision !== lesson.revision) {
    return {
      revision: lesson.revision,
      note: stored.note,
      checked: [],
      visitedAt: stored.visitedAt,
      completedAt: null,
    }
  }

  const items = checklistItems(lesson)
  const checked =
    lesson.status === 'published'
      ? stored.checked
          .filter((itemId) => items.has(itemId))
          .sort((left, right) => (items.get(left)?.order ?? 0) - (items.get(right)?.order ?? 0))
      : []
  const completedAt =
    lesson.status === 'published' && stored.completedAt !== null && allRequiredChecked(lesson, checked)
      ? stored.completedAt
      : null

  return {
    revision: lesson.revision,
    note: stored.note,
    checked,
    visitedAt: stored.visitedAt,
    completedAt,
  }
}

function lookupLesson(courseId: string, lessonId: string): LearningLessonEntry | null {
  if (!courseId || !lessonId) return null
  if (!findCourse(courseId)) return null
  return findLesson(courseId, lessonId) ?? null
}

export const useLearningStore = defineStore('learning', () => {
  const ready = ref(false)
  const storageStatus = ref<LearningStorageStatus>('idle')
  const state = ref<LearningState>(emptyLearningState())
  // `getProgress` is called from page computeds. Touch a counter on every
  // commit so a missing-then-created course still invalidates those computeds.
  const version = ref(0)

  let repository: LearningRepository | null = null
  let storageHandle: LearningStorage | null = null
  let initialized = false
  let loaded = false
  let pendingWrite = false
  let failureKind: 'read' | 'write' | 'clear' | null = null
  const pendingReadEdits = new Map<string, Map<string, PendingEdit>>()

  function recordReadEdit(courseId: string, lesson: LearningLesson, change: Omit<PendingEdit, 'revision'>): void {
    if (failureKind !== 'read') return
    let course = pendingReadEdits.get(courseId)
    if (!course) {
      course = new Map()
      pendingReadEdits.set(courseId, course)
    }
    const previous = course.get(lesson.id)
    const retained: Omit<PendingEdit, 'revision'> =
      previous?.revision === lesson.revision ? previous : { note: previous?.note, visitedAt: previous?.visitedAt }
    course.set(lesson.id, {
      ...retained,
      ...change,
      revision: lesson.revision,
      ...(change.checks ? { checks: { ...retained.checks, ...change.checks } } : {}),
    })
  }

  function replayReadEdits(): void {
    for (const [courseId, lessons] of pendingReadEdits) {
      for (const [lessonId, edit] of lessons) {
        const entry = lookupLesson(courseId, lessonId)
        if (!entry) continue
        const progress = normalizeProgress(storedProgress(courseId, lessonId), entry.lesson)
        if (edit.note !== undefined) progress.note = edit.note
        if (edit.visitedAt !== undefined) progress.visitedAt = edit.visitedAt
        if (entry.lesson.status === 'published' && edit.revision === entry.lesson.revision) {
          const items = checklistItems(entry.lesson)
          const checked = new Set(progress.checked)
          for (const [itemId, value] of Object.entries(edit.checks ?? {})) {
            if (!items.has(itemId)) continue
            if (value) checked.add(itemId)
            else checked.delete(itemId)
          }
          progress.checked = [...checked]
          if (edit.completedAt !== undefined) progress.completedAt = edit.completedAt
        }
        ensureCourse(courseId).lessons[lessonId] = normalizeProgress(progress, entry.lesson)
      }
    }
    pendingReadEdits.clear()
  }

  function configure(nextStorage: LearningStorage | null): void {
    storageHandle = nextStorage
    repository = createLearningRepository(nextStorage)
  }

  function applyLoad(result: ReturnType<LearningRepository['load']>): void {
    if (result.ok) {
      const hasEdits = pendingReadEdits.size > 0
      const lastVisited = new Map(
        [...pendingReadEdits.keys()].map((courseId) => [courseId, currentCourse(courseId)?.lastLessonId]),
      )
      state.value = result.state
      storageStatus.value = 'idle'
      loaded = true
      pendingWrite = false
      failureKind = null
      if (hasEdits) {
        replayReadEdits()
        for (const [courseId, lessonId] of lastVisited) {
          if (lessonId && lookupLesson(courseId, lessonId)) ensureCourse(courseId).lastLessonId = lessonId
        }
        persist()
      }
      return
    }

    if (result.status === 'corrupt') {
      storageStatus.value = 'corrupt'
      loaded = false
      pendingWrite = false
      failureKind = null
      return
    }

    storageStatus.value = 'unavailable'
    loaded = false
    failureKind = 'read'
  }

  function initialize(storage?: LearningStorage | null): void {
    if (initialized || (storage === undefined && typeof window === 'undefined')) return
    initialized = true
    configure(storage === undefined ? createBrowserLearningStorage() : storage)
    applyLoad(repository!.load())
    ready.value = true
  }

  function resolveStorageForRetry(): boolean {
    if (storageHandle) return true
    const fresh = createBrowserLearningStorage()
    if (!fresh) return false
    configure(fresh)
    return true
  }

  function persist(): void {
    if (!loaded || storageStatus.value === 'corrupt') {
      pendingWrite = true
      return
    }
    if (!repository) {
      storageStatus.value = 'unavailable'
      pendingWrite = true
      failureKind = 'write'
      return
    }

    const result = repository.save(state.value)
    if (result.ok) {
      storageStatus.value = 'saved'
      pendingWrite = false
      failureKind = null
      return
    }

    pendingWrite = true
    if (result.status === 'corrupt') {
      storageStatus.value = 'corrupt'
      loaded = false
      failureKind = null
      return
    }

    // The outgoing state was rejected by validation: the bytes on disk are
    // still readable, so keep the edit in memory and let Retry try again
    // rather than reloading and silently discarding it.
    storageStatus.value = result.status === 'invalid' ? 'invalid' : 'unavailable'
    failureKind = 'write'
  }

  function currentCourse(courseId: string) {
    return Object.prototype.hasOwnProperty.call(state.value.courses, courseId)
      ? state.value.courses[courseId]
      : undefined
  }

  function storedProgress(courseId: string, lessonId: string): LessonProgress | undefined {
    const course = currentCourse(courseId)
    if (!course) return undefined
    return Object.prototype.hasOwnProperty.call(course.lessons, lessonId) ? course.lessons[lessonId] : undefined
  }

  function ensureCourse(courseId: string) {
    let course = currentCourse(courseId)
    if (!course) {
      course = { lastLessonId: null, lessons: {} }
      state.value.courses[courseId] = course
    }
    return course
  }

  function resolvedProgress(
    courseId: string,
    lessonId: string,
  ): { entry: LearningLessonEntry; progress: LessonProgress } | null {
    if (!ready.value) return null
    const entry = lookupLesson(courseId, lessonId)
    if (!entry) return null
    return {
      entry,
      progress: normalizeProgress(storedProgress(courseId, entry.lesson.id), entry.lesson),
    }
  }

  function commit(courseId: string, entry: LearningLessonEntry, progress: LessonProgress): void {
    const course = ensureCourse(courseId)
    course.lessons[entry.lesson.id] = progress
    version.value += 1
    persist()
  }

  function getProgress(courseId: string, lesson: LearningLesson): LessonProgress {
    void version.value
    const fallbackRevision =
      lesson && Number.isSafeInteger(lesson.revision) && lesson.revision > 0 ? lesson.revision : 1
    if (!lesson || typeof lesson.id !== 'string') return emptyProgress(fallbackRevision)

    const entry = lookupLesson(courseId, lesson.id)
    if (!entry) return emptyProgress(fallbackRevision)
    return normalizeProgress(storedProgress(courseId, entry.lesson.id), entry.lesson)
  }

  function visit(courseId: string, lesson: LearningLesson): void {
    if (!lesson || typeof lesson.id !== 'string') return
    const resolved = resolvedProgress(courseId, lesson.id)
    if (!resolved) return

    resolved.progress.visitedAt = new Date().toISOString()
    const course = ensureCourse(courseId)
    course.lastLessonId = resolved.entry.lesson.id
    recordReadEdit(courseId, resolved.entry.lesson, { visitedAt: resolved.progress.visitedAt })
    commit(courseId, resolved.entry, resolved.progress)
  }

  function setNote(courseId: string, lesson: LearningLesson, note: string): void {
    if (!lesson || typeof lesson.id !== 'string' || typeof note !== 'string') return
    const resolved = resolvedProgress(courseId, lesson.id)
    if (!resolved) return

    resolved.progress.note = note.slice(0, LEARNING_NOTE_LIMIT)
    recordReadEdit(courseId, resolved.entry.lesson, { note: resolved.progress.note })
    commit(courseId, resolved.entry, resolved.progress)
  }

  function setChecked(courseId: string, lesson: LearningLesson, itemId: string, checked: boolean): void {
    if (!lesson || typeof lesson.id !== 'string' || typeof itemId !== 'string' || typeof checked !== 'boolean') {
      return
    }
    const resolved = resolvedProgress(courseId, lesson.id)
    if (!resolved || resolved.entry.lesson.status !== 'published') return

    const items = checklistItems(resolved.entry.lesson)
    const item = items.get(itemId)
    if (!item) return

    const nextChecked = new Set(resolved.progress.checked)
    if (checked) nextChecked.add(itemId)
    else nextChecked.delete(itemId)

    resolved.progress.checked = [...nextChecked].sort(
      (left, right) => (items.get(left)?.order ?? 0) - (items.get(right)?.order ?? 0),
    )

    if (!checked && item.required) resolved.progress.completedAt = null
    if (
      resolved.progress.completedAt !== null &&
      !allRequiredChecked(resolved.entry.lesson, resolved.progress.checked)
    ) {
      resolved.progress.completedAt = null
    }

    recordReadEdit(courseId, resolved.entry.lesson, {
      checks: { [itemId]: checked },
      ...(!checked && item.required ? { completedAt: null } : {}),
    })
    commit(courseId, resolved.entry, resolved.progress)
  }

  function setCompleted(courseId: string, lesson: LearningLesson, completed: boolean): void {
    if (!lesson || typeof lesson.id !== 'string' || typeof completed !== 'boolean') return
    const resolved = resolvedProgress(courseId, lesson.id)
    if (!resolved || resolved.entry.lesson.status !== 'published') return

    if (completed) {
      if (resolved.progress.completedAt !== null) return
      if (!allRequiredChecked(resolved.entry.lesson, resolved.progress.checked)) return
      resolved.progress.completedAt = new Date().toISOString()
    } else {
      if (resolved.progress.completedAt === null) return
      resolved.progress.completedAt = null
    }

    recordReadEdit(courseId, resolved.entry.lesson, { completedAt: resolved.progress.completedAt })
    commit(courseId, resolved.entry, resolved.progress)
  }

  function lastLesson(courseId: string): string | null {
    if (!findCourse(courseId)) return null
    const lessonId = currentCourse(courseId)?.lastLessonId ?? null
    if (lessonId === null) return null
    if (!findLesson(courseId, lessonId)) return null
    return lessonId
  }

  function retry(): void {
    if (!initialized) {
      initialize()
      return
    }

    if (storageStatus.value === 'corrupt') {
      resolveStorageForRetry()
      if (!repository) {
        storageStatus.value = 'unavailable'
        failureKind = 'read'
        return
      }
      applyLoad(repository.load())
      return
    }

    if (failureKind === 'clear') {
      resolveStorageForRetry()
      if (!repository) {
        storageStatus.value = 'unavailable'
        failureKind = 'clear'
        return
      }
      const result = repository.clear()
      if (result.ok) {
        storageStatus.value = 'idle'
        loaded = true
        failureKind = null
        if (pendingWrite) persist()
      } else {
        storageStatus.value = 'unavailable'
        failureKind = 'clear'
      }
      return
    }

    if (failureKind === 'read' || !loaded) {
      resolveStorageForRetry()
      if (!repository) {
        storageStatus.value = 'unavailable'
        failureKind = 'read'
        return
      }
      applyLoad(repository.load())
      return
    }

    if (pendingWrite || failureKind === 'write') {
      persist()
    }
  }

  function reset(): void {
    if (!initialized) initialize()
    pendingReadEdits.clear()
    if (!repository) {
      state.value = emptyLearningState()
      storageStatus.value = 'unavailable'
      loaded = false
      pendingWrite = false
      failureKind = 'clear'
      return
    }

    const result = repository.clear()
    state.value = emptyLearningState()
    pendingWrite = false

    if (result.ok) {
      storageStatus.value = 'idle'
      loaded = true
      failureKind = null
      return
    }

    storageStatus.value = 'unavailable'
    loaded = false
    failureKind = 'clear'
  }

  return {
    state,
    ready,
    storageStatus,
    initialize,
    getProgress,
    visit,
    setNote,
    setChecked,
    setCompleted,
    lastLesson,
    retry,
    reset,
  }
})
