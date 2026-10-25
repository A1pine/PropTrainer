export type LearningLocale = 'en' | 'zh-CN' | 'ja'
export type LearningText = { en: string; 'zh-CN'?: string; ja?: string }
export type PracticeTool = '/trainer' | '/drill' | '/analysis' | '/terminal'

export type LearningBlock =
  | { id: string; type: 'text'; paragraphs: LearningText[] }
  | { id: string; type: 'callout'; title: LearningText; body: LearningText }
  | {
      id: string
      type: 'checklist'
      title: LearningText
      items: { id: string; text: LearningText; required: boolean }[]
    }
  | { id: string; type: 'resources'; title: LearningText; items: { label: LearningText; url: string }[] }
  | {
      id: string
      type: 'practice'
      title: LearningText
      body: LearningText
      target: PracticeTool | null
    }

export type LearningVideo =
  { type: 'youtube'; videoId: string; title: LearningText } | { type: 'file'; url: string; title: LearningText }

export interface LearningLesson {
  id: string
  revision: number
  title: LearningText
  summary: LearningText
  status: 'published' | 'draft'
  blocks: LearningBlock[]
  video?: LearningVideo
}

export interface LearningChapter {
  id: string
  kind: 'orientation' | 'curriculum'
  title: LearningText
  lessons: LearningLesson[]
}

export interface LearningCourse {
  id: string
  title: LearningText
  summary: LearningText
  chapters: LearningChapter[]
}

export interface LearningLessonEntry {
  chapter: LearningChapter
  lesson: LearningLesson
}

export interface LessonProgress {
  revision: number
  note: string
  checked: string[]
  visitedAt: string | null
  completedAt: string | null
}

export interface CourseProgress {
  lastLessonId: string | null
  lessons: Record<string, LessonProgress>
}

export interface LearningState {
  schemaVersion: 1
  courses: Record<string, CourseProgress>
}

export const LEARNING_NOTE_LIMIT = 12000
