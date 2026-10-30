import dotenv from 'dotenv';
dotenv.config();

const hasSentryAuthToken = Boolean(process.env.SENTRY_AUTH_TOKEN);
const isProduction = process.env.NODE_ENV === 'production';
const shouldTypeCheck = process.env.NUXT_TYPECHECK !== 'false';

export default defineNuxtConfig({
  pwa: {
    strategies: 'injectManifest',
    srcDir: 'service-worker',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    manifest: {
      name: 'Nervion',
      short_name: 'Nervion',
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
          label: 'Nervion - канбан доска',
        },
        { src: '/screenshot-mobile.png', sizes: '700x1315', type: 'image/png', form_factor: 'narrow', label: 'Nervion - задачи' },
      ],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
    },
  },
  devtools: {
    enabled: !isProduction,
  },

  typescript: {
    typeCheck: shouldTypeCheck,
  },

  runtimeConfig: {
    apiInternalUrl: process.env.API_INTERNAL_URL || process.env.API_URL || 'http://localhost:3026',
    tenancyProxySecret: process.env.TENANCY_PROXY_SECRET || '',
    tenancyAllowedHosts: process.env.TENANCY_ALLOWED_HOSTS || '',
    public: {
      tenancyEnabled: process.env.TENANCY_ENABLED === 'true',
      tenancyRootDomain: process.env.TENANCY_ROOT_DOMAIN || 'nervion.ru',
      platformAdminHost: process.env.PLATFORM_ADMIN_HOST || 'admin.nervion.ru',
      AWS_ENDPOINT: process.env.AWS_ENDPOINT || "",
      API_URL: process.env.API_URL,
      SENTRY_DSN: process.env.NUXT_PUBLIC_SENTRY_DSN,
      metrikaId: process.env.NUXT_PUBLIC_METRIKA_ID || "",
    },
  },

  routeRules: {
    '/**': { cache: false },
  },

  app: {
    head: {
      viewport: 'width=device-width, initial-scale=1',
      style: [
        {
          children:
            '@media (max-width: 480px) {.home__desktop-filter-panel,.home__tasks-filters>.home__today-filter{display:none!important}}',
        },
      ],
      meta: [
        { name: 'yandex-verification', content: '1821b5a09daf0a20' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'Nervion' },
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
