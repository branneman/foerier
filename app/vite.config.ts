import react from '@vitejs/plugin-react'
import { FontaineTransform } from 'fontaine'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const fontsDir = fileURLToPath(new URL('../ui/fonts', import.meta.url))

export default defineConfig({
  plugins: [
    react(),

    // Generates the metric-matched fallback `@font-face` rules from the real
    // font files, so the `font-display: swap` handover does not reflow the
    // page (`frontend-design.md` §7). Deriving them beats hand-tuning
    // `size-adjust` by eye.
    FontaineTransform.vite({
      fallbacks: ['system-ui', 'Arial'],
      resolvePath: (id) => new URL(`file://${fontsDir}/${id}`),
    }),

    VitePWA({
      // `prompt` was chosen when there was no update affordance designed: it
      // deliberately never calls `skipWaiting`, so a deploy reached a client
      // only once every tab for the origin had closed — for `/join`, whose
      // Invite secret is single-use with a one-hour expiry, that is too easy
      // to lose to a stale shell running the wrong flow. `autoUpdate` makes a
      // new worker take control (and the page reload) on the next load
      // instead. `JoinContainer` checks for that update *before* it strips
      // the secret from the URL, so the reload this causes cannot land after
      // the strip and destroy an otherwise-valid link.
      registerType: 'autoUpdate',

      // The CSP forbids inline script outright — no `unsafe-inline`, no
      // hashes, no nonces (`auth-design.md` §8.2). The plugin's default
      // registration is an inline `<script>` snippet, so registration is done
      // from app code instead.
      injectRegister: null,

      manifest: {
        name: 'foerier',
        short_name: 'foerier',
        description: "The household's gear ledger.",
        start_url: '/',
        display: 'standalone',
        background_color: '#151A15',
        theme_color: '#151A15',
      },

      workbox: {
        // The precache holds the shell only. Navigation fallback serves it for
        // `/signin` and `/join` so a cold, offline, or freshly-installed
        // client resolves those routes (`auth-design.md` §8.4).
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
        runtimeCaching: [
          {
            // Auth and sync traffic is never cached, and no token, invite
            // secret, or challenge is ever written to Cache Storage.
            urlPattern: ({ url }) => url.hostname === 'api.foerier.app',
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],

  build: {
    // Both settings exist to keep the build CSP-clean rather than for size.
    // The module-preload polyfill ships as an inline script, and inlined
    // assets become `data:` URIs that `font-src 'self'` would reject.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },

  server: {
    port: 5173,
    // Listen on every interface rather than loopback only. Firefox's handling
    // of the `localhost` domain makes the default binding awkward to work
    // against, and this costs nothing locally.
    host: true,
  },

  preview: {
    port: 4173,
    host: true,
  },
})
