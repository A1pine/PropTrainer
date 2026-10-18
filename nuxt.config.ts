import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: false },
  telemetry: false,
  modules: ['@pinia/nuxt', '@vueuse/nuxt', '@nuxtjs/i18n'],
  components: [{ path: '~/components', pathPrefix: false }],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['@lucide/vue', 'clsx', 'reka-ui', 'tailwind-merge'],
    },
  },
  typescript: {
    strict: true,
    typeCheck: false,
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Prop Desk — Blind Replay Trainer',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        {
          name: 'description',
          content:
            'Train prop-firm futures execution on hidden historical-style replays. Read structure, size by risk, grade the plan.',
        },
        { name: 'theme-color', content: '#f9f9f7' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      script: [
        {
          tagPosition: 'head',
          innerHTML:
            "(function(){try{var s=JSON.parse(localStorage.getItem('propdesk.v1:settings')||'{}');var t=s.theme||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');if(s.reduceMotion)document.documentElement.dataset.motion='reduced'}catch(e){}})()",
        },
      ],
    },
    pageTransition: { name: 'page', mode: 'out-in' },
    layoutTransition: { name: 'layout', mode: 'out-in' },
  },
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    langDir: 'locales',
    locales: [
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      { code: 'zh-CN', language: 'zh-CN', name: '简体中文', file: 'zh-CN.json' },
      { code: 'ja', language: 'ja-JP', name: '日本語', file: 'ja.json' },
    ],
    detectBrowserLanguage: false,
  },
  runtimeConfig: {
    public: {
      appVersion: '0.1.0',
    },
  },
})
