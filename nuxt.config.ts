import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: false },
  telemetry: false,
  modules: ['@pinia/nuxt', '@vueuse/nuxt', '@nuxtjs/i18n'],
  components: [{ path: '~/components', pathPrefix: false }],
  css: ['~/assets/css/main.css'],
  nitro: {
    // Pre-compress public assets so the 145 KiB wasm ships as ~55 KiB brotli.
    compressPublicAssets: { gzip: true, brotli: true },
  },
  routeRules: {
    // Content-hashed wasm URL (?v=<hash>) can be cached forever.
    '/wasm/**': {
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
        'content-type': 'application/wasm',
      },
    },
  },
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
        { name: 'color-scheme', content: 'light dark' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      script: [
        {
          tagPosition: 'head',
          innerHTML:
            "(function(){try{var s=JSON.parse(localStorage.getItem('propdesk.v1:settings')||'{}');var t=s.theme||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d)r.classList.add('dark');r.style.colorScheme=d?'dark':'light dark';var m=document.querySelector('meta[name=\"theme-color\"]');if(m)m.setAttribute('content',d?'#0b0b0b':'#f9f9f7');if(s.reduceMotion)r.dataset.motion='reduced'}catch(e){}})()",
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
