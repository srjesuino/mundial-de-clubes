import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// base relativa: funciona tanto em https://<usuario>.github.io/<repo>/ quanto em domínio próprio
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Mundial de Clubes 64',
        short_name: 'Mundial 64',
        description: 'Simulador de torneio de clubes de futebol com partidas jogáveis.',
        lang: 'pt-BR',
        theme_color: '#020617',
        background_color: '#020617',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // escudos dos clubes vêm de um servidor externo: cache para jogar offline depois da 1ª visita
        runtimeCaching: [{
          urlPattern: /^https:\/\/tmssl\.akamaized\.net\/images\/wappen\//,
          handler: 'CacheFirst',
          options: { cacheName: 'escudos', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 60 }, cacheableResponse: { statuses: [0, 200] } }
        }]
      }
    })
  ]
});
