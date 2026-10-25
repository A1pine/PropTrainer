import { describe, expect, it } from 'vitest'
import {
  courseLessons,
  courseProgress,
  createCourseRegistry,
  findCourse,
  findLesson,
  learningText,
  requiredChecks,
  safeResourceUrl,
} from '~/domain/learning/catalog'
import type { LearningCourse, LearningState } from '~/domain/learning/types'

function course(overrides: Partial<LearningCourse> = {}): LearningCourse {
  return {
    id: 'sample-course',
    title: { en: 'Sample course' },
    summary: { en: 'A synthetic course used by registry tests.' },
    chapters: [
      {
        id: 'orientation',
        kind: 'orientation',
        title: { en: 'Orientation' },
        lessons: [
          {
            id: 'guide',
            revision: 1,
            title: { en: 'Guide' },
            summary: { en: 'Workspace instructions.' },
            status: 'published',
            blocks: [
              {
                id: 'guide-check',
                type: 'checklist',
                title: { en: 'Try it' },
                items: [{ id: 'read', text: { en: 'Read the guide' }, required: true }],
              },
            ],
          },
        ],
      },
      {
        id: 'curriculum',
        kind: 'curriculum',
        title: { en: 'Curriculum' },
        lessons: [
          {
            id: 'lesson',
            revision: 2,
            title: { en: 'Lesson', 'zh-CN': '课时' },
            summary: { en: 'A published lesson.' },
            status: 'published',
            blocks: [
              { id: 'text', type: 'text', paragraphs: [{ en: 'Body' }] },
              {
                id: 'checks',
                type: 'checklist',
                title: { en: 'Checks' },
                items: [
                  { id: 'required', text: { en: 'Required' }, required: true },
                  { id: 'optional', text: { en: 'Optional' }, required: false },
                ],
              },
            ],
          },
          {
            id: 'draft',
            revision: 1,
            title: { en: 'Draft' },
            summary: { en: 'No material yet.' },
            status: 'draft',
            blocks: [],
          },
        ],
      },
    ],
    ...overrides,
  }
}

function state(overrides: Partial<LearningState['courses'][string]> = {}): LearningState {
  return {
    schemaVersion: 1,
    courses: {
      'sample-course': {
        lastLessonId: 'lesson',
        lessons: {
          guide: { revision: 1, note: '', checked: ['read'], visitedAt: null, completedAt: '2026-01-01T00:00:00.000Z' },
          lesson: {
            revision: 2,
            note: 'note',
            checked: ['required'],
            visitedAt: null,
            completedAt: '2026-01-02T00:00:00.000Z',
          },
          ...overrides.lessons,
        },
        ...overrides,
      },
    },
  }
}

describe('learning catalog registry', () => {
  it('registers stable IDs and exposes selectors', () => {
    const registry = createCourseRegistry([course()])
    expect(registry.findCourse('sample-course')?.id).toBe('sample-course')
    expect(registry.findLesson('sample-course', 'lesson')?.chapter.id).toBe('curriculum')
    expect(registry.findLesson('sample-course', 'missing')).toBeUndefined()
    expect(registry.findCourse('missing')).toBeUndefined()
    expect(courseLessons(registry.courses[0]!)).toHaveLength(3)
  })

  it('falls back to English and uses translated text when present', () => {
    expect(learningText({ en: 'Fallback' }, 'ja')).toBe('Fallback')
    expect(learningText({ en: 'English', 'zh-CN': '中文' }, 'zh-CN')).toBe('中文')
    expect(learningText({ en: 'English', 'zh-CN': '中文' }, 'en')).toBe('English')
  })

  it('rejects duplicate course, chapter, lesson, block and checklist IDs', () => {
    expect(() => createCourseRegistry([course(), course()])).toThrow(/Duplicate course ID/)
    const duplicateChapter = course()
    duplicateChapter.chapters.push({ ...duplicateChapter.chapters[0]!, id: duplicateChapter.chapters[0]!.id })
    expect(() => createCourseRegistry([duplicateChapter])).toThrow(/chapter ID/)
    const duplicateLesson = course()
    duplicateLesson.chapters[1]!.lessons.push({ ...duplicateLesson.chapters[1]!.lessons[0]! })
    expect(() => createCourseRegistry([duplicateLesson])).toThrow(/lesson ID/)
    const duplicateBlock = course()
    duplicateBlock.chapters[1]!.lessons[0]!.blocks.push({ ...duplicateBlock.chapters[1]!.lessons[0]!.blocks[0]! })
    expect(() => createCourseRegistry([duplicateBlock])).toThrow(/block ID/)
    const duplicateCheck = course()
    const checklist = duplicateCheck.chapters[1]!.lessons[0]!.blocks[1]!
    duplicateCheck.chapters[1]!.lessons[0]!.blocks.push({ ...checklist, id: 'checks-copy' })
    expect(() => createCourseRegistry([duplicateCheck])).toThrow(/checklist item ID/)
  })

  it('rejects malformed content and unsafe URLs', () => {
    const empty = course()
    empty.chapters[1]!.lessons[0]!.blocks = []
    expect(() => createCourseRegistry([empty])).toThrow(/published lesson needs content/i)
    for (const url of ['http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'not-a-url']) {
      expect(safeResourceUrl(url)).toBe(false)
      const unsafe = course()
      unsafe.chapters[1]!.lessons[0]!.blocks.push({
        id: 'links',
        type: 'resources',
        title: { en: 'Links' },
        items: [{ label: { en: 'Bad' }, url }],
      })
      expect(() => createCourseRegistry([unsafe])).toThrow()
    }
    const video = course()
    video.chapters[1]!.lessons[0]!.video = { type: 'youtube', videoId: 'too-short', title: { en: 'Video' } }
    expect(() => createCourseRegistry([video])).toThrow()
  })

  it('derives required checks and counts only published curriculum lessons', () => {
    const registry = createCourseRegistry([course()])
    const lesson = registry.findLesson('sample-course', 'lesson')!.lesson
    expect(requiredChecks(lesson)).toEqual(['required'])
    expect(courseProgress(registry.courses[0]!, state())).toEqual({ completed: 1, total: 1, percent: 100 })
    const guideOnly = state({
      lessons: { lesson: { revision: 2, note: '', checked: [], visitedAt: null, completedAt: null } },
    })
    expect(courseProgress(registry.courses[0]!, guideOnly)).toEqual({ completed: 0, total: 1, percent: 0 })
    const withoutChecks = state({
      lessons: {
        lesson: { revision: 2, note: '', checked: [], visitedAt: null, completedAt: '2026-01-02T00:00:00.000Z' },
      },
    })
    expect(courseProgress(registry.courses[0]!, withoutChecks).completed).toBe(0)
    const staleRevision = state({
      lessons: {
        lesson: {
          revision: 1,
          note: '',
          checked: ['required'],
          visitedAt: null,
          completedAt: '2026-01-02T00:00:00.000Z',
        },
      },
    })
    expect(courseProgress(registry.courses[0]!, staleRevision).completed).toBe(0)
  })

  it('reports no percentage when no curriculum lesson is published', () => {
    const registry = createCourseRegistry([
      course({
        chapters: [{ id: 'curriculum', kind: 'curriculum', title: { en: 'Soon' }, lessons: [] }],
      }),
    ])
    expect(courseProgress(registry.courses[0]!, state())).toEqual({ completed: 0, total: 0, percent: null })
  })

  it('ships the owner-supplied 14-chapter outline with pending practice slots', () => {
    const course = findCourse('ict-2022-concept')!
    const curriculum = courseLessons(course).filter((entry) => entry.chapter.kind === 'curriculum')
    expect(course.title.en).toBe('ICT 2022 Concept')
    expect(curriculum).toHaveLength(14)
    expect(curriculum.every((entry) => entry.lesson.status === 'published')).toBe(true)
    expect(curriculum[0]!.lesson.id).toBe('chapter-01')
    expect(curriculum[13]!.lesson.id).toBe('chapter-14')
    expect(curriculum[0]!.lesson.blocks.find((block) => block.type === 'practice')).toMatchObject({
      type: 'practice',
      target: null,
    })
    expect(curriculum[2]!.lesson.video).toMatchObject({ type: 'youtube', videoId: 'nQfHZ2DEJ8c' })
    expect(courseProgress(course, { schemaVersion: 1, courses: {} })).toEqual({
      completed: 0,
      total: 14,
      percent: 0,
    })
  })

  it('rejects identifiers that would collide with Object.prototype', () => {
    for (const reserved of ['constructor', 'prototype', '__proto__', 'toString']) {
      const unsafeCourse = course()
      unsafeCourse.id = reserved
      expect(() => createCourseRegistry([unsafeCourse])).toThrow(/reserved/i)

      const unsafeLesson = course()
      unsafeLesson.chapters[1]!.lessons[0]!.id = reserved
      expect(() => createCourseRegistry([unsafeLesson])).toThrow(/reserved/i)

      const unsafeCheck = course()
      const block = unsafeCheck.chapters[1]!.lessons[0]!.blocks[1]!
      if (block.type !== 'checklist') throw new Error('fixture changed')
      block.items[0]!.id = reserved
      expect(() => createCourseRegistry([unsafeCheck])).toThrow(/reserved/i)
    }
  })

  it('caps courses, lessons and checklist items at the stored limits', () => {
    const tooManyCourses = Array.from({ length: 201 }, (_, index) => {
      const item = course()
      item.id = `course-${index}`
      return item
    })
    expect(() => createCourseRegistry(tooManyCourses)).toThrow()

    const tooManyChecks = course()
    const checklist = tooManyChecks.chapters[1]!.lessons[0]!.blocks[1]!
    if (checklist.type !== 'checklist') throw new Error('fixture changed')
    checklist.items = Array.from({ length: 501 }, (_, index) => ({
      id: `check-${index}`,
      text: { en: `Check ${index}` },
      required: false,
    }))
    expect(() => createCourseRegistry([tooManyChecks])).toThrow()
  })

  it('counts progress without reading inherited object properties', () => {
    const registry = createCourseRegistry([course()])
    const empty = { schemaVersion: 1 as const, courses: {} }
    // `courses` inherits `constructor`/`toString` from Object.prototype; a
    // course named like one of those must not crash or count as complete.
    expect(courseProgress(registry.courses[0]!, empty)).toEqual({ completed: 0, total: 1, percent: 0 })
    expect(
      courseProgress(registry.courses[0]!, {
        schemaVersion: 1,
        courses: { 'sample-course': { lastLessonId: null, lessons: {} } },
      }),
    ).toEqual({ completed: 0, total: 1, percent: 0 })
  })
})
