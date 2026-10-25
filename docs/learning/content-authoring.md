# Adding academy chapters

The academy is data-driven. A new chapter is a catalog edit plus tests; no page component changes are needed.

## Where content lives

- `app/domain/learning/catalog.ts` — the validated course registry and the only shipped course (`ict-2022-concept`).
- `app/domain/learning/types.ts` — the content and progress types.
- `i18n/locales/{en,zh-CN,ja}.json` — interface copy only. Lesson copy lives in the catalog so a lesson and its translations travel together.
- `app/pages/learn/**` and `app/components/learning/**` — renderers. They must stay content-agnostic.

Do not add ICT text, episode numbers, durations or examples unless the course owner supplied them. The shipped 14
chapters use only the owner's supplied titles, knowledge points and outline examples; the full written lesson and the
practical task are still pending, so each practice block stays unconfigured.

## Lesson shape

```ts
{
  id: 'chapter-02',
  revision: 1,
  title: { en: 'Chapter 2', 'zh-CN': '第二章', ja: '第2章' },
  summary: { en: 'One sentence describing the supplied chapter.' },
  status: 'draft' | 'published',
  blocks: [
    { id: 'intro', type: 'text', paragraphs: [{ en: 'First paragraph.' }] },
    { id: 'key-idea', type: 'callout', title: { en: 'Key idea' }, body: { en: 'One supplied takeaway.' } },
    {
      id: 'checks',
      type: 'checklist',
      title: { en: 'Before you continue' },
      items: [{ id: 'checked-example', text: { en: 'I checked the supplied example.' }, required: true }],
    },
    {
      id: 'resources',
      type: 'resources',
      title: { en: 'Sources' },
      items: [{ label: { en: 'Source' }, url: 'https://example.com/source' }],
    },
    {
      id: 'practice',
      type: 'practice',
      title: { en: 'Practice' },
      body: { en: 'Free practice, not a graded replay.' },
      target: '/trainer',
    },
  ],
  video: { type: 'youtube', videoId: 'XXXXXXXXXXX', title: { en: 'Supplied video' } },
}
```

Rules:

- IDs are stable ASCII slugs and unique within their scope. Renaming a title must not change an ID.
- `revision` is a positive integer. Increment it when the substance changes; stored notes survive, but prior checks/completion are invalidated until the learner reviews the new revision.
- `status: 'draft'` is visible and inspectable but cannot be completed and has no checkable items. Use it for chapter slots awaiting material.
- Text is `{ en, 'zh-CN'?, ja? }`; missing translations fall back to English. Never put HTML in content.
- Resource links must be HTTPS. Video is lazy: no request is made until the learner presses **Load video**. YouTube IDs are embedded through `youtube-nocookie.com`; a direct file must be HTTPS.
- Practice targets are restricted to `/trainer`, `/drill`, `/analysis` and `/terminal`. A missing or unknown target renders “practice pending”, not a broken link. Linking to a tool never submits an order, resets an account or moves a replay clock.
- Required checklist items gate manual completion. Completion is self-reported; it is not a knowledge score or a trading grade.

## Publishing a chapter

1. Add the chapter and lesson in `catalog.ts` (or extend the existing `chapter-01`…`chapter-14` outline entries).
2. Set `status: 'published'` only for content the owner supplied. Outline-level chapters may be published with a
   self-check while their practice block remains unconfigured; keep `draft` when even the outline is missing.
3. Add catalog tests for the new IDs, required checks and any practice target.
4. Run `bun run test`, `bun run typecheck`, `bun run check:learning`, and inspect light/dark desktop and 390/320px screenshots.
5. Update `docs/design/academy.md` only if the framework itself changes.

## What the owner must supply per chapter

- Title, intended order and one learning objective.
- Video or media URL, with rights/attribution.
- Written explanation and annotated examples, including market, date, timezone and data source.
- A practical task and explicit review criteria.
- Whether the task is free practice or requires an exact replay sample; this release does not auto-grade chapter tasks.

Until those exist, keep the lesson as a draft. The app intentionally does not invent an ICT syllabus, durations, instructor names, performance claims or certificates.
