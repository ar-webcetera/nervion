import dotenv from 'dotenv';
dotenv.config();

const hasSentryAuthToken = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default defineNuxtConfig({
  pwa: {
    strategies: 'injectManifest',
    srcDir: 'service-worker',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    manifest: {
      name: 'Tracker',
      short_name: 'TRC',
      id: '/',
      start_url: '/',
      launch_handler: {
        client_mode: 'navigate-existing',
      },
      display: 'standalone',
      theme_color: '#ffffff',
      background_color: '#ffffff',
      icons: [
        { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
      screenshots: [
        {
          src: '/screenshot-desktop.png',
          sizes: '1672x1315',
          type: 'image/png',
          form_factor: 'wide',
          label: 'Tracker — канбан доска',
        },
        { src: '/screenshot-mobile.png', sizes: '700x1315', type: 'image/png', form_factor: 'narrow', label: 'Tracker — задачи' },
      ],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
    },
  },
  devtools: {
    enabled: true,
  },

  typescript: {
    typeCheck: true,
  },

  runtimeConfig: {
    apiInternalUrl: process.env.API_INTERNAL_URL || process.env.API_URL || 'http://localhost:3026',
    public: {
      AWS_ENDPOINT: process.env.AWS_ENDPOINT || "",
      API_URL: process.env.API_URL,
      SENTRY_DSN: process.env.NUXT_PUBLIC_SENTRY_DSN,
      metrikaId: process.env.NUXT_PUBLIC_METRIKA_ID || "",
    },
  },

  app: {
    head: {
      viewport: 'width=device-width, initial-scale=1',
      meta: [
        { name: 'yandex-verification', content: '1821b5a09daf0a20' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'Tracker' },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },

  plugins: [{ src: '~/plugins/vee-validate', mode: 'client' }, '~/plugins/toast.ts', '~/plugins/click-outside.ts'],
  css: ['@/assets/styles/index.scss'],
  sourcemap: {
    server: false,
    client: false,
  },
  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `
            @use "@/assets/styles/_shared.scss" as *;
          `,
        },
      },
    },
  },

  modules: ['@vite-pwa/nuxt', '@nuxt/eslint', '@pinia/nuxt', '@sentry/nuxt/module'],

  sentry: {
    authToken: process.env.SENTRY_AUTH_TOKEN,
    telemetry: false,
    sourcemaps: {
      disable: !hasSentryAuthToken,
    },
  },

  compatibilityDate: '2025-01-27',
});
