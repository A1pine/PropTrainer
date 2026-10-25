# Prop Firm academy framework

## Scope

Build an independent learning area in Prop Desk, starting with **ICT 2022 Concept**. The owner supplies the chapter sequence, knowledge points, outline examples and some reference videos; the framework renders them. It is not an official ICT affiliation, not financial advice and not a substitute for the owner's full lesson material.

The shipped course contains a clearly labelled **workspace guide** (platform instructions, not ICT teaching) plus the **14-chapter outline supplied by the course owner** (titles, knowledge points, outline examples, three reference videos). Each chapter carries a self-check and an explicitly **pending practice slot**: the owner has not yet supplied the practical task, replay sample or review criteria, so nothing launches from it. The outline is not an assertion about official ICT episode numbering. No fabricated durations, instructors, performance claims, certificates or automatic trading grades.

## Implementation status

Shipped: the validated registry, versioned local repository, store, library/overview/lesson routes, outline,
text/callout/checklist/resources/practice blocks, lazy video shell, notes, required-check completion, progress,
corrupt-storage recovery and responsive light/dark layouts. The store bumps a reactive version on every commit so
`getProgress()` computeds invalidate even when a course is first created during client-side navigation. The
14 supplied chapters are `published` with outline-level content and a two-item self-check each; curriculum progress
counts them (`n of 14`).

Still owner-supplied: the full written explanation, annotated examples with market/date/timezone/data source, the
practical task and its review criteria for every chapter, plus any remaining video sources. Practice slots render
"practice is not configured yet" rather than a broken action. Authoring steps are in
[`docs/learning/content-authoring.md`](../learning/content-authoring.md).

## Routes and visual plan

- `/learn`: course library. One course entry, honest curriculum status and an action to open it. No fake catalogue filler.
- `/learn/ict-2022-concept`: course overview with an ordered contents list, readiness/progress and a resume action. The empty-curriculum state stays distinct from guide completion.
- `/learn/ict-2022-concept/workspace-guide`: functional learning workspace demonstrating text, a required checklist and personal notes.
- `/learn/ict-2022-concept/chapter-01` … `chapter-14`: owner-supplied outline chapters. Each has knowledge points, an outline example, a required self-check and a pending practice slot; chapters 3, 6 and 8 also carry owner-supplied reference videos that load only on request.
- Unknown course or lesson: a recoverable not-found view, never fallback to a different lesson.

Desktop: contained 1280px reading desk, a 236px course outline, a readable main column and a 280px notes column. Below 1200px notes follow the reading content; on phones the outline is a native disclosure. Page scroll rather than nested fixed-height panes. Breadcrumbs and previous/next links are real routes. The learning workspace, not marketing art, is the signature.

Preserve `app/assets/css/main.css:12-181` surfaces, clay, inks and both themes, the existing shell, Lucide icons, Button primitive and reduced-motion handling. New academy styles use aliases of existing tokens, sentence-case labels, 16px reading copy, no gradients or added images. Primary colour identifies the main action/current lesson, not decoration. A single containment level, hairline lesson rows and spacious prose. Do not redesign existing pages. Viewports: 1440×1000, 1280×800, 390×844 and 320px minimum.

## Files and ownership boundary

New:

- `app/domain/learning/{types,catalog}.ts`: content model, registry, validation and selectors.
- `app/lib/learning/repository.ts`: versioned, explicit-error browser repository and isolated memory implementation.
- `app/stores/learning.ts`: learning-only lifecycle/progress/notes; no terminal imports.
- `app/pages/learn/index.vue`, `app/pages/learn/[course]/index.vue`, `app/pages/learn/[course]/[lesson].vue`.
- `app/components/learning/*`, `app/assets/css/academy.css`.
- Learning unit/component tests and `scripts/check-learning.mjs`.

Targeted existing changes only: navigation registration, matching topbar badge on learning routes, three locale bundles, package check command, README. Shared trading, chart, WASM and account implementations are out of scope. Heavy chart computation remains in the existing tools, never duplicated in the course renderer.

## Content contract

Localized text is `{ en: string; 'zh-CN'?: string; ja?: string }`, with English fallback. Course content is data, never HTML to execute. No `v-html`.

- Course: stable `id`, localized `title/summary`, sections (`LearningChapter[]`).
- Chapter: stable `id`, `kind: 'orientation' | 'curriculum'`, localized title, ordered lessons.
- Lesson: stable `id`, positive integer `revision`, localized title/summary, `status: 'published' | 'draft'`, ordered blocks, optional video.
- Blocks: `text` (paragraphs), `callout` (title/body), `checklist` (stable item IDs, required flag), `resources` (label/HTTPS URL), `practice` (unconfigured or linked to a permitted free-practice tool). Checklist completion is self-reported, not a knowledge score.
- Video: optional YouTube video ID or file URL, localized title. No media request until a user loads the supplied resource. No source shipped for ICT until the owner supplies it.
- Linked practice destinations are an allowlist of `/trainer`, `/drill`, `/analysis`, `/terminal`; labelled independent free practice, not a pinned replay, grading integration or broker action. Current ICT practice stays unconfigured.

Registry validation rejects duplicate IDs, malformed content, unsafe resource/video URLs and invalid practice targets. Stable IDs survive renamed/localized titles and added sections. Publishing substantive changes increments `revision`; old notes survive but completion/checks need a new review.

## State and storage contract

Use `propdesk.learning.v1` in Web Storage, with schemaVersion 1. This does not share settings, terminal accounts or trade history. SSR starts empty and never reads a module-global memory cache. Initialize on client mount. Repository methods report errors, never silently claim a write succeeded.

Per lesson: stable course/lesson key, revision, note text (bounded), checked item IDs, visited timestamp, completed timestamp or null. Per course: last visited lesson. UI progress counts **published curriculum lessons only**, never drafts or the workspace guide; no denominator means “Curriculum pending”, not 100%.

Manual completion requires a published lesson and all required checklist items. Unchecking a required item reopens the lesson. Opening a lesson is not completion. Drafts remain draft regardless of stored state. Store APIs validate IDs and check IDs. Notes auto-save locally and remain in memory if quota/private-mode writes fail. Retry persists the latest state. Corrupt/unknown-version storage is protected from automatic overwrite; the UI offers retry reading or an explicitly confirmed reset of learning data only. Notes stay scoped when navigating between lessons. Missing/removed content must not silently reassign a note to another lesson.

## Acceptance

1. Registry validation, English fallback, readiness and derived progress, completion gates and revision behaviour.
2. Repository/store tests for reload, per-lesson isolation, corrupt/blocked storage, write errors/retry and reset isolation; no trading writes.
3. Real browser course navigation, guide checklist, note persistence, reopen/complete, chapter self-check gating and progress, pending practice, lazy video, deep links, invalid route, mobile directory and both themes.
4. Format/typecheck/full tests/production build; smoke and terminal/account checks remain passing.
5. Inspect desktop/mobile screenshots. Run Hallmark app-scope sweep on new surfaces, report unavailable tooling honestly. No external image service is needed for this text/content workspace.

## Owner handoff (one chapter at a time)

Provide chapter title, intended order, learning objective, video link or permitted local media, written explanation, annotated examples (with market/date/timezone/data source), practical task and its expected review criteria. Include rights/attribution for third-party materials. Each task must say whether it is free practice or needs an exact replay sample. Until those are supplied, there is no meaningful automated grade.

Developer insertion examples and the exact shipped API are recorded in `docs/learning/content-authoring.md`. The framework is deliberately separate from running brokerage or simulated-account actions: merely opening a lesson or a practice link must not submit trades, reset an account or move a replay clock.
