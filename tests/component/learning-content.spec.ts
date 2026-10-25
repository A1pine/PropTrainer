// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LearningBlocks from '@/components/learning/LearningBlocks.vue'
import LearningVideo from '@/components/learning/LearningVideo.vue'
import type { LearningBlock, LearningVideo as LearningVideoData } from '@/domain/learning/types'

const locale = ref('en')

const messages: Record<string, string> = {
  'learning.required': 'Required',
  'learning.practicePending': 'Practice is awaiting configuration.',
  'learning.freePractice': 'Open free practice',
  'learning.openResource': 'Opens in a new tab',
  'learning.loadVideo': 'Load video',
  'learning.videoPrivacy': 'No media request is made until you load this video.',
  'learning.unloadVideo': 'Unload video',
  'learning.videoUnavailable': 'Video unavailable',
}

function t(key: string) {
  const value = messages[key]
  if (!value) throw new Error(`Missing translation: ${key}`)
  return value
}

let wrapper: ReturnType<typeof mount> | undefined

beforeEach(() => {
  locale.value = 'en'
  vi.stubGlobal('useI18n', () => ({ t, locale }))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
})

function blocksView(blocks: LearningBlock[], checked: string[] = [], disabled = false) {
  const view = mount(LearningBlocks, {
    props: { blocks, checked, disabled },
    global: {
      stubs: {
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  })
  wrapper = view
  return view
}

function videoView(video: LearningVideoData) {
  const view = mount(LearningVideo, { props: { video } })
  wrapper = view
  return view
}

describe('LearningBlocks', () => {
  it('renders escaped prose in sections and keeps every block title at h2', () => {
    const blocks: LearningBlock[] = [
      {
        id: 'reading',
        type: 'text',
        paragraphs: [{ en: '<img src=x onerror="window.__xss = true">Read <strong>this</strong>' }],
      },
      {
        id: 'notice',
        type: 'callout',
        title: { en: '<script>alert(1)</script>Notice' },
        body: { en: '<b>Body</b> copy' },
      },
      {
        id: 'checks',
        type: 'checklist',
        title: { en: 'Checks' },
        items: [{ id: 'one', text: { en: 'One' }, required: true }],
      },
      {
        id: 'links',
        type: 'resources',
        title: { en: 'Links' },
        items: [{ label: { en: 'Guide' }, url: 'https://example.com/guide' }],
      },
      { id: 'practice', type: 'practice', title: { en: 'Practice' }, body: { en: 'Body' }, target: null },
    ]

    const view = blocksView(blocks)

    expect(view.classes()).toContain('academy-blocks')
    expect(view.findAll('section')).toHaveLength(5)
    expect(view.findAll('.academy-block')).toHaveLength(5)
    expect(view.find('h1').exists()).toBe(false)
    expect(view.findAll('h2')).toHaveLength(4)
    expect(view.findAll('h2').map((heading) => heading.text())).toEqual([
      '<script>alert(1)</script>Notice',
      'Checks',
      'Links',
      'Practice',
    ])

    expect(view.get('.academy-prose p').text()).toBe(
      '<img src=x onerror="window.__xss = true">Read <strong>this</strong>',
    )
    expect(view.find('img').exists()).toBe(false)
    expect(view.find('strong').exists()).toBe(false)
    expect(view.find('script').exists()).toBe(false)
    expect(view.find('b').exists()).toBe(false)
    expect(view.find('.academy-callout').exists()).toBe(true)
    expect(view.find('.academy-checklist').exists()).toBe(true)
    expect(view.find('.academy-practice').exists()).toBe(true)
  })

  it('uses the active locale with an English fallback', async () => {
    locale.value = 'zh-CN'
    const view = blocksView([
      {
        id: 'reading',
        type: 'text',
        paragraphs: [{ en: 'English only' }, { en: 'English', 'zh-CN': '中文' }],
      },
    ])

    expect(view.text()).toContain('中文')
    expect(view.text()).toContain('English only')

    locale.value = 'en'
    await nextTick()

    expect(view.text()).toContain('English')
    expect(view.text()).not.toContain('中文')
  })

  it('emits native checklist changes without mutating the checked prop', async () => {
    const checked = ['read-boundary']
    const blocks: LearningBlock[] = [
      {
        id: 'guide-checklist',
        type: 'checklist',
        title: { en: 'Try the workflow' },
        items: [
          { id: 'read-boundary', text: { en: 'Read the boundary.' }, required: true },
          { id: 'try-notes', text: { en: 'Try the notes.' }, required: false },
        ],
      },
    ]

    const view = blocksView(blocks, checked)
    const boundary = view.get('[data-check-id="read-boundary"]')
    const notes = view.get('[data-check-id="try-notes"]')

    expect(boundary.attributes('id')).toBeTruthy()
    expect((boundary.element as HTMLInputElement).checked).toBe(true)
    expect((notes.element as HTMLInputElement).checked).toBe(false)
    expect(view.text()).toContain('Required')

    await notes.setValue(true)

    expect(view.emitted('check')).toEqual([['try-notes', true]])

    await boundary.setValue(false)

    expect(view.emitted('check')).toEqual([
      ['try-notes', true],
      ['read-boundary', false],
    ])
    expect(checked).toEqual(['read-boundary'])
  })

  it('disables native inputs and emits nothing while disabled', async () => {
    const view = blocksView(
      [
        {
          id: 'checks',
          type: 'checklist',
          title: { en: 'Checks' },
          items: [{ id: 'one', text: { en: 'One' }, required: true }],
        },
      ],
      [],
      true,
    )
    const input = view.get('[data-check-id="one"]')

    expect(input.attributes('disabled')).toBeDefined()

    await input.setValue(true)

    expect(view.emitted('check')).toBeUndefined()
  })

  it('links only vetted HTTPS resources in a new tab', () => {
    const view = blocksView([
      {
        id: 'links',
        type: 'resources',
        title: { en: 'Resources' },
        items: [
          { label: { en: 'Guide' }, url: 'https://example.com/guide' },
          { label: { en: 'Unsafe script' }, url: 'javascript:alert(1)' },
          { label: { en: 'Insecure' }, url: 'http://example.com/guide' },
          { label: { en: 'Credentials' }, url: 'https://user:pass@example.com/guide' },
        ],
      },
    ])

    const links = view.findAll('a')

    expect(links).toHaveLength(1)
    expect(links[0].attributes('href')).toBe('https://example.com/guide')
    expect(links[0].attributes('target')).toBe('_blank')
    expect(links[0].attributes('rel')).toBe('noopener noreferrer')
    expect(links[0].text()).toContain('Guide')
    expect(links[0].text()).toContain('Opens in a new tab')

    expect(view.text()).toContain('Unsafe script')
    expect(view.text()).toContain('Insecure')
    expect(view.text()).toContain('Credentials')
    expect(view.find('a[href^="javascript:"]').exists()).toBe(false)
    expect(view.find('a[href^="http:"]').exists()).toBe(false)
  })

  it('links only allowlisted practice destinations and shows pending otherwise', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const invalidPractice = {
      id: 'invalid',
      type: 'practice',
      title: { en: 'Invalid' },
      body: { en: 'No destination.' },
      target: '/trade',
    } as unknown as LearningBlock

    const view = blocksView([
      { id: 'practice', type: 'practice', title: { en: 'Practice' }, body: { en: 'Try it.' }, target: '/trainer' },
      { id: 'pending', type: 'practice', title: { en: 'Pending' }, body: { en: 'Later.' }, target: null },
      invalidPractice,
    ])

    const link = view.get('a[href="/trainer"]')

    expect(link.text()).toContain('Open free practice')
    expect(link.attributes('target')).toBeUndefined()
    expect(view.findAll('a')).toHaveLength(1)
    expect(view.text()).toContain('Practice is awaiting configuration.')
    expect(view.find('a[href="/trade"]').exists()).toBe(false)

    link.element.addEventListener('click', (event) => event.preventDefault(), { once: true })
    await link.trigger('click')

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('LearningVideo', () => {
  it('waits for opt-in before loading YouTube and clears on unload or source change', async () => {
    const video = {
      type: 'youtube' as const,
      videoId: 'abcdefghijk',
      title: { en: 'Lesson video' },
    }
    const view = videoView(video)

    expect(view.findAll('h2')).toHaveLength(1)
    expect(view.get('h2').text()).toBe('Lesson video')
    expect(view.find('iframe').exists()).toBe(false)
    expect(view.find('video').exists()).toBe(false)
    expect(view.text()).toContain('No media request is made until you load this video.')

    const load = view.get('button')

    expect(load.element.tagName).toBe('BUTTON')
    expect(load.attributes('type')).toBe('button')
    expect(load.classes()).toContain('academy-secondary')
    expect(load.text()).toBe('Load video')

    await load.trigger('click')

    const iframe = view.get('iframe')

    expect(iframe.attributes('src')).toBe('https://www.youtube-nocookie.com/embed/abcdefghijk')
    expect(iframe.attributes('title')).toBe('Lesson video')
    expect(iframe.attributes('loading')).toBe('lazy')
    expect(iframe.attributes('referrerpolicy')).toBe('strict-origin-when-cross-origin')
    expect(iframe.attributes('allowfullscreen')).toBeDefined()
    expect(iframe.attributes('src')).not.toContain('autoplay')

    const unload = view.get('button')

    expect(unload.text()).toBe('Unload video')

    await unload.trigger('click')

    expect(view.find('iframe').exists()).toBe(false)
    expect(view.text()).toContain('Load video')

    await view.get('button').trigger('click')

    expect(view.find('iframe').exists()).toBe(true)

    await view.setProps({ video: { ...video, videoId: 'zyxwvutsrqp' } })

    expect(view.find('iframe').exists()).toBe(false)
    expect(view.text()).toContain('Load video')
  })

  it('uses native controls for file media and clears on same-type URL changes', async () => {
    const video = {
      type: 'file' as const,
      url: 'https://cdn.example.com/lesson-1.mp4',
      title: { en: 'File lesson' },
    }
    const view = videoView(video)

    expect(view.find('video').exists()).toBe(false)
    expect(view.find('iframe').exists()).toBe(false)

    await view.get('button').trigger('click')

    const media = view.get('video')

    expect(media.attributes('src')).toBe('https://cdn.example.com/lesson-1.mp4')
    expect(media.attributes('controls')).toBeDefined()
    expect(media.attributes('autoplay')).toBeUndefined()
    expect(media.attributes('preload')).toBe('metadata')

    await view.setProps({ video: { ...video, url: 'https://cdn.example.com/lesson-2.mp4' } })

    expect(view.find('video').exists()).toBe(false)
    expect(view.text()).toContain('Load video')

    await view.get('button').trigger('click')

    expect(view.get('video').attributes('src')).toBe('https://cdn.example.com/lesson-2.mp4')
  })

  it('refuses invalid or unsafe video sources without offering a launch control', async () => {
    const invalidVideos: LearningVideoData[] = [
      { type: 'youtube', videoId: 'too-short', title: { en: 'Broken YouTube' } },
      { type: 'file', url: 'http://example.com/video.mp4', title: { en: 'Insecure file' } },
      { type: 'file', url: 'https://user:pass@example.com/video.mp4', title: { en: 'Credentialed file' } },
    ]

    for (const video of invalidVideos) {
      const view = mount(LearningVideo, { props: { video } })

      expect(view.find('iframe').exists()).toBe(false)
      expect(view.find('video').exists()).toBe(false)
      expect(view.find('button').exists()).toBe(false)
      expect(view.text()).toContain('Video unavailable')

      view.unmount()
    }
  })

  it('clears loaded media when a valid source becomes invalid', async () => {
    const video = {
      type: 'youtube' as const,
      videoId: 'abcdefghijk',
      title: { en: 'Lesson video' },
    }
    const view = videoView(video)

    await view.get('button').trigger('click')

    expect(view.find('iframe').exists()).toBe(true)

    await view.setProps({ video: { type: 'youtube', videoId: 'broken', title: { en: 'Lesson video' } } })

    expect(view.find('iframe').exists()).toBe(false)
    expect(view.find('button').exists()).toBe(false)
    expect(view.text()).toContain('Video unavailable')
  })
})
