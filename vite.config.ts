import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const commit = process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev';

export default defineConfig({
  // Relative base: works under any GitHub Pages project path without hard-coding it.
  base: './',
  define: { __APP_COMMIT__: JSON.stringify(commit) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['robots.txt', 'apple-touch-icon.png'],
      manifest: {
        name: 'BabyLog',
        short_name: 'BabyLog',
        description: 'יומן תינוק משותף',
        lang: 'he',
        dir: 'rtl',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallback: 'index.html', cleanupOutdatedCaches: true, clientsClaim: true, skipWaiting: true },
    }),
  ],
  build: { target: 'es2020', sourcemap: false },
});
