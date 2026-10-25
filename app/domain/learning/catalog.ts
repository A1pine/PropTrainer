import { z } from 'zod'
import { isReservedId } from './ids'
import { MAX_CHECKED_ITEMS, MAX_COURSES, MAX_LESSONS_PER_COURSE } from './limits'
import type { LearningCourse, LearningLesson, LearningLessonEntry, LearningState, LearningText } from './types'

/**
 * Same rule the repository enforces when it persists progress. Keeping one
 * definition stops the catalog from accepting an ID that can never be saved.
 */
const id = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80)
  .refine((value) => !isReservedId(value), 'Identifier is reserved')
const text = z
  .object({
    en: z.string().trim().min(1),
    'zh-CN': z.string().trim().min(1).optional(),
    ja: z.string().trim().min(1).optional(),
  })
  .strict()

export function safeResourceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

const url = z.string().refine(safeResourceUrl, 'Resources must use an HTTPS URL without credentials')
const video = z.discriminatedUnion('type', [
  z.object({ type: z.literal('youtube'), videoId: z.string().regex(/^[\w-]{11}$/), title: text }).strict(),
  z.object({ type: z.literal('file'), url, title: text }).strict(),
])
const block = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('text'), paragraphs: z.array(text).min(1) }).strict(),
  z.object({ id, type: z.literal('callout'), title: text, body: text }).strict(),
  z
    .object({
      id,
      type: z.literal('checklist'),
      title: text,
      items: z
        .array(z.object({ id, text, required: z.boolean() }).strict())
        .min(1)
        .max(MAX_CHECKED_ITEMS),
    })
    .strict(),
  z
    .object({
      id,
      type: z.literal('resources'),
      title: text,
      items: z.array(z.object({ label: text, url }).strict()).min(1),
    })
    .strict(),
  z
    .object({
      id,
      type: z.literal('practice'),
      title: text,
      body: text,
      target: z.enum(['/trainer', '/drill', '/analysis', '/terminal']).nullable(),
    })
    .strict(),
])
const lesson = z
  .object({
    id,
    revision: z.number().int().positive(),
    title: text,
    summary: text,
    status: z.enum(['published', 'draft']),
    blocks: z.array(block),
    video: video.optional(),
  })
  .strict()
  .refine(
    (value) => value.status !== 'published' || value.blocks.length > 0 || value.video,
    'A published lesson needs content',
  )
const course = z
  .object({
    id,
    title: text,
    summary: text,
    chapters: z.array(
      z.object({ id, kind: z.enum(['orientation', 'curriculum']), title: text, lessons: z.array(lesson) }).strict(),
    ),
  })
  .strict()
  .refine(
    (value) => value.chapters.reduce((count, chapter) => count + chapter.lessons.length, 0) <= MAX_LESSONS_PER_COURSE,
    `A course cannot exceed ${MAX_LESSONS_PER_COURSE} lessons`,
  )

function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} ID`)
}

export function createCourseRegistry(input: readonly LearningCourse[]) {
  const courses: LearningCourse[] = z.array(course).max(MAX_COURSES).parse(input)
  unique(
    courses.map((item) => item.id),
    'course',
  )
  for (const item of courses) {
    unique(
      item.chapters.map((chapter) => chapter.id),
      'chapter',
    )
    unique(
      item.chapters.flatMap((chapter) => chapter.lessons.map((entry) => entry.id)),
      'lesson',
    )
    for (const chapter of item.chapters) {
      for (const entry of chapter.lessons) {
        unique(
          entry.blocks.map((value) => value.id),
          'block',
        )
        unique(
          entry.blocks.flatMap((value) => (value.type === 'checklist' ? value.items.map((check) => check.id) : [])),
          'checklist item',
        )
      }
    }
  }
  const byId = new Map(courses.map((item) => [item.id, item]))
  return {
    courses,
    findCourse: (courseId: string) => byId.get(courseId),
    findLesson(courseId: string, lessonId: string): LearningLessonEntry | undefined {
      for (const chapter of byId.get(courseId)?.chapters ?? []) {
        const found = chapter.lessons.find((entry) => entry.id === lessonId)
        if (found) return { chapter, lesson: found }
      }
      return undefined
    },
  }
}

export function learningText(value: LearningText, locale: string): string {
  return locale === 'zh-CN' || locale === 'ja' ? (value[locale] ?? value.en) : value.en
}

export function courseLessons(value: LearningCourse): LearningLessonEntry[] {
  return value.chapters.flatMap((chapter) => chapter.lessons.map((lesson) => ({ chapter, lesson })))
}

export function requiredChecks(value: LearningLesson): string[] {
  return value.blocks.flatMap((block) =>
    block.type === 'checklist' ? block.items.filter((item) => item.required).map((item) => item.id) : [],
  )
}

export function courseProgress(value: LearningCourse, state: LearningState) {
  const published = courseLessons(value).filter(
    (entry) => entry.chapter.kind === 'curriculum' && entry.lesson.status === 'published',
  )
  const completed = published.filter(({ lesson }) => {
    const course = Object.hasOwn(state.courses, value.id) ? state.courses[value.id] : undefined
    const saved = course && Object.hasOwn(course.lessons, lesson.id) ? course.lessons[lesson.id] : undefined
    return (
      saved?.revision === lesson.revision &&
      saved.completedAt !== null &&
      saved.completedAt !== undefined &&
      requiredChecks(lesson).every((key) => saved.checked.includes(key))
    )
  }).length
  return {
    completed,
    total: published.length,
    percent: published.length ? Math.round((completed / published.length) * 100) : null,
  }
}

const videoTitle: LearningText = {
  en: 'Reference video supplied with the outline (not an official course episode)',
  'zh-CN': '课程大纲附带的参考视频（非官方课程绑定）',
  ja: '概要に添付された参考動画（公式講座ではありません）',
}

const practiceTitle: LearningText = {
  en: 'Practice is not configured yet',
  'zh-CN': '实战任务待配置',
  ja: '実践課題は未設定',
}

const practiceBody: LearningText = {
  en: 'The course owner has not supplied the task, replay sample or review criteria for this chapter yet. Reading and the self-check remain available; nothing launches from here.',
  'zh-CN': '课程维护者尚未提供本章的实战任务、回放样本与复核标准。阅读与自检仍可使用；此处不会启动任何练习。',
  ja: 'この章の実践課題、リプレイ例、確認基準はまだ提供されていません。読解とセルフチェックは利用できますが、ここから練習は開始されません。',
}

const selfCheckTitle: LearningText = {
  en: 'Self-check',
  'zh-CN': '本章自检',
  ja: 'セルフチェック',
}

const selfCheckItems = [
  {
    id: 'explain',
    required: true,
    text: {
      en: 'I can explain this chapter’s key points in my own words.',
      'zh-CN': '我能用自己的话说明本章知识点。',
      ja: '本章の要点を自分の言葉で説明できる。',
    } satisfies LearningText,
  },
  {
    id: 'review-example',
    required: true,
    text: {
      en: 'I reviewed the supplied example and recorded one question or invalidation condition.',
      'zh-CN': '我复盘了所给示例，并记录了一个疑问或失效条件。',
      ja: '示された例を確認し、疑問または無効条件を1つ記録した。',
    } satisfies LearningText,
  },
]

function chapterLesson(input: {
  number: number
  title: LearningText
  summary: LearningText
  points: LearningText
  example: LearningText
  videoId?: string
}): LearningLesson {
  return {
    id: 'chapter-' + String(input.number).padStart(2, '0'),
    revision: 1,
    title: input.title,
    summary: input.summary,
    status: 'published',
    blocks: [
      { id: 'points', type: 'text', paragraphs: [input.points] },
      {
        id: 'example',
        type: 'callout',
        title: {
          en: 'Example from the outline',
          'zh-CN': '课程大纲中的示例',
          ja: '概要で示された例',
        },
        body: input.example,
      },
      { id: 'self-check', type: 'checklist', title: selfCheckTitle, items: selfCheckItems },
      { id: 'practice', type: 'practice', title: practiceTitle, body: practiceBody, target: null },
    ],
    ...(input.videoId ? { video: { type: 'youtube' as const, videoId: input.videoId, title: videoTitle } } : {}),
  }
}

const registry = createCourseRegistry([
  {
    id: 'ict-2022-concept',
    title: { en: 'ICT 2022 Concept' },
    summary: {
      en: 'A 14-chapter outline supplied by the course owner, with reading notes, self-checks and a pending practice slot for each chapter. Independent study, not an official ICT affiliation.',
      'zh-CN':
        '由课程维护者提供的 14 章大纲，配有阅读笔记、本章自检，以及每章待配置的实战入口。独立学习用途，不代表 ICT 官方课程。',
      ja: 'コース管理者が提供した全14章の概要です。読解ノート、セルフチェック、各章の未設定の実践枠を備えます。独立学習用であり、ICT公式講座ではありません。',
    },
    chapters: [
      {
        id: 'workspace',
        kind: 'orientation',
        title: { en: 'Using the learning workspace', 'zh-CN': '使用学习工作区', ja: '学習ワークスペースの使い方' },
        lessons: [
          {
            id: 'workspace-guide',
            revision: 1,
            title: { en: 'Workspace guide', 'zh-CN': '工作区导览', ja: 'ワークスペースガイド' },
            summary: {
              en: 'Start with the workspace guide, then work through the supplied chapters.',
              'zh-CN': '先阅读工作区导览，再按顺序学习已提供的章节。',
              ja: 'まずワークスペースガイドを読み、提供された章を順に進めます。',
            },
            status: 'published',
            blocks: [
              {
                id: 'boundary',
                type: 'callout',
                title: {
                  en: 'A platform guide, not an ICT lesson',
                  'zh-CN': '这是平台导览，不是 ICT 教学',
                  ja: 'ICT の授業ではなく、操作ガイドです',
                },
                body: {
                  en: 'The curriculum uses the 14-chapter outline supplied by the course owner. Completing this guide is not part of curriculum progress and is not an assessment.',
                  'zh-CN': '课程使用维护者提供的 14 章大纲。完成本导览不计入课程进度，也不构成任何考核。',
                  ja: 'カリキュラムは管理者が提供した全14章の概要を使用します。このガイドの完了は課程の進捗に含まれず、評価でもありません。',
                },
              },
              {
                id: 'reading',
                type: 'text',
                paragraphs: [
                  {
                    en: 'Each lesson has its own notes and checklist. Opening a page only saves your reading position; you decide when to mark a published lesson complete.',
                    'zh-CN': '每个课时都有独立笔记与检查清单。打开页面只会保存阅读位置；是否完成已发布课时由你确认。',
                    ja: '各レッスンには専用のノートとチェックリストがあります。ページを開くと閲覧位置が保存され、公開済みレッスンの完了は自分で確認します。',
                  },
                  {
                    en: 'Use the notebook to record observations, questions and the evidence you would want to review. Notes and progress stay in this browser, separate from simulated trading accounts.',
                    'zh-CN':
                      '在笔记中记录观察、疑问及需要复查的证据。笔记和进度仅保存在当前浏览器，与模拟交易账户隔离。',
                    ja: 'ノートには観察、疑問、確認したい根拠を記録できます。ノートと進捗はこのブラウザーに保存され、模擬取引口座とは別に管理されます。',
                  },
                ],
              },
              {
                id: 'guide-checklist',
                type: 'checklist',
                title: { en: 'Try the workflow', 'zh-CN': '试用学习流程', ja: '学習の流れを試す' },
                items: [
                  {
                    id: 'read-boundary',
                    required: true,
                    text: {
                      en: 'I understand this is a workspace guide, not course instruction.',
                      'zh-CN': '我理解这只是工作区导览，不是正式课程教学。',
                      ja: 'これは操作ガイドであり、正式な授業ではないと理解しました。',
                    },
                  },
                  {
                    id: 'try-notes',
                    required: true,
                    text: {
                      en: 'I have tried the notebook and understand that storage is local.',
                      'zh-CN': '我已试用笔记，并理解数据仅保存在本地。',
                      ja: 'ノートを試し、保存先がローカルであると理解しました。',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'curriculum',
        kind: 'curriculum',
        title: { en: 'Course chapters', 'zh-CN': '课程章节', ja: 'コースの章' },
        lessons: [
          chapterLesson({
            number: 1,
            title: {
              en: 'Chapter 1: Course framework and trading basics',
              'zh-CN': '第1章：课程框架与交易基础',
              ja: '第1章：コースの枠組みと取引の基礎',
            },
            summary: {
              en: 'Understand the terminology, trade conditions and execution steps.',
              'zh-CN': '理解术语、交易条件与执行步骤。',
              ja: '用語、取引条件、実行手順を理解する。',
            },
            points: {
              en: 'ICT 2022 model overview · candlesticks · instruments · order types',
              'zh-CN': 'ICT 2022 模型概览；K线；交易品种；订单类型',
              ja: 'ICT 2022モデルの概要；ローソク足；取引対象；注文種別',
            },
            example: {
              en: 'A complete simulated trade walkthrough',
              'zh-CN': '一笔模拟交易的完整流程',
              ja: '模擬取引1件の全体フロー',
            },
          }),
          chapterLesson({
            number: 2,
            title: {
              en: 'Chapter 2: Market structure and swing highs/lows',
              'zh-CN': '第2章：市场结构与摆动高低点',
              ja: '第2章：市場構造とスイング高値・安値',
            },
            summary: {
              en: 'Identify key structure and reduce invalid markings.',
              'zh-CN': '识别关键结构，减少无效标记。',
              ja: '重要な構造を特定し、無効なマーキングを減らす。',
            },
            points: {
              en: 'Swing highs and lows · trend and range · structural hierarchy',
              'zh-CN': '摆动高点与低点；趋势与盘整；结构层级',
              ja: 'スイング高値・安値；トレンドとレンジ；構造の階層',
            },
            example: {
              en: 'Marking an uptrend, downtrend and range',
              'zh-CN': '上涨、下跌与震荡行情标注',
              ja: '上昇・下降・レンジ相場のマーキング',
            },
          }),
          chapterLesson({
            number: 3,
            videoId: 'nQfHZ2DEJ8c',
            title: {
              en: 'Chapter 3: Identifying and locating liquidity',
              'zh-CN': '第3章：流动性的识别与定位',
              ja: '第3章：流動性の特定と位置づけ',
            },
            summary: {
              en: 'Distinguish liquidity locations, sweep behavior and entry conditions.',
              'zh-CN': '区分流动性位置、扫取行为与入场条件。',
              ja: '流動性の位置、掃取行動、エントリー条件を区別する。',
            },
            points: {
              en: 'Buy-side and sell-side liquidity (BSL/SSL) · equal highs/lows · prior-day high/low · liquidity inside and outside the range',
              'zh-CN': '买方／卖方流动性（BSL／SSL）；等高等低；前日高低点；区间内外流动性',
              ja: '買い方／売り方流動性（BSL／SSL）；等高値・等安値；前日高値・安値；レンジ内外の流動性',
            },
            example: {
              en: 'A liquidity sweep near a prior high or low',
              'zh-CN': '前高、前低附近的流动性扫取',
              ja: '前日高値・安値付近での流動性掃取',
            },
          }),
          chapterLesson({
            number: 4,
            title: {
              en: 'Chapter 4: Dealing range, premium and discount',
              'zh-CN': '第4章：交易区间与溢价、折价',
              ja: '第4章：取引レンジとプレミアム・ディスカウント',
            },
            summary: {
              en: 'Define the range first, then judge where price sits.',
              'zh-CN': '先确定区间，再判断价格位置。',
              ja: 'まずレンジを定め、その中での価格位置を判断する。',
            },
            points: {
              en: 'Dealing range · equilibrium · premium and discount zones',
              'zh-CN': '交易区间（Dealing Range）；均衡点；溢价区与折价区',
              ja: '取引レンジ（Dealing Range）；均衡点；プレミアム・ディスカウント帯',
            },
            example: {
              en: 'Dividing one leg into a range and locating price within it',
              'zh-CN': '同一波段的区间划分与价格定位',
              ja: '同じ波をレンジに分け、その中の価格位置を特定する',
            },
          }),
          chapterLesson({
            number: 5,
            title: {
              en: 'Chapter 5: Multi-timeframe analysis and daily bias',
              'zh-CN': '第5章：多周期分析与日内方向',
              ja: '第5章：マルチタイムフレーム分析とデイリーバイアス',
            },
            summary: {
              en: 'Build a directional hypothesis, target and invalidation.',
              'zh-CN': '建立方向假设、目标与失效条件。',
              ja: '方向性の仮説、ターゲット、無効条件を組み立てる。',
            },
            points: {
              en: 'Higher-timeframe context · daily bias · liquidity targets',
              'zh-CN': '高周期背景；日内偏向（Daily Bias）；流动性目标',
              ja: '上位足の背景；デイリーバイアス；流動性ターゲット',
            },
            example: {
              en: 'Aligning the daily, hourly and minute charts',
              'zh-CN': '日线、小时线与分钟线联动分析',
              ja: '日足・時間足・分足を連動させて分析する',
            },
          }),
          chapterLesson({
            number: 6,
            videoId: 'S9ORTYmXwdE',
            title: {
              en: 'Chapter 6: Trading sessions and the economic calendar',
              'zh-CN': '第6章：交易时段与经济日历',
              ja: '第6章：取引時間帯と経済カレンダー',
            },
            summary: {
              en: 'Put time conditions into the trading plan.',
              'zh-CN': '将时间条件纳入交易计划。',
              ja: '時間条件を取引計画に組み込む。',
            },
            points: {
              en: 'New York time · daylight saving · opening sessions · economic releases',
              'zh-CN': '纽约时间；夏令时；开盘时段；经济数据发布',
              ja: 'ニューヨーク時間；夏時間；オープン時間帯；経済指標発表',
            },
            example: {
              en: 'Comparing price action around the US open and an economic release',
              'zh-CN': '美股开盘与重要数据发布前后的行情对照',
              ja: '米国市場の寄り付きと重要指標発表前後の値動きを比較する',
            },
          }),
          chapterLesson({
            number: 7,
            title: {
              en: 'Chapter 7: Displacement and market structure shift',
              'zh-CN': '第7章：位移与市场结构转变',
              ja: '第7章：ディスプレイスメントと市場構造の転換',
            },
            summary: {
              en: 'Combine liquidity context and displacement when judging MSS.',
              'zh-CN': '结合流动性背景与位移判断 MSS。',
              ja: '流動性の背景とディスプレイスメントを合わせてMSSを判断する。',
            },
            points: {
              en: 'Displacement · market structure shift (MSS) · key short-term highs/lows',
              'zh-CN': '位移（Displacement）；市场结构转变（MSS）；关键短期高低点',
              ja: 'ディスプレイスメント；市場構造の転換（MSS）；重要な短期高値・安値',
            },
            example: {
              en: 'A sweep low followed by an upward shift, and the mirror case',
              'zh-CN': '扫低后向上转变、扫高后向下转变',
              ja: '安値掃取後の上方向への転換と、その逆のケース',
            },
          }),
          chapterLesson({
            number: 8,
            videoId: 'Bkt8B3kLATQ',
            title: {
              en: 'Chapter 8: Fair value gaps',
              'zh-CN': '第8章：公允价值缺口',
              ja: '第8章：フェアバリューギャップ',
            },
            summary: {
              en: 'Distinguish gap formation, retracement opportunities and valid trade conditions.',
              'zh-CN': '区分缺口形成、回踩机会和交易条件成立。',
              ja: 'ギャップの形成、戻り機会、取引条件の成立を区別する。',
            },
            points: {
              en: 'Fair value gap (FVG) · three-candle structure · gap boundaries · rebalance and invalidation',
              'zh-CN': '公允价值缺口（FVG）；三根K线结构；缺口边界；回补与失效',
              ja: 'フェアバリューギャップ（FVG）；3本足の構造；ギャップの境界；埋め戻しと無効化',
            },
            example: {
              en: 'Bullish and bearish FVGs, plus an invalidated example',
              'zh-CN': '看涨、看跌 FVG 与无效案例',
              ja: '強気・弱気のFVGと、無効化された例',
            },
          }),
          chapterLesson({
            number: 9,
            title: {
              en: 'Chapter 9: Intraday rhythm and the Power of Three',
              'zh-CN': '第9章：日内运行节奏与三阶段模型',
              ja: '第9章：日中リズムとPower of Three',
            },
            summary: {
              en: 'Understand phase relationships instead of mechanically copying shapes.',
              'zh-CN': '理解阶段关系，避免机械套用形态。',
              ja: '局面の関係を理解し、形を機械的に当てはめない。',
            },
            points: {
              en: 'Power of Three · accumulation, manipulation, distribution · opening price · Judas swing',
              'zh-CN': 'Power of Three；积累、操纵与派发；开盘价；Judas Swing',
              ja: 'Power of Three；蓄積・操作・分配；始値；Judas Swing',
            },
            example: {
              en: 'A sweep lower then rally, and a sweep higher then decline',
              'zh-CN': '先向下扫取再上涨、先向上扫取再下跌',
              ja: '下方向への掃取後の上昇と、上方向への掃取後の下落',
            },
          }),
          chapterLesson({
            number: 10,
            title: {
              en: 'Chapter 10: The ICT 2022 long model',
              'zh-CN': '第10章：ICT 2022 做多模型',
              ja: '第10章：ICT 2022のロングモデル',
            },
            summary: {
              en: 'Filter conditions in order and define where the model is invalid.',
              'zh-CN': '按条件顺序筛选，明确模型失效位置。',
              ja: '条件を順番に絞り、モデルが無効になる位置を明確にする。',
            },
            points: {
              en: 'Directional context · sell-side liquidity sweep · upward displacement and MSS · FVG retracement · target selection',
              'zh-CN': '方向背景；卖方流动性扫取；向上位移与 MSS；FVG 回踩；目标定位',
              ja: '方向性の背景；売り方流動性の掃取；上方向のディスプレイスメントとMSS；FVGへの戻り；ターゲット設定',
            },
            example: {
              en: 'A complete long example, a no-trigger case and a failed case',
              'zh-CN': '完整做多案例、未触发案例与失败案例',
              ja: 'ロングの完成例、未トリガー例、失敗例',
            },
          }),
          chapterLesson({
            number: 11,
            title: {
              en: 'Chapter 11: The ICT 2022 short model',
              'zh-CN': '第11章：ICT 2022 做空模型',
              ja: '第11章：ICT 2022のショートモデル',
            },
            summary: {
              en: 'Keep long and short analysis consistent and avoid early entries.',
              'zh-CN': '保持多空分析逻辑一致，避免提前入场。',
              ja: 'ロングとショートの分析を一致させ、早すぎるエントリーを避ける。',
            },
            points: {
              en: 'Directional context · buy-side liquidity sweep · downward displacement and MSS · FVG retracement · target selection',
              'zh-CN': '方向背景；买方流动性扫取；向下位移与 MSS；FVG 回抽；目标定位',
              ja: '方向性の背景；買い方流動性の掃取；下方向のディスプレイスメントとMSS；FVGへの戻り；ターゲット設定',
            },
            example: {
              en: 'A complete short example, a no-trigger case and a failed case',
              'zh-CN': '完整做空案例、未触发案例与失败案例',
              ja: 'ショートの完成例、未トリガー例、失敗例',
            },
          }),
          chapterLesson({
            number: 12,
            title: {
              en: 'Chapter 12: Stops, targets and position sizing',
              'zh-CN': '第12章：止损、止盈与仓位管理',
              ja: '第12章：ストップ、ターゲット、ポジションサイズ',
            },
            summary: {
              en: 'Define risk first, then size the position and assess the target.',
              'zh-CN': '先确定风险，再计算仓位与评估目标。',
              ja: 'まずリスクを決め、その後ポジションとターゲットを評価する。',
            },
            points: {
              en: 'Structural stop · liquidity target · risk-reward · position sizing · trading costs',
              'zh-CN': '结构止损；流动性目标；风险回报比；仓位计算；交易成本',
              ja: '構造的なストップ；流動性ターゲット；リスクリワード；ポジションサイズ；取引コスト',
            },
            example: {
              en: 'Position size and P&L at different stop distances',
              'zh-CN': '不同止损距离下的仓位与盈亏计算',
              ja: '異なるストップ幅でのポジションサイズと損益計算',
            },
          }),
          chapterLesson({
            number: 13,
            title: {
              en: 'Chapter 13: Trade filtering and execution discipline',
              'zh-CN': '第13章：交易筛选与执行纪律',
              ja: '第13章：取引の絞り込みと実行規律',
            },
            summary: {
              en: 'Build executable rules and accept no-trade days.',
              'zh-CN': '建立可执行规则，接受无交易日。',
              ja: '実行可能なルールを作り、取引しない日を受け入れる。',
            },
            points: {
              en: 'Pre-market plan · entry checklist · no-trade conditions · losing streaks and emotional management',
              'zh-CN': '盘前计划；入场检查清单；放弃交易条件；连续亏损与情绪管理',
              ja: '寄り前の計画；エントリーチェックリスト；見送り条件；連敗と感情管理',
            },
            example: {
              en: 'Range conditions, conflicting signals, missed entries and chasing',
              'zh-CN': '震荡、信号冲突、错过入场与追单案例',
              ja: 'レンジ相場、シグナル衝突、エントリー機会の逸失、追撃の例',
            },
          }),
          chapterLesson({
            number: 14,
            title: {
              en: 'Chapter 14: Backtesting, review and simulation',
              'zh-CN': '第14章：回测、复盘与模拟训练',
              ja: '第14章：バックテスト、振り返り、模擬訓練',
            },
            summary: {
              en: 'Include failed samples and costs; avoid hindsight bias.',
              'zh-CN': '纳入失败样本与成本，避免事后偏差。',
              ja: '失敗サンプルとコストを含め、後知恵を避ける。',
            },
            points: {
              en: 'Historical replay · trading journal · win rate and payoff ratio · expectancy · drawdown · forward simulation',
              'zh-CN': '历史回放；交易日志；胜率与盈亏比；期望值；回撤；前向模拟',
              ja: 'ヒストリカルリプレイ；トレード日誌；勝率とペイオフレシオ；期待値；ドローダウン；フォワードシミュレーション',
            },
            example: {
              en: 'From chart annotations to full-sample statistics',
              'zh-CN': '从图表标注到完整样本统计',
              ja: 'チャートのマーキングから全サンプル統計まで',
            },
          }),
        ],
      },
    ],
  },
])

export const learningCourses = registry.courses
export const findCourse = registry.findCourse
export const findLesson = registry.findLesson
